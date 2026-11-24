import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { TrackerLabel, TrackerProject, TrackerProjectId, TrackerState } from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  getMcpWriteAllowed,
  migrate,
  openDatabase,
  recordRunnerCheck,
  recordWebhookAccepted,
  replaceMapping,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMcpWriteAllowed,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { serverFnName, waitForRouterIdle } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

const fakeGhModule = fileURLToPath(new URL("./browser/fake-gh.ts", import.meta.url));
const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const STREAM_PATH = "/api/change-events/stream";
const VISIBLE_WITHIN_MS = 3_000;
const SETTLE_MS = 700;
const DISCONNECTED_POLL_MS = 30_000;
const ROOT_AND_SHELL = ["getTimeZone", "getTitleBarHidden", "getShell"];
const TRACKER_FUNCTIONS = ["getTrackerProjects", "getBoundProjectReads"];

const runnerId = toRunnerId("runner-a");
const webRepo = toRunnerProjectId("fake:acme/web");
const apiRepo = toRunnerProjectId("fake:acme/api");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const registryKey = "__gangerE2eSettingsQueryRegistry";
const secretBoxKey = "__gangerE2eSettingsQuerySecretBox";
const virtualAdapters = "\0e2e-settings-query-adapters";
const projectPath = `/settings/projects/${connection}/${trackerProject}`;
const connectionPath = `/settings/connections/${connection}`;

class CountingTracker extends FakeTracker {
  reads = 0;

  override listProjects(): Promise<ReadonlyArray<TrackerProject>> {
    this.reads += 1;
    return super.listProjects();
  }

  override listStates(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerState>> {
    this.reads += 1;
    return super.listStates(projectId);
  }

  override listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>> {
    this.reads += 1;
    return super.listLabels(projectId);
  }
}

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let tracker: CountingTracker;

const fakeAdapters: Plugin = {
  name: "e2e-settings-query-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? virtualAdapters : null;
  },
  load(id) {
    if (id !== virtualAdapters) return null;
    return [
      `export function getAdapterRegistry() { return globalThis[${JSON.stringify(registryKey)}]; }`,
      `export function getSecretBox() { return globalThis[${JSON.stringify(secretBoxKey)}]; }`,
      `export { getGitHubAuth } from ${JSON.stringify(fakeGhModule)};`,
    ].join("\n");
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-settings-query-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  tracker = new CountingTracker(fakeKind);
  tracker.projects.push({
    id: trackerProject,
    name: "Web",
    url: "https://tracker.example.com/web",
  });
  tracker.states.set(trackerProject, [
    { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
    { id: toTrackerStateId("in-progress"), name: "In Progress", category: "started" },
  ]);
  tracker.labels.set(trackerProject, [{ id: toLabelId("factory"), name: "factory" }]);
  Object.assign(globalThis, {
    [registryKey]: new AdapterRegistry().registerTracker({
      kind: fakeKind,
      create: () => tracker,
    }),
    [secretBoxKey]: new SecretBox(encryptionKey),
  });

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  for (const path of ["/settings", "/settings/mcp", projectPath, connectionPath]) {
    await warm.goto(`${path}?ws=${workspaceId}`);
    await warm.waitForLoadState("networkidle");
  }
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  Reflect.deleteProperty(globalThis, registryKey);
  Reflect.deleteProperty(globalThis, secretBoxKey);
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [
      { id: webRepo, displayName: "acme/web", setupState: "ready" },
      { id: apiRepo, displayName: "acme/api", setupState: "ready" },
    ],
    assignmentBlocked: false,
  });
  replaceMapping(db, {
    connection,
    trackerProject,
    agent,
    repos: [{ project: webRepo, isDefault: true, labelId: null }],
  });
  saveMcpWriteAllowed(db, false, new Date());
});

interface Opened {
  page: Page;
  serverCalls: string[];
}

async function newPage(
  context: TestContext,
  options: { stream: boolean; clock?: boolean },
): Promise<Opened> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 800 },
  });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  if (options.clock === true) await page.clock.install();
  if (!options.stream)
    await page.route(
      (url) => url.pathname === STREAM_PATH,
      (route) => route.abort(),
    );
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

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${path}?ws=${workspaceId}`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await waitForRouterIdle(page, path);
  await page.waitForLoadState("networkidle");
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(SETTLE_MS);
}

function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

async function addApiRepo(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: fill(settings.mapping.addLabel, { project: "Web" }) })
    .click();
  await page.getByRole("menuitem", { name: "acme/api", exact: true }).click();
  await page.getByRole("status").getByText(settings.mapping.status.saved).first().waitFor();
}

describe("Settings 의 Query(브라우저, 0128)", () => {
  it("서버 렌더한 Settings 세 화면과 연결 상세는 hydration 이 끝날 때까지 서버 함수를 다시 부르지 않는다", async (context) => {
    for (const path of ["/settings", "/settings/mcp", projectPath, connectionPath]) {
      const { page, serverCalls } = await newPage(context, { stream: false });
      await open(page, path);
      await settle(page);
      expect({ path, serverCalls }).toEqual({ path, serverCalls: [] });
      await page.context().close();
    }
  });

  it("Mapping 을 저장하면 DB 설정만 다시 읽고 트래커 프로젝트·상태·라벨과 루트·셸은 다시 읽지 않는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, projectPath);
    await settle(page);
    const trackerReads = tracker.reads;
    serverCalls.length = 0;

    await addApiRepo(page);
    await settle(page);

    expect(serverCalls).toEqual(["saveWorkspaceMapping", "getSettings"]);
    expect(tracker.reads).toBe(trackerReads);
  });

  it("변경 기록 통로가 켜져 있어도 Mapping 저장 뒤 트래커를 다시 읽지 않는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: true });
    await open(page, projectPath);
    await settle(page);
    const trackerReads = tracker.reads;
    serverCalls.length = 0;

    await addApiRepo(page);
    await page.waitForTimeout(VISIBLE_WITHIN_MS);
    await settle(page);

    expect(serverCalls.filter((call) => TRACKER_FUNCTIONS.includes(call))).toEqual([]);
    expect(tracker.reads).toBe(trackerReads);
  });

  it("런이 시작되면 바꿀 상태를 저장하면 DB 설정만 다시 읽는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, projectPath);
    await settle(page);
    serverCalls.length = 0;

    await page.getByRole("combobox", { name: settings.project.state }).click();
    await page.getByRole("option", { name: "Todo", exact: true }).click();
    await page.getByText(settings.status.saved, { exact: true }).first().waitFor();
    await settle(page);

    expect(serverCalls).toEqual(["saveWorkspaceInProgressState", "getSettings"]);
    saveWorkspaceTrackerProject(db, {
      workspaceId,
      connection,
      projectId: trackerProject,
      name: "Web",
      inProgressStateId: toTrackerStateId("in-progress"),
    });
  });

  it("MCP 쓰기 허용을 저장하면 DB 설정만 다시 읽고, 저장했다고 알릴 때 이미 새 값이다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, "/settings/mcp");
    await settle(page);
    serverCalls.length = 0;
    const toggle = page.getByRole("switch", { name: settings.mcp.writeToggle });

    await toggle.click();
    await page.getByText(settings.status.saved, { exact: true }).waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await settle(page);

    expect(serverCalls).toEqual(["saveMcpWriteSettings", "getSettings"]);
    expect(serverCalls).not.toEqual(expect.arrayContaining(ROOT_AND_SHELL));
    expect(getMcpWriteAllowed(db)).toBe(true);
  });

  it("Workspace 이름을 저장하면 DB 설정과 셸만 다시 읽고 트래커는 다시 읽지 않는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, "/settings");
    await settle(page);
    const workspace = page.getByRole("region", {
      name: settings.sections.workspace,
      exact: true,
    });
    await workspace
      .getByRole("button", { name: `${settings.workspace.name} ${settings.change}` })
      .click();
    serverCalls.length = 0;

    await workspace
      .getByRole("textbox", { name: settings.workspace.name, exact: true })
      .fill("Acme Renamed");
    await workspace.getByRole("button", { name: settings.save }).click();
    await page.getByRole("button", { name: /^Workspace 바꾸기, 지금 Acme Renamed/ }).waitFor();
    await settle(page);

    expect(serverCalls.toSorted()).toEqual(["getSettings", "getShell", "saveWorkspaceGeneral"]);
    saveWorkspace(db, { id: workspaceId, name: "Acme" });
  });

  it("Linear에서 다시 읽기는 트래커 query 만 다시 읽는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, projectPath);
    await settle(page);
    serverCalls.length = 0;

    await page.getByRole("button", { name: settings.mapping.reload }).click();
    await page.getByText(settings.mapping.reloaded).waitFor();
    await settle(page);

    expect(serverCalls.toSorted()).toEqual([
      "getBoundProjectReads",
      "getTrackerProjects",
      "rereadTrackers",
    ]);
  });

  it("다른 탭에서 설정을 저장하면 열린 Settings 가 3초 안에 바뀐다", async (context) => {
    const { page } = await newPage(context, { stream: true });
    await open(page, "/settings/mcp");
    await settle(page);
    const toggle = page.getByRole("switch", { name: settings.mcp.writeToggle });
    expect(await toggle.getAttribute("aria-checked")).toBe("false");

    const other = await page.context().browser()?.newPage({ baseURL: baseUrl, locale: "ko-KR" });
    if (other === undefined) throw new Error("second tab did not open");
    await open(other, "/settings/mcp");
    await other.getByRole("switch", { name: settings.mcp.writeToggle }).click();
    await other.getByText(settings.status.saved, { exact: true }).waitFor();

    await expect
      .poll(() => toggle.getAttribute("aria-checked"), { timeout: VISIBLE_WITHIN_MS })
      .toBe("true");
    await other.close();
  });

  it("webhook 을 처음 받으면 열린 연결 상세가 폴링 없이 3초 안에 받는 중으로 바뀐다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: true });
    await open(page, connectionPath);
    const webhook = page.getByRole("region", { name: settings.webhook.title, exact: true });
    await webhook.getByText(settings.webhook.status.waiting).waitFor();
    await settle(page);
    serverCalls.length = 0;

    recordWebhookAccepted(db, connection, new Date());

    await webhook
      .getByText(settings.webhook.status.receiving)
      .waitFor({ timeout: VISIBLE_WITHIN_MS });
    expect(serverCalls).toEqual(["getSettings"]);
  });

  it("연결 이름을 바꾸면 제목과 문서 제목이 함께 바뀐다", async (context) => {
    const { page } = await newPage(context, { stream: false });
    await open(page, connectionPath);
    const section = page.getByRole("region", { name: settings.connection.section, exact: true });
    await section
      .getByRole("button", { name: `${settings.connection.name} ${settings.change}` })
      .click();
    await section
      .getByRole("textbox", { name: settings.connection.name, exact: true })
      .fill("Acme Two");
    await section.getByRole("button", { name: settings.save }).click();
    await page.getByRole("heading", { level: 1, name: "Acme Two" }).waitFor();

    await expect
      .poll(() => page.title())
      .toBe(fill(settings.connection.documentTitle, { name: "Acme Two" }));
    seedConnection(db);
  });

  it("변경 기록이 끊기면 열린 Settings 가 30초마다 다시 읽는다(가짜 시계)", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false, clock: true });
    await open(page, "/settings");
    const reads = () => serverCalls.filter((call) => call === "getSettings").length;
    const before = reads();

    await page.clock.runFor(DISCONNECTED_POLL_MS);
    await expect.poll(reads).toBe(before + 1);
    await page.clock.runFor(DISCONNECTED_POLL_MS);
    await expect.poll(reads).toBe(before + 2);
  });

  it("프로젝트 상세에서 프로젝트를 빼면 찾을 수 없음 화면 없이 Settings 로 돌아가고 목록에서 빠진다", async (context) => {
    saveWorkspaceTrackerProject(db, {
      workspaceId,
      connection,
      projectId: toTrackerProjectId("tp-docs"),
      name: "Docs",
      inProgressStateId: null,
    });
    const { page } = await newPage(context, { stream: false });
    await open(page, `/settings/projects/${connection}/tp-docs`);
    await page.evaluate((notFound) => {
      const watch = new MutationObserver(() => {
        if (document.body.textContent?.includes(notFound))
          document.body.dataset["sawNotFound"] = "1";
      });
      watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, settings.project.notFound);

    await page.getByRole("button", { name: settings.projects.remove }).click();
    await page.getByRole("dialog").getByRole("button", { name: settings.projects.remove }).click();
    await page.waitForURL((url) => url.pathname === "/settings");
    const projects = page.getByRole("region", { name: settings.sections.projects, exact: true });
    await projects.getByRole("link", { name: /^Web/ }).waitFor();
    await settle(page);

    expect(await projects.getByRole("link", { name: /^Docs/ }).count()).toBe(0);
    expect(await page.evaluate(() => document.body.dataset["sawNotFound"] ?? null)).toBeNull();
  });
});

function seedConnection(database: Database): void {
  saveTrackerConnection(database, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret", webhookSecret: "whsec_example" },
  });
}

function seed(database: Database): void {
  const secretBox = new SecretBox(encryptionKey);
  seedConnection(database);
  saveCodeHostConnection(database, secretBox, {
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
  saveAutoAssignLabel(database, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(database, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
}
