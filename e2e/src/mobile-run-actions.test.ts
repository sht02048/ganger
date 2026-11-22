import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectResponseSchema,
  runActionResponseSchema,
  runDetailResponseSchema,
  v1ErrorSchema,
  v1RunActionPath,
  v1RunPath,
} from "@ganger/api";
import type { V1RunAction } from "@ganger/api";
import {
  DeviceConnectionCodes,
  connectDevice,
  startDeviceConnection,
} from "@ganger/app/devices/connection";
import { parseConnectionQr } from "@ganger/api";
import type { QuestionId, RunnerId, WorktreeRef } from "@ganger/core";
import { getRun, listRunPermissionWaits, listRunQuestions, requestRunControl } from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import type { Worker } from "@ganger/worker";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, projectA } from "../../apps/worker/src/test-fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const encryptionKey = new Uint8Array(32).fill(7);

const fakeAdapters: Plugin = {
  name: "mobile-run-actions-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

let h: Harness;
let web: ViteDevServer;
let baseUrl: string;
let worker: Worker;
let runnerId: RunnerId;
let token: string;
let ticketSeq = 0;
let requestSeq = 0;

beforeAll(async () => {
  h = new Harness();
  h.now = new Date();
  runnerId = h.addRunner({ id: "runner-a", capacity: 40, projects: [projectA] });
  worker = h.worker();
  const codes = new DeviceConnectionCodes();
  const started = startDeviceConnection({ codes, webAddress: "https://ganger.example.com" });
  if (!started.ok) throw new Error(started.reason);
  const qr = parseConnectionQr(started.qr);
  if (qr === null) throw new Error("QR을 읽지 못했다");
  const reply = connectDevice({ db: h.db, codes }, { code: qr.code, name: "iPhone" }, new Date());
  if (reply.status !== 200) throw new Error("기기를 연결하지 못했다");
  token = connectResponseSchema.shape.data.parse(reply.result).token;
  process.env["DATABASE_PATH"] = h.dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(h.dbPath, "..", "vite-cache"),
  }));
  const warm = await fetch(new URL(v1RunPath("warm-up"), baseUrl));
  if (warm.status !== 401) throw new Error(`warm-up failed: ${warm.status}`);
}, 240_000);

afterAll(async () => {
  await web?.close();
  await h?.cleanup();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
});

function newRequestId(): string {
  requestSeq += 1;
  return `mobile-request-${String(requestSeq).padStart(8, "0")}`;
}

function post(runId: string, action: string, body: unknown, auth = true): Promise<Response> {
  return fetch(new URL(`${v1RunPath(runId)}/${action}`, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function accepted(runId: string, action: V1RunAction, body: unknown): Promise<void> {
  const response = await post(runId, action, body);
  expect(response.status).toBe(200);
  runActionResponseSchema.parse(await response.json());
}

async function refused(response: Response): Promise<{ status: number; reason: string }> {
  const body = v1ErrorSchema.parse(await response.json());
  return { status: response.status, reason: body.error.reason };
}

function stateOf(run: StoredRun): string | undefined {
  return getRun(h.db, run.id)?.state;
}

function worktreeOf(run: StoredRun): WorktreeRef {
  const found = getRun(h.db, run.id);
  if (found === null || found.state === "queued" || found.worktree === null) {
    throw new Error("런이 시작되지 않았다");
  }
  return found.worktree;
}

async function startedRun(): Promise<StoredRun> {
  ticketSeq += 1;
  const run = h.assign(`MOB-${ticketSeq}`, projectA);
  await worker.tick();
  expect(stateOf(run)).toBe("running");
  return run;
}

async function askedRun(kind?: "human-check"): Promise<{ run: StoredRun; questionId: QuestionId }> {
  const run = await startedRun();
  const questionId = h.runner(runnerId).ask(worktreeOf(run), {
    body: "어느 쪽으로 할까요?",
    options: ["A", "B"],
    at: h.now,
    ...(kind === undefined ? {} : { kind }),
  });
  await worker.tick();
  expect(stateOf(run)).toBe("waiting-for-input");
  return { run, questionId };
}

async function permissionRun() {
  const run = await startedRun();
  const promptId = h.runner(runnerId).requestPermission(worktreeOf(run), "pnpm test", h.now);
  await worker.tick();
  expect(stateOf(run)).toBe("waiting-for-input");
  return { run, promptId };
}

async function pausedRun(): Promise<StoredRun> {
  const run = await startedRun();
  expect(requestRunControl(h.db, run.id, "pause", h.now).ok).toBe(true);
  await worker.tick();
  expect(stateOf(run)).toBe("paused");
  return run;
}

async function tickUntilRunning(run: StoredRun): Promise<void> {
  for (let tick = 0; tick < 3 && stateOf(run) !== "running"; tick += 1) await worker.tick();
  expect(stateOf(run)).toBe("running");
}

describe("v1 쓰기로 런을 다시 움직이기", () => {
  it("Question에 답하면 런이 Running으로 돌아간다", async () => {
    const { run, questionId } = await askedRun();
    await accepted(run.id, "answer", { requestId: newRequestId(), questionId, answer: "A" });
    await tickUntilRunning(run);
    expect(h.runner(runnerId).runAt(worktreeOf(run)).answers).toEqual([
      { questionId, answer: "A" },
    ]);
  });

  it.each([
    ["confirmed", "확인했어요\n\n좋아요"],
    ["changes-requested", "고쳐 주세요\n\n좋아요"],
  ] as const)("Human Check의 %s 답으로 런이 Running으로 돌아간다", async (decision, text) => {
    const { run, questionId } = await askedRun("human-check");
    await accepted(run.id, "human-check", {
      requestId: newRequestId(),
      questionId,
      decision,
      note: "좋아요",
    });
    await tickUntilRunning(run);
    expect(h.runner(runnerId).runAt(worktreeOf(run)).answers).toEqual([
      { questionId, answer: text },
    ]);
  });

  it("거절이 러너에 전해진다", async () => {
    const { run, promptId } = await permissionRun();
    await accepted(run.id, "deny", { requestId: newRequestId(), promptId, reason: "안 돼요" });
    expect(listRunPermissionWaits(h.db, run.id)[0]?.denial?.reason).toBe("안 돼요");
    await worker.tick();
    expect(h.runner(runnerId).runAt(worktreeOf(run)).denials).toEqual([
      { permissionId: promptId, reason: "안 돼요" },
    ]);
  });

  it("재개하면 Paused 런이 Running으로 돌아간다", async () => {
    const run = await pausedRun();
    await accepted(run.id, "resume", { requestId: newRequestId() });
    await tickUntilRunning(run);
    expect(h.runner(runnerId).runAt(worktreeOf(run)).resumes).toHaveLength(1);
  });

  it("취소하면 런이 끝난다", async () => {
    const run = await startedRun();
    await accepted(run.id, "cancel", { requestId: newRequestId() });
    for (let tick = 0; tick < 3 && stateOf(run) !== "ended"; tick += 1) await worker.tick();
    expect(stateOf(run)).toBe("ended");
  });
});

describe("늦게 간 쓰기", () => {
  it("이미 답한 질문은 다른 요청이면 already-answered로 거절한다", async () => {
    const { run, questionId } = await askedRun();
    await accepted(run.id, "answer", { requestId: newRequestId(), questionId, answer: "A" });
    expect(
      await refused(
        await post(run.id, "answer", { requestId: newRequestId(), questionId, answer: "B" }),
      ),
    ).toEqual({ status: 409, reason: "already-answered" });
  });

  it("끝난 런의 취소와 Paused가 아닌 런의 재개를 이유와 함께 거절한다", async () => {
    const run = await startedRun();
    expect(await refused(await post(run.id, "resume", { requestId: newRequestId() }))).toEqual({
      status: 409,
      reason: "not-paused",
    });
    await accepted(run.id, "cancel", { requestId: newRequestId() });
    for (let tick = 0; tick < 3 && stateOf(run) !== "ended"; tick += 1) await worker.tick();
    expect(await refused(await post(run.id, "cancel", { requestId: newRequestId() }))).toEqual({
      status: 409,
      reason: "already-ended",
    });
  });

  it("러너에서 이미 처리한 Permission은 resolved로 거절한다", async () => {
    const { run, promptId } = await permissionRun();
    h.runner(runnerId).allowPermission(worktreeOf(run), promptId);
    await worker.tick();
    expect(
      await refused(
        await post(run.id, "deny", { requestId: newRequestId(), promptId, reason: "" }),
      ),
    ).toEqual({ status: 409, reason: "resolved" });
  });

  it("10,000자 한국어 답도 받는다", async () => {
    const { run, questionId } = await askedRun();
    const answer = "가".repeat(10_000);
    await accepted(run.id, "answer", { requestId: newRequestId(), questionId, answer });
    expect(listRunQuestions(h.db, run.id)[0]?.answer?.text).toBe(answer);
  });

  it("없는 런은 not-found로 거절한다", async () => {
    expect(await refused(await post("no-run", "cancel", { requestId: newRequestId() }))).toEqual({
      status: 404,
      reason: "not-found",
    });
  });
});

describe("requestId(M25)", () => {
  it.each(["answer", "human-check", "deny", "resume", "cancel"] as const)(
    "%s는 requestId가 없으면 거절한다",
    async (action) => {
      const run = await startedRun();
      const bodies: Record<V1RunAction, unknown> = {
        answer: { questionId: "q", answer: "A" },
        "human-check": { questionId: "q", decision: "confirmed", note: "" },
        deny: { promptId: "p", reason: "" },
        resume: {},
        cancel: {},
      };
      expect(await refused(await post(run.id, action, bodies[action]))).toEqual({
        status: 400,
        reason: "invalid-request",
      });
    },
  );

  it("답하기는 같은 ID와 내용을 한 번만 처리하고, 다른 내용은 already-answered다", async () => {
    const { run, questionId } = await askedRun();
    const requestId = newRequestId();
    const body = { requestId, questionId, answer: "A" };
    await accepted(run.id, "answer", body);
    await accepted(run.id, "answer", body);
    expect(listRunQuestions(h.db, run.id)[0]?.answer?.text).toBe("A");
    expect(await refused(await post(run.id, "answer", { ...body, answer: "B" }))).toEqual({
      status: 409,
      reason: "already-answered",
    });
  });

  it("Human Check는 같은 ID에 다른 내용이면 already-answered다", async () => {
    const { run, questionId } = await askedRun("human-check");
    const body = { requestId: newRequestId(), questionId, decision: "confirmed", note: "" };
    await accepted(run.id, "human-check", body);
    await accepted(run.id, "human-check", body);
    expect(
      await refused(await post(run.id, "human-check", { ...body, decision: "changes-requested" })),
    ).toEqual({ status: 409, reason: "already-answered" });
  });

  it("Permission 거절은 같은 ID와 내용을 한 번만 처리하고, 다른 내용은 request-reused다", async () => {
    const { run, promptId } = await permissionRun();
    const body = { requestId: newRequestId(), promptId, reason: "안 돼요" };
    await accepted(run.id, "deny", body);
    await accepted(run.id, "deny", body);
    expect(listRunPermissionWaits(h.db, run.id)[0]?.denial?.reason).toBe("안 돼요");
    expect(await refused(await post(run.id, "deny", { ...body, reason: "다른 이유" }))).toEqual({
      status: 409,
      reason: "request-reused",
    });
  });

  it("취소와 재개는 같은 ID를 다른 동작에 쓰면 request-reused다", async () => {
    const run = await pausedRun();
    const requestId = newRequestId();
    await accepted(run.id, "resume", { requestId });
    await accepted(run.id, "resume", { requestId });
    expect(await refused(await post(run.id, "cancel", { requestId }))).toEqual({
      status: 409,
      reason: "request-reused",
    });
  });

  it("러너에서 실패한 재개는 같은 ID로 다시 처리한다", async () => {
    const run = await pausedRun();
    const requestId = newRequestId();
    h.runner(runnerId).failNextControl = {
      kind: "runner-error",
      code: "agent_not_running",
      message: "no agent",
    };
    await accepted(run.id, "resume", { requestId });
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    await accepted(run.id, "resume", { requestId });
    await tickUntilRunning(run);
  });
});

describe("v1 경계", () => {
  it("멈추기는 열리지 않는다", async () => {
    const run = await startedRun();
    expect(await refused(await post(run.id, "pause", { requestId: newRequestId() }))).toEqual({
      status: 404,
      reason: "not-found",
    });
    expect(
      await refused(await post(run.id, "resume", { requestId: newRequestId(), control: "pause" })),
    ).toEqual({ status: 400, reason: "invalid-request" });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("쓰기와 런 상세는 기기 토큰이 없으면 거절한다", async () => {
    const run = await startedRun();
    expect(
      await refused(await post(run.id, "cancel", { requestId: newRequestId() }, false)),
    ).toEqual({ status: 401, reason: "invalid-token" });
    expect(await refused(await fetch(new URL(v1RunPath(run.id), baseUrl)))).toEqual({
      status: 401,
      reason: "invalid-token",
    });
    expect(stateOf(run)).toBe("running");
  });

  it("런 상세는 처리할 일 띠·요약·PR을 싣고 타임라인과 터미널은 싣지 않는다", async () => {
    const { run } = await askedRun();
    const response = await fetch(new URL(v1RunPath(run.id), baseUrl), {
      headers: { authorization: `Bearer ${token}` },
    });
    const raw: unknown = await response.json();
    const { data } = runDetailResponseSchema.parse(raw);
    expect(data.nextStep).toBe("question");
    expect(data.input).toMatchObject({
      kind: "question",
      choices: [
        { text: "A", answer: "A" },
        { text: "B", answer: "B" },
      ],
    });
    expect(data.summary).toMatchObject({ report: null });
    expect(data.pullRequest).toBeNull();
    const text = JSON.stringify(raw);
    for (const field of ['"timeline"', '"log"', '"worktree"', '"branch"']) {
      expect(text).not.toContain(field);
    }
    expect(v1RunActionPath(run.id, "answer")).toContain(encodeURIComponent(run.id));
  });
});
