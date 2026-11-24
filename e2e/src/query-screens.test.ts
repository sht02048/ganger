import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterError,
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toDeliveryId,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
} from "@ganger/core";
import type {
  Page as TrackerPage,
  Paged,
  TrackerLabel,
  TrackerProjectId,
  TrackerTicket,
} from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  assignRun,
  changeRunState,
  completeRunnerCheckRequest,
  listPendingRunnerCheckRequests,
  markTrackerChanged,
  migrate,
  openDatabase,
  recordRunnerCheck,
  recordTrackerEvent,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
  toWorkspaceId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { loadShell } from "@ganger/app/shell/load";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import runners from "../../apps/web/messages/ko/runners.json" with { type: "json" };
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { serverFnName, waitForRouterIdle, waitForScreen } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

const fakeGhModule = fileURLToPath(new URL("./browser/fake-gh.ts", import.meta.url));
const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const STREAM_PATH = "/api/change-events/stream";
const VISIBLE_WITHIN_MS = 3_000;
const SETTLE_MS = 700;
const DISCONNECTED_POLL_MS = 30_000;
const QUERY_GC_MS = 5 * 60_000;
const DB_STALE_MS = 30_000;
const ROOT_READS = ["getTimeZone", "getTitleBarHidden"];
const ROOT_AND_SHELL = [...ROOT_READS, "getShell"];

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const registryKey = "__gangerE2eQueryScreensRegistry";
const secretBoxKey = "__gangerE2eQueryScreensSecretBox";
const virtualAdapters = "\0e2e-query-screens-adapters";

class CountingTracker extends FakeTracker {
  ticketReads = 0;
  labelReads = 0;
  failing = false;

  override listProjectTickets(
    projectId: TrackerProjectId,
    page?: TrackerPage,
  ): Promise<Paged<TrackerTicket>> {
    this.ticketReads += 1;
    if (this.failing) return Promise.reject(new AdapterError({ kind: "rate-limited" }));
    return super.listProjectTickets(projectId, page);
  }

  override listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>> {
    this.labelReads += 1;
    return super.listLabels(projectId);
  }
}

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let tracker: CountingTracker;
let nextTicket = 1;
let nextDelivery = 1;

const fakeAdapters: Plugin = {
  name: "e2e-query-screens-adapters",
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
  dir = mkdtempSync(join(tmpdir(), "ganger-query-screens-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  tracker = new CountingTracker(fakeKind);
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
  for (const path of ["/runners", "/tickets", "/"]) {
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
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
    assignmentBlocked: false,
  });
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

async function open(
  page: Page,
  path: string,
  screen: "runners" | "tickets" | "runs" | "stats",
): Promise<void> {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}ws=${workspaceId}`);
  await waitForScreen(page, screen);
  await waitForRouterIdle(page, new URL(path, baseUrl).pathname);
  await page.waitForLoadState("networkidle");
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(SETTLE_MS);
}

function addTicket(title: string): TrackerTicket {
  const ticket: TrackerTicket = {
    key: toTicketKey(`ACME-${nextTicket}`),
    title,
    body: "",
    url: `https://tracker.example.com/ACME-${nextTicket}`,
    labels: [],
    project: { id: trackerProject, name: "Web" },
    state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
    updatedAt: new Date(Date.UTC(2026, 10, 17) + nextTicket * 60_000),
  };
  nextTicket += 1;
  tracker.addTicket(ticket);
  markTrackerChanged(db, connection);
  return ticket;
}

function runnerOffline(): void {
  recordRunnerCheck(db, {
    runnerId,
    online: false,
    checkedAt: new Date(),
    error: { kind: "unreachable", detail: "ssh timed out" },
    projects: null,
    assignmentBlocked: null,
  });
}

function railLink(page: Page, name: string) {
  return page.getByRole("navigation", { name: shell.nav.label }).getByRole("link", { name });
}

describe("셸·Runners·Tickets 의 Query(브라우저, 0127)", () => {
  it("서버 렌더한 Tickets 와 Runners 는 hydration 이 끝날 때까지 서버 함수를 다시 부르지 않는다", async (context) => {
    addTicket("Hydration ticket");
    for (const [path, screen] of [
      ["/tickets", "tickets"],
      ["/runners", "runners"],
    ] as const) {
      const { page, serverCalls } = await newPage(context, { stream: false });
      await open(page, path, screen);
      await settle(page);
      expect(serverCalls).toEqual([]);
      await page.context().close();
    }
  });

  it("할당 뒤에는 Tickets 의 DB 부분과 처리할 일 수가 든 셸만 다시 읽고 트래커·루트는 다시 읽지 않는다", async (context) => {
    const ticket = addTicket("Assign without tracker reread");
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, "/tickets?f=assignable", "tickets");
    await page
      .getByRole("list", { name: tickets.listLabel })
      .getByRole("button", { name: `${ticket.key} ${ticket.title}` })
      .click();
    const panel = page.getByRole("region", { name: tickets.panel.label });
    await panel.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: tickets.assign.submit }).waitFor();
    await settle(page);
    const trackerReads = tracker.ticketReads + tracker.labelReads;
    serverCalls.length = 0;

    await dialog.getByRole("button", { name: tickets.assign.submit }).click();
    await dialog.waitFor({ state: "hidden" });
    await settle(page);

    expect(serverCalls[0]).toBe("assignTicket");
    expect(serverCalls.slice(1).toSorted()).toEqual(["getShell", "getTicketRuns"]);
    expect(tracker.ticketReads + tracker.labelReads).toBe(trackerReads);
  });

  it("변경 기록 통로가 켜져 있어도 할당 뒤 트래커를 다시 읽지 않는다", async (context) => {
    const ticket = addTicket("Assign with change feed");
    const { page, serverCalls } = await newPage(context, { stream: true });
    await open(page, "/tickets?f=assignable", "tickets");
    await page
      .getByRole("list", { name: tickets.listLabel })
      .getByRole("button", { name: `${ticket.key} ${ticket.title}` })
      .click();
    const panel = page.getByRole("region", { name: tickets.panel.label });
    await panel.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: tickets.assign.submit }).waitFor();
    await settle(page);
    const trackerReads = tracker.ticketReads + tracker.labelReads;
    serverCalls.length = 0;

    await dialog.getByRole("button", { name: tickets.assign.submit }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForTimeout(VISIBLE_WITHIN_MS);
    await settle(page);

    expect(serverCalls).not.toContain("getTrackerTickets");
    expect(tracker.ticketReads + tracker.labelReads).toBe(trackerReads);
  });

  it("화면 이동 한 번에 Tickets 는 서버 함수 둘(DB 부분, 트래커 부분)만 부르고 라벨을 따로 읽지 않는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, "/runners", "runners");
    await page.mouse.move(0, 0);
    serverCalls.length = 0;

    await railLink(page, shell.nav.tickets).click();
    await waitForScreen(page, "tickets");
    await settle(page);

    expect(serverCalls.toSorted()).toEqual(["getTicketRuns", "getTrackerTickets"]);
  });

  it("다시 점검은 Runners 목록만 다시 읽고, 점검이 끝나면 목록과 셸만 다시 읽는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, `/runners?sel=${runnerId}`, "runners");
    serverCalls.length = 0;

    const panel = page.getByRole("region", { name: runners.panel.label });
    await panel.getByRole("button", { name: runners.panel.recheck }).click();
    await panel.getByRole("button", { name: runners.panel.checking }).waitFor();
    await expect
      .poll(() => serverCalls.includes("getRunnerChecksPending"), { timeout: 5_000 })
      .toBe(true);
    await page.waitForTimeout(4_000);
    expect(serverCalls.filter((call) => call !== "getRunnerChecksPending")).toEqual([
      "requestRunnerCheckNow",
      "getRunnersPage",
    ]);

    serverCalls.length = 0;
    for (const pending of listPendingRunnerCheckRequests(db)) {
      completeRunnerCheckRequest(db, { ...pending, completedAt: new Date(), error: "failed" });
    }
    await panel.getByRole("button", { name: runners.panel.recheck }).waitFor();
    await settle(page);

    const refetched = serverCalls.filter((call) => call !== "getRunnerChecksPending");
    expect(refetched.toSorted()).toEqual(["getRunnersPage", "getShell"]);
    expect(serverCalls.filter((call) => ROOT_AND_SHELL.slice(0, 2).includes(call))).toEqual([]);
  });

  it("러너가 Offline 이 되면 셸 배지와 Runners 가 3초 안에 바뀐다", async (context) => {
    const { page } = await newPage(context, { stream: true });
    await open(page, `/runners?sel=${runnerId}`, "runners");
    const badge = railLink(page, `${shell.nav.runners}, Runner Issue 1개`);
    expect(await badge.count()).toBe(0);

    const changedAt = Date.now();
    runnerOffline();

    await badge.waitFor({ timeout: VISIBLE_WITHIN_MS });
    await page
      .getByRole("region", { name: runners.panel.label })
      .getByRole("region", { name: runners.panel.fix.offline.title })
      .waitFor({ timeout: VISIBLE_WITHIN_MS });
    expect(Date.now() - changedAt).toBeLessThan(VISIBLE_WITHIN_MS + 500);
  });

  it("런이 처리할 일이 되면 셸의 Dashboard 배지가 3초 안에 바뀐다(티켓 0212)", async (context) => {
    const { page } = await newPage(context, { stream: true });
    await open(page, "/runners", "runners");
    const before = loadShell(db).todo.byWorkspace[workspaceId] ?? 0;
    const dashboardLink = (count: number) =>
      page.getByRole("navigation", { name: shell.nav.label }).getByRole("link", {
        name: count === 0 ? shell.nav.dashboard : `${shell.nav.dashboard}, 처리할 일 ${count}개`,
        exact: true,
      });
    await dashboardLink(before).waitFor();

    const ticket = addTicket("Could not start");
    const assigned = assignRun(db, {
      ticket: { connection, key: ticket.key },
      trackerProject,
      runnerProject,
      agent,
      now: new Date(),
    });
    if (!assigned.ok) throw new Error(assigned.reason);
    const ended = changeRunState(db, assigned.run.id, {
      to: "ended",
      agentResult: "could-not-start",
      prState: "none",
    });
    if (!ended.ok) throw new Error(JSON.stringify(ended.error));

    const link = dashboardLink(before + 1);
    await link.waitFor({ timeout: VISIBLE_WITHIN_MS });
    const badge = link.locator('[data-badge="todo"]');
    expect(await badge.textContent()).toBe(String(before + 1));
    expect(await badge.getAttribute("aria-hidden")).toBe("true");
  });

  it("Workspace 를 더하면 셸의 Workspace 목록이 바뀐다", async (context) => {
    const { page } = await newPage(context, { stream: true });
    await open(page, "/runners", "runners");

    saveWorkspace(db, { id: toWorkspaceId("ws-labs"), name: "Acme Labs" });

    const menu = page.getByRole("button", { name: /^Workspace 바꾸기/ });
    await expect
      .poll(
        async () => {
          await menu.click();
          const found = await page.getByRole("menuitemradio", { name: "Acme Labs" }).count();
          await page.keyboard.press("Escape");
          return found;
        },
        { timeout: VISIBLE_WITHIN_MS },
      )
      .toBe(1);
  });

  it("트래커 webhook 을 받으면 Tickets 의 트래커 query 를 다시 읽어 서버 캐시가 있어도 새 값을 보인다", async (context) => {
    const ticket = addTicket("Before webhook");
    const { page } = await newPage(context, { stream: true });
    await open(page, "/tickets", "tickets");
    const list = page.getByRole("list", { name: tickets.listLabel });
    await list.getByRole("button", { name: `${ticket.key} Before webhook` }).waitFor();

    const trackerReads = tracker.ticketReads;
    tracker.addTicket({ ...ticket, title: "After webhook" });
    recordTrackerEvent(db, connection, {
      deliveryId: toDeliveryId(`delivery-${nextDelivery++}`),
      kind: "ticket.updated",
      ticketKey: ticket.key,
      projectId: trackerProject,
      labelIds: null,
      previousLabelIds: null,
      receivedAt: new Date(),
    });

    await list
      .getByRole("button", { name: `${ticket.key} After webhook` })
      .waitFor({ timeout: VISIBLE_WITHIN_MS });
    expect(tracker.ticketReads).toBeGreaterThan(trackerReads);
    expect(await list.getByRole("button", { name: `${ticket.key} Before webhook` }).count()).toBe(
      0,
    );
  });

  it("트래커를 읽지 못한 결과는 5분이 아니라 30초 뒤 Tickets 에 다시 들어가면 다시 읽는다(가짜 시계)", async (context) => {
    const ticket = addTicket("Recovered after failure");
    tracker.failing = true;
    const { page } = await newPage(context, { stream: false, clock: true });
    try {
      await open(page, "/tickets", "tickets");
      await page
        .getByText(/티켓을 읽지 못했어요/)
        .first()
        .waitFor();
      tracker.failing = false;
      await railLink(page, shell.nav.runners).click();
      await waitForScreen(page, "runners");
      await page.mouse.move(0, 0);
      await page.clock.runFor(DB_STALE_MS + 1_000);

      await railLink(page, shell.nav.tickets).click();
      await waitForScreen(page, "tickets");
      await page
        .getByRole("list", { name: tickets.listLabel })
        .getByRole("button", { name: `${ticket.key} ${ticket.title}` })
        .waitFor({ timeout: VISIBLE_WITHIN_MS });
      expect(await page.getByText(/티켓을 읽지 못했어요/).count()).toBe(0);
    } finally {
      tracker.failing = false;
    }
  });

  it("포인터를 올려 미리 읽은 뒤 Runners 에 들어가면 서버 함수를 더 부르지 않는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await open(page, "/tickets", "tickets");

    const preloaded = page.waitForResponse(
      (response) => serverFnName(response.url()) === "getRunnersPage",
    );
    await railLink(page, shell.nav.runners).hover();
    await (await preloaded).finished();
    serverCalls.length = 0;

    await railLink(page, shell.nav.runners).click();
    await waitForScreen(page, "runners");
    await settle(page);
    expect(serverCalls).toEqual([]);
  });

  it("훅을 나눈 뒤에도 Settings 는 저장 뒤 Settings 를 다시 읽고, Workspace 이름은 셸에 바로 닿는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false });
    await page.goto(`/settings/general?ws=${workspaceId}`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await waitForRouterIdle(page, "/settings/general");
    await settle(page);
    const workspace = page.getByRole("main");
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

    expect(serverCalls).toContain("saveWorkspaceGeneral");
    expect(serverCalls).toContain("getSettings");
    expect(serverCalls).toContain("getShell");
    saveWorkspace(db, { id: workspaceId, name: "Acme" });
  });

  it.for([
    ["runners", "tickets", shell.nav.runners, shell.nav.tickets, "getRunnersPage"],
    ["tickets", "runners", shell.nav.tickets, shell.nav.runners, "getTrackerTickets"],
  ] as const)(
    "%s 를 5분 넘게 떠났다 돌아와도 빈 대체 화면 없이 그린다(query gcTime 5분)",
    async ([screen, away, screenLink, awayLink, reread], context) => {
      const { page, serverCalls } = await newPage(context, { stream: false, clock: true });
      await open(page, `/${screen}`, screen);
      await railLink(page, awayLink).click();
      await waitForScreen(page, away);
      await page.mouse.move(0, 0);
      await page.clock.runFor(QUERY_GC_MS + 60_000);
      await page.evaluate(() => {
        const watch = new MutationObserver(() => {
          if (document.querySelector("main h1") === null) document.body.dataset["sawBlank"] = "1";
        });
        watch.observe(document.body, { subtree: true, childList: true });
      });
      serverCalls.length = 0;

      await railLink(page, screenLink).click();
      await waitForScreen(page, screen);
      await settle(page);
      expect(await page.evaluate(() => document.body.dataset["sawBlank"] ?? null)).toBeNull();
      expect(serverCalls).toContain(reread);
    },
  );

  it("변경 기록 통로가 막혀도 다시 들어간 Runners 는 그사이 바뀐 러너 상태를 그린다", async (context) => {
    const { page } = await newPage(context, { stream: false });
    await open(page, `/runners?sel=${runnerId}`, "runners");
    const panel = page.getByRole("region", { name: runners.panel.label });
    const offlineFix = panel.getByRole("region", { name: runners.panel.fix.offline.title });
    expect(await offlineFix.count()).toBe(0);
    await railLink(page, shell.nav.tickets).click();
    await waitForScreen(page, "tickets");
    await page.mouse.move(0, 0);

    runnerOffline();
    await railLink(page, shell.nav.runners).click();
    await waitForScreen(page, "runners");

    await offlineFix.waitFor({ timeout: VISIBLE_WITHIN_MS });
  });

  it("변경 기록 통로가 막혀도 다시 들어간 Tickets 는 그사이 생긴 런을 그린다", async (context) => {
    const ticket = addTicket("Assigned elsewhere");
    const { page } = await newPage(context, { stream: false });
    await open(page, "/tickets", "tickets");
    const option = page
      .getByRole("list", { name: tickets.listLabel })
      .getByRole("listitem")
      .filter({ hasText: ticket.key });
    expect(await option.innerText()).toContain(tickets.unassigned);
    await railLink(page, shell.nav.runners).click();
    await waitForScreen(page, "runners");
    await page.mouse.move(0, 0);

    const assigned = assignRun(db, {
      ticket: { connection, key: ticket.key },
      trackerProject,
      runnerProject,
      agent,
      now: new Date(),
    });
    if (!assigned.ok) throw new Error(assigned.reason);
    await railLink(page, shell.nav.tickets).click();
    await waitForScreen(page, "tickets");

    await expect
      .poll(() => option.innerText(), { timeout: VISIBLE_WITHIN_MS })
      .not.toContain(tickets.unassigned);
  });

  it("변경 기록이 끊기면 열린 Runners 가 30초마다 다시 읽는다(가짜 시계)", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: false, clock: true });
    await open(page, "/runners", "runners");
    const reads = () => serverCalls.filter((call) => call === "getRunnersPage").length;
    const before = reads();

    await page.clock.runFor(DISCONNECTED_POLL_MS);
    await expect.poll(reads).toBe(before + 1);
    await page.clock.runFor(DISCONNECTED_POLL_MS);
    await expect.poll(reads).toBe(before + 2);
  });
});

describe("변경 기록이 끊겼을 때 남은 화면(브라우저, 0129)", () => {
  it.for([
    { name: "Tickets", path: "/tickets", screen: "tickets", serverFn: "getTicketRuns" },
    { name: "Runs", path: "/runs", screen: "runs", serverFn: "getRunsPage" },
    { name: "Stats", path: "/stats", screen: "stats", serverFn: "getStatsPage" },
  ] as const)(
    "변경 기록이 끊기면 열린 $name 가 30초마다 자기 query 를 다시 읽고 루트는 읽지 않는다(가짜 시계)",
    async ({ path, screen, serverFn }, context) => {
      const { page, serverCalls } = await newPage(context, { stream: false, clock: true });
      await open(page, path, screen);
      const reads = () => serverCalls.filter((call) => call === serverFn).length;
      const before = reads();

      await page.clock.runFor(DISCONNECTED_POLL_MS);
      await expect.poll(reads).toBe(before + 1);
      await page.clock.runFor(DISCONNECTED_POLL_MS);
      await expect.poll(reads).toBe(before + 2);
      expect(serverCalls.filter((call) => ROOT_READS.includes(call))).toEqual([]);
    },
  );
});

function seed(database: Database): void {
  const secretBox = new SecretBox(encryptionKey);
  saveTrackerConnection(database, secretBox, {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
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
  saveMapping(database, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(database, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(database, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
}
