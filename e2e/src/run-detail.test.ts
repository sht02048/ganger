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
import type { RunId } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  completeAgentMessage,
  listRunAgentMessages,
  listRunQuestions,
  migrate,
  openDatabase,
  recordPermissionWaits,
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
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import domain from "../../apps/web/messages/ko/domain.json" with { type: "json" };
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

const LOG_LINES = 200;

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
let questionRun: RunId;
let inlineQuestionRun: RunId;
let permissionRun: RunId;
let cancelRun: RunId;
let endedRun: RunId;
let keptRun: RunId;
let messageRun: RunId;
let narrowMessageRun: RunId;
let draftRun: RunId;
let failedSendRun: RunId;
let retriedRun: RunId;
let typingRun: RunId;
let resentRun: RunId;

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
  dir = mkdtempSync(join(tmpdir(), "ganger-run-detail-"));
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

describe("Run 상세 보내기 뒤 포커스와 안내(브라우저, 0051)", () => {
  it("처리할 일 띠의 답하기를 누르면 포커스가 답하기 칸으로 간다(0174)", async () => {
    await open(questionRun);
    await page
      .getByRole("button", { name: domain.runNextStep.action.question, exact: true })
      .press("Enter");

    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .toMatch(/^(TEXTAREA|INPUT)$/);
  });

  it("질문에 키보드로 답하면 포커스가 body 가 아니고 결과 문장이 role=status 안에 있다", async () => {
    await open(questionRun);
    const card = page.getByRole("region", { name: run.question.title });
    const input = card.getByLabel(question.answerLabel);
    await input.fill("Use SQLite.");
    await input.press("ControlOrMeta+Enter");

    await card.getByRole("status").getByText(run.question.sent).waitFor();
    await expect.poll(focusedStatusText).toBe(run.question.sent);
  });

  it("선택지 없이 온 질문은 글 안의 (A) (B)를 골라 보내기를 눌러야 글자와 내용으로 답한다(0116)", async () => {
    await open(inlineQuestionRun);
    const card = page.getByRole("region", { name: run.question.title });
    await card.getByText("I suggest B.").waitFor();
    await card
      .getByRole("radio", { name: "B Start now on the current main and rebase later." })
      .check();
    expect(answerOf(inlineQuestionRun)).toBeUndefined();
    await card.getByRole("button", { name: question.send }).click();

    await card.getByRole("status").getByText(run.question.sent).waitFor();
    expect(answerOf(inlineQuestionRun)).toBe("(B) Start now on the current main and rebase later.");
  });

  it("권한 요청을 키보드로 거절하면 포커스가 body 가 아니고 결과 문장이 role=status 안에 있다", async () => {
    await open(permissionRun);
    const card = page.getByRole("region", { name: run.permission.title });
    await card.getByLabel(run.permission.reasonLabel).press("Enter");

    await card.getByRole("status").getByText(run.permission.denied).waitFor();
    await expect.poll(focusedStatusText).toBe(run.permission.denied);
  });

  it("런 취소를 키보드로 확인하면 포커스가 상태 줄의 role=status 로 간다", async () => {
    await open(cancelRun);
    await page.getByRole("button", { name: run.cancel.trigger }).press("Enter");
    const dialog = page.getByRole("dialog", { name: run.cancel.title });
    await dialog.getByRole("button", { name: run.cancel.confirm }).press("Enter");

    await page.getByRole("status").getByText(run.cancelPending, { exact: true }).waitFor();
    await expect.poll(focusedStatusText).toBe(run.cancelPending);
  });

  it("워크트리 지우기를 키보드로 확인하면 버튼 대신 지우는 중이 상태 줄의 role=status 에 보이고 포커스가 그리로 간다 (0145 R7-3)", async () => {
    await open(keptRun);
    await page.getByText(run.keptWorktree["no-pr"], { exact: true }).waitFor();
    await page.getByRole("button", { name: run.removeWorktree.trigger }).press("Enter");
    const dialog = page.getByRole("dialog", { name: run.removeWorktree.title });
    await dialog.getByText(run.removeWorktree.body).waitFor();
    await dialog.getByRole("button", { name: run.removeWorktree.confirm }).press("Enter");

    await page.getByRole("status").getByText(run.removeWorktree.pending, { exact: true }).waitFor();
    await expect.poll(focusedStatusText).toBe(run.removeWorktree.pending);
    expect(await page.getByRole("button", { name: run.removeWorktree.trigger }).count()).toBe(0);
  });

  it("에이전트에게 보내면 입력칸이 비고 포커스가 입력칸으로 돌아오며 결과와 타임라인이 보인다(0147)", async () => {
    await open(messageRun);
    const card = page.getByRole("region", { name: run.agentMessage.title });
    const input = card.getByLabel(run.agentMessage.label);
    await input.fill("끝내기 전에 push 해 주세요");
    await card.getByRole("button", { name: run.agentMessage.send }).press("Enter");

    await card.getByRole("status").getByText(run.agentMessage.delivery.sending).waitFor();
    await expect.poll(() => input.inputValue()).toBe("");
    await expect
      .poll(() => input.evaluate((element) => element === document.activeElement))
      .toBe(true);
    await page.getByText(run.timeline["operator-message"], { exact: true }).waitFor();
    expect(listRunAgentMessages(db, messageRun).map((message) => message.body)).toEqual([
      "끝내기 전에 push 해 주세요",
    ]);
  });

  it("런이 잠깐 Disconnected가 돼도 쓰던 말이 남는다(0147)", async () => {
    await open(draftRun);
    const card = page.getByRole("region", { name: run.agentMessage.title });
    await card.getByLabel(run.agentMessage.label).fill("쓰던 말");

    ok(changeRunState(db, draftRun, { to: "disconnected" }));
    await card.getByLabel(run.agentMessage.label).waitFor({ state: "detached" });
    await card.getByText("쓰던 말").waitFor();
    ok(changeRunState(db, draftRun, { to: "running" }));
    await card.getByLabel(run.agentMessage.label).waitFor();
    expect(await card.getByLabel(run.agentMessage.label).inputValue()).toBe("쓰던 말");
  });

  it("요청이 실패한 뒤 런이 끝나도 이유와 쓰던 말을 남긴다(0147)", async () => {
    await open(failedSendRun);
    const card = page.getByRole("region", { name: run.agentMessage.title });
    await card.getByLabel(run.agentMessage.label).fill("실패한 말");
    await page.route("**/_serverFn/**", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await card.getByRole("button", { name: run.agentMessage.send }).press("Enter");
    await card.getByRole("status").getByText(run.actionFailed).waitFor();
    await page.unroute("**/_serverFn/**");

    ok(
      changeRunState(db, failedSendRun, {
        to: "ended",
        agentResult: "reported-success",
        prState: "none",
      }),
    );
    await card.getByLabel(run.agentMessage.label).waitFor({ state: "detached" });
    await card.getByRole("status").getByText(run.actionFailed).waitFor();
    await card.getByText("실패한 말").waitFor();
    expect(listRunAgentMessages(db, failedSendRun)).toEqual([]);
  });

  it("저장된 뒤 응답만 끊겨 다시 보내도 말은 한 번만 남는다(0147)", async () => {
    await open(retriedRun);
    const card = page.getByRole("region", { name: run.agentMessage.title });
    const input = card.getByLabel(run.agentMessage.label);
    await input.fill("한 번만 갈 말");
    await page.route("**/_serverFn/**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      return route.abort();
    });
    await card.getByRole("button", { name: run.agentMessage.send }).press("Enter");
    await card.getByRole("status").getByText(run.actionFailed).waitFor();
    await page.unroute("**/_serverFn/**");

    await card.getByRole("button", { name: run.agentMessage.send }).press("Enter");
    await expect.poll(() => input.inputValue()).toBe("");
    expect(listRunAgentMessages(db, retriedRun).map((message) => message.body)).toEqual([
      "한 번만 갈 말",
    ]);
  });

  it("보내는 동안 이어 쓴 글은 응답이 와도 지우지 않는다(0147)", async () => {
    await open(typingRun);
    const card = page.getByRole("region", { name: run.agentMessage.title });
    const input = card.getByLabel(run.agentMessage.label);
    await input.fill("먼저 보낸 말");
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_serverFn/**", async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    });
    await card.getByRole("button", { name: run.agentMessage.send }).press("Enter");
    await input.fill("이어 쓴 말");
    release();

    await expect
      .poll(() => listRunAgentMessages(db, typingRun).map((message) => message.body))
      .toEqual(["먼저 보낸 말"]);
    await card.getByRole("button", { name: run.agentMessage.send }).waitFor();
    await expect
      .poll(() =>
        card.getByRole("button", { name: run.agentMessage.send }).getAttribute("aria-busy"),
      )
      .toBe("false");
    await page.unroute("**/_serverFn/**");
    expect(await input.inputValue()).toBe("이어 쓴 말");
  });

  it("응답이 끊긴 말이 실패로 끝났으면 실패를 보이고 다음 보내기를 새 말로 저장한다(0147)", async () => {
    await open(resentRun);
    const card = page.getByRole("region", { name: run.agentMessage.title });
    const input = card.getByLabel(run.agentMessage.label);
    await input.fill("다시 보낼 말");
    await page.route("**/_serverFn/**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      return route.abort();
    });
    await card.getByRole("button", { name: run.agentMessage.send }).press("Enter");
    await card.getByRole("status").getByText(run.actionFailed).waitFor();
    await page.unroute("**/_serverFn/**");
    const [stored] = listRunAgentMessages(db, resentRun);
    if (stored === undefined) throw new Error("not stored");
    completeAgentMessage(db, {
      id: stored.id,
      runId: resentRun,
      completedAt: new Date(),
      error: "runner-error",
    });

    await card.getByRole("button", { name: run.agentMessage.send }).press("Enter");
    await card.getByRole("status").getByText(run.agentMessage.failure["runner-error"]).waitFor();
    expect(await input.inputValue()).toBe("다시 보낼 말");
    expect(listRunAgentMessages(db, resentRun)).toHaveLength(1);

    await card.getByRole("button", { name: run.agentMessage.send }).press("Enter");
    await expect.poll(() => listRunAgentMessages(db, resentRun).length).toBe(2);
    await expect.poll(() => input.inputValue()).toBe("");
  });

  it("400px 에서도 에이전트에게 보내기가 가로로 넘치지 않는다(0147)", async () => {
    await page.setViewportSize({ width: 400, height: 844 });
    await open(narrowMessageRun);
    await page.getByRole("region", { name: run.agentMessage.title }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  it("로그를 열면 마지막 줄이 보이고 키보드로 스크롤할 수 있다", async () => {
    await open(endedRun);
    const log = page.getByRole("region", { name: run.log.linesLabel });
    await log.waitFor();
    const atBottom = await log.evaluate(
      (e: { scrollHeight: number; clientHeight: number; scrollTop: number }) =>
        e.scrollHeight > e.clientHeight && e.scrollTop + e.clientHeight >= e.scrollHeight - 1,
    );
    expect(atBottom).toBe(true);
    expect(await log.getAttribute("tabindex")).toBe("0");
  });
});

async function open(runId: RunId): Promise<void> {
  await page.goto(`/runs/${runId}?ws=${workspaceId}`);
  await hydrated(page);
}

function answerOf(runId: RunId): string | undefined {
  return listRunQuestions(db, runId).find((q) => q.answer !== null)?.answer?.text;
}

async function focusedStatusText(): Promise<string | undefined> {
  const focused = page.locator('[role="status"]:focus-within');
  if ((await focused.count()) !== 1) return undefined;
  return (await focused.textContent())?.trim();
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
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 8,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
    assignmentBlocked: false,
  });

  questionRun = startRun("ACME-11");
  ok(changeRunState(db, questionRun, { to: "waiting-for-input" }));
  recordRunQuestions(db, questionRun, [
    {
      id: toQuestionId("q-1"),
      body: "Which database should the cache use?",
      options: [],
      askedAt: new Date(),
    },
  ]);

  inlineQuestionRun = startRun("ACME-16");
  ok(changeRunState(db, inlineQuestionRun, { to: "waiting-for-input" }));
  recordRunQuestions(db, inlineQuestionRun, [
    {
      id: toQuestionId("q-16"),
      body: "The timer ticket is not on main yet. What should I do? (A) Wait for the timer ticket to merge (B) Start now on the current main and rebase later. I suggest B.",
      options: [],
      askedAt: new Date(),
    },
  ]);

  permissionRun = startRun("ACME-12");
  ok(changeRunState(db, permissionRun, { to: "waiting-for-input" }));
  recordPermissionWaits(db, permissionRun, [
    { id: toPermissionRequestId("perm-1"), detail: "Bash: ls", requestedAt: new Date() },
  ]);

  cancelRun = startRun("ACME-13");
  messageRun = startRun("ACME-18");
  narrowMessageRun = startRun("ACME-19");
  draftRun = startRun("ACME-20");
  failedSendRun = startRun("ACME-23");
  retriedRun = startRun("ACME-27");
  typingRun = startRun("ACME-28");
  resentRun = startRun("ACME-29");

  endedRun = startRun("ACME-15");
  ok(
    changeRunState(db, endedRun, {
      to: "ended",
      agentResult: "reported-success",
      prState: "merged",
    }),
  );
  updateRunRecords(db, endedRun, {
    lastLog: Array.from({ length: LOG_LINES }, (_, i) => `line ${i + 1}`),
  });

  keptRun = startRun("ACME-17");
  ok(
    changeRunState(db, keptRun, { to: "ended", agentResult: "reported-success", prState: "none" }),
  );
}

function startRun(key: string): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
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

async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}
