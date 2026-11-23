import { V1_RUN_ACTIONS, continueBodySchema } from "@ganger/api";
import {
  handleV1RunAction,
  loadV1RunDetail,
  parseV1RunAction,
} from "@ganger/app/devices/run-actions";
import { CONTINUE_MESSAGE_MAX_LENGTH, toRunnerProjectId } from "@ganger/core";
import type { RunId, RunnerId } from "@ganger/core";
import {
  changeRunState,
  getRun,
  listRuns,
  recordAgentCheck,
  saveMapping,
  updateRunRecords,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import type { Worker } from "@ganger/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, projectA } from "../../apps/worker/src/test-fixtures.js";

const otherProject = toRunnerProjectId("project-without-runner");

let h: Harness;
let runnerId: RunnerId;
let worker: Worker;
let ticketSeq = 0;
let requestSeq = 0;

beforeEach(() => {
  h = new Harness();
  h.now = new Date();
  runnerId = h.addRunner({ id: "runner-a", capacity: 40, projects: [projectA] });
  worker = h.worker();
});

afterEach(async () => {
  await h.cleanup();
});

function newRequestId(): string {
  requestSeq += 1;
  return `assign-request-${String(requestSeq).padStart(8, "0")}`;
}

function mapped(run: StoredRun): void {
  saveMapping(h.db, {
    connection: run.ticket.connection,
    trackerProject: run.trackerProject,
    runnerProject: run.runnerProject,
    agent: run.agent,
  });
}

async function endAs(
  id: RunId,
  agentResult: "reported-failure" | "reported-success",
): Promise<void> {
  await worker.tick();
  if (getRun(h.db, id)?.state !== "running") throw new Error("런을 시작하지 못했다");
  const ended = changeRunState(h.db, id, { to: "ended", agentResult, prState: "none" }, h.now);
  if (!ended.ok) throw new Error("런을 끝내지 못했다");
  h.advance(1000);
}

async function failedRun(): Promise<StoredRun> {
  ticketSeq += 1;
  const run = h.assign(`RETRY-${ticketSeq}`, projectA, runnerId);
  mapped(run);
  await endAs(run.id, "reported-failure");
  return run;
}

function keepWorktree(run: StoredRun, agent: "gone" | "alive" = "gone"): void {
  updateRunRecords(h.db, run.id, { worktreeKept: "unpushed-commits" });
  recordAgentCheck(h.db, run.id, agent, { stopHandled: agent === "gone" });
}

function act(run: StoredRun, action: "retry" | "continue", body: unknown) {
  return handleV1RunAction(h.db, run.id, action, body, h.now);
}

function ticketRuns(run: StoredRun): StoredRun[] {
  return listRuns(h.db, { ticket: run.ticket });
}

function followUp(run: StoredRun) {
  return loadV1RunDetail(h.db, run.id, h.now)?.followUp;
}

describe("앱에서 다시 맡기기", () => {
  it("이전 런과 같은 저장소·러너·에이전트로 새 런을 만든다", async () => {
    const run = await failedRun();
    expect(followUp(run)?.retry).toBe("available");
    expect(act(run, "retry", { requestId: newRequestId() })).toEqual({ status: 200 });
    const next = ticketRuns(run).at(-1);
    expect(next?.id).not.toBe(run.id);
    expect(next).toMatchObject({
      state: "queued",
      runnerId,
      runnerProject: projectA,
      agent: run.agent,
    });
  });

  it("같은 requestId는 런을 하나만 만든다", async () => {
    const run = await failedRun();
    const requestId = newRequestId();
    expect(act(run, "retry", { requestId })).toEqual({ status: 200 });
    expect(act(run, "retry", { requestId })).toEqual({ status: 200 });
    expect(ticketRuns(run)).toHaveLength(2);
  });

  it("끝나지 않은 런이 생긴 뒤의 새 requestId는 거절한다", async () => {
    const run = await failedRun();
    expect(act(run, "retry", { requestId: newRequestId() })).toEqual({ status: 200 });
    expect(act(run, "retry", { requestId: newRequestId() })).toEqual({
      status: 409,
      reason: "active-run",
    });
    expect(ticketRuns(run)).toHaveLength(2);
  });

  it("러너가 없는 런은 맡길 수 없다고 싣고 쓰기도 거절한다", () => {
    ticketSeq += 1;
    const run = h.assign(`RETRY-${ticketSeq}`, otherProject);
    mapped(run);
    const ended = changeRunState(
      h.db,
      run.id,
      { to: "ended", agentResult: "could-not-start", prState: "none" },
      h.now,
    );
    expect(ended.ok).toBe(true);
    expect(getRun(h.db, run.id)?.runnerId).toBeNull();
    expect(followUp(run)?.retry).toBe("unavailable");
    expect(act(run, "retry", { requestId: newRequestId() })).toEqual({
      status: 409,
      reason: "cannot-assign",
    });
    expect(ticketRuns(run)).toHaveLength(1);
  });

  it("러너에서 저장소가 사라지면 맡길 수 없다", async () => {
    const run = await failedRun();
    h.setRunnerOnline(runnerId, true, [otherProject], false);
    expect(followUp(run)?.retry).toBe("unavailable");
    expect(act(run, "retry", { requestId: newRequestId() })).toEqual({
      status: 409,
      reason: "cannot-assign",
    });
  });

  it("성공한 런은 다시 맡기기를 두지 않는다", async () => {
    ticketSeq += 1;
    const run = h.assign(`RETRY-${ticketSeq}`, projectA, runnerId);
    mapped(run);
    await endAs(run.id, "reported-success");
    expect(followUp(run)).toEqual({ retry: "not-offered", continue: "not-offered" });
    expect(act(run, "retry", { requestId: newRequestId() })).toEqual({
      status: 409,
      reason: "state-changed",
    });
  });
});

describe("앱에서 이어서 맡기기", () => {
  it("워크트리가 남은 Failed 런에서만 고를 수 있다", async () => {
    const kept = await failedRun();
    keepWorktree(kept);
    expect(followUp(kept)?.continue).toBe("available");
    const alive = await failedRun();
    keepWorktree(alive, "alive");
    expect(followUp(alive)?.continue).toBe("agent-running");
  });

  it("말 없이 보낼 수 없다", async () => {
    const run = await failedRun();
    keepWorktree(run);
    for (const message of ["", "   "]) {
      expect(act(run, "continue", { requestId: newRequestId(), message })).toEqual({
        status: 400,
        reason: "invalid-request",
      });
    }
    expect(ticketRuns(run)).toHaveLength(1);
  });

  it("이어 만든 런이 시작하지 못하고 끝나면 같은 requestId를 다시 처리한다", async () => {
    const run = await failedRun();
    keepWorktree(run);
    const body = { requestId: newRequestId(), message: "남은 시험을 고쳐 주세요" };
    expect(act(run, "continue", body)).toEqual({ status: 200 });
    expect(act(run, "continue", body)).toEqual({ status: 200 });
    expect(ticketRuns(run)).toHaveLength(2);
    const first = ticketRuns(run).at(-1);
    if (first === undefined) throw new Error("이어 만든 런이 없다");
    const ended = changeRunState(
      h.db,
      first.id,
      { to: "ended", agentResult: "could-not-start", prState: "none" },
      h.now,
    );
    expect(ended.ok).toBe(true);
    expect(act(run, "continue", body)).toEqual({ status: 200 });
    expect(ticketRuns(run)).toHaveLength(3);
  });

  it("이어 만든 런이 없어지면 같은 requestId를 다시 처리한다", async () => {
    const run = await failedRun();
    keepWorktree(run);
    const body = { requestId: newRequestId(), message: "남은 시험을 고쳐 주세요" };
    expect(act(run, "continue", body)).toEqual({ status: 200 });
    const first = ticketRuns(run).at(-1);
    if (first === undefined) throw new Error("이어 만든 런이 없다");
    h.db.$client.prepare("DELETE FROM runs WHERE id = ?").run(first.id);
    h.advance(1000);
    expect(act(run, "continue", body)).toEqual({ status: 200 });
    const remade = ticketRuns(run);
    expect(remade).toHaveLength(2);
    expect(remade.at(-1)?.id).not.toBe(first.id);
  });

  it("워크트리를 지운 Failed 런은 고를 수 없고 쓰기도 거절한다", async () => {
    const run = await failedRun();
    keepWorktree(run);
    updateRunRecords(h.db, run.id, { worktreeRemovedAt: h.now });
    expect(followUp(run)?.continue).toBe("not-offered");
    expect(act(run, "continue", { requestId: newRequestId(), message: "이어 주세요" })).toEqual({
      status: 409,
      reason: "state-changed",
    });
    expect(ticketRuns(run)).toHaveLength(1);
  });

  it("워크트리를 잃고 끝난 런은 고를 수 없고 쓰기도 거절한다", async () => {
    ticketSeq += 1;
    const run = h.assign(`RETRY-${ticketSeq}`, projectA, runnerId);
    mapped(run);
    await worker.tick();
    const ended = changeRunState(
      h.db,
      run.id,
      { to: "ended", agentResult: "worktree-missing", prState: "none" },
      h.now,
    );
    expect(ended.ok).toBe(true);
    h.advance(1000);
    keepWorktree(run);
    expect(followUp(run)?.continue).toBe("not-offered");
    expect(act(run, "continue", { requestId: newRequestId(), message: "이어 주세요" })).toEqual({
      status: 409,
      reason: "state-changed",
    });
    expect(ticketRuns(run)).toHaveLength(1);
  });

  it("처리한 요청은 뒤에 워크트리를 지워도 같은 requestId에 성공으로 답한다", async () => {
    const run = await failedRun();
    keepWorktree(run);
    const body = { requestId: newRequestId(), message: "이어 주세요" };
    expect(act(run, "continue", body)).toEqual({ status: 200 });
    updateRunRecords(h.db, run.id, { worktreeRemovedAt: h.now });
    expect(act(run, "continue", body)).toEqual({ status: 200 });
    expect(ticketRuns(run)).toHaveLength(2);
  });

  it("v1 글자 한도가 서버의 이어서 맡기기 한도와 같다", () => {
    const requestId = newRequestId();
    const fits = "가".repeat(CONTINUE_MESSAGE_MAX_LENGTH);
    expect(continueBodySchema.safeParse({ requestId, message: fits }).success).toBe(true);
    expect(continueBodySchema.safeParse({ requestId, message: `${fits}가` }).success).toBe(false);
  });
});

describe("v1 할당 범위", () => {
  it("새 티켓 할당과 assignTickets를 열지 않는다", () => {
    for (const action of ["assign", "assign-ticket", "assign-tickets", "assignTickets"]) {
      expect(parseV1RunAction(action)).toBeNull();
    }
    expect(V1_RUN_ACTIONS).toEqual([
      "answer",
      "human-check",
      "deny",
      "resume",
      "cancel",
      "retry",
      "continue",
    ]);
  });

  it("다시 맡기기 본문으로 다른 러너나 저장소를 보낼 수 없다", async () => {
    const run = await failedRun();
    expect(
      act(run, "retry", { requestId: newRequestId(), runnerId: "other", runnerProject: "other" }),
    ).toEqual({ status: 400, reason: "invalid-request" });
    expect(ticketRuns(run)).toHaveLength(1);
  });
});
