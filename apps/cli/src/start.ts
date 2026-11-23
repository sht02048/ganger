import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { z } from "zod";
import { CLI_ENTRY_ENV } from "@ganger/app/settings/mcp-launch";
import { WORKER_WAKE_ENV, WORKER_WAKE_MESSAGE, WORKER_WAKE_VIA_IPC } from "@ganger/core";
import { BOOT_ENV, migrate, openDatabase, parseBootConfig } from "@ganger/db";
import type { BootConfig } from "@ganger/db";
import { log, readLogSettings, rotateInPlaceIfOver } from "@ganger/log";
import { HOME_ENV, homePaths, readBootEnv } from "./home.js";
import { keepAwake } from "./keep-awake.js";
import type { KeepAwakeOptions } from "./keep-awake.js";
import type { AppLayout, ProcessSpec } from "./layout.js";
import { readPowerSettings } from "@ganger/app/power-settings";
import { runCommand } from "@ganger/app/runner-setup/commands";
import { ensureGangerSshKey, gangerSshPaths } from "@ganger/app/runner-setup/ganger-ssh";
import { ServerAlreadyRunningError, acquireServerLock } from "./server-lock.js";
import { messages } from "./messages.js";
import { serviceLogFile } from "./service.js";
import { webUrl } from "./web-url.js";

export { webUrl };

export const READY_TIMEOUT_MS = 60_000;
export const STOP_TIMEOUT_MS = 15_000;

export interface StartOptions {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  layout: AppLayout;
  onOutput?: (name: ProcessSpec["name"], line: string) => void;
  onMigrated?: (config: BootConfig, migrated: ReadonlyArray<string>) => void;
  signal?: AbortSignal;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  keepAwake?: Omit<KeepAwakeOptions, "serverPid" | "readSettings">;
  cliEntry?: string;
  warn?: (line: string) => void;
}

export interface Started {
  config: BootConfig;
  url: string;
  migrated: string[];
  stop(): Promise<void>;
  exited: Promise<{ failure?: string }>;
}

export class StartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartError";
  }
}

export async function start(options: StartOptions): Promise<Started> {
  const bootEnv = readBootEnv(homePaths(options.home).envFile, options.env);
  const config = parseBootConfig(bootEnv);
  const webSpec = options.layout.web(config);
  const workerSpec = options.layout.worker();
  const specs = [webSpec, workerSpec];
  const missing = specs.flatMap((spec) => spec.requires.filter((path) => !existsSync(path)));
  if (missing.length > 0) {
    throw new StartError(`build output not found (run pnpm build): ${missing.join(", ")}`);
  }

  const url = webUrl(config);
  let lock;
  try {
    lock = acquireServerLock(options.home, { pid: process.pid, url });
  } catch (error) {
    if (error instanceof ServerAlreadyRunningError) throw new StartError(error.message);
    throw error;
  }

  let migrated: string[];
  try {
    const db = openDatabase(config.databasePath);
    try {
      migrated = migrate(db);
    } finally {
      db.$client.close();
    }
    options.onMigrated?.(config, migrated);
  } catch (error) {
    lock.release();
    throw error;
  }

  rotateServiceLog(options.home, options.env);

  const sshKey = await ensureGangerSshKey(gangerSshPaths(options.home), runCommand);
  if (!sshKey.ok) {
    log().warn("supervisor.ssh_key_failed", { reason: sshKey.detail });
    options.warn?.(messages.start.sshKeyFailed(sshKey.detail));
  }

  const childEnv: Record<string, string | undefined> = {
    ...options.env,
    [HOME_ENV]: options.home,
    ...(options.cliEntry === undefined ? {} : { [CLI_ENTRY_ENV]: options.cliEntry }),
    [BOOT_ENV.host]: config.host,
    [BOOT_ENV.port]: String(config.port),
    [BOOT_ENV.databasePath]: config.databasePath,
    [BOOT_ENV.encryptionKey]: Buffer.from(config.encryptionKey).toString("base64"),
    [WORKER_WAKE_ENV]: WORKER_WAKE_VIA_IPC,
  };
  const web = spawnChild(webSpec, childEnv, options.onOutput);
  const worker = spawnChild(workerSpec, childEnv, options.onOutput);
  relayWorkerWake(web.process, worker.process);
  const group = superviseChildren([web, worker], options.stopTimeoutMs ?? STOP_TIMEOUT_MS);

  const awake =
    options.keepAwake === undefined
      ? undefined
      : keepAwake({
          ...options.keepAwake,
          warn: (line) => {
            log().warn("supervisor.keep_awake_failed", { reason: line });
            options.keepAwake?.warn(line);
          },
          serverPid: process.pid,
          readSettings: () => readPowerSettings(options.home),
        });
  const exited = group.exited.finally(() => {
    awake?.stop();
    lock.release();
  });
  try {
    await waitForWeb(
      url,
      options.readyTimeoutMs ?? READY_TIMEOUT_MS,
      group.firstFailure,
      options.signal,
    );
  } catch (error) {
    await group.stop();
    await exited;
    throw error;
  }
  return {
    config,
    url,
    migrated,
    stop: () =>
      group
        .stop()
        .then(() => exited)
        .then(() => undefined),
    exited,
  };
}

export function forEachLine(stream: Readable, onLine: (line: string) => void): void {
  createInterface({ input: stream, crlfDelay: Infinity }).on("line", onLine);
}

interface Child {
  name: ProcessSpec["name"];
  process: ChildProcess;
  exit: Promise<string>;
  kill(signal: NodeJS.Signals): void;
}

const workerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wake") }),
  z.object({
    type: z.literal("device-activity"),
    deviceId: z.string().min(1),
    lastUsedAt: z.number().int().nonnegative(),
  }),
]);

const ignoreSendFailure = (): void => undefined;

function relayWorkerWake(web: ChildProcess, worker: ChildProcess): void {
  web.on("message", (message) => {
    const parsed = workerMessageSchema.safeParse(message);
    if (!parsed.success || !worker.connected) return;
    worker.send(parsed.data.type === "wake" ? WORKER_WAKE_MESSAGE : parsed.data, ignoreSendFailure);
  });
}

function spawnChild(
  spec: ProcessSpec,
  env: Record<string, string | undefined>,
  onOutput: StartOptions["onOutput"],
): Child {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env,
    stdio:
      onOutput === undefined
        ? ["ignore", "inherit", "inherit", "ipc"]
        : ["ignore", "pipe", "pipe", "ipc"],
  });
  if (onOutput !== undefined) {
    for (const stream of [child.stdout, child.stderr]) {
      if (stream !== null) forEachLine(stream, (line) => onOutput(spec.name, line));
    }
  }
  let running = true;
  const exit = new Promise<string>((resolve) => {
    child.once("error", (error) => {
      running = false;
      resolve(`could not start: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      running = false;
      resolve(signal === null ? `exited with code ${code ?? "unknown"}` : `killed by ${signal}`);
    });
  });
  return {
    name: spec.name,
    process: child,
    exit,
    kill: (signal) => {
      if (running) child.kill(signal);
    },
  };
}

function superviseChildren(children: Child[], stopTimeoutMs: number) {
  let stopping = false;
  let failure: string | undefined;
  let notifyFailure: (reason: string) => void = () => undefined;
  const firstFailure = new Promise<string>((resolve) => (notifyFailure = resolve));

  const allExited = Promise.all(children.map((child) => child.exit));
  const stopAll = (): Promise<void> => {
    if (!stopping) {
      stopping = true;
      for (const child of children) child.kill("SIGTERM");
      const timer = setTimeout(() => {
        for (const child of children) child.kill("SIGKILL");
      }, stopTimeoutMs);
      void allExited.then(() => clearTimeout(timer));
    }
    return allExited.then(() => undefined);
  };

  for (const child of children) {
    void child.exit.then((reason) => {
      if (stopping) {
        log().info("supervisor.child_exited", { child: child.name, reason });
        return;
      }
      log().warn("supervisor.child_exited", { child: child.name, reason });
      failure = `${child.name} ${reason}`;
      notifyFailure(failure);
      void stopAll();
    });
  }

  return {
    stop: stopAll,
    firstFailure,
    exited: allExited.then(() => (failure === undefined ? {} : { failure })),
  };
}

export function rotateServiceLog(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): void {
  try {
    rotateInPlaceIfOver(serviceLogFile(home), readLogSettings(env).limits);
  } catch (error) {
    log().warn("log.rotate_failed", { path: basename(serviceLogFile(home)), error });
  }
}

async function waitForWeb(
  url: string,
  timeoutMs: number,
  failed: Promise<string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let failure: string | undefined;
  void failed.then((reason) => (failure = reason));
  const stopRequested = (): boolean => signal?.aborted === true;
  const stopped = () => new StartError("stopped before web responded: stop requested");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (failure !== undefined) throw new StartError(`stopped before web responded: ${failure}`);
    if (stopRequested()) throw stopped();
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    if (stopRequested()) throw stopped();
    return;
  }
  if (stopRequested()) throw stopped();
  throw new StartError(`web did not respond at ${url} within ${timeoutMs} ms`);
}
