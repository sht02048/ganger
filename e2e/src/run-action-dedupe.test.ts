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
import type { QuestionKind, RunId } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  migrate,
  openDatabase,
  recordAgentCheck,
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
  updateRunRecords,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Locator, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import question from "../../apps/web/messages/ko/question.json" with { type: "json" };
import run from "../../apps/web/messages/ko/run.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { waitForScreenQuerySettled } from "./query-settled.js";
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

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
let ticketNumber = 100;

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

describe("보내는 동안 버튼을 막는다(0156)", () => {
  it("런 취소: 확인한 뒤 응답 전에는 트리거가 막혀 대화상자가 다시 열리지 않는다", async () => {
    await open(startRun());
    const held = await holdActionRequests();
    await page.getByRole("button", { name: run.cancel.trigger }).click();
    await page
      .getByRole("dialog", { name: run.cancel.title })
      .getByRole("button", { name: run.cancel.confirm })
      .click();
    await held.arrived(1);
    await page.getByRole("dialog").waitFor({ state: "detached" });

    const trigger = page.getByRole("button", { name: run.cancel.sending });
    await expectBlocked(trigger);
    await trigger.click({ force: true });
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(held.count()).toBe(1);

    await held.release();
    await page.getByText(run.cancelPending, { exact: true }).waitFor();
  });

  it("워크트리 지우기: 확인한 뒤 응답 전에는 트리거가 막힌다", async () => {
    await open(endedRun("gone"));
    const held = await holdActionRequests();
    await page.getByRole("button", { name: run.removeWorktree.trigger }).click();
    await page
      .getByRole("dialog", { name: run.removeWorktree.title })
      .getByRole("button", { name: run.removeWorktree.confirm })
      .click();
    await held.arrived(1);
    await page.getByRole("dialog").waitFor({ state: "detached" });

    const trigger = page.getByRole("button", { name: run.removeWorktree.sending });
    await expectBlocked(trigger);
    await trigger.click({ force: true });
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(held.count()).toBe(1);
    await held.release();
  });

  it("멈추기: 응답 전에 다시 눌러도 요청은 하나다", async () => {
    await open(startRun());
    const held = await holdActionRequests();
    const pause = page.getByRole("button", { name: run.control.pause });
    await pause.click();
    await held.arrived(1);

    await expectBlocked(pause);
    await pause.click({ force: true });
    expect(held.count()).toBe(1);
    await held.release();
  });

  it("답하기: 응답 전에 다시 눌러도 요청은 하나다", async () => {
    await open(waitingRun("question"));
    const held = await holdActionRequests();
    const card = page.getByRole("region", { name: run.question.title });
    await card.getByLabel(question.answerLabel).fill("SQLite 로 해 주세요");
    await card.getByRole("button", { name: question.send }).click();
    await held.arrived(1);

    const sending = card.getByRole("button", { name: question.sending });
    expect(await sending.isDisabled()).toBe(true);
    await sending.click({ force: true });
    expect(held.count()).toBe(1);
    await held.release();
  });

  it("Human Check 답: 응답 전에는 두 답 버튼이 모두 막힌다", async () => {
    await open(waitingRun("human-check"));
    const held = await holdActionRequests();
    await page.getByRole("button", { name: question.humanCheck.confirm }).click();
    await held.arrived(1);

    const other = page.getByRole("button", { name: question.humanCheck.requestChanges });
    expect(await other.isDisabled()).toBe(true);
    await other.click({ force: true });
    expect(held.count()).toBe(1);
    await held.release();
  });

  it("이어서 맡기기: 응답 전에 다시 눌러도 요청은 하나다", async () => {
    await open(endedRun("gone"));
    await page.getByRole("button", { name: run.continue.trigger }).click();
    const dialog = page.getByRole("dialog", { name: run.continue.title });
    await dialog.getByLabel(run.continue.messageLabel).fill("이어 주세요");
    const held = await holdActionRequests();
    await dialog.getByRole("button", { name: run.continue.confirm }).click();
    await held.arrived(1);

    const sending = dialog.getByRole("button", { name: run.continue.sending });
    await expectBlocked(sending);
    await sending.click({ force: true });
    expect(held.count()).toBe(1);
    await held.release();
  });

  it("이전 에이전트 멈추기: 응답 전에 다시 눌러도 요청은 하나다", async () => {
    await open(endedRun("alive"));
    const held = await holdActionRequests();
    await page.getByRole("button", { name: run.continue.stop }).click();
    await held.arrived(1);

    const stopping = page.getByRole("button", { name: run.continue.stopPending });
    await expectBlocked(stopping);
    await stopping.click({ force: true });
    expect(held.count()).toBe(1);
    await held.release();
  });
});

async function open(runId: RunId): Promise<void> {
  await page.goto(`/runs/${runId}?ws=${workspaceId}`);
  await waitForScreenQuerySettled(page, ["runs", "detail", runId]);
}

async function expectBlocked(button: Locator): Promise<void> {
  await expect.poll(() => button.getAttribute("aria-disabled")).toBe("true");
  expect(await button.getAttribute("aria-busy")).toBe("true");
}

async function holdActionRequests() {
  let seen = 0;
  let letGo = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  await page.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.postData()?.includes("requestId")) {
      seen += 1;
      await gate;
    }
    await route.continue();
  });
  return {
    count: () => seen,
    arrived: async (count: number) => {
      await expect.poll(() => seen).toBe(count);
    },
    release: async () => {
      letGo();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  };
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
  saveRunner(db, { id: runnerId, kind: runnerKind, name: "runner-a", config: {}, capacity: 20 });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
}

function startRun(): RunId {
  ticketNumber += 1;
  const key = toTicketKey(`ACME-${ticketNumber}`);
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

function endedRun(check: "gone" | "alive"): RunId {
  const id = startRun();
  ok(changeRunState(db, id, { to: "ended", agentResult: "reported-success", prState: "none" }));
  updateRunRecords(db, id, { worktreeKept: "unpushed-commits" });
  recordAgentCheck(db, id, check, { stopHandled: check === "gone" });
  return id;
}

function waitingRun(kind: QuestionKind): RunId {
  const id = startRun();
  ok(changeRunState(db, id, { to: "waiting-for-input" }));
  recordRunQuestions(db, id, [
    { id: questionId, kind, body: "확인해 주세요", options: [], askedAt: new Date() },
  ]);
  return id;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}
