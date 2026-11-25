import { AdapterError, DISCONNECT_AFTER_MS, summarizeRunOutcome } from "@ganger/core";
import type { RunnerErrorDetail, RunnerId, WorktreeRef } from "@ganger/core";
import {
  DEFAULT_MAX_RUN_MS,
  answerRunQuestion,
  changeRunState,
  denyPermissionWait,
  getRun,
  getRunControlRequest,
  getRunWithRecords,
  hasPendingCancelRequest,
  listRunPermissionWaits,
  listRunQuestions,
  listRunners,
  listRunStateChanges,
  listRuns,
  requestRunCancel,
  requestRunControl,
  saveWorkspace,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, projectA, projectB } from "./test-fixtures.js";
import { RUNNER_CHECK_INTERVAL_MS } from "./runner-check.js";
import type { Worker } from "./worker.js";
import { FAKE_AGENT_PROTOCOL } from "@ganger/core/testing";
import type { FakeRunnerRun } from "@ganger/core/testing";

let h: Harness;

beforeEach(() => {
  h = new Harness();
  agents.clear();
});

afterEach(async () => {
  await h.cleanup();
});

const MINUTE = 60_000;

function current(run: StoredRun): StoredRun {
  const found = getRun(h.db, run.id);
  if (found === null) throw new Error(`run ${run.id} is gone`);
  return found;
}

function stateOf(run: StoredRun): string {
  return current(run).state;
}

function ended(run: StoredRun) {
  const found = current(run);
  if (found.state !== "ended") throw new Error(`run ${run.id} is ${found.state}, not ended`);
  return found;
}

function worktreeOf(run: StoredRun): WorktreeRef {
  const found = current(run);
  if (found.state === "queued" || found.worktree === null) throw new Error("run has not started");
  return found.worktree;
}

function unreachableSince(run: StoredRun): Date | null {
  return getRunWithRecords(h.db, run.id)?.records.unreachableSince ?? null;
}

async function startOne(): Promise<{ run: StoredRun; runnerId: RunnerId; worker: Worker }> {
  const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
  const run = h.assign("ENG-1", projectA);
  const worker = h.worker();
  await worker.tick();
  expect(stateOf(run)).toBe("running");
  agentOf(run, runnerId);
  return { run, runnerId, worker };
}

const agents = new Map<string, FakeRunnerRun>();

function agentOf(run: StoredRun, runnerId: RunnerId): FakeRunnerRun {
  const known = agents.get(run.id);
  if (known !== undefined) return known;
  const agent = h.runner(runnerId).runAt(worktreeOf(run));
  agents.set(run.id, agent);
  return agent;
}

function cutSsh(runnerId: RunnerId, cut = true): void {
  h.runner(runnerId).online = !cut;
}

async function disconnect(run: StoredRun, runnerId: RunnerId, worker: Worker): Promise<void> {
  cutSsh(runnerId);
  await worker.tick();
  h.advance(DISCONNECT_AFTER_MS);
  await worker.tick();
  expect(stateOf(run)).toBe("disconnected");
}

describe("입력 기다림", () => {
  it("질문을 DB에 쓰고 Waiting for Input으로 바꾼 뒤, 답을 한 번 보내면 Running으로 돌아간다", async () => {
    const { run, runnerId, worker } = await startOne();
    const questionId = h.runner(runnerId).ask(worktreeOf(run), {
      body: "어느 쪽으로 할까요?",
      options: ["A", "B"],
      at: h.now,
    });

    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
    expect(listRunQuestions(h.db, run.id)).toEqual([
      expect.objectContaining({ id: questionId, body: "어느 쪽으로 할까요?", options: ["A", "B"] }),
    ]);

    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");

    expect(answerRunQuestion(h.db, { runId: run.id, questionId, answer: "A" }, h.now)).toEqual({
      ok: true,
    });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).answers).toEqual([{ questionId, answer: "A" }]);
    expect(listRunQuestions(h.db, run.id)[0]?.answer?.sentAt).toEqual(h.now);

    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).answers).toHaveLength(1);
  });

  it("Human Check 를 종류와 함께 저장해 Waiting for Input 으로 바꾸고, 답을 보내면 Running 으로 돌아간다", async () => {
    const { run, runnerId, worker } = await startOne();
    const questionId = h.runner(runnerId).ask(worktreeOf(run), {
      kind: "human-check",
      body: "PR #7 머지를 확인해 주세요",
      at: h.now,
    });

    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
    expect(listRunQuestions(h.db, run.id)).toEqual([
      expect.objectContaining({ id: questionId, kind: "human-check" }),
    ]);

    answerRunQuestion(
      h.db,
      {
        runId: run.id,
        questionId,
        answer: "고쳐 주세요\n\n시험을 더해 주세요",
        kind: "human-check",
      },
      h.now,
    );
    await worker.tick();
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).answers).toEqual([
      { questionId, answer: "고쳐 주세요\n\n시험을 더해 주세요" },
    ]);
    expect(agentOf(run, runnerId).resumes).toEqual([]);
  });

  it("Human Check 를 보내고 차례를 끝낸 에이전트는 답을 보낼 때 깨우고, 깨우지 못하면 Waiting for Input 에 두고 다시 깨운다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const questionId = fake.ask(worktreeOf(run), {
      kind: "human-check",
      body: "PR #7 머지를 확인해 주세요",
      at: h.now,
    });
    fake.stopWithoutReport(worktreeOf(run), { at: h.now });
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");

    answerRunQuestion(
      h.db,
      {
        runId: run.id,
        questionId,
        answer: "고쳐 주세요\n\n시험을 더해 주세요",
        kind: "human-check",
      },
      h.now,
    );
    const resume = vi.spyOn(fake, "resumeAgent");
    resume.mockRejectedValueOnce(new Error("terminal busy"));
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
    expect(listRunQuestions(h.db, run.id)[0]?.answer?.sentAt).toBeNull();

    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).answers).toHaveLength(1);
    expect(agentOf(run, runnerId).resumes.map((r) => r.message)).toEqual([
      `운영자가 Human Check(${questionId})에 답했어요: 고쳐 주세요 시험을 더해 주세요`,
    ]);
  });

  it("활동을 알 수 없으면 터미널에 입력하지 않고 Waiting for Input 에 둔 채 다음 차례에 다시 본다", async () => {
    const { run, runnerId, worker } = await startOne();
    const questionId = h
      .runner(runnerId)
      .ask(worktreeOf(run), { kind: "human-check", body: "확인", at: h.now });
    await worker.tick();
    answerRunQuestion(
      h.db,
      { runId: run.id, questionId, answer: "확인했어요", kind: "human-check" },
      h.now,
    );
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
    expect(listRunQuestions(h.db, run.id)[0]?.answer?.sentAt).toBeNull();
    expect(agentOf(run, runnerId).resumes).toEqual([]);

    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).answers).toHaveLength(1);
    expect(agentOf(run, runnerId).resumes).toEqual([]);
  });

  it("깨우기가 다른 에이전트를 찾기만 했으면 답을 보낸 것으로 적지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const questionId = fake.ask(worktreeOf(run), {
      kind: "human-check",
      body: "확인",
      at: h.now,
    });
    fake.stopWithoutReport(worktreeOf(run), { at: h.now });
    await worker.tick();
    answerRunQuestion(
      h.db,
      { runId: run.id, questionId, answer: "확인했어요", kind: "human-check" },
      h.now,
    );
    vi.spyOn(fake, "resumeAgent").mockResolvedValueOnce({
      agentRef: agentOf(run, runnerId).started.agentRef,
      restarted: true,
    });
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
    expect(listRunQuestions(h.db, run.id)[0]?.answer?.sentAt).toBeNull();
    expect(agentOf(run, runnerId).answers).toHaveLength(1);
  });

  it("권한 대기가 열려 있으면 차례가 끝나 보여도 터미널에 답을 넣지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const questionId = fake.ask(worktreeOf(run), { kind: "human-check", body: "확인", at: h.now });
    const permissionId = fake.requestPermission(worktreeOf(run), "Bash: rm -rf build", h.now);
    fake.stopWithoutReport(worktreeOf(run), { at: h.now });
    await worker.tick();
    answerRunQuestion(
      h.db,
      { runId: run.id, questionId, answer: "확인했어요", kind: "human-check" },
      h.now,
    );

    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
    expect(agentOf(run, runnerId).resumes).toEqual([]);

    fake.allowPermission(worktreeOf(run), permissionId);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).resumes).toHaveLength(1);
  });

  it("일하는 에이전트에게 간 Human Check 답은 터미널로 다시 넣지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const questionId = fake.ask(worktreeOf(run), { kind: "human-check", body: "확인", at: h.now });
    fake.continueOnRunner(worktreeOf(run), h.now);
    await worker.tick();
    answerRunQuestion(
      h.db,
      { runId: run.id, questionId, answer: "확인했어요", kind: "human-check" },
      h.now,
    );
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).resumes).toEqual([]);
  });

  it("같은 질문의 답은 데몬을 다시 띄워도 한 번만 보낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    const questionId = h.runner(runnerId).ask(worktreeOf(run), { body: "계속할까요?" });
    await worker.tick();
    answerRunQuestion(h.db, { runId: run.id, questionId, answer: "네" }, h.now);
    await worker.tick();
    await worker.close();

    const restarted = h.worker();
    await restarted.tick();
    await restarted.tick();
    expect(agentOf(run, runnerId).answers).toEqual([{ questionId, answer: "네" }]);
    expect(stateOf(run)).toBe("running");
  });

  it("권한 대기를 DB에 쓰고 Waiting for Input으로 바꾸며, 러너 화면에서 허용하면 닫고 Running으로 돌아간다", async () => {
    const { run, runnerId, worker } = await startOne();
    const permissionId = h
      .runner(runnerId)
      .requestPermission(worktreeOf(run), "Bash: rm -rf dist", h.now);

    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
    expect(listRunPermissionWaits(h.db, run.id)).toEqual([
      expect.objectContaining({ id: permissionId, detail: "Bash: rm -rf dist", resolvedAt: null }),
    ]);

    h.runner(runnerId).allowPermission(worktreeOf(run), permissionId);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(listRunPermissionWaits(h.db, run.id)[0]?.resolvedAt).toEqual(h.now);
  });

  it("운영자의 거절을 한 번만 보내고, 데몬을 다시 띄워도 다시 보내지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const permissionId = h.runner(runnerId).requestPermission(worktreeOf(run), "Bash: curl");
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");

    expect(
      denyPermissionWait(h.db, { runId: run.id, permissionId, reason: "필요 없어요" }, h.now),
    ).toEqual({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).denials).toEqual([{ permissionId, reason: "필요 없어요" }]);
    expect(listRunPermissionWaits(h.db, run.id)[0]?.denial?.sentAt).toEqual(h.now);
    await worker.close();

    const restarted = h.worker();
    await restarted.tick();
    expect(agentOf(run, runnerId).denials).toHaveLength(1);
    expect(listRunPermissionWaits(h.db, run.id)[0]?.resolvedAt).not.toBeNull();
  });

  it("거절을 남긴 뒤 러너 화면에서 허용돼 닫힌 대기에는 거절을 보내지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const permissionId = h.runner(runnerId).requestPermission(worktreeOf(run), "Bash: ls");
    await worker.tick();
    denyPermissionWait(h.db, { runId: run.id, permissionId, reason: "아니요" }, h.now);
    h.runner(runnerId).allowPermission(worktreeOf(run), permissionId);

    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agentOf(run, runnerId).denials).toEqual([]);
  });

  it("런이 끝나면 열린 권한 대기를 닫는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).requestPermission(worktreeOf(run), "Bash: make");
    await worker.tick();
    expect(listRunPermissionWaits(h.db, run.id)[0]?.resolvedAt).toBeNull();

    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(ended(run).agentResult).toBe("stopped-waiting-for-input");
    expect(listRunPermissionWaits(h.db, run.id)[0]?.resolvedAt).toEqual(h.now);
  });
});

describe("완료 보고와 보고 없이 사라짐", () => {
  it.each([
    { outcome: "succeeded", agentResult: "reported-success" },
    { outcome: "failed", agentResult: "reported-failure" },
  ])(
    "완료 보고 $outcome → $agentResult로 기록하고 에이전트를 닫는다",
    async ({ outcome, agentResult }) => {
      const { run, runnerId, worker } = await startOne();
      h.putPullRequest(current(run), "open");
      h.runner(runnerId).report(worktreeOf(run), { outcome, body: "끝났어요" });

      await worker.tick();
      const found = ended(run);
      expect(found).toMatchObject({ agentResult, prState: "open" });
      expect(getRunWithRecords(h.db, run.id)?.records.reportBody).toBe("끝났어요");
      expect(agentOf(run, runnerId)).toMatchObject({ agentClosed: true, agentStopped: false });
    },
  );

  it("에이전트를 닫지 못하면 기록하지 않고 다음 바퀴에 다시 닫는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).report(worktreeOf(run), { outcome: "succeeded" });
    const close = vi
      .spyOn(h.runner(runnerId), "closeAgent")
      .mockRejectedValueOnce(new AdapterError(runnerError("close_failed")));

    await worker.tick();
    expect(stateOf(run)).toBe("running");

    await worker.tick();
    expect(ended(run).agentResult).toBe("reported-success");
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("보고 없이 사라지면 비정상 종료로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).vanish(worktreeOf(run));

    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "ended-without-report", prState: "none" });
    expect(agentOf(run, runnerId).agentClosed).toBe(false);
  });

  it("Running 중 워크트리가 사라지면 워크트리 없음으로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).deleteWorktree(worktreeOf(run));

    await worker.tick();
    const found = ended(run);
    expect(found.agentResult).toBe("worktree-missing");
    expect(summarizeRunOutcome(found).worktree).toBe("nothing-to-remove");
  });
});

describe("시간 초과", () => {
  it("PR이 열린 Running 런이 최대 실행 시간을 넘기면 에이전트를 멈추고 시간 초과로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");

    h.advance(DEFAULT_MAX_RUN_MS - 1);
    await worker.tick();
    expect(stateOf(run)).toBe("running");

    h.advance(1);
    await worker.tick();
    const found = ended(run);
    expect(found).toMatchObject({ agentResult: "timed-out", prState: "open" });
    expect(summarizeRunOutcome(found)).toEqual({
      outcome: "failed",
      worktree: "keep-until-pr-settles",
    });
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
  });

  it("입력 기다림 중에도 시계가 흘러 최대 실행 시간이 지나면 입력 기다리다 멈춤으로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).ask(worktreeOf(run), { body: "어떻게 할까요?" });
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");

    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "stopped-waiting-for-input", prState: "none" });
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
  });

  it("Workspace의 최대 실행 시간을 따른다", async () => {
    const { run, worker } = await startOne();
    saveWorkspace(h.db, { id: current(run).workspaceId, name: "Acme", maxRunMs: 10 * MINUTE });

    h.advance(10 * MINUTE);
    await worker.tick();
    expect(ended(run).agentResult).toBe("timed-out");
  });
});

describe("연결 끊김", () => {
  it("ssh가 4분 실패한 뒤 다시 닿으면 상태를 바꾸지 않고 이어서 본다", async () => {
    const { run, runnerId, worker } = await startOne();
    cutSsh(runnerId);
    await worker.tick();
    expect(unreachableSince(run)).toEqual(h.now);

    h.advance(4 * MINUTE);
    await worker.tick();
    expect(stateOf(run)).toBe("running");

    cutSsh(runnerId, false);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(unreachableSince(run)).toBeNull();
    expect(listRunStateChanges(h.db, run.id).map((c) => c.to)).toEqual(["queued", "running"]);

    cutSsh(runnerId);
    await worker.tick();
    h.advance(4 * MINUTE);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("ssh가 닿았는데 출력 오류면 연속 실패가 아니라 5분 시계를 되돌린다", async () => {
    const { run, runnerId, worker } = await startOne();
    cutSsh(runnerId);
    await worker.tick();
    h.advance(3 * MINUTE);
    cutSsh(runnerId, false);
    vi.spyOn(h.runner(runnerId), "pollRun").mockRejectedValueOnce(
      new AdapterError<RunnerErrorDetail>({ kind: "malformed-output", raw: "?" }),
    );
    await worker.tick();
    expect(unreachableSince(run)).toBeNull();

    cutSsh(runnerId);
    await worker.tick();
    h.advance(3 * MINUTE);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("ssh가 5분 동안 계속 실패하면 끝내지 않고 Disconnected로 바꾸며 워크트리를 건드리지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    await disconnect(run, runnerId, worker);
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(h.runner(runnerId).runs.size).toBe(1);
  });

  it("ssh 실패 도중 데몬을 다시 띄워도 5분 시계가 처음부터 다시 시작하지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    cutSsh(runnerId);
    await worker.tick();
    h.advance(3 * MINUTE);
    await worker.tick();
    await worker.close();

    const restarted = h.worker();
    h.advance(2 * MINUTE);
    await restarted.tick();
    expect(stateOf(run)).toBe("disconnected");
  });

  it("다시 연결했을 때 에이전트가 돌고 있으면 Running으로 돌아간다", async () => {
    const { run, runnerId, worker } = await startOne();
    await disconnect(run, runnerId, worker);

    cutSsh(runnerId, false);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(unreachableSince(run)).toBeNull();
  });

  it("다시 연결했을 때 입력을 기다리고 있으면 바로 Waiting for Input으로 돌아간다", async () => {
    const { run, runnerId, worker } = await startOne();
    await disconnect(run, runnerId, worker);
    h.runner(runnerId).ask(worktreeOf(run), { body: "어떻게 할까요?" });

    cutSsh(runnerId, false);
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
  });

  it("다시 연결했을 때 에이전트가 이미 끝났으면 보통 종료처럼 두 축을 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    await disconnect(run, runnerId, worker);
    h.putPullRequest(current(run), "merged");
    h.runner(runnerId).report(worktreeOf(run), { outcome: "succeeded" });

    cutSsh(runnerId, false);
    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "reported-success", prState: "merged" });
    expect(agentOf(run, runnerId).agentClosed).toBe(true);
  });

  it("다시 연결했을 때 워크트리가 사라졌으면 워크트리 없음으로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    await disconnect(run, runnerId, worker);
    h.runner(runnerId).deleteWorktree(worktreeOf(run));

    cutSsh(runnerId, false);
    await worker.tick();
    expect(ended(run).agentResult).toBe("worktree-missing");
  });

  it("Disconnected인 채 최대 실행 시간이 지나면 러너 연결 끊김으로 끝내고 PR 상태를 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    await disconnect(run, runnerId, worker);

    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    const found = ended(run);
    expect(found).toMatchObject({
      agentResult: "runner-disconnected",
      prState: "open",
      runnerUnreached: false,
    });
    expect(summarizeRunOutcome(found).worktree).toBe("operator-decides");
  });

  it("Disconnected 동안 워크트리를 지우거나 에이전트를 멈추는 러너 호출이 없다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const stop = vi.spyOn(fake, "stopAgent");
    const close = vi.spyOn(fake, "closeAgent");
    const remove = vi.spyOn(fake, "removeWorktree");
    await disconnect(run, runnerId, worker);

    requestRunCancel(h.db, run.id, h.now);
    await worker.tick();
    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(stateOf(run)).toBe("ended");
    expect(stop).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("Disconnected 런도 데몬을 다시 띄운 뒤 다시 연결을 확인한다", async () => {
    const { run, runnerId, worker } = await startOne();
    await disconnect(run, runnerId, worker);
    await worker.close();

    cutSsh(runnerId, false);
    const restarted = h.worker();
    await restarted.tick();
    expect(stateOf(run)).toBe("running");
  });
});

describe("실제 상태를 읽지 못함", () => {
  it("러너에 닿는데 폴링 오류가 이어져도 최대 실행 시간이 지나면 에이전트를 멈추고 시간 초과로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    vi.spyOn(fake, "pollRun").mockRejectedValue(
      new AdapterError<RunnerErrorDetail>({ kind: "malformed-output", raw: "?" }),
    );
    await worker.tick();
    expect(stateOf(run)).toBe("running");

    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(ended(run).agentResult).toBe("timed-out");
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
  });

  it("폴링 오류 중 멈춘 뒤 기록하지 못해도 다음 바퀴에 시간 초과로 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const poll = vi
      .spyOn(h.runner(runnerId), "pollRun")
      .mockRejectedValueOnce(
        new AdapterError<RunnerErrorDetail>({ kind: "malformed-output", raw: "?" }),
      );
    h.advance(DEFAULT_MAX_RUN_MS);
    const stop = vi.spyOn(h.runner(runnerId), "stopAgent");
    h.db.$client.exec(
      "CREATE TRIGGER fail_end BEFORE UPDATE OF state ON runs BEGIN SELECT RAISE(ABORT, 'locked'); END",
    );
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(stop).toHaveBeenCalledTimes(1);

    h.db.$client.exec("DROP TRIGGER fail_end");
    poll.mockRestore();
    await worker.tick();
    expect(ended(run).agentResult).toBe("timed-out");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("폴링 오류가 이어져도 취소 요청은 에이전트를 멈추고 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    vi.spyOn(h.runner(runnerId), "pollRun").mockRejectedValue(
      new AdapterError<RunnerErrorDetail>({ kind: "malformed-output", raw: "?" }),
    );
    requestRunCancel(h.db, run.id, h.now);
    await worker.tick();
    expect(ended(run).agentResult).toBe("canceled");
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
    expect(hasPendingCancelRequest(h.db, run.id)).toBe(false);
  });
});

describe("취소", () => {
  it("PR이 열린 Running 런은 에이전트를 멈춘 뒤 운영자가 취소함으로 끝내고 PR 상태를 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    requestRunCancel(h.db, run.id, h.now);

    await worker.tick();
    const found = ended(run);
    expect(found).toMatchObject({
      agentResult: "canceled",
      prState: "open",
      runnerUnreached: false,
    });
    expect(summarizeRunOutcome(found)).toEqual({
      outcome: "canceled",
      worktree: "keep-until-pr-settles",
    });
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
    expect(hasPendingCancelRequest(h.db, run.id)).toBe(false);
  });

  it("Queued 런은 바로 끝내고 PR 상태를 없음으로 둔다", async () => {
    const { runnerId, worker } = await startOne();
    const queued = h.assign("ENG-2", projectA);
    await worker.tick();
    expect(stateOf(queued)).toBe("queued");

    requestRunCancel(h.db, queued.id, h.now);
    await worker.tick();
    expect(ended(queued)).toMatchObject({
      agentResult: "canceled",
      prState: "none",
      startedAt: null,
      runnerUnreached: false,
    });
    expect(hasPendingCancelRequest(h.db, queued.id)).toBe(false);
    expect(h.runner(runnerId).startCalls).toHaveLength(1);
  });

  it("Waiting for Input 런은 에이전트를 멈춘 뒤 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).ask(worktreeOf(run), { body: "어떻게 할까요?" });
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");

    requestRunCancel(h.db, run.id, h.now);
    await worker.tick();
    expect(ended(run).agentResult).toBe("canceled");
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
  });

  it("멈추기가 실패하면 요청을 처리하지 않은 채 두고 다음 바퀴에 다시 시도한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const stop = vi
      .spyOn(h.runner(runnerId), "stopAgent")
      .mockRejectedValueOnce(new AdapterError(runnerError("stop_unknown")));
    requestRunCancel(h.db, run.id, h.now);

    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(hasPendingCancelRequest(h.db, run.id)).toBe(true);

    await worker.tick();
    expect(ended(run).agentResult).toBe("canceled");
    expect(hasPendingCancelRequest(h.db, run.id)).toBe(false);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("Disconnected 런은 다시 연결되면 에이전트를 멈추고 운영자가 취소함으로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    await disconnect(run, runnerId, worker);
    requestRunCancel(h.db, run.id, h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("disconnected");

    cutSsh(runnerId, false);
    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "canceled", runnerUnreached: false });
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
  });

  it("취소 중에 Disconnected가 된 런이 다시 닿지 않은 채 최대 실행 시간이 지나면 러너에 닿지 못한 채 운영자가 취소함으로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    requestRunCancel(h.db, run.id, h.now);
    cutSsh(runnerId);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    h.advance(DISCONNECT_AFTER_MS);
    await worker.tick();
    expect(stateOf(run)).toBe("disconnected");

    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    const found = ended(run);
    expect(found).toMatchObject({
      agentResult: "canceled",
      prState: "open",
      runnerUnreached: true,
    });
    expect(summarizeRunOutcome(found)).toEqual({
      outcome: "canceled",
      worktree: "operator-decides",
    });
    expect(hasPendingCancelRequest(h.db, run.id)).toBe(false);
  });

  it("취소 중에 완료 보고가 오면 에이전트를 닫고 운영자가 취소함으로 끝내며 보고 본문을 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    requestRunCancel(h.db, run.id, h.now);
    h.runner(runnerId).report(worktreeOf(run), { outcome: "succeeded", body: "다 했어요" });

    await worker.tick();
    expect(ended(run).agentResult).toBe("canceled");
    expect(getRunWithRecords(h.db, run.id)?.records.reportBody).toBe("다 했어요");
    expect(agentOf(run, runnerId)).toMatchObject({ agentClosed: true, agentStopped: false });
  });

  it("시작을 보낸 Queued 런의 취소는 시작했는지 확인하지 못해도 다시 시작을 보내지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const fake = h.runner(runnerA);
    fake.failNextStart = { kind: "start-outcome-unknown", detail: "lost" };
    const worker = h.worker();
    await worker.tick();
    expect(stateOf(run)).toBe("queued");
    expect(fake.startCalls).toHaveLength(1);

    requestRunCancel(h.db, run.id, h.now);
    vi.spyOn(fake, "findStartedRun")
      .mockRejectedValueOnce(new AdapterError(runnerError("busy")))
      .mockResolvedValue(null);
    await worker.tick();
    expect(stateOf(run)).toBe("queued");
    expect(fake.startCalls).toHaveLength(1);

    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "canceled", prState: "none" });
    expect(fake.startCalls).toHaveLength(1);
  });

  it("이미 Ended인 런의 요청은 처리하지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    requestRunCancel(h.db, run.id, h.now);
    h.runner(runnerId).vanish(worktreeOf(run));
    changeRunState(
      h.db,
      run.id,
      { to: "ended", agentResult: "ended-without-report", prState: "none" },
      h.now,
    );

    await worker.tick();
    expect(ended(run).agentResult).toBe("ended-without-report");
    expect(hasPendingCancelRequest(h.db, run.id)).toBe(true);
  });
});

describe("폴링 주기(0232)", () => {
  function agentRefOf(run: StoredRun) {
    const found = current(run);
    if (found.state === "queued" || found.agentRef === null) throw new Error("run has not started");
    return found.agentRef;
  }

  it("러너마다 그 러너의 런을 알리며 주기를 열고, 런을 모두 폴링한 뒤 닫는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const first = h.assign("ENG-1", projectA);
    const second = h.assign("ENG-2", projectA);
    const elsewhere = h.assign("ENG-3", projectB);
    const worker = h.worker();
    await worker.tick();
    expect([first, second, elsewhere].map(stateOf)).toEqual(["running", "running", "running"]);
    h.runner(runnerA).pollCycleEvents.length = 0;
    h.runner(runnerB).pollCycleEvents.length = 0;

    await worker.tick();

    const onA = h.runner(runnerA).pollCycleEvents;
    const bothAgents = [agentRefOf(first), agentRefOf(second)].sort();
    expect(onA.map((event) => event.kind)).toEqual(["begin", "poll", "poll", "end"]);
    expect(onA.flatMap((event) => (event.kind === "begin" ? event.agents : [])).sort()).toEqual(
      bothAgents,
    );
    expect(onA.flatMap((event) => (event.kind === "poll" ? [event.agent] : [])).sort()).toEqual(
      bothAgents,
    );
    expect(h.runner(runnerB).pollCycleEvents).toEqual([
      { kind: "begin", agents: [agentRefOf(elsewhere)] },
      { kind: "poll", agent: agentRefOf(elsewhere) },
      { kind: "end" },
    ]);
  });
});

describe("러너 상태 확인", () => {
  it("간격마다 Online/Offline, 확인 시각, 러너 쪽 프로젝트, GitHub 인증을 DB에 쓴다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const worker = h.worker();
    const stored = () => listRunners(h.db).find((r) => r.id === runnerId);

    h.runner(runnerId).setProjects([
      { id: projectA, displayName: "a", setupState: "ready" },
      { id: projectB, displayName: "b", setupState: "ready" },
    ]);
    h.setPushAuth(runnerId, false);
    await worker.tick();
    expect(stored()?.projects.map((p) => p.id)).toEqual([projectA]);

    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(stored()).toMatchObject({ online: true, assignmentBlocked: true, checkedAt: h.now });
    expect(stored()?.projects.map((p) => p.id)).toEqual([projectA, projectB]);
    const brokenAuth = stored()?.prerequisites?.filter((p) => p.blocksAssignment);
    expect(brokenAuth?.map((p) => p.satisfied)).toEqual([false]);

    cutSsh(runnerId);
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(stored()).toMatchObject({ online: false, assignmentBlocked: true, checkedAt: h.now });
    expect(stored()?.projects.map((p) => p.id)).toEqual([projectA, projectB]);
    expect(stored()?.prerequisites?.filter((p) => p.blocksAssignment)).toEqual(brokenAuth);
  });

  it("정한 러너에서 러너 쪽 프로젝트가 사라진 Queued 런은 러너를 비우고 순서에서 빠진다(Q78)", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const worker = h.worker();
    const busy = h.assign("ENG-1", projectA);
    await worker.tick();
    expect(stateOf(busy)).toBe("running");
    const head = h.assign("ENG-2", projectA);
    const behind = h.assign("ENG-3", projectB);
    await worker.tick();
    expect(current(head)).toMatchObject({ state: "queued", runnerId: runnerA });
    expect(current(behind)).toMatchObject({ state: "running", runnerId: runnerB });

    h.runner(runnerA).setProjects([]);
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(current(head)).toMatchObject({ state: "queued", runnerId: null });
  });

  it("GitHub 인증이 깨진 러너로 정한 Queued 런은 러너 확인 뒤 러너를 비운다(Q82.22)", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const worker = h.worker();
    const busy = h.assign("ENG-1", projectA);
    await worker.tick();
    const head = h.assign("ENG-2", projectA);
    await worker.tick();
    expect(current(head)).toMatchObject({ state: "queued", runnerId: runnerA });

    h.setPushAuth(runnerA, false);
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(current(head)).toMatchObject({ state: "queued", runnerId: null });
    expect(stateOf(busy)).toBe("running");
  });
});

describe("대기열 맨 앞이 막히지 않음 (0037 남은 위험)", () => {
  it("이미 시작했는지 찾는 일이 계속 실패해도 맨 앞 런이 뒤 런을 막지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const head = h.assign("ENG-1", projectA);
    const behind = h.assign("ENG-2", projectB);
    h.runner(runnerA).loseNextStartResponse = true;
    vi.spyOn(h.runner(runnerA), "findStartedRun").mockRejectedValue(
      new AdapterError<RunnerErrorDetail>({ kind: "malformed-output", raw: "?" }),
    );
    const worker = h.worker();

    await worker.tick();
    expect(stateOf(head)).toBe("queued");
    await worker.tick();
    expect(current(head)).toMatchObject({ state: "queued", runnerId: runnerA });
    expect(stateOf(behind)).toBe("running");
    expect(h.runner(runnerA).startCalls).toHaveLength(1);
  });

  it("트래커에서 티켓이 지워진 맨 앞 런은 시작할 수 없음으로 끝내 뒤 런을 막지 않는다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const head = h.assign("ENG-1", projectA);
    const behind = h.assign("ENG-2", projectA);
    h.tracker.tickets.delete(current(head).ticket.key);

    const worker = h.worker();
    await worker.tick();
    expect(ended(head)).toMatchObject({ agentResult: "could-not-start", prState: "none" });
    expect(getRunWithRecords(h.db, head.id)?.records.startError).toContain("ticket-not-found");
    await worker.tick();
    expect(stateOf(behind)).toBe("running");
  });
});

function runnerError(code: string): RunnerErrorDetail {
  return { kind: "runner-error", code, message: code };
}

describe("멈추기·재개(0118)", () => {
  async function pause(run: StoredRun, worker: Worker): Promise<void> {
    expect(requestRunControl(h.db, run.id, "pause", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
  }

  it("멈추기는 에이전트만 멈추고 워크트리·capacity를 그대로 두며, 재개하면 같은 대화로 이어 Running이 된다", async () => {
    const { run, runnerId, worker } = await startOne();
    await pause(run, worker);
    const agent = agentOf(run, runnerId);
    expect(agent.paused).toBe(true);
    expect(agent.agentStopped).toBe(false);
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(getRunControlRequest(h.db, run.id)).toMatchObject({ status: "done" });

    h.assign("ENG-2", projectA);
    await worker.tick();
    expect(listRuns(h.db, { states: ["queued"] })).toHaveLength(1);

    expect(requestRunControl(h.db, run.id, "resume", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(agent.paused).toBe(false);
    expect(agent.resumes.map((resume) => resume.agent)).toEqual([current(run).agent]);
    expect(agent.resumes[0]?.message).not.toBe("");
  });

  it("Paused 동안 최대 실행 시간 시계도 멈추고, 재개하면 남은 시간부터 센다", async () => {
    const { run, worker } = await startOne();
    h.advance(DEFAULT_MAX_RUN_MS - 10 * MINUTE);
    await pause(run, worker);

    h.advance(3 * DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");

    expect(requestRunControl(h.db, run.id, "resume", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    h.advance(10 * MINUTE - 1);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    h.advance(1);
    await worker.tick();
    expect(ended(run).agentResult).toBe("timed-out");
  });

  it("멈춘 에이전트가 사라져도 Paused로 두고, 재개하면 같은 워크트리에서 새 에이전트를 띄운다", async () => {
    const { run, runnerId, worker } = await startOne();
    await pause(run, worker);
    const before = current(run);
    h.runner(runnerId).vanish(worktreeOf(run), "runner rebooted");
    await worker.tick();
    expect(stateOf(run)).toBe("paused");

    expect(requestRunControl(h.db, run.id, "resume", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    const after = current(run);
    expect(after.state).toBe("running");
    expect(after.state === "running" && before.state === "paused" ? after.agentRef : null).not.toBe(
      before.state === "paused" ? before.agentRef : null,
    );
    expect(after.state === "running" ? after.worktree : null).toBe(worktreeOf(run));
    const restartPrompt = agentOf(run, runnerId).resumes[0]?.restartPrompt;
    expect(restartPrompt).toContain(agentOf(run, runnerId).input.brief);
    expect(restartPrompt).toContain(FAKE_AGENT_PROTOCOL);
  });

  it("Paused 중에 취소하면 에이전트를 멈추고 운영자가 취소함으로 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    await pause(run, worker);
    requestRunCancel(h.db, run.id, h.now);
    expect(requestRunControl(h.db, run.id, "resume", h.now)).toEqual({
      ok: false,
      reason: "cancelling",
    });
    await worker.tick();
    expect(ended(run).agentResult).toBe("canceled");
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
  });

  it("Paused 중 러너에 5분 동안 닿지 않으면 Disconnected가 되고, 다시 닿으면 Paused로 돌아간다", async () => {
    const { run, runnerId, worker } = await startOne();
    await pause(run, worker);
    await disconnect(run, runnerId, worker);

    cutSsh(runnerId, false);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    expect(agentOf(run, runnerId).paused).toBe(true);
  });

  it("멈춘 런의 러너가 최대 실행 시간보다 오래 꺼져 있어도 런을 끝내지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(DEFAULT_MAX_RUN_MS - MINUTE);
    await pause(run, worker);
    await disconnect(run, runnerId, worker);
    h.advance(3 * DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(stateOf(run)).toBe("disconnected");

    cutSsh(runnerId, false);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
  });

  it("새 세션 시작 결과를 모르면 요청을 끝내지 않고, 다음 바퀴에 뜬 세션을 이어 받는다", async () => {
    const { run, runnerId, worker } = await startOne();
    await pause(run, worker);
    h.runner(runnerId).vanish(worktreeOf(run));
    h.runner(runnerId).loseNextResumeResponse = true;
    expect(requestRunControl(h.db, run.id, "resume", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    expect(getRunControlRequest(h.db, run.id)).toMatchObject({ status: "pending" });

    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(getRunControlRequest(h.db, run.id)).toMatchObject({ status: "done" });
    expect(agentOf(run, runnerId).resumes).toHaveLength(2);
  });

  it("결과를 모르는 재개 뒤 worker가 다시 떠도, 취소하면 뜬 세션을 이어 받아 멈추고 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    await pause(run, worker);
    h.runner(runnerId).vanish(worktreeOf(run));
    h.runner(runnerId).loseNextResumeResponse = true;
    expect(requestRunControl(h.db, run.id, "resume", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    requestRunCancel(h.db, run.id, h.now);
    await h.worker().tick();
    expect(ended(run).agentResult).toBe("canceled");
    expect(agentOf(run, runnerId).agentStopped).toBe(true);
    expect(agentOf(run, runnerId).resumes.at(-1)?.startIfGone).toBe(false);
  });

  it("결과를 모르는 재개는 러너가 끊겨 Disconnected를 거쳐도 남아, 다시 닿으면 뜬 세션을 이어 받는다", async () => {
    const { run, runnerId, worker } = await startOne();
    await pause(run, worker);
    h.runner(runnerId).vanish(worktreeOf(run));
    h.runner(runnerId).loseNextResumeResponse = true;
    expect(requestRunControl(h.db, run.id, "resume", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    await disconnect(run, runnerId, worker);
    expect(getRunControlRequest(h.db, run.id)).toMatchObject({ status: "pending" });

    cutSsh(runnerId, false);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(getRunControlRequest(h.db, run.id)).toMatchObject({ status: "done" });
  });

  it("러너에 닿지 않으면 멈추기가 실패하고 그 이유를 남기며 Running 그대로 둔다", async () => {
    const { run, runnerId, worker } = await startOne();
    cutSsh(runnerId);
    expect(requestRunControl(h.db, run.id, "pause", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(getRunControlRequest(h.db, run.id)).toMatchObject({
      status: "failed",
      error: "runner-unreachable",
    });
  });

  it("에이전트가 없어 멈추지 못하면 agent-not-running 으로 실패한다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).failNextControl = {
      kind: "runner-error",
      code: "agent_not_running",
      message: "gone",
    };
    expect(requestRunControl(h.db, run.id, "pause", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    expect(getRunControlRequest(h.db, run.id)).toMatchObject({
      status: "failed",
      error: "agent-not-running",
    });
  });
});

describe("러너에서 멈춘·막힌 에이전트(0120)", () => {
  function recordsOf(run: StoredRun) {
    const records = getRunWithRecords(h.db, run.id)?.records;
    if (records === undefined) throw new Error(`run ${run.id} has no records`);
    return records;
  }

  it("러너에서 에이전트 세션이 중단되면 '러너에서 멈춤' Paused가 되고 러너 자리를 지키며, 재개하면 같은 세션으로 이어 간다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    h.runner(runnerId).interruptOnRunner(worktreeOf(run), h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    expect(recordsOf(run).pauseSource).toBe("runner");

    h.assign("ENG-2", projectA);
    await worker.tick();
    expect(listRuns(h.db, { states: ["queued"] })).toHaveLength(1);

    h.advance(MINUTE);
    expect(requestRunControl(h.db, run.id, "resume", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(recordsOf(run).pauseSource).toBeNull();
    expect(agentOf(run, runnerId).resumes).toHaveLength(1);
  });

  it("재개 뒤에는 그 전에 남은 중단 표시로 다시 멈추지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    h.runner(runnerId).interruptOnRunner(worktreeOf(run), h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");

    h.advance(MINUTE);
    expect(requestRunControl(h.db, run.id, "resume", h.now)).toMatchObject({ ok: true });
    h.runner(runnerId).interruptOnRunner(worktreeOf(run), new Date(h.now.getTime() - MINUTE));
    await worker.tick();
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("보고 없이 턴을 끝냈다는 러너 알림은 '보고 없이 멈춤' Paused가 되고 마지막 출력을 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    h.runner(runnerId).stopWithoutReport(worktreeOf(run), {
      at: h.now,
      lastOutput: ["로그인 버튼을 고쳤어요", "❯"],
    });
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    expect(recordsOf(run)).toMatchObject({
      pauseSource: "unreported",
      lastLog: ["로그인 버튼을 고쳤어요", "❯"],
    });
  });

  it("알림이 없어도 질문·보고 없이 끝난 턴이 10분 이어지면 '보고 없이 멈춤'이 되고 러너 로그 끝을 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    h.runner(runnerId).appendLog(worktreeOf(run), "테스트를 돌렸어요");
    h.runner(runnerId).stopWithoutReport(worktreeOf(run), { at: h.now, notified: false });
    h.advance(9 * MINUTE);
    await worker.tick();
    expect(stateOf(run)).toBe("running");

    h.advance(MINUTE);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    expect(recordsOf(run)).toMatchObject({
      pauseSource: "unreported",
      lastLog: ["테스트를 돌렸어요"],
    });
  });

  it("러너에서 사람이 다시 일을 시키면 Running으로 돌아간다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    h.runner(runnerId).stopWithoutReport(worktreeOf(run), { at: h.now });
    await worker.tick();
    expect(stateOf(run)).toBe("paused");

    h.advance(MINUTE);
    h.runner(runnerId).continueOnRunner(worktreeOf(run), h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(recordsOf(run).pauseSource).toBeNull();
  });

  it("러너에서 멈춘 동안에도 최대 실행 시간 시계가 멈춘다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(DEFAULT_MAX_RUN_MS - 10 * MINUTE);
    h.runner(runnerId).interruptOnRunner(worktreeOf(run), h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");

    h.advance(3 * DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");

    h.runner(runnerId).continueOnRunner(worktreeOf(run), h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    h.advance(10 * MINUTE - 1);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    h.advance(1);
    await worker.tick();
    expect(ended(run).agentResult).toBe("timed-out");
  });

  it("질문이 열려 있으면 보고 없이 멈춘 알림이 와도 Waiting for Input으로 둔다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    h.runner(runnerId).ask(worktreeOf(run), { body: "시안이 없어요. 어떻게 할까요?", at: h.now });
    h.runner(runnerId).stopWithoutReport(worktreeOf(run), { at: h.now });
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");
  });

  it("러너가 끊긴 동안 중단된 에이전트도 다시 닿은 뒤 '러너에서 멈춤'으로 알아챈다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    await disconnect(run, runnerId, worker);
    h.runner(runnerId).interruptOnRunner(worktreeOf(run), h.now);
    h.advance(MINUTE);
    cutSsh(runnerId, false);
    await worker.tick();
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    expect(recordsOf(run).pauseSource).toBe("runner");
  });

  it("끊긴 동안 질문에 답한 런은 다시 닿은 뒤 답하기 전의 멈춤 알림으로 멈추지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    const question = h.runner(runnerId).ask(worktreeOf(run), { body: "어떻게 할까요?", at: h.now });
    h.runner(runnerId).stopWithoutReport(worktreeOf(run), { at: h.now });
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");

    await disconnect(run, runnerId, worker);
    answerRunQuestion(
      h.db,
      { runId: run.id, questionId: question, answer: "A 로 해 주세요" },
      h.now,
    );
    h.advance(MINUTE);
    cutSsh(runnerId, false);
    await worker.tick();
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });

  it("답을 보낸 직후 Orca가 끝난 에이전트에게 전하지 못했다고 알리면, 초 단위 시각이 앞서도 '보고 없이 멈춤'이 된다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.advance(MINUTE);
    const question = h.runner(runnerId).ask(worktreeOf(run), { body: "어떻게 할까요?", at: h.now });
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");

    h.advance(MINUTE + 700);
    answerRunQuestion(h.db, { runId: run.id, questionId: question, answer: "A" }, h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("running");

    h.runner(runnerId).stopWithoutReport(worktreeOf(run), {
      at: new Date(h.now.getTime() - 700),
    });
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    expect(recordsOf(run).pauseSource).toBe("unreported");
  });

  it("에이전트 상태를 모르면 Running 그대로 둔다", async () => {
    const { run, worker } = await startOne();
    h.advance(30 * MINUTE);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
  });
});
