import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toAgentRef,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
  toWorktreeRef,
} from "@ganger/core";
import type { RunId, TicketKey } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  migrate,
  openDatabase,
  pruneChangeEvents,
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
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Locator, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { waitForRouterIdle } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const dashboardPath = `/?ws=${workspaceId}`;

let dir: string;
let db: Database;
let web: ViteDevServer;
let port: number;
let browser: Browser;

const fakeAdapters: Plugin = {
  name: "e2e-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

async function startWeb(fixedPort?: number): Promise<ViteDevServer> {
  const started = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
    ...(fixedPort === undefined ? {} : { port: fixedPort }),
  });
  port = Number(new URL(started.baseUrl).port);
  return started.server;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-stale-idle-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  web = await startWeb();
  browser = await chromium.launch({ channel: "chrome" });
  const warm = await browser.newPage({ baseURL: `http://127.0.0.1:${port}`, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await warm.goto(dashboardPath);
  await warm.waitForLoadState("networkidle");
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

let counter = 100;
function nextKey(): TicketKey {
  counter += 1;
  return toTicketKey(`ACME-${counter}`);
}

const VISIBLE_WITHIN_MS = 5_000;
const SHOWN_REFRESH_AFTER_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

describe("오래 둔 Dashboard(브라우저, 티켓 0210)", () => {
  it("숨은 동안 생긴 런은 다시 보일 때 이어 받아 그린다", async () => {
    const page = await newPage();
    await openDashboard(page);
    await setVisibility(page, "hidden");
    const key = nextKey();
    assign(key);

    await setVisibility(page, "visible");

    await expect.poll(() => card(page, key).count(), { timeout: VISIBLE_WITHIN_MS }).toBe(1);
  });

  it("숨은 동안 변경 줄이 하루를 넘겨 지워져도 다시 보일 때 모두 다시 읽어 그린다", async () => {
    const page = await newPage();
    await openDashboard(page);
    await setVisibility(page, "hidden");
    const key = nextKey();
    assign(key, new Date(Date.now() - 2 * DAY_MS));
    pruneChangeEvents(db, new Date(Date.now() + 2 * DAY_MS));

    await setVisibility(page, "visible");

    await expect.poll(() => card(page, key).count(), { timeout: VISIBLE_WITHIN_MS }).toBe(1);
  });

  it("페이지가 얼었다(잠듦) 풀리면 그사이 생긴 런을 그린다", async () => {
    const page = await newPage();
    await openDashboard(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    const key = nextKey();
    assign(key);
    await page.waitForTimeout(1_000);

    await cdp.send("Page.setWebLifecycleState", { state: "active" });

    await expect.poll(() => card(page, key).count(), { timeout: VISIBLE_WITHIN_MS }).toBe(1);
  });

  it("창이 숨었다고 남은 채 포커스만 얻어도, 1분 넘게 못 들었으면 다시 읽어 그린다", async () => {
    const page = await newPage();
    await page.clock.install();
    await openDashboard(page);
    await setVisibility(page, "hidden");
    const key = nextKey();
    assign(key);
    await page.clock.runFor(SHOWN_REFRESH_AFTER_MS + 1_000);
    expect(await card(page, key).count()).toBe(0);

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    await expect.poll(() => card(page, key).count(), { timeout: VISIBLE_WITHIN_MS }).toBe(1);
  });

  it("서버가 다시 시작돼도 그사이 생긴 런을 그린다", async () => {
    const page = await newPage();
    await openDashboard(page);
    const samePort = port;
    await web.close();
    const key = nextKey();
    assign(key);
    web = await startWeb(samePort);

    await expect.poll(() => card(page, key).count(), { timeout: 20_000 }).toBe(1);
  }, 90_000);
});

async function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { value: next, configurable: true });
    Object.defineProperty(document, "hidden", { value: next === "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function newPage(): Promise<Page> {
  const baseURL = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ baseURL, locale: "ko-KR", timezoneId: "UTC" });
  await context.addCookies([{ name: "tz", value: "UTC", url: baseURL }]);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  onTestFinished(() => context.close());
  return page;
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto(dashboardPath);
  await waitForRouterIdle(page, "/");
}

function card(page: Page, key: string): Locator {
  return page
    .getByRole("region", { name: home.column.queued })
    .locator("li[data-run]")
    .filter({ has: page.getByText(key, { exact: true }) });
}

function assign(key: TicketKey, now: Date = new Date()): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
    now,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  return assigned.run.id;
}

function seed(database: Database): void {
  saveTrackerConnection(database, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(database, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(database, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(database, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(database, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(database, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(database, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 1,
  });
  recordRunnerCheck(database, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
  const run = assign(toTicketKey("ACME-1"));
  const moved = changeRunState(database, run, {
    to: "running",
    started: { worktree: toWorktreeRef("wt"), branch: "b", agentRef: toAgentRef("a") },
  });
  if (!moved.ok) throw new Error("seed");
}
