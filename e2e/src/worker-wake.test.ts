import { silentLogger } from "@ganger/log/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import { FakeCodeHost, FakeRunner, FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  listRuns,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { Database, StoredRun } from "@ganger/db";
import { createWorker, startTickLoop } from "@ganger/worker";
import type { TickLoop, Worker } from "@ganger/worker";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import domain from "../../apps/web/messages/ko/domain.json" with { type: "json" };
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import {
  connection,
  fakeKind,
  trackerProject,
  unassignedTicket,
  workspaceId,
} from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webServerDir = fileURLToPath(new URL("../../apps/web/src/server", import.meta.url));
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const fakeWorkerWakeModule = fileURLToPath(new URL("./fake-worker-wake.ts", import.meta.url));

const POLL_INTERVAL_MS = 60_000;
const START_WITHIN_MS = 5_000;
const runnerKind = toRunnerKind("fake");
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const githubKind = toCodeHostKind("github");

let dir: string;
let db: Database;
let worker: Worker;
let loop: TickLoop;
let ticks = 0;
const ticksAtWake: number[] = [];
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let fakeRunner: FakeRunner;

function swapWebModule(name: string, replacement: string): Plugin {
  const original = join(webServerDir, `${name}.ts`);
  return {
    name: `e2e-swap-${name}`,
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || !source.endsWith(`/${name}`)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id === original ? replacement : null;
    },
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-wake-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  const runner = seed(db);
  fakeRunner = runner;

  const tracker = new FakeTracker(fakeKind);
  tracker.addTicket(unassignedTicket);
  worker = createWorker({
    dbPath,
    registry: new AdapterRegistry()
      .registerTracker({ kind: fakeKind, create: () => tracker })
      .registerCodeHost({ kind: githubKind, create: () => new FakeCodeHost(githubKind) })
      .registerRunner({ kind: runnerKind, create: () => runner }),
    secretBox: new SecretBox(encryptionKey),
    logger: silentLogger,
  });
  loop = startTickLoop({
    tick: async () => {
      await worker.tick();
      ticks += 1;
    },
    pollIntervalMs: POLL_INTERVAL_MS,
    logger: silentLogger,
  });
  globalThis.__gangerE2eWakeWorker = () => {
    ticksAtWake.push(ticks);
    loop.wake();
  };

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [
      swapWebModule("adapters", fakeAdaptersModule),
      swapWebModule("worker-wake", fakeWorkerWakeModule),
    ],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  loop?.stop();
  await loop?.stopped;
  await worker?.close();
  globalThis.__gangerE2eWakeWorker = undefined;
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("web 이 DB 에 쓴 직후 worker 깨우기", () => {
  it("화면에서 할당한 런이 폴링 간격을 기다리지 않고 몇 초 안에 시작된다", async () => {
    await vi.waitFor(() => expect(ticks).toBe(1));
    const page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
    page.setDefaultTimeout(30_000);
    try {
      await assignFromTickets(page);
    } finally {
      await page.close();
    }
    const assignedAt = Date.now();

    expect(ticksAtWake[0]).toBe(1);
    await vi.waitFor(() => expect(runOfTicket()?.state).toBe("running"), {
      timeout: START_WITHIN_MS,
      interval: 50,
    });
    expect(Date.now() - assignedAt).toBeLessThan(START_WITHIN_MS);
    expect(ticks).toBeGreaterThan(1);
  });
});

describe("멈추기·재개(0118, 가짜 어댑터)", () => {
  it("Dashboard 카드 메뉴로 멈추면 Paused 꼬리표가 보이고, 재개 버튼으로 같은 에이전트가 이어서 Running이 된다", async () => {
    await vi.waitFor(() => expect(runOfTicket()?.state).toBe("running"), { timeout: 30_000 });
    const key = unassignedTicket.key;
    const page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
    page.setDefaultTimeout(30_000);
    try {
      await page.goto(`/?ws=${workspaceId}`);
      await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
      await page.waitForLoadState("networkidle");
      const card = page
        .getByRole("region", { name: home.column.running })
        .getByRole("listitem")
        .filter({ has: page.getByText(key, { exact: true }) });
      await card.getByRole("button", { name: fill(home.card.menu, { key }) }).click();
      await page.getByRole("menuitem", { name: home.card.pause }).click();
      await page
        .getByRole("region", { name: shell.toastRegion })
        .getByText(fill(home.control.pauseRequested, { key }))
        .waitFor();
      await vi.waitFor(() => expect(runOfTicket()?.state).toBe("paused"), { timeout: 10_000 });
      await card.getByText(domain.runState.paused, { exact: true }).waitFor();

      await card.getByRole("button", { name: home.card.resume }).click();
      await vi.waitFor(() => expect(runOfTicket()?.state).toBe("running"), { timeout: 10_000 });
      await card.getByRole("button", { name: fill(home.card.menu, { key }) }).waitFor();
    } finally {
      await page.close();
    }
    const run = runOfTicket();
    const agent =
      run === undefined || run.state === "queued" || run.state === "ended"
        ? undefined
        : fakeRunner.runAt(run.worktree);
    expect(agent?.paused).toBe(false);
    expect(agent?.resumes).toHaveLength(1);
    expect(agent?.agentStopped).toBe(false);
  });
});

describe("러너에서 멈춘 에이전트(0120, 가짜 어댑터)", () => {
  it("러너에서 에이전트 세션이 중단되면 카드가 '러너에서 멈췄어요' Paused가 되고, 재개 버튼으로 Running이 된다", async () => {
    await vi.waitFor(() => expect(runOfTicket()?.state).toBe("running"), { timeout: 30_000 });
    const run = runOfTicket();
    if (run === undefined || run.state === "queued" || run.state === "ended") {
      throw new Error("run has not started");
    }
    const key = unassignedTicket.key;
    fakeRunner.interruptOnRunner(run.worktree);
    loop.wake();
    await vi.waitFor(() => expect(runOfTicket()?.state).toBe("paused"), { timeout: 10_000 });

    const page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
    page.setDefaultTimeout(30_000);
    try {
      await page.goto(`/?ws=${workspaceId}`);
      await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
      await page.waitForLoadState("networkidle");
      const card = page
        .getByRole("region", { name: home.column.running })
        .getByRole("listitem")
        .filter({ has: page.getByText(key, { exact: true }) });
      await card.getByText(domain.runState.paused, { exact: true }).waitFor();
      await card.getByText(domain.pauseSource.runner, { exact: true }).waitFor();

      await card.getByRole("button", { name: home.card.resume }).click();
      await vi.waitFor(() => expect(runOfTicket()?.state).toBe("running"), { timeout: 10_000 });
      await card.getByRole("button", { name: fill(home.card.menu, { key }) }).waitFor();
    } finally {
      await page.close();
    }
    expect(fakeRunner.runAt(run.worktree).resumes).toHaveLength(2);
  });
});

async function assignFromTickets(page: Page): Promise<void> {
  const key = unassignedTicket.key;
  await page.goto(`/tickets?ws=${workspaceId}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("list", { name: tickets.listLabel })
    .getByRole("button", { name: unassignedTicket.title })
    .click();
  await page.getByRole("button", { name: tickets.panel.assign }).click();
  const dialog = page.getByRole("dialog", { name: fill(tickets.assign.title, { key }) });
  await dialog.getByRole("button", { name: tickets.assign.submit }).click();
  await page
    .getByRole("region", { name: shell.toastRegion })
    .getByText(fill(tickets.assign.done, { key }))
    .waitFor();
}

function runOfTicket(): StoredRun | undefined {
  return listRuns(db, { workspaceId }).find((run) => run.ticket.key === unassignedTicket.key);
}

function seed(db: Database): FakeRunner {
  saveTrackerConnection(db, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(db, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: githubKind,
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(db, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(db, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });

  const projects = [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }];
  const runner = new FakeRunner(runnerKind);
  runner.setProjects(projects);
  saveRunner(db, { id: runnerId, kind: runnerKind, name: "runner-a", config: {}, capacity: 1 });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects,
    assignmentBlocked: false,
  });
  return runner;
}

function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}
