import { readFileSync } from "node:fs";
import { DEFAULT_ORCA_PATH, parseOrcaRunnerConfig } from "./config.js";
import { OrcaRunner } from "./orca-runner.js";
import type { RemoteExec, RemoteResult, RemoteRunOptions } from "./ssh.js";

export function own(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

export function research(name: string): string {
  return readFileSync(new URL(`../../../docs/research/fixtures/${name}`, import.meta.url), "utf8");
}

export function stdout(text: string, exitCode = 0): RemoteResult {
  return { exitCode, stdout: text, stderr: "", timedOut: false };
}

export function processResult(text: string): RemoteResult {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("exitCode" in parsed) ||
    !("stdout" in parsed) ||
    !("stderr" in parsed) ||
    typeof parsed.exitCode !== "number" ||
    typeof parsed.stdout !== "string" ||
    typeof parsed.stderr !== "string"
  ) {
    throw new TypeError("not a process result fixture");
  }
  return {
    exitCode: parsed.exitCode,
    stdout: parsed.stdout,
    stderr: parsed.stderr,
    timedOut: false,
  };
}

export function peekOf(...rows: string[]): string {
  const messages: unknown[] = rows.map((row) => {
    const parsed: unknown = JSON.parse(row);
    return parsed;
  });
  return JSON.stringify({ ok: true, result: { messages } });
}

export interface RecordedCall {
  command: string;
  stdin: string | undefined;
}

type Reply = RemoteResult | ((command: string) => RemoteResult);

export class ScriptedExec implements RemoteExec {
  readonly calls: RecordedCall[] = [];
  private readonly routes: Array<{ prefix: string; replies: Reply[] }> = [];

  orca(args: string, ...replies: Reply[]): this {
    return this.on(`${DEFAULT_ORCA_PATH} ${args}`, ...replies);
  }

  on(prefix: string, ...replies: Reply[]): this {
    this.routes.push({ prefix, replies });
    return this;
  }

  run(command: string, options: RemoteRunOptions): Promise<RemoteResult> {
    this.calls.push({ command, stdin: options.stdin });
    const route = this.routes
      .filter((r) => command.startsWith(r.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (route === undefined) return Promise.reject(new Error(`unexpected command: ${command}`));
    const reply = route.replies.length > 1 ? route.replies.shift() : route.replies[0];
    if (reply === undefined) return Promise.reject(new Error(`no reply for: ${command}`));
    return Promise.resolve(typeof reply === "function" ? reply(command) : reply);
  }

  commands(): string[] {
    return this.calls.map((call) => call.command);
  }
}

export function runnerWith(
  exec: ScriptedExec,
  config: { model?: string } = {},
  sleeps: number[] = [],
): OrcaRunner {
  return new OrcaRunner(
    parseOrcaRunnerConfig({ sshTarget: "runner.example.com", ...config }),
    exec,
    {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
  );
}
