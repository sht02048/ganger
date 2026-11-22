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
  toTrackerProjectId,
  toTrackerStateId,
  toWorktreeRef,
} from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
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
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import runsJson from "../../apps/web/messages/ko/runs.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { waitForScreenQuerySettled } from "./query-settled.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerId = toRunnerId("runner-a");
const otherRunnerId = toRunnerId("runner-b");
const idleRunnerId = toRunnerId("runner-c");
const otherWorkspace = toWorkspaceId("ws-other");
const otherProject = toTrackerProjectId("tp-other");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const questionKey = "ACME-ASK";
const questionTitle = "Choose the retry policy";

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let questionRun: string;

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
  dir = mkdtempSync(join(tmpdir(), "ganger-runs-polish-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  questionRun = seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });
  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await openRuns(warm);
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

describe("Runs 다듬기(브라우저, 0178)", () => {
  it("패널의 처리할 일 링크는 문서를 다시 읽지 않고 런 상세로 간다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    await questionLine(page).click();
    await page.evaluate(() => {
      Object.assign(globalThis, { runsPolishMarker: true });
    });

    await page.getByRole("link", { name: runsJson.panel.inDetail.question }).click();
    await page.waitForURL(new RegExp(`/runs/${questionRun}`));
    await waitForScreenQuerySettled(page, ["runs", "detail", questionRun]);

    expect(await page.evaluate(() => "runsPolishMarker" in globalThis)).toBe(true);
  });

  it("처리할 일 링크를 수정키로 누르면 지금 화면을 두고 새 탭으로 연다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    await questionLine(page).click();
    const listUrl = page.url();
    const opened = page.context().waitForEvent("page");

    await page
      .getByRole("link", { name: runsJson.panel.inDetail.question })
      .click({ modifiers: ["ControlOrMeta"] });

    const tab = await opened;
    await tab.waitForURL(new RegExp(`/runs/${questionRun}`));
    expect(page.url()).toBe(listUrl);
  });

  it("다른 Workspace 문장을 누르면 수정키 없이도 링크와 같은 주소로 간다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    const link = page
      .locator(`[data-runner-card="${otherRunnerId}"]`)
      .getByRole("link", { name: runsJson.now.otherWorkspace.replace("{count}", "1") });
    const href = await link.getAttribute("href");

    await link.click();
    await page.waitForURL((url) => `${url.pathname}${url.search}` === href);

    expect(href).toBe(`/runs?ws=${otherWorkspace}&runner=${otherRunnerId}`);
  });

  it("좁은 화면에서 Tab 은 기다리는 런 카드에 먼저 닿는다", async (context) => {
    const page = await newPage(context, { width: 400, height: 900 });
    await openRuns(page);
    await page.locator("[data-waiting-card]").getByRole("button").first().waitFor();
    await page.locator("[data-runner-cards]").getByRole("button").first().waitFor();
    await page.evaluate(() => {
      const board = document.querySelector("[data-waiting-card]")?.parentElement;
      const start = document.createElement("span");
      start.tabIndex = -1;
      start.id = "tab-start";
      board?.prepend(start);
      start.focus();
    });

    await page.keyboard.press("Tab");

    const inWaitingCard = await page.evaluate(() =>
      Boolean(document.activeElement?.closest("[data-waiting-card]")),
    );
    expect(inWaitingCard).toBe(true);
  });

  it("넓은 화면에서 러너 카드가 남는 폭을 나누고 거르기 줄과 표 사이가 띄어진다(0185)", async (context) => {
    const page = await newPage(context, { width: 1600, height: 900 });
    await openRuns(page);
    await page.locator(`[data-runner-card="${idleRunnerId}"]`).waitFor();
    await waitForScreenQuerySettled(page, ["runs"]);

    const layout = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const cards = [...document.querySelectorAll("[data-runner-card]")].map((card) =>
        card.getBoundingClientRect(),
      );
      const grid = document.querySelector("[data-runner-cards]");
      const tools = document.querySelector("[data-ended-tools]");
      return {
        cardCount: cards.length,
        trackCount:
          grid === null ? 0 : getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
        lastCardRight: Math.max(...cards.map((card) => card.right)),
        cardWidth: cards[0]?.width ?? 0,
        waitingLeft: box("[data-waiting-card]")?.left ?? 0,
        toolsGap:
          (tools?.nextElementSibling?.getBoundingClientRect().top ?? 0) -
          (tools?.getBoundingClientRect().bottom ?? 0),
      };
    });

    expect(layout.cardCount).toBe(3);
    expect(layout.trackCount).toBe(3);
    expect(layout.waitingLeft - layout.lastCardRight).toBeLessThan(layout.cardWidth);
    expect(layout.toolsGap).toBeGreaterThan(0);
  });
});

async function newPage(context: TestContext, viewport: { width: number; height: number }) {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport,
  });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  return page;
}

function questionLine(page: Page) {
  return page.locator("[data-runner-cards]").getByRole("button", { name: questionKey });
}

async function openRuns(page: Page): Promise<void> {
  await page.goto(`/runs?ws=${workspaceId}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.locator("[data-runner-cards]").waitFor();
}

function seed(db: Database): string {
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
  saveMapping(db, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 1,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
  const asked = assign(db, questionKey, new Date(Date.now() - 60_000), questionTitle);
  must(
    changeRunState(db, asked, {
      to: "running",
      started: {
        worktree: toWorktreeRef("wt-ask"),
        branch: "acme/wt-ask",
        agentRef: toAgentRef("agent-wt-ask"),
      },
    }),
  );
  must(changeRunState(db, asked, { to: "waiting-for-input" }));
  recordRunQuestions(db, asked, [
    { id: toQuestionId("q-1"), body: "Which policy?", options: [], askedAt: new Date() },
  ]);
  assign(db, "ACME-WAIT", new Date());
  saveWorkspace(db, { id: otherWorkspace, name: "Other" });
  saveWorkspaceTrackerProject(db, {
    workspaceId: otherWorkspace,
    connection,
    projectId: otherProject,
    name: "Other",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(db, { connection, trackerProject: otherProject, runnerProject, agent });
  saveRunner(db, {
    id: otherRunnerId,
    kind: toRunnerKind("fake"),
    name: "runner-b",
    config: {},
    capacity: 2,
  });
  recordRunnerCheck(db, {
    runnerId: otherRunnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
  saveRunner(db, {
    id: idleRunnerId,
    kind: toRunnerKind("fake"),
    name: "runner-c",
    config: {},
    capacity: 1,
  });
  recordRunnerCheck(db, {
    runnerId: idleRunnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
  const away = assignRun(db, {
    ticket: { connection, key: toTicketKey("OTHER-1") },
    trackerProject: otherProject,
    runnerProject,
    agent,
    runnerId: otherRunnerId,
    now: new Date(),
  });
  if (!away.ok) throw new Error(away.reason);
  must(
    changeRunState(db, away.run.id, {
      to: "running",
      started: {
        worktree: toWorktreeRef("wt-other"),
        branch: "acme/wt-other",
        agentRef: toAgentRef("agent-wt-other"),
      },
    }),
  );
  return asked;
}

function assign(db: Database, key: string, now: Date, ticketTitle?: string) {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    ...(ticketTitle === undefined ? {} : { ticketTitle }),
    trackerProject,
    runnerProject,
    agent,
    runnerId,
    now,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  return assigned.run.id;
}

function must(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}
