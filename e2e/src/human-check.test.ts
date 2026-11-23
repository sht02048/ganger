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
  assignRun,
  changeRunState,
  listRunQuestions,
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
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerProject = toRunnerProjectId("fake:acme/web");
const runnerId = toRunnerId("runner-a");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const CHECK_BODY = "PR #7 머지를 확인해 주세요\n\nhttps://github.com/acme/widgets/pull/7";

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
let detailRun: RunId;
let sheetRun: RunId;

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
  dir = mkdtempSync(join(tmpdir(), "ganger-human-check-"));
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

describe("Human Check 답하기(브라우저, 0148)", () => {
  it("400px Run 상세에서 넘치지 않고, 고쳐 주세요와 함께 보낼 말을 보내면 결과에 포커스가 간다", async () => {
    await page.setViewportSize({ width: 400, height: 844 });
    await page.goto(`/runs/${detailRun}?ws=${workspaceId}`);
    await hydrated(page);
    const card = page.getByRole("region", { name: run.humanCheck.title });
    await card.getByRole("link", { name: "https://github.com/acme/widgets/pull/7" }).waitFor();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);

    await card.getByLabel(question.humanCheck.noteLabel).fill("시험을 더해 주세요");
    await card.getByRole("button", { name: question.humanCheck.requestChanges }).click();

    await card.getByRole("status").getByText(run.humanCheck.sent).waitFor();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("role")))
      .toBe("status");
    expect(listRunQuestions(db, detailRun)[0]?.answer?.text).toBe(
      "고쳐 주세요\n\n시험을 더해 주세요",
    );
  });

  it("Dashboard 의 확인해 주세요 묶음에서 패널을 열어 확인했어요로 답한다", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/?ws=${workspaceId}`);
    await hydrated(page);
    const group = page.locator('[data-todo-group="check"]');
    await group.getByText(home.board.humanCheck, { exact: true }).waitFor();
    await group.getByRole("button", { name: home.card.check }).first().click();

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: question.humanCheck.confirm }).click();
    await sheet.waitFor({ state: "hidden" });
    expect(listRunQuestions(db, sheetRun)[0]?.answer?.text).toBe("확인했어요");
  });
});

async function hydrated(target: Page): Promise<void> {
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}

function waitingRun(key: string, questionId: string): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  const id = assigned.run.id;
  const started = changeRunState(db, id, {
    to: "running",
    started: {
      worktree: toWorktreeRef(`wt-${key}`),
      branch: `acme/wt-${key}`,
      agentRef: toAgentRef(`agent-${key}`),
    },
  });
  if (!started.ok) throw new Error("start failed");
  const waiting = changeRunState(db, id, { to: "waiting-for-input" });
  if (!waiting.ok) throw new Error("wait failed");
  recordRunQuestions(db, id, [
    {
      id: toQuestionId(questionId),
      kind: "human-check",
      body: CHECK_BODY,
      options: [],
      askedAt: new Date(),
    },
  ]);
  return id;
}

function seed(target: Database): void {
  saveTrackerConnection(target, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(target, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(target, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(target, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(target, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(target, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(target, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 8,
  });
  recordRunnerCheck(target, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
    assignmentBlocked: false,
  });
  detailRun = waitingRun("ACME-71", "msg-detail");
  sheetRun = waitingRun("ACME-72", "msg-sheet");
}
