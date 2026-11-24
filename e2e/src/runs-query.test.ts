import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import type { RunId } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
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
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page, Request } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import domain from "../../apps/web/messages/ko/domain.json" with { type: "json" };
import run from "../../apps/web/messages/ko/run.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { navigateByRail, serverFnName, waitForRouterIdle } from "./navigation-timing.js";
import { waitForScreenQuerySettled } from "./query-settled.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const STREAM_PATH = "/api/change-events/stream";
const VISIBLE_WITHIN_MS = 3_000;
const DISCONNECTED_POLL_MS = 30_000;
const SETTLE_MS = 1_500;
const LOG_POLL_MS = 2_000;
const LOG_POLL_LIMIT = 15;
const SERVER_TIME_ZONE = "UTC";
const BROWSER_TIME_ZONE = "Asia/Seoul";
const ROOT_FNS = ["getTimeZone", "getTitleBarHidden", "getOnboardingComplete"];

const runsListQueryKey = ["runs", "list"];

const runnerProject = toRunnerProjectId("fake:acme/web");
const runnerId = toRunnerId("runner-a");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let endedRun: RunId;
let cancelRun: RunId;
let logRun: RunId;
let watchedRun: RunId;
let revisitedRun: RunId;
let stalledLogRun: RunId;
const watchedTicket = "ACME-24";
const revisitedTicket = "ACME-25";

const fakeAdapters: Plugin = {
  name: "e2e-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-runs-query-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  for (const [path, screenQueryKey] of [
    [`/runs?ws=${workspaceId}`, runsListQueryKey],
    [`/runs/${endedRun}?ws=${workspaceId}`, runDetailQueryKey(endedRun)],
  ] as const) {
    await warm.goto(path);
    await waitForScreenQuerySettled(warm, screenQueryKey);
  }
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("Runs·Run 상세를 Query로(브라우저, 0125)", () => {
  it("서버 렌더한 Runs와 Run 상세는 hydration이 끝날 때까지 자기 서버 함수를 다시 부르지 않는다", async (context) => {
    const runsPage = await newPage(context);
    await open(runsPage, "/runs", runsListQueryKey);
    expect(runsPage.serverCalls).toEqual([]);

    const detailPage = await newPage(context);
    await open(detailPage, `/runs/${endedRun}`, runDetailQueryKey(endedRun));
    expect(detailPage.serverCalls).not.toContain("getRunDetail");
    expect(new Set(detailPage.serverCalls)).toEqual(new Set(["requestRunLog"]));
  });

  it("취소 하나 뒤에는 그 런의 상세와 처리할 일 수가 든 셸만 다시 읽고 루트는 다시 읽지 않는다", async (context) => {
    const detail = await newPage(context, { stream: "blocked" });
    await open(detail, `/runs/${cancelRun}`, runDetailQueryKey(cancelRun));
    detail.serverCalls.length = 0;

    await detail.page.getByRole("button", { name: run.cancel.trigger }).click();
    const dialog = detail.page.getByRole("dialog", { name: run.cancel.title });
    const reread = detail.page.waitForResponse(
      (response) => serverFnName(response.url()) === "getRunDetail",
    );
    await dialog.getByRole("button", { name: run.cancel.confirm }).click();
    await (await reread).finished();
    await detail.page.waitForTimeout(SETTLE_MS);

    expect(detail.serverCalls[0]).toBe("cancelRun");
    expect(detail.serverCalls.slice(1).toSorted()).toEqual(["getRunDetail", "getShell"]);
    for (const name of ROOT_FNS) expect(detail.serverCalls).not.toContain(name);
  });

  it("로그 다시 받기 뒤에는 그 런의 상세만 다시 읽는다", async (context) => {
    const detail = await newPage(context, { stream: "blocked" });
    await open(detail, `/runs/${logRun}`, runDetailQueryKey(logRun));
    await detail.page.waitForTimeout(SETTLE_MS);
    const before = detail.serverCalls.length;

    await detail.page.getByRole("button", { name: run.log.refresh }).click();
    await detail.page.getByRole("button", { name: run.log.refresh }).waitFor();
    const after = detail.serverCalls.slice(before);

    const requested = after.indexOf("requestRunLog");
    expect(requested).toBeGreaterThanOrEqual(0);
    expect(after.slice(requested)).toContain("getRunDetail");
    expect(new Set(after)).toEqual(new Set(["requestRunLog", "getRunDetail"]));
  });

  it("worker와 같은 함수로 런 상태를 바꾸면 열린 Runs와 Run 상세가 3초 안에 바뀐다", async (context) => {
    const runsPage = await newPage(context);
    await open(runsPage, "/runs", runsListQueryKey);
    await runLine(runsPage.page, "[data-waiting-card]", watchedTicket).waitFor();

    const detail = await newPage(context);
    await open(detail, `/runs/${watchedRun}`, runDetailQueryKey(watchedRun));
    const state = detail.page.locator("main");
    await expect.poll(() => state.innerText()).toContain(domain.runState.queued);

    const changedAt = Date.now();
    start(watchedRun, "wt-watched");

    await runLine(runsPage.page, "[data-runner-cards]", watchedTicket).waitFor({
      timeout: VISIBLE_WITHIN_MS,
    });
    await expect
      .poll(() => state.innerText(), { timeout: VISIBLE_WITHIN_MS })
      .toContain(domain.runState.running);
    expect(Date.now() - changedAt).toBeLessThan(VISIBLE_WITHIN_MS);
  });

  it("변경 기록 통로 없이도 다시 들어간 Runs는 뒤에서 새로 읽어 그사이 바뀐 상태를 그린다", async (context) => {
    const runsPage = await newPage(context, { stream: "blocked" });
    await open(runsPage, "/runs", runsListQueryKey);
    await runLine(runsPage.page, "[data-waiting-card]", revisitedTicket).waitFor();

    await navigateByRail(runsPage.page, "dashboard", "first");
    await runsPage.page.mouse.move(0, 0);
    start(revisitedRun, "wt-revisited");
    await navigateByRail(runsPage.page, "runs", "again");

    await runLine(runsPage.page, "[data-runner-cards]", revisitedTicket).waitFor();
    expect(await runLine(runsPage.page, "[data-runner-cards]", revisitedTicket).count()).toBe(1);
  });

  it("변경 기록 통로가 끊기면 열린 Run 상세를 30초마다 다시 읽는다(가짜 시계)", async (context) => {
    const detail = await newPage(context, { stream: "blocked", clock: true });
    await open(detail, `/runs/${endedRun}`, runDetailQueryKey(endedRun));
    await detail.page.clock.pauseAt((await detail.page.evaluate(() => Date.now())) + 100);
    await detail.page.clock.runFor(SETTLE_MS);
    const before = countOf(detail.serverCalls, "getRunDetail");

    await detail.page.clock.runFor(DISCONNECTED_POLL_MS);
    await expect.poll(() => countOf(detail.serverCalls, "getRunDetail")).toBe(before + 1);
    await waitForScreenQuerySettled(detail.page, runDetailQueryKey(endedRun));
    await detail.page.clock.runFor(DISCONNECTED_POLL_MS);
    await expect.poll(() => countOf(detail.serverCalls, "getRunDetail")).toBe(before + 2);
  });

  it("로그 받는 중 폴링 15번이 끝나도 로그가 오지 않으면 다시 요청하는 길을 보인다(가짜 시계)", async (context) => {
    const detail = await newPage(context, { stream: "blocked", clock: true });
    await open(detail, `/runs/${stalledLogRun}`, runDetailQueryKey(stalledLogRun));
    await expect.poll(() => detail.page.locator("main").innerText()).toContain(run.log.pending);
    await detail.page.clock.pauseAt((await detail.page.evaluate(() => Date.now())) + 100);

    for (let poll = 0; poll < LOG_POLL_LIMIT; poll += 1) {
      const polled = countOf(detail.serverCalls, "getRunDetail");
      await detail.page.clock.runFor(LOG_POLL_MS);
      await expect.poll(() => countOf(detail.serverCalls, "getRunDetail")).toBe(polled + 1);
      await waitForScreenQuerySettled(detail.page, runDetailQueryKey(stalledLogRun));
    }
    const afterLimit = countOf(detail.serverCalls, "getRunDetail");
    await detail.page.clock.runFor(LOG_POLL_MS * 3);

    await expect.poll(() => detail.page.locator("main").innerText()).toContain(run.log.stalled);
    expect(countOf(detail.serverCalls, "getRunDetail")).toBe(afterLimit);
  });

  it("시간대 쿠키가 바뀌면 Runs가 새 시간대로 다시 읽는다", async (context) => {
    const runsPage = await newPage(context, { timeZone: BROWSER_TIME_ZONE });
    const reread = runsPage.page.waitForRequest(
      (request) => serverFnName(request.url()) === "getRunsPage",
    );
    await runsPage.page.goto(`/runs?ws=${workspaceId}`);

    expect(await timeZoneCookieOf(await reread)).toBe(BROWSER_TIME_ZONE);
  });
});

interface OpenedPage {
  page: Page;
  serverCalls: string[];
}

async function newPage(
  context: TestContext,
  options: { stream?: "open" | "blocked"; clock?: boolean; timeZone?: string } = {},
): Promise<OpenedPage> {
  const timeZone = options.timeZone ?? SERVER_TIME_ZONE;
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: timeZone,
    viewport: { width: 1280, height: 800 },
  });
  await browserContext.addCookies([{ name: "tz", value: SERVER_TIME_ZONE, url: baseUrl }]);
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  if (options.stream === "blocked") {
    await page.route(
      (url) => url.pathname === STREAM_PATH,
      (route) => route.abort(),
    );
  }
  if (options.clock === true) await page.clock.install();
  const serverCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/")) serverCalls.push(serverFnName(request.url()));
  });
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  return { page, serverCalls };
}

async function open(
  opened: OpenedPage,
  path: string,
  screenQueryKey: ReadonlyArray<string>,
): Promise<void> {
  await opened.page.goto(`${path}?ws=${workspaceId}`);
  await opened.page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await waitForRouterIdle(opened.page, path);
  await waitForScreenQuerySettled(opened.page, screenQueryKey);
}

function runDetailQueryKey(id: RunId): string[] {
  return ["runs", "detail", id];
}

async function timeZoneCookieOf(request: Request): Promise<string | undefined> {
  const cookie = await request.headerValue("cookie");
  return cookie
    ?.split(";")
    .map((pair) => pair.trim().split("="))
    .find(([name]) => name === "tz")?.[1];
}

function countOf(serverCalls: ReadonlyArray<string>, name: string): number {
  return serverCalls.filter((call) => call === name).length;
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
    capacity: 8,
  });
  recordRunnerCheck(database, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
    assignmentBlocked: false,
  });

  endedRun = assign("ACME-21");
  start(endedRun, "wt-ended");
  ok(
    changeRunState(database, endedRun, {
      to: "ended",
      agentResult: "reported-success",
      prState: "merged",
    }),
  );
  cancelRun = assign("ACME-22");
  logRun = assign("ACME-23");
  start(logRun, "wt-log");
  watchedRun = assign(watchedTicket);
  revisitedRun = assign(revisitedTicket);
  stalledLogRun = assign("ACME-26");
  start(stalledLogRun, "wt-stalled");
}

function assign(key: string): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  return assigned.run.id;
}

function start(id: RunId, worktree: string): void {
  ok(
    changeRunState(db, id, {
      to: "running",
      started: {
        worktree: toWorktreeRef(worktree),
        branch: `acme/${worktree}`,
        agentRef: toAgentRef(`agent-${worktree}`),
      },
    }),
  );
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}

function runLine(page: Page, area: string, ticket: string) {
  return page.locator(area).getByRole("button").filter({ hasText: ticket });
}
