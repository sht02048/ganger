/// <reference lib="dom" />

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toAgentRef,
  toCodeHostKind,
  toLabelId,
  toPermissionRequestId,
  toQuestionId,
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
  answerRunQuestion,
  assignRun,
  changeRunState,
  completeRunControlRequest,
  listPendingRunControlRequests,
  migrate,
  openDatabase,
  recordPermissionWaits,
  recordRunQuestions,
  recordRunnerCheck,
  resolvePermissionWaits,
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
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import questionJson from "../../apps/web/messages/ko/question.json" with { type: "json" };
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import stats from "../../apps/web/messages/ko/stats.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { serverFnName, waitForRouterIdle } from "./navigation-timing.js";
import { DONE_COLUMN_DAYS } from "@ganger/app/home/model";
import { DAY_MS, calendarDay } from "@ganger/app/time-zone";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const STREAM_PATH = "/api/change-events/stream";
const VISIBLE_WITHIN_MS = 3_000;
const CONTROL_POLL_MS = 2_000;
const DISCONNECTED_POLL_MS = 30_000;
const SETTLE_MS = 1_500;
const SEOUL = "Asia/Seoul";
const QUERY_GC_TIME_MS = 5 * 60_000;
const TIME_TEXT_TICK_MS = 15_000;
const ROOT_READS = ["getTimeZone", "getTitleBarHidden"];
const ROOT_AND_SHELL_READS = [...ROOT_READS, "getShell"];

const runnerKind = toRunnerKind("fake");
const runnerId = toRunnerId("runner-a");
const spareRunnerId = toRunnerId("runner-b");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const projects = [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }];

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
const runIds = new Map<string, RunId>();

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
  dir = mkdtempSync(join(tmpdir(), "ganger-dashboard-query-"));
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
  for (const path of [dashboardPath, statsPath]) {
    await warm.goto(path);
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
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

const dashboardPath = `/?ws=${workspaceId}`;
const statsPath = `/stats?ws=${workspaceId}`;
const runsPath = `/runs?ws=${workspaceId}`;

describe("Dashboard·Stats query와 hydration(브라우저, 0126)", () => {
  it.for([
    { name: "Dashboard", path: dashboardPath, pathname: "/" },
    { name: "Stats", path: statsPath, pathname: "/stats" },
  ])(
    "서버 렌더한 $name는 hydration이 끝날 때까지 서버 함수를 다시 부르지 않는다",
    async ({ path, pathname }, context) => {
      const { page, serverCalls } = await newPage(context);
      await page.goto(path);
      await waitForRouterIdle(page, pathname);
      await page.waitForTimeout(SETTLE_MS);

      expect(serverCalls).toEqual([]);
    },
  );
});

describe("Dashboard mutation(브라우저, 0126)", () => {
  it("답하기는 Dashboard query만 다시 읽고 루트와 셸은 다시 읽지 않는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: "blocked" });
    await openDashboard(page);
    serverCalls.length = 0;

    await card(page, "ACME-1").getByRole("button", { name: home.card.answer }).click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("radio", { name: "SQLite" }).check();
    await panel.getByRole("button", { name: questionJson.send }).click();
    await panel.waitFor({ state: "hidden" });
    await card(page, "ACME-1").getByText(home.card.answered).waitFor();
    await page.waitForTimeout(SETTLE_MS);

    expect(serverCalls).toEqual(["answerQuestion", "getHomePage"]);
  });

  it("거절은 Dashboard query만 다시 읽고 루트와 셸은 다시 읽지 않는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: "blocked" });
    await openDashboard(page);
    serverCalls.length = 0;

    await cardButton(page, "ACME-2").click();
    const panel = page.getByRole("dialog");
    await panel.getByLabel(home.permission.reasonLabel).fill("Not now.");
    await panel.getByRole("button", { name: home.permission.send }).click();
    await panel.waitFor({ state: "hidden" });
    await page.waitForTimeout(SETTLE_MS);

    expect(serverCalls).toEqual(["denyPermission", "getHomePage"]);
  });

  it("멈추기는 Dashboard query를 다시 읽고, 처리 중에는 2초마다 다시 읽다가 끝나면 멈춘다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: "blocked" });
    await openDashboard(page);
    serverCalls.length = 0;

    await pauseFromCard(page, "ACME-3");
    await page.getByText(fill(home.control.pauseRequested, { key: "ACME-3" })).waitFor();
    await card(page, "ACME-3").getByText(home.card.pausing).first().waitFor();
    expect(serverCalls.slice(0, 2)).toEqual(["controlRun", "getHomePage"]);

    await expect
      .poll(() => countOf(serverCalls, "getHomePage"), {
        timeout: CONTROL_POLL_MS * 3,
      })
      .toBeGreaterThanOrEqual(2);

    const pending = listPendingRunControlRequests(db).find(
      (request) => request.runId === runOf("ACME-3"),
    );
    if (pending === undefined) throw new Error("no pending control for ACME-3");
    completeRunControlRequest(db, {
      runId: pending.runId,
      requestedAt: pending.requestedAt,
      completedAt: new Date(),
      error: null,
    });
    await expect
      .poll(() => card(page, "ACME-3").getByText(home.card.pausing).count(), {
        timeout: CONTROL_POLL_MS * 3,
      })
      .toBe(0);
    const settled = countOf(serverCalls, "getHomePage");
    await page.waitForTimeout(CONTROL_POLL_MS * 2);

    expect(countOf(serverCalls, "getHomePage")).toBe(settled);
    expect(serverCalls.filter((call) => ROOT_AND_SHELL_READS.includes(call))).toEqual([]);
  });

  it("멈추기가 '상태가 바뀜'을 돌려줘도 오류가 아니라 그 결과를 알리고 Dashboard query만 다시 읽는다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: "blocked" });
    await openDashboard(page);
    ok(
      changeRunState(db, runOf("ACME-4"), {
        to: "ended",
        agentResult: "reported-success",
        prState: "none",
      }),
    );
    serverCalls.length = 0;

    await pauseFromCard(page, "ACME-4");
    await page.getByText(fill(home.control.stateChanged, { key: "ACME-4" })).waitFor();
    await expect.poll(() => card(page, "ACME-4").getByText("ACME-4").count()).toBe(1);
    await page.waitForTimeout(SETTLE_MS);

    expect(serverCalls).toEqual(["controlRun", "getHomePage"]);
    expect(await page.getByText(fill(home.control.pauseRejected, { key: "ACME-4" })).count()).toBe(
      0,
    );
  });
});

describe("답하기·거절의 거절 이유(브라우저, 0126)", () => {
  it("그사이 다른 곳에서 답한 질문은 다시 보내라고 하지 않고 이미 답했다고 알리고 보내기를 거둔다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: "blocked" });
    await openDashboard(page);
    answerRunQuestion(db, {
      runId: runOf("ACME-7"),
      questionId: toQuestionId("q-7"),
      answer: "No",
    });

    await card(page, "ACME-7").getByRole("button", { name: home.card.answer }).click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("radio", { name: "Yes" }).check();

    await panel.getByRole("button", { name: questionJson.send }).click();

    await panel.getByRole("status").getByText(home.question.rejected["already-answered"]).waitFor();
    await page.waitForTimeout(SETTLE_MS);
    expect(serverCalls).toEqual(["answerQuestion"]);
    expect(await panel.getByText(questionJson.failed).count()).toBe(0);
    expect(await panel.getByRole("button", { name: questionJson.send }).count()).toBe(0);
  });

  it("그사이 러너에서 처리한 Permission은 다시 보내라고 하지 않고 이미 처리했다고 알리고 보내기를 거둔다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: "blocked" });
    await openDashboard(page);
    resolvePermissionWaits(db, runOf("ACME-8"), []);

    await cardButton(page, "ACME-8").click();
    const panel = page.getByRole("dialog");
    await panel.getByLabel(home.permission.reasonLabel).fill("Not now.");
    serverCalls.length = 0;
    await panel.getByRole("button", { name: home.permission.send }).click();

    await panel.getByRole("status").getByText(home.permission.rejected.resolved).waitFor();
    await page.waitForTimeout(SETTLE_MS);
    expect(serverCalls).toEqual(["denyPermission"]);
    expect(await panel.getByText(home.permission.failed).count()).toBe(0);
    expect(await panel.getByRole("button", { name: home.permission.send }).count()).toBe(0);
  });
});

describe("열린 Dashboard의 변경 기록(브라우저, 0126)", () => {
  it("worker와 같은 함수로 런 상태를 바꾸면 열린 Dashboard가 3초 안에 바뀐다", async (context) => {
    const { page } = await newPage(context);
    await openDashboard(page);
    const queued = page.getByRole("region", { name: home.column.queued });
    await card(queued, "ACME-40").waitFor();

    const changedAt = Date.now();
    start(runOf("ACME-40"));
    await expect
      .poll(() => card(queued, "ACME-40").count(), { timeout: VISIBLE_WITHIN_MS })
      .toBe(0);

    expect(Date.now() - changedAt).toBeLessThan(VISIBLE_WITHIN_MS);
  });

  it("러너가 Offline이 되면 Dashboard 러너 카드가 바뀐다", async (context) => {
    const { page } = await newPage(context);
    await openDashboard(page);
    const runners = page.getByRole("region", { name: home.section.runners });
    const problem = runners.getByRole("region", {
      name: fill(home.runners.problemTitle, { count: "1" }),
    });
    expect(await problem.count()).toBe(0);

    recordRunnerCheck(db, {
      runnerId: spareRunnerId,
      online: false,
      checkedAt: new Date(),
      error: null,
      projects: null,
      assignmentBlocked: false,
    });
    await problem.waitFor({ timeout: VISIBLE_WITHIN_MS });

    expect(await problem.innerText()).toContain("runner-b");
  });

  it("SSE가 끊기면 열린 Dashboard가 30초마다 다시 읽는다(가짜 시계)", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: "blocked", fakeClock: true });
    await openDashboard(page);
    await page.waitForTimeout(SETTLE_MS);
    const before = countOf(serverCalls, "getHomePage");
    const shellBefore = countOf(serverCalls, "getShell");

    await page.clock.runFor(DISCONNECTED_POLL_MS);
    await expect.poll(() => countOf(serverCalls, "getHomePage")).toBe(before + 1);
    await page.clock.runFor(DISCONNECTED_POLL_MS);
    await expect.poll(() => countOf(serverCalls, "getHomePage")).toBe(before + 2);

    expect(serverCalls.filter((call) => ROOT_READS.includes(call))).toEqual([]);
    await expect.poll(() => countOf(serverCalls, "getShell")).toBe(shellBefore + 2);
  });
});

describe("시간대 쿠키(브라우저, 0126)", () => {
  it.for([
    {
      name: "Dashboard",
      path: dashboardPath,
      pathname: "/",
      serverFn: "getHomePage",
      title: home.title,
    },
    {
      name: "Stats",
      path: statsPath,
      pathname: "/stats",
      serverFn: "getStatsPage",
      title: stats.title,
    },
  ])(
    "시간대 쿠키가 바뀌면 $name가 새 시간대로 다시 읽고, 그동안 화면을 비우지 않는다",
    async ({ path, pathname, serverFn, title }, context) => {
      const { page, serverCalls } = await newPage(context, { browserTimeZone: "Asia/Seoul" });
      const readTimeZones: string[] = [];
      page.on("request", (request) => {
        if (!request.url().includes("/_serverFn/") || serverFnName(request.url()) !== serverFn)
          return;
        void request.allHeaders().then((headers) => {
          readTimeZones.push(/(?:^|; )tz=([^;]+)/.exec(headers["cookie"] ?? "")?.[1] ?? "");
        });
      });
      await watchForBlankScreen(page);

      await page.goto(path);
      await waitForRouterIdle(page, pathname);
      await expect.poll(() => readTimeZones).toEqual(["Asia/Seoul"]);
      await waitForRouterIdle(page, pathname);
      await page.waitForTimeout(SETTLE_MS);

      expect(countOf(serverCalls, serverFn)).toBe(1);
      expect(await blankScreenSeen(page)).toBe(false);
      expect(await page.locator("h1").first().innerText()).toContain(title);
    },
  );
});

describe("다시 들어간 화면(브라우저, 0126)", () => {
  it("변경 기록 통로가 막혀도 다시 들어간 Dashboard는 그사이 바뀐 런 상태를 그린다", async (context) => {
    const { page } = await newPage(context, { stream: "blocked" });
    await openDashboard(page);
    const queued = page.getByRole("region", { name: home.column.queued });
    await card(queued, "ACME-50").waitFor();

    await railLink(page, "runs").click();
    await waitForRouterIdle(page, "/runs");
    start(runOf("ACME-50"));
    await railLink(page, "dashboard").click();
    await waitForRouterIdle(page, "/");

    await expect
      .poll(() => card(queued, "ACME-50").count(), { timeout: VISIBLE_WITHIN_MS })
      .toBe(0);
  });

  it("변경 기록 통로가 막혀도 다시 들어간 Stats는 그사이 끝난 런을 센다", async (context) => {
    const { page } = await newPage(context, { stream: "blocked" });
    await page.goto(statsPath);
    await waitForRouterIdle(page, "/stats");
    const ended = page.getByRole("group", { name: stats.figures.ended });
    const before = await ended.innerText();

    await railLink(page, "runs").click();
    await waitForRouterIdle(page, "/runs");
    const run = runOf("ACME-51");
    start(run);
    ok(changeRunState(db, run, { to: "ended", agentResult: "reported-success", prState: "none" }));
    await railLink(page, "stats").click();
    await waitForRouterIdle(page, "/stats");

    await expect.poll(() => ended.innerText(), { timeout: VISIBLE_WITHIN_MS }).not.toBe(before);
  });
});

describe("시간 글자(브라우저, 0126)", () => {
  it("다시 읽지 않아도 카드의 지난 시간이 흐른다", async (context) => {
    const { page, serverCalls } = await newPage(context, { stream: "blocked" });
    const oneTickBeforeNextMinute = new Date(Date.now() - (60_000 - TIME_TEXT_TICK_MS));
    assign(toTicketKey("ACME-60"), oneTickBeforeNextMinute);
    await openDashboard(page);
    const queued = card(page.getByRole("region", { name: home.column.queued }), "ACME-60");
    expect(await queued.innerText()).toContain("<1 min");
    serverCalls.length = 0;

    await expect
      .poll(() => queued.innerText(), { timeout: TIME_TEXT_TICK_MS * 2 })
      .toMatch(/(^|\s)1 min$/);

    expect(serverCalls).toEqual([]);
  });
});

describe("시간대 쿠키가 없는 첫 방문(브라우저, 0126)", () => {
  it.for([
    { name: "Dashboard", path: dashboardPath, pathname: "/" },
    { name: "Stats", path: statsPath, pathname: "/stats" },
  ])(
    "$name는 쿠키를 맞추는 동안에도 hydration이 어긋나지 않는다",
    async ({ path, pathname }, context) => {
      const { page } = await newPage(context, {
        browserTimeZone: "Pacific/Kiritimati",
        timeZoneCookie: false,
      });
      const hydrationErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat/i.test(message.text()))
          hydrationErrors.push(message.text());
      });

      await page.goto(path);
      await waitForRouterIdle(page, pathname);
      await expect
        .poll(async () => (await page.context().cookies()).find((c) => c.name === "tz")?.value)
        .toBe("Pacific/Kiritimati");
      await waitForRouterIdle(page, pathname);
      await page.waitForTimeout(SETTLE_MS);

      expect(hydrationErrors).toEqual([]);
    },
  );
});

describe("서버 렌더 뒤 바뀐 시간대 쿠키(브라우저, 0208)", () => {
  it.for([
    { name: "Dashboard", path: dashboardPath, pathname: "/", drawsDoneLink: true },
    { name: "Stats", path: statsPath, pathname: "/stats", drawsDoneLink: false },
    { name: "Runs", path: runsPath, pathname: "/runs", drawsDoneLink: false },
  ])(
    "$name는 서버가 정한 시간대로 hydration해 서버 렌더와 같은 개수를 그린다",
    async ({ path, pathname, drawsDoneLink }, context) => {
      const { page } = await newPage(context, { stream: "blocked" });
      await page.addInitScript((cookie) => {
        document.cookie = cookie;
      }, `tz=${SEOUL}; Path=/`);
      const hydrationErrors: string[] = [];
      page.on("pageerror", (error) => {
        if (/hydrat/i.test(error.message)) hydrationErrors.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat/i.test(message.text()))
          hydrationErrors.push(message.text());
      });

      const response = await page.goto(path);
      const serverDoneLink = doneLinkIn((await response?.text()) ?? "");
      await waitForRouterIdle(page, pathname);
      await page.waitForTimeout(SETTLE_MS);

      expect(hydrationErrors).toEqual([]);
      expect(serverDoneLink !== null).toBe(drawsDoneLink);
      expect(doneLinkIn(await page.content())).toBe(serverDoneLink);
    },
  );
});

describe("오래 떠났다 돌아오기(브라우저, 0126)", () => {
  it.for([
    { name: "Dashboard", path: dashboardPath, pathname: "/", away: "runs", back: "dashboard" },
    { name: "Stats", path: statsPath, pathname: "/stats", away: "runs", back: "stats" },
  ] as const)(
    "query 캐시가 지워질 만큼(5분 넘게) 떠났다 돌아와도 $name를 빈 화면 없이 그린다",
    async ({ path, pathname, away, back }, context) => {
      const { page } = await newPage(context, { fakeClock: true });
      await watchForBlankScreen(page);
      await page.goto(path);
      await waitForRouterIdle(page, pathname);

      await railLink(page, away).click();
      await waitForRouterIdle(page, "/runs");
      await page.mouse.move(0, 0);
      await page.clock.fastForward(QUERY_GC_TIME_MS + 60_000);
      await railLink(page, back).click();
      await waitForRouterIdle(page, pathname);

      expect(await blankScreenSeen(page)).toBe(false);
    },
  );
});

interface PageOptions {
  stream?: "open" | "blocked";
  timeZoneCookie?: boolean;
  fakeClock?: boolean;
  browserTimeZone?: string;
}

async function newPage(
  context: TestContext,
  options: PageOptions = {},
): Promise<{ page: Page; serverCalls: string[] }> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: options.browserTimeZone ?? "UTC",
  });
  if (options.timeZoneCookie !== false) {
    await browserContext.addCookies([{ name: "tz", value: "UTC", url: baseUrl }]);
  }
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  if (options.fakeClock === true) await page.clock.install();
  if (options.stream === "blocked") {
    await page.route(`**${STREAM_PATH}**`, (route) => route.abort());
  }
  const serverCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/")) serverCalls.push(serverFnName(request.url()));
  });
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  context.onTestFinished(() => browserContext.close());
  return { page, serverCalls };
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto(dashboardPath);
  await waitForRouterIdle(page, "/");
}

async function pauseFromCard(page: Page, key: string): Promise<void> {
  await card(page, key)
    .getByRole("button", { name: fill(home.card.menu, { key }) })
    .click();
  await page.getByRole("menuitem", { name: home.card.pause }).click();
}

function railLink(page: Page, screen: "dashboard" | "runs" | "stats"): Locator {
  return page
    .getByRole("navigation", { name: shell.nav.label })
    .getByRole("link", { name: new RegExp(`^${shell.nav[screen]}(,|$)`) });
}

async function watchForBlankScreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      let drawn = document.querySelector("h1") !== null;
      new MutationObserver(() => {
        const headed = document.querySelector("h1") !== null;
        if (headed) drawn = true;
        else if (drawn) Reflect.set(window, "__blankScreenSeen", true);
      }).observe(document.body, { childList: true, subtree: true });
    });
  });
}

async function blankScreenSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => Reflect.get(window, "__blankScreenSeen") === true);
}

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, value),
    template,
  );
}

function doneLinkIn(html: string): string | null {
  const label = fill(home.board.doneLink, { column: home.column.done, count: "(\\d+)" });
  return new RegExp(label).exec(html)?.[0] ?? null;
}

function inDoneColumn(at: Date, now: Date, timeZone: string): boolean {
  const today = calendarDay(now, timeZone);
  const day = calendarDay(at, timeZone);
  return day >= today - (DONE_COLUMN_DAYS - 1) * DAY_MS && day <= today;
}

function endedOnlyForOneTimeZone(now: Date): Date {
  const HOUR_MS = 60 * 60_000;
  const differing: Date[] = [];
  for (let hours = 0; hours <= (DONE_COLUMN_DAYS + 2) * 24; hours += 1) {
    const at = new Date(now.getTime() - hours * HOUR_MS - HOUR_MS / 2);
    if (inDoneColumn(at, now, "UTC") !== inDoneColumn(at, now, SEOUL)) differing.push(at);
  }
  const middle = differing[Math.floor(differing.length / 2)];
  if (middle === undefined) throw new Error("no time that only one time zone counts as Done");
  return middle;
}

function countOf(serverCalls: ReadonlyArray<string>, name: string): number {
  return serverCalls.filter((call) => call === name).length;
}

function card(target: Page | Locator, key: string): Locator {
  const page = "page" in target ? target.page() : target;
  return target.locator("li[data-run]").filter({ has: page.getByText(key, { exact: true }) });
}

function cardButton(page: Page, key: string): Locator {
  return card(page, key).locator('button[aria-haspopup="dialog"]');
}

function runOf(key: string): RunId {
  const run = runIds.get(key);
  if (run === undefined) throw new Error(`no run for ${key}`);
  return run;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
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
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  runIds.set(key, assigned.run.id);
  return assigned.run.id;
}

function start(run: RunId): void {
  const worktree = `wt-${run}`;
  ok(
    changeRunState(db, run, {
      to: "running",
      started: {
        worktree: toWorktreeRef(worktree),
        branch: `acme/${worktree}`,
        agentRef: toAgentRef(`agent-${worktree}`),
      },
    }),
  );
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
  for (const [id, capacity] of [
    [runnerId, 8],
    [spareRunnerId, 1],
  ] as const) {
    saveRunner(database, { id, kind: runnerKind, name: id, config: {}, capacity });
    recordRunnerCheck(database, {
      runnerId: id,
      online: true,
      checkedAt: new Date(),
      error: null,
      projects,
      assignmentBlocked: false,
    });
  }

  const questionRun = assign(toTicketKey("ACME-1"));
  start(questionRun);
  ok(changeRunState(database, questionRun, { to: "waiting-for-input" }));
  recordRunQuestions(database, questionRun, [
    {
      id: toQuestionId("q-1"),
      body: "Which database should the cache use?",
      options: ["SQLite", "In memory"],
      askedAt: new Date(),
    },
  ]);

  const permissionRun = assign(toTicketKey("ACME-2"));
  start(permissionRun);
  ok(changeRunState(database, permissionRun, { to: "waiting-for-input" }));
  recordPermissionWaits(database, permissionRun, [
    { id: toPermissionRequestId("p-2"), detail: "git push --force", requestedAt: new Date() },
  ]);

  const lateQuestionRun = assign(toTicketKey("ACME-7"));
  start(lateQuestionRun);
  ok(changeRunState(database, lateQuestionRun, { to: "waiting-for-input" }));
  recordRunQuestions(database, lateQuestionRun, [
    { id: toQuestionId("q-7"), body: "Ship it?", options: ["Yes", "No"], askedAt: new Date() },
  ]);

  const latePermissionRun = assign(toTicketKey("ACME-8"));
  start(latePermissionRun);
  ok(changeRunState(database, latePermissionRun, { to: "waiting-for-input" }));
  recordPermissionWaits(database, latePermissionRun, [
    { id: toPermissionRequestId("p-8"), detail: "rm -rf dist", requestedAt: new Date() },
  ]);

  start(assign(toTicketKey("ACME-3")));
  start(assign(toTicketKey("ACME-4")));
  assign(toTicketKey("ACME-40"));
  assign(toTicketKey("ACME-50"));
  assign(toTicketKey("ACME-51"));

  for (const key of ["ACME-30", "ACME-31"]) {
    const run = assign(toTicketKey(key));
    start(run);
    ok(
      changeRunState(database, run, {
        to: "ended",
        agentResult: "reported-success",
        prState: "none",
      }),
    );
  }

  const boundaryRun = assign(toTicketKey("ACME-90"));
  start(boundaryRun);
  ok(
    changeRunState(
      database,
      boundaryRun,
      { to: "ended", agentResult: "reported-success", prState: "none" },
      endedOnlyForOneTimeZone(new Date()),
    ),
  );
}
