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
  toQuestionId,
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
  answerRunQuestion,
  assignRun,
  changeRunState,
  getRun,
  migrate,
  openDatabase,
  recordRunQuestions,
  recordRunnerCheck,
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
import { chromium } from "playwright-core";
import type { Browser, Locator, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { serverFnName, waitForRouterIdle } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

interface MotionCall {
  key: string | null;
  properties: string[];
  pill: boolean;
}

declare global {
  var screenMotionCalls: MotionCall[];
  var screenMotionRate: number;
}

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const CHANGE_VISIBLE_MS = 15_000;
const QUIET_MS = 400;
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let nextTicket = 100;
const openRuns = new Set<RunId>();

const fakeAdapters: Plugin = {
  name: "e2e-screen-motion-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-screen-motion-"));
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
  for (const path of [dashboardPath, runsPath]) {
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

afterEach(() => {
  for (const run of openRuns) {
    changeRunState(db, run, {
      to: "running",
      started: {
        worktree: toWorktreeRef(`wt-${run}`),
        branch: `acme/wt-${run}`,
        agentRef: toAgentRef(`agent-${run}`),
      },
    });
    changeRunState(db, run, { to: "ended", agentResult: "reported-success", prState: "none" });
    if (getRun(db, run)?.state !== "ended") throw new Error(`run ${run} did not end`);
  }
  openRuns.clear();
});

const otherWorkspaceId = toWorkspaceId("ws-other");
const otherWorkspaceName = "Beta";
const dashboardPath = `/?ws=${workspaceId}`;
const runsPath = `/runs?ws=${workspaceId}`;

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
  saveWorkspace(database, { id: otherWorkspaceId, name: otherWorkspaceName });
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
    capacity: 100,
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

function assign(): { id: RunId; key: string } {
  const key = `ACME-${nextTicket++}`;
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  openRuns.add(assigned.run.id);
  return { id: assigned.run.id, key };
}

function start(run: RunId): void {
  const worktree = `wt-${run}`;
  const changed = changeRunState(db, run, {
    to: "running",
    started: {
      worktree: toWorktreeRef(worktree),
      branch: `acme/${worktree}`,
      agentRef: toAgentRef(`agent-${worktree}`),
    },
  });
  if (!changed.ok) throw new Error(`start failed: ${JSON.stringify(changed.error)}`);
}

function pause(run: RunId): void {
  const changed = changeRunState(db, run, { to: "waiting-for-input" });
  if (!changed.ok) throw new Error(`wait failed: ${JSON.stringify(changed.error)}`);
}

async function newPage(
  context: TestContext,
  reducedMotion: "reduce" | "no-preference" = "no-preference",
): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    reducedMotion,
    timezoneId: "UTC",
    viewport: { width: 1440, height: 1000 },
  });
  await browserContext.addCookies([{ name: "tz", value: "UTC", url: baseUrl }]);
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  await page.addInitScript(() => {
    const calls: MotionCall[] = [];
    // oxlint-disable-next-line typescript/unbound-method
    const original = Element.prototype.animate;
    Element.prototype.animate = function animate(keyframes, options) {
      calls.push({
        key: this.closest("[data-motion-key]")?.getAttribute("data-motion-key") ?? null,
        properties: Array.isArray(keyframes)
          ? Object.keys(keyframes[0] ?? {}).filter((name) => name !== "offset")
          : Object.keys(keyframes ?? {}),
        pill: this.hasAttribute("data-status"),
      });
      const animation = original.call(this, keyframes, options);
      animation.playbackRate = globalThis.screenMotionRate;
      return animation;
    };
    globalThis.screenMotionCalls = calls;
    globalThis.screenMotionRate = 1;
  });
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  context.onTestFinished(() => browserContext.close());
  return page;
}

async function open(page: Page, path: string, pathname: string): Promise<void> {
  await page.goto(path);
  await waitForRouterIdle(page, pathname);
  await page.waitForLoadState("networkidle");
}

const motionCalls = (page: Page) => page.evaluate(() => globalThis.screenMotionCalls.slice());
const clearCalls = (page: Page) =>
  page.evaluate(() => {
    globalThis.screenMotionCalls.length = 0;
  });
const column = (page: Page, name: string) => page.getByRole("region", { name });
const card = (target: Page | Locator, key: string): Locator => {
  const page = "page" in target ? target.page() : target;
  return target.locator("li[data-run]").filter({ has: page.getByText(key, { exact: true }) });
};
const cardButton = (target: Page | Locator, key: string) =>
  card(target, key).locator('button[aria-haspopup="dialog"]');
const tab = (page: Page, name: string) => page.getByRole("tab").filter({ hasText: name });
const runRow = (page: Page, key: string) =>
  page.getByRole("option").filter({ has: page.getByText(key, { exact: true }) });

async function switchWorkspace(page: Page, from: string, to: string): Promise<void> {
  await page
    .getByRole("button", { name: shell.workspace.switch.replace("{workspace}", from) })
    .click();
  await page.getByRole("menuitemradio", { name: to, exact: true }).click();
  await page
    .getByRole("button", { name: shell.workspace.switch.replace("{workspace}", to) })
    .waitFor();
}

async function pressSecondOfDoubleClick(page: Page): Promise<void> {
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}

async function openSheetOverCard(
  page: Page,
  openKey: string,
  behindKey: string,
): Promise<{ x: number; y: number }> {
  const queued = column(page, home.column.queued);
  const target = await cardButton(queued, behindKey).boundingBox();
  if (target === null) throw new Error("no card box");
  await cardButton(queued, openKey).click();
  const opened = page.getByRole("dialog");
  await opened.getByText(openKey, { exact: true }).waitFor();
  await expect.poll(() => opened.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  return { x: target.x + target.width / 2, y: target.y + target.height / 2 };
}

async function closeSheetSlowly(page: Page, close: () => Promise<void>): Promise<Locator> {
  const sheet = page.locator('[role="dialog"]');
  const slowed = sheet.evaluate(async (node) => {
    for (let frame = 0; frame < 600 && !node.hasAttribute("data-ending-style"); frame += 1) {
      await new Promise(requestAnimationFrame);
    }
    for (const animation of document.getAnimations()) animation.playbackRate = 0.02;
    return node.hasAttribute("data-ending-style");
  });
  await close();
  expect(await slowed).toBe(true);
  return sheet;
}

async function expectQuiet(page: Page): Promise<void> {
  await page.waitForTimeout(QUIET_MS);
  expect(await motionCalls(page)).toEqual([]);
}

async function callsFor(page: Page, key: string): Promise<MotionCall[]> {
  await expect
    .poll(async () => (await motionCalls(page)).filter((call) => call.key === key).length, {
      timeout: CHANGE_VISIBLE_MS,
    })
    .toBeGreaterThan(0);
  return (await motionCalls(page)).filter((call) => call.key === key);
}

describe("Dashboard 움직임(브라우저, 0153)", () => {
  it("첫 렌더와 To do 보기 바꾸기에서는 움직이지 않는다", async (context) => {
    assign();
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await expectQuiet(page);

    await tab(page, home.view.todo).click();
    await expect.poll(() => tab(page, home.view.todo).getAttribute("aria-selected")).toBe("true");
    await expectQuiet(page);
  });

  it("SSE 로 칸을 옮긴 카드만 움직이고 다른 칸의 카드는 그대로다", async (context) => {
    const moved = assign();
    const bystander = assign();
    start(bystander.id);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    const running = column(page, home.column.running);
    await card(running, bystander.key).waitFor();
    await clearCalls(page);

    start(moved.id);

    await card(running, moved.key).waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, moved.id);
    expect(calls.some((call) => call.properties.includes("transform"))).toBe(true);
    expect((await motionCalls(page)).some((call) => call.key === bystander.id && call.pill)).toBe(
      false,
    );
  });

  it("카드의 To do 표시가 바뀌면 상태 알약만 한 번 커진다", async (context) => {
    const run = assign();
    start(run.id);
    pause(run.id);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await card(page, run.key).waitFor();
    await clearCalls(page);

    const changed = changeRunState(db, run.id, { to: "disconnected" });
    if (!changed.ok) throw new Error("disconnect failed");

    await card(page, run.key)
      .locator('[data-status="disconnected"]')
      .waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, run.id);
    expect(calls.some((call) => call.pill && call.properties.includes("transform"))).toBe(true);
  });

  it("알약이 없던 카드에 알약이 새로 생기면 한 번 커진다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await card(page, run.key).waitFor();
    expect(await card(page, run.key).locator("[data-status]").count()).toBe(0);
    await clearCalls(page);

    pause(run.id);

    await card(page, run.key).locator("[data-status]").waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, run.id);
    expect(calls.some((call) => call.pill && call.properties.includes("transform"))).toBe(true);
  });

  it("다른 보기에 있는 동안 생긴 알약은 돌아와도 움직이지 않는다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await card(page, run.key).waitFor();
    await tab(page, home.view.todo).click();
    await expect.poll(() => card(page, run.key).count()).toBe(0);
    const reread = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") && serverFnName(response.url()) === "getHomePage",
      { timeout: CHANGE_VISIBLE_MS },
    );

    const paused = changeRunState(db, run.id, { to: "paused", source: "operator" });
    if (!paused.ok) throw new Error("pause failed");
    await reread;
    await page.waitForTimeout(QUIET_MS);
    await clearCalls(page);

    await tab(page, home.view.all).click();

    await card(page, run.key).locator('[data-status="paused"]').waitFor();
    await page.waitForTimeout(QUIET_MS);
    expect((await motionCalls(page)).filter((call) => call.pill)).toEqual([]);
  });

  it("사람 확인 묶음으로 건너가며 알약이 생겨도 한 번 커진다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await card(page, run.key).waitFor();
    expect(await card(page, run.key).locator("[data-status]").count()).toBe(0);
    await clearCalls(page);

    recordRunQuestions(db, run.id, [
      {
        id: toQuestionId(`cross-${run.id}`),
        kind: "human-check",
        body: "Check the preview.",
        options: [],
        askedAt: new Date(),
      },
    ]);
    pause(run.id);

    await card(page.locator('[data-todo-group="check"]'), run.key).waitFor({
      timeout: CHANGE_VISIBLE_MS,
    });
    await expect
      .poll(
        async () =>
          (await motionCalls(page)).some(
            (call) => call.key === run.id && call.pill && call.properties.includes("transform"),
          ),
        { timeout: CHANGE_VISIBLE_MS },
      )
      .toBe(true);

    answerRunQuestion(db, {
      runId: run.id,
      questionId: toQuestionId(`cross-${run.id}`),
      answer: "ok",
      kind: "human-check",
    });
    const resumed = changeRunState(db, run.id, { to: "running" });
    if (!resumed.ok) throw new Error("resume failed");
  });

  it("묶음의 마지막 카드는 접히는 동안 보이고 끝나면 묶음이 숨는다", async (context) => {
    const run = assign();
    start(run.id);
    pause(run.id);
    recordRunQuestions(db, run.id, [
      {
        id: toQuestionId(`check-${run.id}`),
        kind: "human-check",
        body: "Check the preview.",
        options: [],
        askedAt: new Date(),
      },
    ]);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await tab(page, home.view.todo).click();
    await expect.poll(() => tab(page, home.view.todo).getAttribute("aria-selected")).toBe("true");
    const group = page.locator('[data-todo-group="check"]');
    await card(group, run.key).waitFor();
    await page.evaluate(() => {
      globalThis.screenMotionRate = 0.05;
    });

    answerRunQuestion(db, {
      runId: run.id,
      questionId: toQuestionId(`check-${run.id}`),
      answer: "ok",
      kind: "human-check",
    });
    const resumed = changeRunState(db, run.id, { to: "running" });
    if (!resumed.ok) throw new Error("resume failed");

    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const row = document.querySelector(`li[data-motion-key="${key}"][inert]`);
            return row !== null && row.getBoundingClientRect().height > 0;
          }, run.id),
        { timeout: CHANGE_VISIBLE_MS },
      )
      .toBe(true);
    await page.evaluate(() => {
      globalThis.screenMotionRate = 1;
      for (const animation of document.getAnimations()) animation.finish();
    });
    await expect.poll(() => group.count(), { timeout: CHANGE_VISIBLE_MS }).toBe(0);
  });

  it("움직임 줄이기에서는 칸을 옮겨도 흐려지기만 한다", async (context) => {
    const moved = assign();
    const page = await newPage(context, "reduce");
    await open(page, dashboardPath, "/");
    await card(column(page, home.column.queued), moved.key).waitFor();
    await clearCalls(page);

    start(moved.id);

    await card(column(page, home.column.running), moved.key).waitFor({
      timeout: CHANGE_VISIBLE_MS,
    });
    const calls = await callsFor(page, moved.id);
    expect(calls.every((call) => call.properties.join() === "opacity")).toBe(true);
  });

  it("Sheet 가 닫히는 도중 다른 카드를 누르면 그 카드의 Sheet 가 바로 열린다", async (context) => {
    const first = assign();
    const second = assign();
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    const queued = column(page, home.column.queued);
    await cardButton(queued, first.key).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByText(first.key, { exact: true }).waitFor();
    await expect
      .poll(() => sheet.evaluate((node) => getComputedStyle(node).transform))
      .toBe("none");
    expect(
      await cardButton(queued, second.key).evaluate((node) => node.closest("[inert]") !== null),
    ).toBe(true);
    const target = await cardButton(queued, second.key).boundingBox();
    if (target === null) throw new Error("no card box");

    const closing = await sheet.evaluate(async (node, closeName) => {
      const close = [...node.querySelectorAll("button")].find(
        (button) => button.textContent === closeName,
      );
      close?.click();
      for (let frame = 0; frame < 60 && !node.hasAttribute("data-ending-style"); frame += 1) {
        await new Promise(requestAnimationFrame);
      }
      for (const animation of document.getAnimations()) animation.playbackRate = 0.02;
      return node.hasAttribute("data-ending-style");
    }, home.sheet.close);
    expect(closing).toBe(true);

    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);

    await sheet.getByText(second.key, { exact: true }).waitFor();
    await expect
      .poll(() => sheet.evaluate((node) => node.hasAttribute("data-ending-style")))
      .toBe(false);
  });

  it("닫히는 Sheet 위 더블클릭의 둘째 클릭은 뒤 카드를 열지 않는다", async (context) => {
    const first = assign();
    const second = assign();
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    const { x, y } = await openSheetOverCard(page, first.key, second.key);

    const sheet = await closeSheetSlowly(page, () => page.mouse.click(x, y));
    await pressSecondOfDoubleClick(page);

    expect(await sheet.evaluate((node) => node.hasAttribute("data-ending-style"))).toBe(true);
    expect(await sheet.getByText(second.key, { exact: true }).count()).toBe(0);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.finish();
    });
    await expect.poll(() => sheet.count()).toBe(0);
  });

  it("Sheet 가 다 닫힌 뒤에 온 둘째 클릭도 뒤 카드를 열지 않는다", async (context) => {
    const first = assign();
    const second = assign();
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    const { x, y } = await openSheetOverCard(page, first.key, second.key);
    const sheet = page.locator('[role="dialog"]');

    await page.mouse.click(x, y);
    await expect.poll(() => sheet.count()).toBe(0);
    await pressSecondOfDoubleClick(page);

    await page.waitForTimeout(QUIET_MS);
    expect(await sheet.count()).toBe(0);
  });

  it("전체에서 한 Workspace 로 바꾸며 상태가 달라진 카드도 움직이지 않는다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await page.route("**/api/change-events/stream**", (route) => route.abort());
    await open(page, "/?ws=all", "/");
    await card(page, run.key).waitFor();
    expect(await card(page, run.key).locator("[data-status]").count()).toBe(0);
    const paused = changeRunState(db, run.id, { to: "paused", source: "operator" });
    if (!paused.ok) throw new Error("pause failed");
    await clearCalls(page);

    await switchWorkspace(page, shell.workspace.all, "Acme");

    await card(page, run.key).locator('[data-status="paused"]').waitFor();
    await expectQuiet(page);
  });
});

describe("Runs 움직임(브라우저, 0153)", () => {
  const finish = (id: RunId, agentResult: "canceled" | "reported-failure" = "canceled") => {
    const ended = changeRunState(db, id, { to: "ended", agentResult, prState: "none" });
    if (!ended.ok) throw new Error(`end failed: ${JSON.stringify(ended.error)}`);
  };

  it("첫 렌더에서는 움직이지 않는다", async (context) => {
    assign();
    const page = await newPage(context);
    await open(page, runsPath, "/runs");
    await expectQuiet(page);
    expect(await motionCalls(page)).toEqual([]);
  });

  it("SSE 로 끝난 런의 행은 끝난 런 표에 들어온다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await open(page, `${runsPath}&view=all`, "/runs");
    await page.locator("[data-runner-cards]").getByRole("button", { name: run.key }).waitFor();
    await clearCalls(page);

    finish(run.id);

    await runRow(page, run.key).waitFor({ timeout: CHANGE_VISIBLE_MS });
    const entered = await callsFor(page, run.id);
    expect(entered.some((call) => call.properties.includes("gridTemplateRows"))).toBe(true);
  });

  it("움직임 줄이기에서는 새 행이 흐려지며 들어온다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context, "reduce");
    await open(page, `${runsPath}&view=all`, "/runs");
    await page.locator("[data-runner-cards]").getByRole("button", { name: run.key }).waitFor();
    await clearCalls(page);

    finish(run.id);

    await runRow(page, run.key).waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, run.id);
    expect(calls.every((call) => call.properties.join() === "opacity")).toBe(true);
  });
});

describe("Run 상세 타임라인 움직임(브라우저, 0153)", () => {
  const timelineCalls = async (page: Page) =>
    (await motionCalls(page)).filter((call) => call.key?.startsWith("waiting-for-input:"));

  it("첫 렌더는 움직이지 않고 SSE 로 붙은 새 줄만 떠오른다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await open(page, `/runs/${run.id}?ws=${workspaceId}`, `/runs/${run.id}`);
    await expectQuiet(page);

    pause(run.id);

    await expect
      .poll(async () => (await timelineCalls(page)).length, { timeout: CHANGE_VISIBLE_MS })
      .toBeGreaterThan(0);
    const calls = await motionCalls(page);
    expect(calls.every((call) => call.key?.startsWith("waiting-for-input:"))).toBe(true);
    expect((await timelineCalls(page))[0]?.properties).toEqual(["opacity", "transform"]);
  });

  it("움직임 줄이기에서는 새 줄이 흐려지기만 한다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context, "reduce");
    await open(page, `/runs/${run.id}?ws=${workspaceId}`, `/runs/${run.id}`);
    await clearCalls(page);

    pause(run.id);

    await expect
      .poll(async () => (await timelineCalls(page)).length, { timeout: CHANGE_VISIBLE_MS })
      .toBeGreaterThan(0);
    const calls = await timelineCalls(page);
    expect(calls.every((call) => call.properties.join() === "opacity")).toBe(true);
  });
});
