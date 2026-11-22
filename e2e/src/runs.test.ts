import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toAgentRef,
  toCodeHostKind,
  toLabelId,
  toPullRequestId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
  toWorktreeRef,
} from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
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
  updateRunRecords,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import runsJson from "../../apps/web/messages/ko/runs.json" with { type: "json" };
import runJson from "../../apps/web/messages/ko/run.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const onlineRunner = toRunnerId("runner-a");
const offlineRunner = toRunnerId("runner-b");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const runningKey = "ACME-RUN";
const runningTitle = "Retry failed payment webhooks";
const endedRunCount = 55;
const endedPageSize = 50;

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
  dir = mkdtempSync(join(tmpdir(), "ganger-runs-"));
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

describe("Runs 화면(브라우저, 0056)", () => {
  it("'자세히 보기'를 누르면 문서를 다시 읽지 않고 Run 상세로 간다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    await runningLine(page).click();
    await page.evaluate(() => {
      Object.assign(globalThis, { runsDocumentMarker: true });
    });

    await page.getByRole("link", { name: runsJson.panel.openDetail }).click();
    await page.waitForURL(/\/runs\/[^/?]+/);
    await page.getByRole("heading", { name: runningTitle }).first().waitFor();

    expect(await page.evaluate(() => "runsDocumentMarker" in globalThis)).toBe(true);
  });

  it("'자세히 보기'를 수정키로 누르면 지금 화면은 그대로 두고 새 탭으로 연다(0166)", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    await runningLine(page).click();
    const listUrl = page.url();
    const opened = page.context().waitForEvent("page");
    await page
      .getByRole("link", { name: runsJson.panel.openDetail })
      .click({ modifiers: ["ControlOrMeta"] });
    const tab = await opened;
    await tab.waitForURL(/\/runs\/[^/?]+/);
    await tab.close();
    expect(page.url()).toBe(listUrl);
  });

  it("끝난 런은 50개부터 보이고, 아래로 내리면 이어서 불러온다(0173)", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    const endedRows = page.getByRole("option", { name: /^ACME-END-/ });
    await expect.poll(() => endedRows.count()).toBeGreaterThanOrEqual(endedPageSize);

    await page.getByRole("button", { name: runsJson.endedRuns.loadMore }).scrollIntoViewIfNeeded();

    await expect.poll(() => endedRows.count()).toBe(endedRunCount);
    expect(await page.getByRole("button", { name: runsJson.endedRuns.loadMore }).count()).toBe(0);
  });

  it("넓으면 자리를 기다리는 카드가 오른쪽, 좁으면 맨 위이고 가로로 넘치지 않는다(0173)", async (context) => {
    const layoutAt = async (width: number) => {
      const page = await newPage(context, { width, height: 900 });
      await openRuns(page);
      await page.locator("[data-waiting-card]").waitFor();
      return page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector(selector);
          if (element === null) throw new Error(`${selector} not found`);
          return element.getBoundingClientRect();
        };
        const waiting = box("[data-waiting-card]");
        const cards = box("[data-runner-cards]");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          waitingRight: waiting.left >= cards.right,
          waitingAbove: waiting.bottom <= cards.top,
        };
      });
    };
    expect(await layoutAt(1440)).toEqual({ overflow: 0, waitingRight: true, waitingAbove: false });
    for (const width of [600, 400, 320])
      expect(await layoutAt(width)).toEqual({
        overflow: 0,
        waitingRight: false,
        waitingAbove: true,
      });
  });

  it("런을 누르면 패널이 열리고 sel 로 남으며, 닫으면 누른 행으로 포커스가 돌아온다(0173)", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    await runningLine(page).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("link", { name: runsJson.panel.openDetail }).waitFor();
    await expect.poll(() => new URL(page.url()).searchParams.has("sel")).toBe(true);

    await page.reload();
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await page.getByRole("dialog").getByRole("link", { name: runsJson.panel.openDetail }).waitFor();

    await page.getByRole("button", { name: runsJson.panel.close }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has("sel")).toBe(false);
    await page.getByRole("dialog").waitFor({ state: "detached" });
  });

  it("끝난 런 행은 클릭·Space·Enter 로 패널을 열고, 방향키만으로는 열지 않는다(0173)", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    const rows = page
      .getByRole("listbox", { name: runsJson.endedRuns.listLabel })
      .getByRole("option");
    const dialog = page.getByRole("dialog");
    const close = async () => {
      await page.getByRole("button", { name: runsJson.panel.close }).click();
      await dialog.waitFor({ state: "detached" });
    };

    await rows.first().click();
    await dialog.waitFor();
    await close();

    await rows.first().focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    expect(await dialog.count()).toBe(0);
    await page.keyboard.press("Space");
    await dialog.waitFor();
    await close();

    await rows.first().focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor();
    expect(new URL(page.url()).searchParams.has("sel")).toBe(true);
  });

  it("400px 에서 PR 의 CI 실패·충돌·뒤처짐이 Runs 행과 Run 상세에서 넘치지 않는다(0150)", async (context) => {
    const ended = listRuns(db)
      .flatMap((run) => (run.state === "ended" ? [run] : []))
      .sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime())
      .at(0);
    if (ended === undefined) throw new Error("no ended run");
    const { id } = ended;
    const key = ended.ticket.key;
    db.$client
      .prepare(
        `UPDATE runs SET agent_result = 'reported-success', pr_state = 'open',
          started_at = ended_at - 60000, runner_id = ?, worktree_ref = 'wt-pr-signals',
          worktree_removed_at = NULL, worktree_kept = NULL,
          branch = 'feat/pr-signals', agent_ref = 'agent-pr-signals' WHERE id = ?`,
      )
      .run(onlineRunner, id);
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("12"),
        displayId: "#12",
        url: "https://code.example.com/acme/web/pull/12",
        ci: "failure",
        checkedAt: new Date(),
        signals: {
          open: true,
          headCommit: "abc",
          ciFailed: true,
          checkTotal: 12,
          failedCount: 2,
          failedChecks: ["browser-shard-with-a-long-check-name", "static"],
          checksTruncated: false,
          conflict: true,
          behindBy: 18,
        },
      },
    });
    const overflow = (page: Page) =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

    const page = await newPage(context, { width: 400, height: 900 });
    await openRuns(page);
    const row = page.getByRole("option", { name: new RegExp(`^${key}(\\D|$)`) });
    await row
      .getByText(`${runsJson.word["needs-review"]} · ${runsJson.reason["ci-failed"]}`)
      .first()
      .waitFor();
    expect(await overflow(page)).toBe(0);

    await page.goto(`/runs/${id}`);
    await page.getByText(runJson.props.hasConflict).waitFor();
    await page.getByText(/browser-shard-with-a-long-check-name/).waitFor();
    expect(await overflow(page)).toBe(0);
  });

  it("머리글과 첫 행 사이에 8px 을 두고, 머리글을 숨긴 좁은 폭에서는 빈 틈을 남기지 않는다(0141)", async (context) => {
    const headGapAt = async (width: number) => {
      const page = await newPage(context, { width, height: 900 });
      await openRuns(page);
      const list = page.getByRole("listbox", { name: runsJson.endedRuns.listLabel });
      await list.getByRole("option").first().waitFor();
      return list.evaluate((listbox) => {
        const table = listbox.parentElement;
        const head = listbox.previousElementSibling;
        const firstRow = listbox.querySelector('[role="option"]');
        if (table === null || head === null || firstRow === null)
          throw new Error("runs table not found");
        const rowTop = firstRow.getBoundingClientRect().top;
        return {
          headShown: getComputedStyle(head).display !== "none",
          belowHead: Math.round(rowTop - head.getBoundingClientRect().bottom),
          belowTableTop: Math.round(rowTop - table.getBoundingClientRect().top),
        };
      });
    };

    const wide = await headGapAt(1440);
    expect(wide).toMatchObject({ headShown: true, belowHead: 8 });

    const narrow = await headGapAt(400);
    expect(narrow).toMatchObject({ headShown: false, belowTableTop: 0 });
  });

  it("Settings 목차는 1100px 에서 본문 왼쪽에, 800px 에서 본문 위 한 줄에 둔다(0119)", async (context) => {
    const boxes = async (width: number) => {
      const page = await newPage(context, { width, height: 900 });
      await page.goto(`/settings?ws=${workspaceId}`);
      await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
      await page.waitForLoadState("networkidle");
      return page.evaluate(() => {
        const nav = document.querySelector('main nav[aria-label="Settings 목차"]');
        const first = document.querySelector("main section#workspace");
        if (nav === null || first === null) throw new Error("settings layout not found");
        const box = (element: Element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        };
        return { nav: box(nav), first: box(first) };
      });
    };

    const wide = await boxes(1100);
    expect(wide.nav.x + wide.nav.width).toBeLessThanOrEqual(wide.first.x);

    const narrow = await boxes(800);
    expect(narrow.nav.y + narrow.nav.height).toBeLessThanOrEqual(narrow.first.y);
  });

  it("레일의 Runner Issue 점은 글자와 바탕의 대비가 4.5:1 이상이다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    const dot = page.locator("[data-issues]");
    expect(await dot.textContent()).toBe("1");

    const ratio = await dot.evaluate((element) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context2d = canvas.getContext("2d", { willReadFrequently: true });
      if (context2d === null) throw new Error("no 2d context");
      const luminance = (color: string): number => {
        context2d.clearRect(0, 0, 1, 1);
        context2d.fillStyle = color;
        context2d.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0] = context2d.getImageData(0, 0, 1, 1).data;
        const linear = (channel: number) => {
          const c = channel / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
      };
      const text = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Runs 조건(브라우저, 0075)", () => {
  it("조건에 맞는 런이 없으면 조건 때문이라고 알린다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await page.goto(`/runs?ws=${workspaceId}&agent=codex`);
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await page.getByText(runsJson.endedRuns.emptyWithConditions).waitFor();
    expect(await page.getByRole("option").count()).toBe(0);
  });
});

async function newPage(
  context: TestContext,
  viewport: { width: number; height: number },
): Promise<Page> {
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

function runningLine(page: Page) {
  return page.locator("[data-runner-cards]").getByRole("button", { name: runningKey });
}

async function openRuns(page: Page): Promise<void> {
  await page.goto(`/runs?ws=${workspaceId}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
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
  saveMapping(db, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
  for (const [id, online] of [
    [onlineRunner, true],
    [offlineRunner, false],
  ] as const) {
    saveRunner(db, { id, kind: toRunnerKind("fake"), name: id, config: {}, capacity: 4 });
    recordRunnerCheck(db, {
      runnerId: id,
      online,
      checkedAt: new Date(),
      error: null,
      projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
      assignmentBlocked: false,
    });
  }

  const start = Date.now() - (endedRunCount + 10) * 60_000;
  for (let i = 0; i < endedRunCount; i += 1) {
    const at = new Date(start + i * 60_000);
    const id = assign(db, `ACME-END-${i}`, at);
    ok(changeRunState(db, id, { to: "ended", agentResult: "canceled", prState: "none" }, at));
  }
  const running = assign(db, runningKey, new Date(), runningTitle);
  ok(
    changeRunState(db, running, {
      to: "running",
      started: {
        worktree: toWorktreeRef("wt-acme-run"),
        branch: "acme/wt-acme-run",
        agentRef: toAgentRef("agent-wt-acme-run"),
      },
    }),
  );
}

function assign(db: Database, key: string, now: Date, ticketTitle?: string) {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    ...(ticketTitle === undefined ? {} : { ticketTitle }),
    trackerProject,
    runnerProject,
    agent,
    runnerId: onlineRunner,
    now,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  return assigned.run.id;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}
