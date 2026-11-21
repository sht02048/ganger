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
  toTicketKey,
  toTrackerStateId,
} from "@ganger/core";
import type { RunId, TicketKey } from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  assignRun,
  changeRunState,
  listRuns,
  migrate,
  openDatabase,
  recordRunRelations,
  recordRunnerCheck,
  replaceMapping,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page, Route } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const apiRepo = toRunnerProjectId("fake:acme/api");
const apiLabel = toLabelId("label-api");
const labeledTicket = 3;
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const trackerReadLimit = 1000;
const registryKey = "__gangerE2eTicketsRegistry";
const secretBoxKey = "__gangerE2eTicketsSecretBox";
const virtualAdapters = "\0e2e-tickets-adapters";

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
const fakeAdapters: Plugin = {
  name: "e2e-tickets-adapters",
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
    ].join("\n");
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-tickets-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  const tracker = new FakeTracker(fakeKind);
  for (let i = 1; i <= trackerReadLimit + 1; i += 1) {
    tracker.addTicket({
      key: toTicketKey(`ACME-${i}`),
      title: `Ticket number ${i}`,
      body: "",
      url: `https://tracker.example.com/ACME-${i}`,
      labels: i === labeledTicket ? [{ id: apiLabel, name: "api" }] : [],
      project: { id: trackerProject, name: "Web" },
      state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
      updatedAt: new Date(Date.UTC(2026, 10, 17) - i * 60_000),
    });
  }
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
}, 120_000);

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

beforeEach(async (context) => {
  const browserContext: BrowserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 720 },
  });
  page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

describe("Tickets 목록 규모(브라우저, 0054)", () => {
  it("1000행 목록에서 화면에 보이는 행 근처만 그리고, 잘린 트래커 프로젝트를 알린다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    await page.getByText(truncatedNotice("Web", "1,000"), { exact: true }).waitFor();
    const allTab = page.getByRole("tab", { name: tickets.filter.all });
    expect(await allTab.textContent()).toContain(String(trackerReadLimit));

    const list = page.getByRole("listbox", { name: tickets.listLabel });
    const options = list.getByRole("option");
    await options.first().waitFor();
    const viewportHeight = page.viewportSize()?.height ?? 0;
    const rowPitch = 54;
    const visibleRows = Math.ceil(viewportHeight / rowPitch);
    const mostRenderedRows = visibleRows + 2 * 6 + 1;
    await expect.poll(() => options.count()).toBeLessThanOrEqual(mostRenderedRows);
    expect(await options.count()).toBeGreaterThanOrEqual(5);
    await options.first().hover();
    await page.mouse.wheel(0, trackerReadLimit * rowPitch);
    await list
      .getByRole("option", { name: `ACME-${trackerReadLimit} Ticket number ${trackerReadLimit}` })
      .waitFor();
    expect(await options.count()).toBeLessThanOrEqual(mostRenderedRows);
    expect(await list.getByRole("option", { name: `ACME-${trackerReadLimit + 1} ` }).count()).toBe(
      0,
    );
  });

  it("화살표로 그리지 않은 행까지 옮겨 갈 수 있다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    const list = page.getByRole("listbox", { name: tickets.listLabel });
    await list.getByRole("option").first().click();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(50);
    }
    await expect.poll(() => page.locator(":focus").getAttribute("role")).toBe("option");
    await expect.poll(focused).toBe("ACME-41Ticket number 41할당 전");
  });
});

describe("Tickets 머리·필터·검색(브라우저, 0070)", () => {
  it("목록만 스크롤되고 머리·필터·열 이름은 제자리에 있다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    const heading = page.getByRole("heading", { level: 1, name: tickets.title });
    const tabs = page.getByRole("tablist", { name: tickets.filter.label });
    const columnHead = page.getByText(tickets.columns.lastRun, { exact: true }).first();
    const list = page.getByRole("listbox", { name: tickets.listLabel });
    await list.getByRole("option").first().waitFor();
    const before = await Promise.all([heading, tabs, columnHead].map((l) => top(l)));
    const scroller = page.locator("[data-more-below]");
    expect(await scroller.getAttribute("data-more-below")).toBe("true");

    await list.getByRole("option").first().hover();
    await page.mouse.wheel(0, 54 * 20);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await Promise.all([heading, tabs, columnHead].map((l) => top(l)))).toEqual(before);
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("*")]
          .filter((el) => !el.hasAttribute("data-more-below"))
          .some((el) => el.scrollTop > 0),
      ),
    ).toBe(false);

    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => scroller.getAttribute("data-more-below")).toBe("false");
  });

  it("필터를 고르면 주소에 남고 그 필터의 티켓만 보인다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    const tab = page.getByRole("tab", { name: tickets.filter.done });
    expect(await tab.textContent()).toBe(`${tickets.filter.done}0`);
    await tab.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("f")).toBe("done");
    await page.getByText(tickets.empty, { exact: true }).waitFor();
    await page.getByRole("tab", { name: tickets.filter.assignable }).click();
    await page
      .getByRole("listbox", { name: tickets.listLabel })
      .getByRole("option")
      .first()
      .waitFor();
  });

  it("키나 제목으로 찾으면 맞는 티켓만 남는다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    const search = page.getByRole("searchbox", { name: tickets.search.label });
    await search.fill("number 1000");
    const options = page.getByRole("listbox", { name: tickets.listLabel }).getByRole("option");
    await expect.poll(() => options.count()).toBe(1);
    expect(await options.first().textContent()).toBe("ACME-1000Ticket number 1000할당 전");
    await search.fill("acme-99");
    await expect.poll(() => options.count()).toBe(11);
    await search.fill("없는 티켓");
    await page.getByText(fill(tickets.noMatch, { query: "없는 티켓" }), { exact: true }).waitFor();
  });
});

describe("Tickets 수동 할당(브라우저, 0054)", () => {
  it("할당할 수 있음 필터에서 할당하면 창이 닫히고, 그 티켓을 고른 채 '런 보기'로 포커스가 간다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}&f=assignable`);
    await hydrated(page);
    const key = "ACME-1";
    const panel = page.getByRole("region", { name: tickets.panel.label });
    await panel.getByRole("heading", { name: "Ticket number 1", exact: true }).waitFor();

    await panel.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog", { name: fill(tickets.assign.title, { key }) });
    await dialog.getByRole("button", { name: tickets.assign.submit }).click();

    await page
      .getByRole("region", { name: shell.toastRegion })
      .getByText(fill(tickets.assign.done, { key }))
      .waitFor();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(focused).toBe(tickets.panel.openRun);
    await panel.getByRole("heading", { name: "Ticket number 1", exact: true }).waitFor();
    const list = page.getByRole("listbox", { name: tickets.listLabel });
    expect(await list.getByRole("option", { name: `${key} Ticket number 1` }).count()).toBe(0);
    expect(new URL(page.url()).searchParams.get("sel")).not.toBeNull();
  });

  it("저장소 라벨이 붙은 티켓은 그 저장소를 골라 둔 채 창이 열리고, 할당하면 그 저장소로 런이 생긴다(0115)", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    const key = `ACME-${labeledTicket}`;
    await page
      .getByRole("listbox", { name: tickets.listLabel })
      .getByRole("option", { name: `${key} Ticket number ${labeledTicket}` })
      .click();
    const panel = page.getByRole("region", { name: tickets.panel.label });
    await panel.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog", { name: fill(tickets.assign.title, { key }) });
    const repos = dialog.getByRole("radiogroup", { name: tickets.assign.project });
    expect(await repos.getByRole("radio").count()).toBe(2);
    expect(await repos.getByRole("radio", { name: /^acme\/api/ }).isChecked()).toBe(true);
    expect(await repos.getByRole("radio", { name: /^acme\/web/ }).isChecked()).toBe(false);

    await page.setViewportSize({ width: 320, height: 568 });
    const submit = dialog.getByRole("button", { name: tickets.assign.submit });
    const box = await submit.boundingBox();
    const title = await dialog.getByRole("heading").first().boundingBox();
    expect(box !== null && box.y >= 0 && box.y + box.height <= 568).toBe(true);
    expect(title !== null && title.y >= 0).toBe(true);
    await submit.focus();
    await page.keyboard.press("Tab");
    const wrapped = await page.evaluate(() => {
      const rect = document.activeElement?.getBoundingClientRect();
      return rect === undefined ? null : { top: rect.top, bottom: rect.bottom };
    });
    expect(wrapped !== null && wrapped.top >= 0 && wrapped.bottom <= 568).toBe(true);

    await submit.click();
    await dialog.waitFor({ state: "hidden" });
    await expect
      .poll(() =>
        listRuns(db, { ticket: { connection, key: toTicketKey(key) } }).map((r) => r.runnerProject),
      )
      .toEqual([apiRepo]);
  });

  it("보내는 중에는 Esc 나 취소로 창이 닫히지 않는다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    const key = "ACME-2";
    await page
      .getByRole("listbox", { name: tickets.listLabel })
      .getByRole("option", { name: `${key} Ticket number 2` })
      .click();
    const panel = page.getByRole("region", { name: tickets.panel.label });
    await panel.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog", { name: fill(tickets.assign.title, { key }) });
    const held = holdNextServerCall(page);
    await dialog.getByRole("button", { name: tickets.assign.submit }).click();
    await held.arrived;
    await dialog.getByRole("button", { name: tickets.assign.submitting }).waitFor();

    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: tickets.assign.cancel }).click();
    await page.waitForTimeout(300);
    expect(await dialog.isVisible()).toBe(true);
    await held.release();
    await page
      .getByRole("region", { name: shell.toastRegion })
      .getByText(fill(tickets.assign.done, { key }))
      .waitFor();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(focused).toBe(tickets.panel.openRun);
  });

  it("관계 행은 그 티켓을 고르고 제목으로 포커스를 옮기고, 런 행과 모두 보기는 Runs로 간다(0164)", async () => {
    const waiter = toTicketKey("ACME-900");
    const blockerKey = toTicketKey("ACME-901");
    const manyRuns = toTicketKey("ACME-902");
    const waiting = assignQueued(waiter);
    recordRunRelations(
      db,
      waiting,
      {
        priority: "high",
        blockers: [
          {
            key: blockerKey,
            title: "Ticket number 901",
            state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
          },
        ],
        inCycle: new Set(),
      },
      new Date(),
    );
    const minuteOf = (minute: number) => new Date(Date.UTC(2026, 10, 17) + minute * 60_000);
    let newest = assignQueued(manyRuns, minuteOf(0));
    for (let i = 1; i < 6; i += 1) {
      endCanceled(newest, minuteOf(i));
      newest = assignQueued(manyRuns, minuteOf(i));
    }
    endCanceled(newest, minuteOf(6));

    const panel = page.getByRole("region", { name: tickets.panel.label });
    await page.goto(ticketUrl(waiter));
    await hydrated(page);
    await panel
      .getByRole("group", { name: tickets.panel.blockers })
      .getByRole("button", { name: /ACME-901/ })
      .click();
    await panel.getByRole("heading", { name: "Ticket number 901", exact: true }).waitFor();
    await expect.poll(focused).toBe("Ticket number 901");
    expect(new URL(page.url()).searchParams.get("sel")).toContain("ACME-901");
    await panel
      .getByRole("group", { name: tickets.panel.waiting })
      .getByRole("button", { name: /ACME-900.*Queued/ })
      .waitFor();

    await page.goto(ticketUrl(manyRuns));
    await hydrated(page);
    const runs = panel.getByRole("region", { name: tickets.panel.runs, exact: true });
    await expect.poll(() => runs.getByRole("listitem").count()).toBe(5);
    await runs
      .getByRole("button", { name: /Canceled/ })
      .first()
      .click();
    await page.waitForURL((url) => url.pathname === "/runs");
    expect(new URL(page.url()).searchParams.get("sel")).toBe(newest);

    await page.goto(ticketUrl(manyRuns));
    await hydrated(page);
    await runs.getByRole("button", { name: tickets.panel.runsAll }).click();
    await page.waitForURL((url) => url.pathname === "/runs");
    expect(new URL(page.url()).searchParams.get("project")).toContain(trackerProject);
  });
});

function ticketUrl(key: string): string {
  const sel = encodeURIComponent(JSON.stringify(JSON.stringify([connection, key])));
  return `/tickets?ws=${workspaceId}&sel=${sel}`;
}

function assignQueued(key: TicketKey, now?: Date): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
    ...(now === undefined ? {} : { now }),
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  return assigned.run.id;
}

function endCanceled(id: RunId, now: Date): void {
  const ended = changeRunState(
    db,
    id,
    { to: "ended", agentResult: "canceled", prState: "none" },
    now,
  );
  if (!ended.ok) throw new Error(`end ${id} failed`);
}

function holdNextServerCall(target: Page): {
  arrived: Promise<void>;
  release: () => Promise<void>;
} {
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let held: Route | undefined;
  const pattern = "**/_serverFn/**";
  const handler = (route: Route) => {
    if (held !== undefined || route.request().method() !== "POST") {
      void route.continue();
      return;
    }
    held = route;
    arrive();
  };
  void target.route(pattern, handler);
  return {
    arrived,
    release: async () => {
      await held?.continue();
      await target.unroute(pattern, handler);
    },
  };
}

function truncatedNotice(project: string, count: string): string {
  return tickets.truncated.replace("{project}", project).replace("{limit, number}", count);
}

function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}
async function top(target: ReturnType<Page["locator"]>): Promise<number> {
  return (await target.boundingBox())?.y ?? Number.NaN;
}

async function focused(): Promise<string | null> {
  const active = page.locator(":focus");
  return (await active.count()) === 0 ? null : active.first().textContent();
}

function seed(db: Database): void {
  saveTrackerConnection(db, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(db, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
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
  replaceMapping(db, {
    connection,
    trackerProject,
    agent,
    repos: [
      { project: runnerProject, isDefault: true, labelId: null },
      { project: apiRepo, isDefault: false, labelId: apiLabel },
    ],
  });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [
      { id: runnerProject, displayName: "acme/web", setupState: "ready" as const },
      { id: apiRepo, displayName: "acme/api", setupState: "ready" as const },
    ],
    assignmentBlocked: false,
  });
}
async function hydrated(target: Page): Promise<void> {
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}
