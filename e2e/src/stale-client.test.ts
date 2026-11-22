import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import {
  SecretBox,
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
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { waitForScreenQuerySettled } from "./query-settled.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

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
  dir = mkdtempSync(join(tmpdir(), "ganger-stale-client-"));
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
  await warm.goto(`/runs?ws=${workspaceId}`);
  await waitForScreenQuerySettled(warm, runsListQueryKey);
  await warm.goto(`/stats?ws=${workspaceId}`);
  await warm.waitForLoadState("networkidle");
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

describe("서버 빌드가 바뀐 뒤 옛 화면(브라우저, 0180)", () => {
  it("빌드가 다르면 오류 화면의 다시 읽기가 새 페이지를 불러온다", async (context) => {
    const page = await openRuns(context);
    await reportServerBuild(page, "newer-build");
    await failServerFunctions(page);
    await openStatsFromRail(page);
    await expect.poll(() => retryButton(page).count(), { timeout: 30_000 }).toBe(1);

    await page.unroute("**/_serverFn/**");
    await retryButton(page).click();

    await page.waitForFunction(() => !("__staleMarker" in window));
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await expect.poll(() => retryButton(page).count(), { timeout: 30_000 }).toBe(0);
  }, 120_000);

  it("빌드가 같으면 다시 읽기가 페이지를 유지한 채 질의만 다시 보낸다", async (context) => {
    const page = await openRuns(context);
    await failServerFunctions(page);
    await openStatsFromRail(page);
    await expect.poll(() => retryButton(page).count(), { timeout: 30_000 }).toBe(1);

    await page.unroute("**/_serverFn/**");
    await retryButton(page).click();

    await expect.poll(() => retryButton(page).count(), { timeout: 30_000 }).toBe(0);
    expect(await hasMarker(page)).toBe(true);
  }, 120_000);

  it("질의를 거치지 않는 서버 함수가 실패해도 빌드를 확인한다", async (context) => {
    const page = await openRuns(context);
    await reportServerBuild(page, "newer-build");
    await failServerFunctions(page);
    const buildCheck = page.waitForRequest("**/api/build");

    await invalidateRootRoute(page);

    const request = await buildCheck;
    expect(new URL(request.url()).pathname).toBe("/api/build");

    const reload = page.getByRole("button", { name: shell.serverBuild.reload });
    await reload.waitFor();
    await page.unroute("**/_serverFn/**");
    await reload.click();
    await page.waitForFunction(() => !("__staleMarker" in window));
  }, 120_000);

  it("루트 오류 화면은 서버가 내려가 확인에 실패해도 창으로 돌아오면 다시 확인한다", async (context) => {
    const page = await openRuns(context);
    await page.route("**/api/build", (route) => route.abort());
    await failServerFunctions(page);
    const failedCheck = page.waitForEvent("requestfailed", (request) =>
      request.url().endsWith("/api/build"),
    );
    await invalidateRootRoute(page);
    await failedCheck;
    const reload = page.getByRole("button", { name: shell.serverBuild.reload });
    expect(await reload.count()).toBe(0);

    await page.unroute("**/api/build");
    await reportServerBuild(page, "newer-build");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    await reload.waitFor();
    await page.unroute("**/_serverFn/**");
    await reload.click();
    await page.waitForFunction(() => !("__staleMarker" in window));
  }, 120_000);

  it("오류 없는 화면에서는 알림만 보이고, 버튼을 눌러야 다시 불러온다", async (context) => {
    const page = await openRuns(context);
    await reportServerBuild(page, "newer-build");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    const reload = page.getByRole("button", { name: shell.serverBuild.reload });
    await reload.waitFor();
    expect(await page.getByText(shell.serverBuild.title).first().isVisible()).toBe(true);
    expect(await hasMarker(page)).toBe(true);

    await reload.click();
    await page.waitForFunction(() => !("__staleMarker" in window));
  }, 120_000);
});

async function invalidateRootRoute(page: Page): Promise<void> {
  await page.evaluate(() => {
    const router: unknown = Reflect.get(window, "__TSR_ROUTER__");
    if (typeof router !== "object" || router === null) throw new Error("router is missing");
    const invalidate: unknown = Reflect.get(router, "invalidate");
    if (typeof invalidate !== "function") throw new Error("router.invalidate is missing");
    const filter = (match: { routeId: string }) => match.routeId === "__root__";
    void Reflect.apply(invalidate, router, [{ filter }]);
  });
}

function retryButton(page: Page) {
  return page.getByRole("button", { name: shell.screenError.retry, exact: true });
}

function hasMarker(page: Page): Promise<boolean> {
  return page.evaluate(() => "__staleMarker" in window);
}

async function reportServerBuild(page: Page, buildId: string): Promise<void> {
  await page.route("**/api/build", (route) => route.fulfill({ json: { buildId } }));
}

async function failServerFunctions(page: Page): Promise<void> {
  await page.route("**/_serverFn/**", (route) => route.fulfill({ status: 500, body: "failed" }));
}

async function openStatsFromRail(page: Page): Promise<void> {
  await page.locator('nav a[href^="/stats"]').first().click();
}

async function openRuns(context: TestContext): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
  });
  context.onTestFinished(() => browserContext.close());
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  await page.goto(`/runs?ws=${workspaceId}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await waitForScreenQuerySettled(page, runsListQueryKey);
  await page.evaluate(() => Reflect.set(window, "__staleMarker", true));
  return page;
}

function seed(database: Database): void {
  const box = new SecretBox(encryptionKey);
  saveTrackerConnection(database, box, {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(database, box, {
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
}
