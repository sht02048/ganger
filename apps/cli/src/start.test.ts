import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { useLogger } from "@ganger/log";
import { memoryLogger } from "@ganger/log/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingEnvFileError } from "./home.js";
import { init } from "./init.js";
import type { HoldSleepAssertion } from "./keep-awake.js";
import type { AppLayout, ProcessSpec } from "./layout.js";
import { writePowerSettings } from "@ganger/app/power-settings";
import { readServerLock, serverLockPath } from "./server-lock.js";
import { StartError, forEachLine, rotateServiceLog, start, webUrl } from "./start.js";
import type { Started } from "./start.js";

let dir: string;
let started: Started | undefined;
let logger = memoryLogger();
let restoreLogger: () => void = () => undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-cli-start-"));
  logger = memoryLogger();
  restoreLogger = useLogger(logger);
});

afterEach(async () => {
  await started?.stop();
  started = undefined;
  restoreLogger();
  rmSync(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const FAKE_WEB = `
import { createServer } from "node:http";
const server = createServer((_req, res) => res.end(JSON.stringify({ databasePath: process.env.DATABASE_PATH })));
server.listen(Number(process.env.WEB_PORT), process.env.WEB_HOST);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;
const FAKE_WORKER = `
const timer = setInterval(() => undefined, 1000);
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
`;
function workerExitingOnceExists(trigger: string): string {
  return `
import { existsSync } from "node:fs";
setInterval(() => { if (existsSync(${JSON.stringify(trigger)})) process.exit(3); }, 50);
`;
}

function fakeLayout(worker: string = FAKE_WORKER): AppLayout {
  const script = (name: ProcessSpec["name"], source: string): ProcessSpec => {
    const file = join(dir, `${name}.mjs`);
    writeFileSync(file, source);
    return { name, command: process.execPath, args: [file], cwd: dir, requires: [file] };
  };
  return { web: () => script("web", FAKE_WEB), worker: () => script("worker", worker) };
}

const quiet = () => undefined;

describe("start", () => {
  it.runIf(existsSync("/usr/bin/ssh-keygen"))(
    "처음 켜질 때 홈의 ssh 폴더에 Ganger 전용 ed25519 키를 만든다",
    async () => {
      const home = join(dir, "home");
      init({ home, port: String(await freePort()) });
      const warnings: string[] = [];
      started = await start({
        home,
        env: {},
        layout: fakeLayout(),
        onOutput: quiet,
        warn: (line) => warnings.push(line),
      });
      const key = join(home, "ssh", "id_ed25519");
      expect(statSync(key).mode & 0o777).toBe(0o600);
      expect(readFileSync(`${key}.pub`, "utf8")).toMatch(/^ssh-ed25519 /);
      expect(warnings).toEqual([]);
    },
  );

  it("다시 띄우면 돌릴 마이그레이션이 없다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const first = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    await first.stop();

    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    expect(started.migrated).toEqual([]);
  });

  it("한쪽이 먼저 끝나면 다른 쪽도 멈추고 이유를 알린다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const crashTrigger = join(dir, "crash-worker");
    started = await start({
      home,
      env: {},
      layout: fakeLayout(workerExitingOnceExists(crashTrigger)),
      onOutput: quiet,
    });
    writeFileSync(crashTrigger, "");
    expect(await started.exited).toEqual({ failure: "worker exited with code 3" });
    await expect(fetch(started.url)).rejects.toThrow("fetch failed");
  });

  it("web이 뜨기 전에 끝나면 실패하고 나머지를 멈춘다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const layout = fakeLayout();
    const crashingWeb: AppLayout = {
      web: (config) => ({ ...layout.web(config), args: ["-e", "process.exit(5)"], requires: [] }),
      worker: () => layout.worker(),
    };
    await expect(start({ home, env: {}, layout: crashingWeb, onOutput: quiet })).rejects.toThrow(
      "stopped before web responded: web exited with code 5",
    );
  });

  it("web이 응답하는 중에 신호를 받으면 뜬 것으로 치지 않고 멈춘다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const abort = new AbortController();
    const pending = start({
      home,
      env: {},
      layout: fakeLayout(),
      onOutput: quiet,
      signal: abort.signal,
      onMigrated: () => abort.abort(),
    });
    await expect(pending).rejects.toThrow("stop requested");
  });

  it("도는 동안 home 에 잠금을 쥐고, 멈추면 놓는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    expect(readServerLock(home)).toMatchObject({ pid: process.pid, url: started.url });

    await started.stop();
    expect(existsSync(serverLockPath(home))).toBe(false);
  });

  it("같은 home 에 두 번째 start 는 마이그레이션 전에 거절하고 첫 번째를 건드리지 않는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    const lock = readServerLock(home);
    if (lock === undefined) throw new Error("lock missing");
    writeFileSync(serverLockPath(home), JSON.stringify({ ...lock, pid: process.ppid }));

    let migratedAgain = false;
    await expect(
      start({
        home,
        env: {},
        layout: fakeLayout(),
        onOutput: quiet,
        onMigrated: () => (migratedAgain = true),
      }),
    ).rejects.toThrow(
      new StartError(
        `another start is already running for this home (pid ${process.ppid}, ${started.url})`,
      ),
    );
    expect(migratedAgain).toBe(false);
    expect((await fetch(started.url)).ok).toBe(true);
    writeFileSync(serverLockPath(home), JSON.stringify(lock));
  });

  it("쥔 프로세스가 없는 낡은 잠금은 새로 쥔다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    });
    writeFileSync(
      serverLockPath(home),
      JSON.stringify({ pid: Number(gone.stdout), url: "http://127.0.0.1:1", startedAt: "x" }),
    );
    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    expect(readServerLock(home)?.pid).toBe(process.pid);
  });

  it("web 이 뜨기 전에 실패해도 잠금을 남기지 않는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const layout = fakeLayout();
    const crashingWeb: AppLayout = {
      web: (config) => ({ ...layout.web(config), args: ["-e", "process.exit(5)"], requires: [] }),
      worker: () => layout.worker(),
    };
    await expect(start({ home, env: {}, layout: crashingWeb, onOutput: quiet })).rejects.toThrow(
      StartError,
    );
    expect(existsSync(serverLockPath(home))).toBe(false);
  });

  it(".env가 없으면 init을 먼저 하라고 실패한다", async () => {
    await expect(
      start({ home: join(dir, "none"), env: {}, layout: fakeLayout(), onOutput: quiet }),
    ).rejects.toThrow(MissingEnvFileError);
  });

  it("빌드 산출물이 없으면 마이그레이션 전에 실패한다", async () => {
    const home = join(dir, "home");
    const setup = init({ home });
    if (!setup.created) throw new Error("init did not create .env");
    const missing: AppLayout = {
      web: () => ({
        name: "web",
        command: process.execPath,
        args: [],
        cwd: dir,
        requires: [join(dir, "missing.js")],
      }),
      worker: () => fakeLayout().worker(),
    };
    await expect(start({ home, env: {}, layout: missing, onOutput: quiet })).rejects.toThrow(
      StartError,
    );
    expect(existsSync(setup.databasePath)).toBe(false);
  });
});

describe("start의 잠자기 방지", () => {
  function recordingHold() {
    const events: string[] = [];
    const hold: HoldSleepAssertion = (pid) => {
      events.push(`hold ${pid}`);
      return {
        exited: new Promise(() => undefined),
        release: () => events.push("release"),
      };
    };
    return { events, hold };
  }

  it("서버가 도는 동안 CLI pid로 잠자기 방지를 걸고, 서버가 끝나면 푼다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const { events, hold } = recordingHold();
    started = await start({
      home,
      env: {},
      layout: fakeLayout(),
      onOutput: quiet,
      keepAwake: { platform: "darwin", hold, warn: quiet },
    });
    expect(events).toEqual([`hold ${process.pid}`]);
    await started.stop();
    expect(events).toEqual([`hold ${process.pid}`, "release"]);
  });

  it("한쪽이 먼저 끝나 서버가 멈춰도 푼다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const crashTrigger = join(dir, "crash-worker");
    const { events, hold } = recordingHold();
    started = await start({
      home,
      env: {},
      layout: fakeLayout(workerExitingOnceExists(crashTrigger)),
      onOutput: quiet,
      keepAwake: { platform: "darwin", hold, warn: quiet },
    });
    writeFileSync(crashTrigger, "");
    await started.exited;
    expect(events).toEqual([`hold ${process.pid}`, "release"]);
  });

  it("설정을 끄면 걸지 않는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    writePowerSettings(home, { preventSleep: false });
    const { events, hold } = recordingHold();
    started = await start({
      home,
      env: {},
      layout: fakeLayout(),
      onOutput: quiet,
      keepAwake: { platform: "darwin", hold, warn: quiet },
    });
    expect(events).toEqual([]);
  });

  it("web에 설치 폴더를 넘겨 Settings가 설정 파일을 찾게 한다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const layout = fakeLayout();
    const homeEchoWeb = join(dir, "home-echo-web.mjs");
    writeFileSync(
      homeEchoWeb,
      FAKE_WEB.replace("databasePath: process.env.DATABASE_PATH", "home: process.env.GANGER_HOME"),
    );
    started = await start({
      home,
      env: {},
      layout: {
        web: (config) => ({ ...layout.web(config), args: [homeEchoWeb], requires: [homeEchoWeb] }),
        worker: () => layout.worker(),
      },
      onOutput: quiet,
    });
    expect(await (await fetch(started.url)).json()).toEqual({ home });
  });

  it("web에 CLI 위치를 넘겨 Settings가 MCP 설정 조각에 절대 경로를 쓰게 한다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const layout = fakeLayout();
    const entryEchoWeb = join(dir, "entry-echo-web.mjs");
    writeFileSync(
      entryEchoWeb,
      FAKE_WEB.replace(
        "databasePath: process.env.DATABASE_PATH",
        "cliEntry: process.env.GANGER_CLI_ENTRY",
      ),
    );
    started = await start({
      home,
      env: {},
      layout: {
        web: (config) => ({
          ...layout.web(config),
          args: [entryEchoWeb],
          requires: [entryEchoWeb],
        }),
        worker: () => layout.worker(),
      },
      onOutput: quiet,
      cliEntry: "/opt/ganger/cli/bin/cli.js",
    });
    expect(await (await fetch(started.url)).json()).toEqual({
      cliEntry: "/opt/ganger/cli/bin/cli.js",
    });
  });
});

const MESSAGE_SENDING_WEB = `
import { createServer } from "node:http";
const sent = [
  { error: "no-entry" },
  { type: "sleep" },
  "wake",
  { type: "device-activity", deviceId: "", lastUsedAt: 1 },
  { type: "wake" },
  { type: "device-activity", deviceId: "mac", lastUsedAt: 1000, extra: "dropped" },
];
const server = createServer((req, res) => {
  if (req.url === "/send") for (const message of sent) process.send(message);
  res.end("ok");
});
server.listen(Number(process.env.WEB_PORT), process.env.WEB_HOST);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

function messageRecordingWorker(out: string): string {
  return `
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(out)}, JSON.stringify({ env: process.env.GANGER_WORKER_WAKE }) + "\\n");
process.on("message", (message) => appendFileSync(${JSON.stringify(out)}, JSON.stringify(message) + "\\n"));
process.on("SIGTERM", () => process.exit(0));
`;
}

const WAKING_UNTIL_STOPPED_WEB = `
import { createServer } from "node:http";
const server = createServer((_req, res) => res.end("ok"));
server.listen(Number(process.env.WEB_PORT), process.env.WEB_HOST);
const timer = setInterval(() => process.send({ type: "wake" }, () => undefined), 5);
process.on("SIGTERM", () => setTimeout(() => { clearInterval(timer); process.exit(0); }, 200));
`;

function readLines(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));
}

describe("start 의 worker 깨우기 중계", () => {
  it("출력을 그대로 둘 때 web 이 보낸 { type: wake } 만 worker 에 닿는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const out = join(dir, "worker-messages.jsonl");
    const layout = fakeLayout(messageRecordingWorker(out));
    const web = join(dir, "sending-web.mjs");
    writeFileSync(web, MESSAGE_SENDING_WEB);
    started = await start({
      home,
      env: {},
      layout: {
        web: (config) => ({ ...layout.web(config), args: [web], requires: [web] }),
        worker: () => layout.worker(),
      },
    });

    await fetch(`${started.url}/send`);
    await vi.waitFor(() => expect(readLines(out)).toHaveLength(3));
    await fetch(`${started.url}/send`);
    await vi.waitFor(() => expect(readLines(out)).toHaveLength(5));
    const activity = { type: "device-activity", deviceId: "mac", lastUsedAt: 1000 };
    expect(readLines(out)).toEqual([
      { env: "ipc" },
      { type: "wake" },
      activity,
      { type: "wake" },
      activity,
    ]);
  });

  it("worker 가 끝난 뒤 web 이 보낸 신호는 멈춘 이유를 바꾸지 않는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const crashTrigger = join(dir, "crash-worker");
    const layout = fakeLayout(workerExitingOnceExists(crashTrigger));
    const web = join(dir, "waking-web.mjs");
    writeFileSync(web, WAKING_UNTIL_STOPPED_WEB);
    started = await start({
      home,
      env: {},
      layout: {
        web: (config) => ({ ...layout.web(config), args: [web], requires: [web] }),
        worker: () => layout.worker(),
      },
      onOutput: quiet,
    });

    writeFileSync(crashTrigger, "");
    expect(await started.exited).toEqual({ failure: "worker exited with code 3" });
  });
});

describe("webUrl", () => {
  it("모든 인터페이스에 바인딩하면 루프백으로 닿는다", () => {
    expect(webUrl({ host: "127.0.0.1", port: 3000 })).toBe("http://127.0.0.1:3000");
    expect(webUrl({ host: "0.0.0.0", port: 3000 })).toBe("http://127.0.0.1:3000");
    expect(webUrl({ host: "::", port: 3000 })).toBe("http://[::1]:3000");
    expect(webUrl({ host: "fd7a::1", port: 80 })).toBe("http://[fd7a::1]:80");
  });
});

describe("server log around start", () => {
  it("넘겨받은 출력을 조각이 아니라 온전한 줄로 넘긴다", async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    forEachLine(stream, (line) => lines.push(line));
    stream.write("first li");
    stream.write("ne\nsecond ");
    stream.write(Buffer.from("줄\n", "utf8").subarray(0, 2));
    stream.write(Buffer.from("줄\n", "utf8").subarray(2));
    stream.end("tail without newline");
    await new Promise((resolve) => stream.on("close", resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines).toEqual(["first line", "second 줄", "tail without newline"]);
  });

  it("자식이 예기치 않게 끝나면 warn 줄을, 멈추라고 해서 끝나면 info 줄을 남긴다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const trigger = join(dir, "exit-now");
    started = await start({
      home,
      env: {},
      layout: fakeLayout(workerExitingOnceExists(trigger)),
      onOutput: quiet,
    });
    writeFileSync(trigger, "");
    await started.exited;
    started = undefined;
    expect(
      logger.entries
        .filter((entry) => entry.event === "supervisor.child_exited")
        .map((entry) => [entry.level, entry.fields.child]),
    ).toEqual([
      ["warn", "worker"],
      ["info", "web"],
    ]);
  });

  it("서비스 출력 파일(ganger.log)이 한도를 넘으면 시작 전에 .1 로 옮기고 비운다", () => {
    const home = join(dir, "home");
    const logs = join(home, "logs");
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, "ganger.log"), "x".repeat(2 * 1024 * 1024));
    rotateServiceLog(home, { GANGER_LOG_MAX_MB: "1" });
    expect(statSync(join(logs, "ganger.log")).size).toBe(0);
    expect(statSync(join(logs, "ganger.log.1")).size).toBe(2 * 1024 * 1024);
  });
});
