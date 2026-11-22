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
import type { RunId, TicketKey } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  listPendingCancelRequests,
  listRunQuestions,
  listRuns,
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
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import question from "../../apps/web/messages/ko/question.json" with { type: "json" };
import run from "../../apps/web/messages/ko/run.json" with { type: "json" };
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import {
  connection,
  fakeKind,
  trackerProject,
  unassignedTicket,
  workspaceId,
} from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerKind = toRunnerKind("fake");
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);

const questionId = toQuestionId("q-1");
const questionBody = "Which database should the cache use?";
const answerText = "Use SQLite.";

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
let questionRun: RunId;
let runningRun: RunId;

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
  dir = mkdtempSync(join(tmpdir(), "ganger-browser-"));
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
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async (context) => {
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

describe("운영자 핵심 동작(브라우저)", () => {
  it("answer: Dashboard 카드의 답하기 패널로 에이전트 질문에 답하면 DB 에 답이 하나 남고 화면에 보인다", async () => {
    await page.goto(`/?ws=${workspaceId}`);
    await hydrated(page);
    const row = page
      .getByRole("region", { name: home.column.running })
      .getByRole("listitem")
      .filter({ has: page.getByText("ACME-1", { exact: true }) });
    await row.getByText(questionBody).waitFor();
    await row.getByRole("button", { name: home.card.answer }).click();
    const layer = page.getByRole("dialog");
    await layer.getByLabel(question.answerLabel).fill(answerText);
    await layer.getByRole("button", { name: question.send }).click();
    await layer.getByRole("status").getByText(home.question.answered).waitFor();

    const answered = listRunQuestions(db, questionRun).filter((q) => q.answer !== null);
    expect(answered.map((q) => [q.id, q.answer?.text])).toEqual([[questionId, answerText]]);

    await page.goto(`/runs/${questionRun}?ws=${workspaceId}`);
    await hydrated(page);
    await page.getByText(answerText, { exact: true }).waitFor();
  });

  it("cancel: Run 상세에서 런 취소를 요청하면 취소 중이 보이고 DB 에 요청이 하나 남는다", async () => {
    await page.goto(`/runs/${runningRun}?ws=${workspaceId}`);
    await hydrated(page);
    await page.getByRole("button", { name: run.cancel.trigger }).click();
    const dialog = page.getByRole("dialog", { name: run.cancel.title });
    await dialog.getByRole("button", { name: run.cancel.confirm }).click();

    await page.getByText(run.cancelPending, { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: run.cancel.trigger }).count()).toBe(0);
    expect(listPendingCancelRequests(db).map((request) => request.runId)).toEqual([runningRun]);
  });

  it("assign: Tickets 에서 수동 할당하면 Queued 런이 하나 생기고 Runs 화면에 보인다", async () => {
    const key = unassignedTicket.key;
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    await page
      .getByRole("list", { name: tickets.listLabel })
      .getByRole("button", { name: unassignedTicket.title })
      .click();
    await page.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog", { name: fill(tickets.assign.title, { key }) });
    await dialog.getByRole("button", { name: tickets.assign.submit }).click();

    await page
      .getByRole("region", { name: shell.toastRegion })
      .getByText(fill(tickets.assign.done, { key }))
      .waitFor();
    const created = runsOf(key);
    expect(created.map((r) => [r.state, r.runnerProject, r.agent])).toEqual([
      ["queued", runnerProject, agent],
    ]);

    await page.goto(`/runs?ws=${workspaceId}`);
    await hydrated(page);
    await page.locator("[data-waiting-card]").getByRole("button", { name: key }).waitFor();
  });
});

describe("화면 시각의 시간대(브라우저, 0044)", () => {
  it("브라우저 시간대로 시각을 그리고, 쿠키를 남긴 뒤에는 서버 렌더링부터 그 시간대다", async () => {
    const context = await browser.newContext({
      baseURL: baseUrl,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    const seoul = await context.newPage();
    seoul.setDefaultTimeout(30_000);
    const consoleErrors: string[] = [];
    seoul.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const assignedAt = runsOf(toTicketKey("ACME-1"))[0]?.assignedAt;
    if (assignedAt === undefined) throw new Error("no ACME-1 run");
    const clockIn = (timeZone: string) =>
      new Intl.DateTimeFormat("ko-KR", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(assignedAt);
    const timeIn = (timeZone: string) => `>${clockIn(timeZone)}</time>`;
    const path = `/runs/${questionRun}?ws=${workspaceId}`;

    try {
      const first = await seoul.goto(path);
      expect(await first?.text()).toContain(timeIn("UTC"));
      await hydrated(seoul);
      await seoul.locator("time").getByText(clockIn("Asia/Seoul")).first().waitFor();
      const cookies = await context.cookies();
      expect(cookies.find((c) => c.name === "tz")?.value).toBe("Asia/Seoul");

      const again = await seoul.goto(path);
      const html = (await again?.text()) ?? "";
      expect(html).toContain(timeIn("Asia/Seoul"));
      expect(html).not.toContain(timeIn("UTC"));
      await hydrated(seoul);
      expect(consoleErrors.filter((text) => /hydrat/i.test(text))).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

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

  const projects = [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }];
  saveRunner(db, { id: runnerId, kind: runnerKind, name: "runner-a", config: {}, capacity: 4 });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects,
    assignmentBlocked: false,
  });

  questionRun = startRun(toTicketKey("ACME-1"));
  ok(changeRunState(db, questionRun, { to: "waiting-for-input" }));
  recordRunQuestions(db, questionRun, [
    { id: questionId, body: questionBody, options: [], askedAt: new Date() },
  ]);

  runningRun = startRun(toTicketKey("ACME-2"));
}

function startRun(key: TicketKey): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  const worktree = `wt-${key}`;
  ok(
    changeRunState(db, assigned.run.id, {
      to: "running",
      started: {
        worktree: toWorktreeRef(worktree),
        branch: `acme/${worktree}`,
        agentRef: toAgentRef(`agent-${worktree}`),
      },
    }),
  );
  return assigned.run.id;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}

function runsOf(key: TicketKey) {
  return listRuns(db, { workspaceId }).filter((r) => r.ticket.key === key);
}

function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}
