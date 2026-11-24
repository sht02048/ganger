import type { QuestionId, RunnerId, WorktreeRef } from "@ganger/core";
import {
  DEFAULT_MAX_RUN_MS,
  answerRunQuestion,
  denyPermissionWait,
  getRun,
  latestChangeSeq,
  listRunPermissionWaits,
  listRunQuestions,
  openDatabase,
} from "@ganger/db";
import type { Database, StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, projectA } from "./test-fixtures.js";
import type { Worker } from "./worker.js";

const hook = vi.hoisted(() => ({
  beforeRunStateChange: null as (() => void) | null,
  failRunStateChanges: 0,
}));

vi.mock("@ganger/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ganger/db")>();
  return {
    ...actual,
    changeRunState: (...args: Parameters<typeof actual.changeRunState>) => {
      hook.beforeRunStateChange?.();
      if (hook.failRunStateChanges > 0) {
        hook.failRunStateChanges -= 1;
        throw new Error("database is locked");
      }
      return actual.changeRunState(...args);
    },
  };
});

let h: Harness;
let reader: Database;

beforeEach(() => {
  h = new Harness();
  reader = openDatabase(h.dbPath);
  hook.beforeRunStateChange = null;
  hook.failRunStateChanges = 0;
});

afterEach(async () => {
  reader.$client.close();
  await h.cleanup();
});

function worktreeOf(run: StoredRun): WorktreeRef {
  const found = getRun(h.db, run.id);
  if (found === null || found.state === "queued" || found.worktree === null) {
    throw new Error("run has not started");
  }
  return found.worktree;
}

async function waitingOnQuestion(): Promise<{
  run: StoredRun;
  runnerId: RunnerId;
  worker: Worker;
  questionId: QuestionId;
}> {
  const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
  const run = h.assign("ENG-1", projectA);
  const worker = h.worker();
  await worker.tick();
  const questionId = h.runner(runnerId).ask(worktreeOf(run), {
    body: "어느 쪽으로 할까요?",
    options: ["A", "B"],
    at: h.now,
  });
  await worker.tick();
  expect(getRun(h.db, run.id)?.state).toBe("waiting-for-input");
  return { run, runnerId, worker, questionId };
}

function seenByReader(run: StoredRun) {
  return {
    state: getRun(reader, run.id)?.state,
    answerSentAt: listRunQuestions(reader, run.id)[0]?.answer?.sentAt ?? null,
    denySentAt: listRunPermissionWaits(reader, run.id)[0]?.denial?.sentAt ?? null,
    changeSeq: latestChangeSeq(reader),
  };
}

describe("답·거절 전달 표시와 Running 전환은 한 트랜잭션으로 쓴다", () => {
  it("다른 연결은 답을 전했다는 표시만 있고 아직 Waiting for Input 인 런을 읽지 못한다", async () => {
    const { run, worker, questionId } = await waitingOnQuestion();
    answerRunQuestion(h.db, { runId: run.id, questionId, answer: "A" }, h.now);
    const before = seenByReader(run);
    const midway: Array<ReturnType<typeof seenByReader>> = [];
    hook.beforeRunStateChange = () => midway.push(seenByReader(run));

    await worker.tick();

    expect(midway).toEqual([before]);
    expect(before).toMatchObject({ state: "waiting-for-input", answerSentAt: null });
    const after = seenByReader(run);
    expect(after).toMatchObject({ state: "running", answerSentAt: h.now });
    expect(after.changeSeq).toBeGreaterThan(before.changeSeq);
  });

  it("Running 으로 바꾸다 실패하면 답 전달 표시도 되돌리고, 다음 바퀴에 다시 보내지 않고 둘을 함께 쓴다", async () => {
    const { run, runnerId, worker, questionId } = await waitingOnQuestion();
    answerRunQuestion(h.db, { runId: run.id, questionId, answer: "A" }, h.now);
    const before = seenByReader(run);

    hook.failRunStateChanges = 1;
    await worker.tick();
    expect(seenByReader(run)).toEqual(before);
    expect(h.runner(runnerId).runAt(worktreeOf(run)).answers).toEqual([
      { questionId, answer: "A" },
    ]);

    await worker.tick();
    expect(seenByReader(run)).toMatchObject({ state: "running", answerSentAt: h.now });
    expect(h.runner(runnerId).runAt(worktreeOf(run)).answers).toHaveLength(1);
  });

  it("답을 전한 바퀴에 런이 끝나면 끝을 쓴 뒤 답 전달 표시를 쓴다", async () => {
    const { run, runnerId, worker, questionId } = await waitingOnQuestion();
    answerRunQuestion(h.db, { runId: run.id, questionId, answer: "A" }, h.now);
    const agent = h.runner(runnerId).runAt(worktreeOf(run));
    h.advance(DEFAULT_MAX_RUN_MS);

    await worker.tick();

    expect(seenByReader(run)).toMatchObject({ state: "ended", answerSentAt: h.now });
    expect(agent.answers).toEqual([{ questionId, answer: "A" }]);
  });

  it("Running 으로 바꾸다 실패하면 거절 전달 표시도 되돌리고, 다음 바퀴에 다시 보내지 않고 둘을 함께 쓴다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    const permissionId = h.runner(runnerId).requestPermission(worktreeOf(run), "Bash: curl");
    await worker.tick();
    expect(getRun(h.db, run.id)?.state).toBe("waiting-for-input");
    denyPermissionWait(h.db, { runId: run.id, permissionId, reason: "필요 없어요" }, h.now);
    const before = seenByReader(run);

    const midway: Array<ReturnType<typeof seenByReader>> = [];
    hook.beforeRunStateChange = () => midway.push(seenByReader(run));
    hook.failRunStateChanges = 1;
    await worker.tick();
    expect(midway).toEqual([before]);
    expect(seenByReader(run)).toEqual(before);
    expect(before).toMatchObject({ state: "waiting-for-input", denySentAt: null });

    await worker.tick();
    expect(seenByReader(run)).toMatchObject({ state: "running", denySentAt: h.now });
    expect(h.runner(runnerId).runAt(worktreeOf(run)).denials).toEqual([
      { permissionId, reason: "필요 없어요" },
    ]);
  });
});
