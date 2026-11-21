import {
  AdapterError,
  DISCONNECT_AFTER_MS,
  summarizeRunOutcome,
  toTrackerStateId,
} from "@ganger/core";
import type { PullRequestSnapshot, RunnerId, WorktreeRef } from "@ganger/core";
import {
  DEFAULT_MAX_RUN_MS,
  LAST_LOG_LINES,
  getLogTailRequest,
  getRun,
  getRunWithRecords,
  getRunnerCheckRequest,
  listRunners,
  requestLogTail,
  requestRunCancel,
  requestRunControl,
  requestRunnerCheck,
  requestWorktreeRemoval,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
  trackerReadGeneration,
  updateRunRecords,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PR_POLL_INTERVAL_MS } from "./after-run.js";
import { RUNNER_CHECK_INTERVAL_MS } from "./runner-check.js";
import { Harness, connection, projectA, repoOf, trackerProject } from "./test-fixtures.js";
import type { Worker } from "./worker.js";

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

afterEach(async () => {
  await h.cleanup();
});

const inProgress = toTrackerStateId("in-progress");

function chooseInProgress(): void {
  saveWorkspaceTrackerProject(h.db, {
    workspaceId: toWorkspaceId("ws-1"),
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: inProgress,
  });
}

function current(run: StoredRun): StoredRun {
  const found = getRun(h.db, run.id);
  if (found === null) throw new Error(`run ${run.id} is gone`);
  return found;
}

function recordsOf(run: StoredRun) {
  const found = getRunWithRecords(h.db, run.id);
  if (found === null) throw new Error(`run ${run.id} is gone`);
  return found.records;
}

function worktreeOf(run: StoredRun): WorktreeRef {
  const found = current(run);
  if (found.state === "queued" || found.worktree === null) throw new Error("run has not started");
  return found.worktree;
}

function ended(run: StoredRun) {
  const found = current(run);
  if (found.state !== "ended") throw new Error(`run ${run.id} is ${found.state}, not ended`);
  return found;
}

async function startOne(key = "ENG-1"): Promise<{
  run: StoredRun;
  runnerId: RunnerId;
  worker: Worker;
}> {
  const runnerId = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
  const run = h.assign(key, projectA);
  const worker = h.worker();
  await worker.tick();
  expect(current(run).state).toBe("running");
  return { run, runnerId, worker };
}

function report(run: StoredRun, runnerId: RunnerId, outcome = "succeeded"): void {
  h.runner(runnerId).report(worktreeOf(run), { outcome, body: "끝" });
}

async function settlePullRequest(run: StoredRun, state: "merged" | "closed"): Promise<void> {
  const found = current(run);
  if (found.state === "queued" || found.branch === null) throw new Error("run has not started");
  const repo = repoOf(found.runnerProject);
  const [pr] = await h.codeHost.findPullRequestsByBranch(repo, found.branch);
  if (pr === undefined) throw new Error("no pull request");
  const settled: PullRequestSnapshot = {
    ...pr,
    state,
    mergedAt: state === "merged" ? h.now : null,
  };
  h.codeHost.putPullRequest(repo, settled);
}

describe("트래커 갱신", () => {
  it("런 시작 때 In Progress로 한 번, 끝날 때 결과 댓글을 한 번 달고 다시 띄워도 댓글은 하나다", async () => {
    chooseInProgress();
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.setRunnerOnline(runnerId, false);
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    expect(current(run).state).toBe("queued");
    expect(h.tracker.stateChanges).toEqual([]);
    const generation = trackerReadGeneration(h.db, run.ticket.connection);

    h.setRunnerOnline(runnerId, true);
    await worker.tick();
    expect(current(run).state).toBe("running");
    expect(h.tracker.stateChanges).toEqual([{ key: run.ticket.key, stateId: inProgress }]);
    expect(recordsOf(run).trackerStateSetAt).toEqual(h.now);
    expect(trackerReadGeneration(h.db, run.ticket.connection)).toBe(generation + 1);

    await worker.tick();
    expect(h.tracker.stateChanges).toHaveLength(1);

    h.putPullRequest(current(run), "open");
    report(run, runnerId);
    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "reported-success", prState: "open" });
    const comments = h.tracker.comments.get(run.ticket.key) ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("Succeeded");
    expect(comments[0]?.body).toContain("완료 보고(성공)");
    expect(comments[0]?.body).toContain("열림");
    expect(comments[0]?.body).toContain("https://code.example.com/acme/pull/1");
    expect(comments[0]?.body).toContain(run.id);
    expect(recordsOf(run).trackerComment).toEqual({ id: comments[0]?.id, at: h.now });
    expect(trackerReadGeneration(h.db, run.ticket.connection)).toBe(generation + 2);

    await worker.close();
    const restarted = h.worker();
    await restarted.tick();
    await restarted.tick();
    expect(h.tracker.comments.get(run.ticket.key)).toHaveLength(1);
    expect(h.tracker.stateChanges).toHaveLength(1);
  });

  it("댓글을 단 뒤 기록하지 못한 채 데몬이 멈춰도 다시 띄웠을 때 같은 댓글을 찾아 기록만 한다", async () => {
    const { run, runnerId, worker } = await startOne();
    report(run, runnerId);
    await worker.tick();
    const [comment] = h.tracker.comments.get(run.ticket.key) ?? [];
    expect(comment).toBeDefined();
    updateRunRecords(h.db, run.id, { trackerComment: null });
    await worker.close();

    await h.worker().tick();
    expect(h.tracker.comments.get(run.ticket.key)).toHaveLength(1);
    expect(recordsOf(run).trackerComment?.id).toBe(comment?.id);
  });

  it("In Progress 상태를 고르지 않았으면 상태를 바꾸지 않는다", async () => {
    await startOne();
    expect(h.tracker.stateChanges).toEqual([]);
  });

  it("트래커 호출이 실패하면 기록하지 않고 다음 바퀴에 다시 한다", async () => {
    chooseInProgress();
    const spy = vi.spyOn(h.tracker, "setState").mockRejectedValueOnce(new Error("network"));
    const { run, worker } = await startOne();
    expect(recordsOf(run).trackerStateSetAt).toBeNull();
    await worker.tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(recordsOf(run).trackerStateSetAt).toEqual(h.now);
  });

  it("멈춘 런도 In Progress 표시를 마저 한다(0118)", async () => {
    chooseInProgress();
    const spy = vi.spyOn(h.tracker, "setState").mockRejectedValueOnce(new Error("network"));
    const { run, worker } = await startOne();
    expect(requestRunControl(h.db, run.id, "pause", h.now)).toMatchObject({ ok: true });
    await worker.tick();
    expect(current(run).state).toBe("paused");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(recordsOf(run).trackerStateSetAt).toEqual(h.now);
  });
});

describe("PR 머지 때 티켓 상태 바꾸기", () => {
  const mergedState = toTrackerStateId("done");

  function chooseMergedState(stateId: typeof mergedState | null = mergedState): void {
    saveWorkspaceTrackerProject(h.db, {
      workspaceId: toWorkspaceId("ws-1"),
      connection,
      projectId: trackerProject,
      name: "Web",
      inProgressStateId: null,
      mergedStateId: stateId,
    });
  }

  it("머지를 확인하면 한 번 바꾸고 다음 바퀴에는 다시 바꾸지 않는다", async () => {
    chooseMergedState();
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "merged");
    report(run, runnerId);
    await worker.tick();
    expect(h.tracker.stateChanges).toEqual([{ key: run.ticket.key, stateId: mergedState }]);
    expect(recordsOf(run).mergedStateSetAt).toEqual(h.now);
    await worker.tick();
    expect(h.tracker.stateChanges).toHaveLength(1);
  });

  it("런이 끝난 뒤 열린 PR이 머지되면 그때 바꾼다", async () => {
    chooseMergedState();
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    report(run, runnerId);
    await worker.tick();
    expect(h.tracker.stateChanges).toEqual([]);
    await settlePullRequest(run, "merged");
    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(h.tracker.stateChanges).toEqual([{ key: run.ticket.key, stateId: mergedState }]);
  });

  it("런이 끝나기 전에 PR이 머지돼도 확인한 때 바꾼다", async () => {
    chooseMergedState();
    const { run, worker } = await startOne();
    h.putPullRequest(current(run), "merged");
    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(current(run).state).toBe("running");
    expect(h.tracker.stateChanges).toEqual([{ key: run.ticket.key, stateId: mergedState }]);
  });

  it("PR이 머지 없이 닫히면 바꾸지 않는다", async () => {
    chooseMergedState();
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    report(run, runnerId);
    await worker.tick();
    await settlePullRequest(run, "closed");
    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(h.tracker.stateChanges).toEqual([]);
    expect(recordsOf(run).mergedStateSetAt).toBeNull();
  });

  it("PR이 없으면 바꾸지 않는다", async () => {
    chooseMergedState();
    const { run, runnerId, worker } = await startOne();
    report(run, runnerId);
    await worker.tick();
    await worker.tick();
    expect(h.tracker.stateChanges).toEqual([]);
  });

  it("바꾸지 않음이면 머지돼도 바꾸지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "merged");
    report(run, runnerId);
    await worker.tick();
    expect(h.tracker.stateChanges).toEqual([]);
    expect(recordsOf(run).mergedStateSetAt).toBeNull();
  });

  it("상태를 나중에 골라도 이미 머지된 지난 런의 티켓은 바꾸지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "merged");
    report(run, runnerId);
    await worker.tick();
    chooseMergedState();
    await worker.tick();
    await h.worker().tick();
    expect(h.tracker.stateChanges).toEqual([]);
  });

  it("트래커 호출이 실패하면 다음 바퀴에 다시 하고 워크트리 정리는 막지 않는다", async () => {
    chooseMergedState();
    const { run, runnerId, worker } = await startOne();
    const worktree = worktreeOf(run);
    h.putPullRequest(current(run), "merged");
    report(run, runnerId);
    const spy = vi.spyOn(h.tracker, "setState").mockRejectedValueOnce(new Error("network"));
    await worker.tick();
    expect(recordsOf(run).mergedStateSetAt).toBeNull();
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);
    expect(await h.runner(runnerId).worktreeExists(worktree)).toBe(false);
    await worker.tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(recordsOf(run).mergedStateSetAt).toEqual(h.now);
  });

  it("티켓이 트래커에서 사라졌으면 기록 없이 더 시도하지 않는다", async () => {
    chooseMergedState();
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "merged");
    report(run, runnerId);
    const spy = vi
      .spyOn(h.tracker, "setState")
      .mockRejectedValue(new AdapterError({ kind: "not-found" }));
    await worker.tick();
    await worker.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(recordsOf(run).mergedStateSetAt).toBeNull();
  });
});

describe("워크트리 정리", () => {
  it("바로 지움인 런(Merged)은 끝난 바퀴에 워크트리를 지우고 지운 시각을 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const worktree = worktreeOf(run);
    h.putPullRequest(current(run), "merged");
    report(run, runnerId);
    await worker.tick();
    expect(summarizeRunOutcome(ended(run)).worktree).toBe("remove-now");
    expect(h.runner(runnerId).removed).toEqual([worktree]);
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);

    await worker.tick();
    expect(h.runner(runnerId).removed).toHaveLength(1);
  });

  it("트래커가 실패해도 워크트리는 지우고, 댓글은 다음 바퀴에 단다", async () => {
    const { run, runnerId, worker } = await startOne();
    const spy = vi
      .spyOn(h.tracker, "listComments")
      .mockRejectedValueOnce(new Error("unauthorized"));
    report(run, runnerId, "failed");
    await worker.tick();
    expect(ended(run).agentResult).toBe("reported-failure");
    expect(h.runner(runnerId).removed).toHaveLength(1);
    expect(recordsOf(run).trackerComment).toBeNull();

    await worker.tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(h.tracker.comments.get(run.ticket.key)).toHaveLength(1);
  });

  it("러너가 Offline이면 지우지 않고 돌아오면 지운다", async () => {
    const { run, runnerId, worker } = await startOne();
    report(run, runnerId, "failed");
    h.setRunnerOnline(runnerId, false);
    h.runner(runnerId).online = true;
    await worker.tick();
    expect(ended(run).agentResult).toBe("reported-failure");
    expect(h.runner(runnerId).removed).toEqual([]);

    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(h.runner(runnerId).removed).toHaveLength(1);
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);
  });

  it("PR이 열린 런은 남기고, PR이 병합되면 이후 PR 상태를 기록한 뒤 지우며 두 축은 그대로다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    report(run, runnerId);
    await worker.tick();
    const axes = ended(run);
    expect(summarizeRunOutcome(axes)).toEqual({
      outcome: "succeeded",
      worktree: "keep-until-pr-settles",
    });
    expect(h.runner(runnerId).removed).toEqual([]);

    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).laterPrState).toBeNull();

    await settlePullRequest(run, "merged");
    await worker.tick();
    expect(recordsOf(run).laterPrState).toBeNull();

    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).laterPrState).toEqual({ state: "merged", at: h.now });
    expect(h.runner(runnerId).removed).toEqual([worktreeOf(run)]);
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);
    expect(ended(run)).toMatchObject({
      agentResult: axes.agentResult,
      prState: "open",
      runnerUnreached: false,
    });
    expect(summarizeRunOutcome(ended(run)).outcome).toBe("succeeded");
  });

  it("PR 열린 시간 초과 런은 PR이 닫히면 이후 PR 상태 닫힘을 기록하고 지운다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "timed-out", prState: "open" });
    expect(h.runner(runnerId).removed).toEqual([]);

    await settlePullRequest(run, "closed");
    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).laterPrState?.state).toBe("closed");
    expect(h.runner(runnerId).removed).toEqual([worktreeOf(run)]);
    expect(ended(run)).toMatchObject({ agentResult: "timed-out", prState: "open" });
  });

  it("워크트리 없음 런은 지우기를 부르지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).deleteWorktree(worktreeOf(run));
    await worker.tick();
    expect(ended(run).agentResult).toBe("worktree-missing");
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeRemovedAt).toBeNull();
  });

  it("Queued에서 취소한 런은 지우기를 부르지 않고 지운 시각도 남기지 않는다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.setRunnerOnline(runnerId, false);
    const run = h.assign("ENG-1", projectA);
    requestRunCancel(h.db, run.id, h.now);
    const worker = h.worker();
    await worker.tick();
    expect(ended(run).agentResult).toBe("canceled");
    h.setRunnerOnline(runnerId, true);
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeRemovedAt).toBeNull();
    expect(h.tracker.comments.get(run.ticket.key)).toHaveLength(1);
  });

  it("러너 연결 끊김 런의 워크트리는 러너가 돌아와도 지우지 않고, 사람이 지우면 러너 확인 때 지운 시각을 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const worktree = worktreeOf(run);
    h.runner(runnerId).online = false;
    await worker.tick();
    h.advance(DISCONNECT_AFTER_MS);
    await worker.tick();
    expect(current(run).state).toBe("disconnected");
    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(ended(run).agentResult).toBe("runner-disconnected");
    expect(summarizeRunOutcome(ended(run)).worktree).toBe("operator-decides");

    h.runner(runnerId).online = true;
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(listRunners(h.db).find((r) => r.id === runnerId)?.online).toBe(true);
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeRemovedAt).toBeNull();

    h.runner(runnerId).deleteWorktree(worktree);
    await worker.tick();
    expect(recordsOf(run).worktreeRemovedAt).toBeNull();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);
    expect(h.runner(runnerId).removed).toEqual([]);
  });
});

describe("일을 잃지 않는 워크트리 정리 (0145 R7)", () => {
  const keptEvents = () =>
    h.log.entries
      .filter((entry) => entry.event === "run.worktree_kept")
      .map((entry) => entry.fields);

  it.each([
    {
      name: "커밋하지 않은 변경",
      work: { uncommittedChanges: true, unpushedCommits: false },
      kept: "uncommitted-changes",
    },
    {
      name: "push하지 않은 커밋",
      work: { uncommittedChanges: false, unpushedCommits: true },
      kept: "unpushed-commits",
    },
  ] as const)("$name 이 있으면 지우지 않고 남긴 이유를 기록한다", async ({ work, kept }) => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).worktreeWork.set(worktreeOf(run), work);
    report(run, runnerId, "failed");
    await worker.tick();

    expect(summarizeRunOutcome(ended(run)).worktree).toBe("remove-now");
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run)).toMatchObject({ worktreeKept: kept, worktreeRemovedAt: null });
    expect(keptEvents()).toEqual([{ runId: run.id, reason: kept }]);

    h.runner(runnerId).worktreeWork.delete(worktreeOf(run));
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(keptEvents()).toHaveLength(1);
  });

  it("변경도 push하지 않은 커밋도 없으면 지운다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).worktreeWork.set(worktreeOf(run), {
      uncommittedChanges: false,
      unpushedCommits: false,
    });
    const worktree = worktreeOf(run);
    report(run, runnerId, "failed");
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([worktree]);
    expect(recordsOf(run)).toMatchObject({ worktreeKept: null, worktreeRemovedAt: h.now });
  });

  it("러너에서 확인하는 명령이 실패하면 남기고 확인하지 못했다고 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).worktreeWork.set(worktreeOf(run), "check-fails");
    report(run, runnerId, "failed");
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeKept).toBe("check-failed");
    expect(h.warnings.map((w) => w.event)).toContain("run.worktree_check_failed");
  });

  it("확인하는 동안 러너에 닿지 못하면 지우지 않고, 닿으면 다시 확인해 지운다", async () => {
    const { run, runnerId, worker } = await startOne();
    const worktree = worktreeOf(run);
    report(run, runnerId, "failed");
    const check = vi
      .spyOn(h.runner(runnerId), "checkWorktreeWork")
      .mockRejectedValueOnce(new AdapterError({ kind: "unreachable", detail: "ssh timed out" }));
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeKept).toBeNull();

    await worker.tick();
    expect(check).toHaveBeenCalledTimes(2);
    expect(h.runner(runnerId).removed).toEqual([worktree]);
  });

  it("운영자가 취소한 런도 커밋하지 않은 변경이 있으면 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).worktreeWork.set(worktreeOf(run), {
      uncommittedChanges: true,
      unpushedCommits: true,
    });
    requestRunCancel(h.db, run.id, h.now);
    await worker.tick();
    await worker.tick();
    expect(ended(run).agentResult).toBe("canceled");
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeKept).toBe("uncommitted-changes");
  });

  it("PR이 병합된 런도 push하지 않은 커밋이 있으면 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).worktreeWork.set(worktreeOf(run), {
      uncommittedChanges: false,
      unpushedCommits: true,
    });
    h.putPullRequest(current(run), "merged");
    report(run, runnerId);
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeKept).toBe("unpushed-commits");
  });

  describe("머지된 PR의 head와 워크트리 HEAD (R8)", () => {
    const PR_HEAD = "abc123";
    const unpushedAt = (headCommit: string) => ({
      uncommittedChanges: false,
      unpushedCommits: true,
      headCommit,
    });

    it("런이 끝날 때 이미 squash 머지됐고 HEAD가 PR head면 지운다", async () => {
      const { run, runnerId, worker } = await startOne();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), unpushedAt(PR_HEAD));
      h.putPullRequest(current(run), "merged");
      report(run, runnerId);
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([worktreeOf(run)]);
      expect(recordsOf(run).worktreeKept).toBeNull();
    });

    it("런이 끝난 뒤 squash 머지되고 HEAD가 PR head면 지운다", async () => {
      const { run, runnerId, worker } = await startOne();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), unpushedAt(PR_HEAD));
      h.putPullRequest(current(run), "open");
      report(run, runnerId);
      await worker.tick();
      await settlePullRequest(run, "merged");
      h.advance(PR_POLL_INTERVAL_MS);
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([worktreeOf(run)]);
      expect(recordsOf(run).worktreeKept).toBeNull();
    });

    it("머지 뒤 더 커밋해 HEAD가 PR head와 다르면 남긴다", async () => {
      const { run, runnerId, worker } = await startOne();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), unpushedAt("def456"));
      h.putPullRequest(current(run), "merged");
      report(run, runnerId);
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([]);
      expect(recordsOf(run).worktreeKept).toBe("unpushed-commits");
    });

    it("HEAD가 PR head와 같아도 커밋하지 않은 변경이 있으면 남긴다", async () => {
      const { run, runnerId, worker } = await startOne();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), {
        ...unpushedAt(PR_HEAD),
        uncommittedChanges: true,
      });
      h.putPullRequest(current(run), "merged");
      report(run, runnerId);
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([]);
      expect(recordsOf(run).worktreeKept).toBe("uncommitted-changes");
    });

    it("PR이 머지되지 않고 닫혔으면 HEAD가 같아도 남긴다", async () => {
      const { run, runnerId, worker } = await startOne();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), unpushedAt(PR_HEAD));
      h.putPullRequest(current(run), "open");
      report(run, runnerId);
      await worker.tick();
      await settlePullRequest(run, "closed");
      h.advance(PR_POLL_INTERVAL_MS);
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([]);
      expect(recordsOf(run).worktreeKept).toBe("unpushed-commits");
    });

    it("머지됐지만 기록에 head 커밋이 없으면 남긴다", async () => {
      const { run, runnerId, worker } = await startOne();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), unpushedAt(PR_HEAD));
      h.putPullRequest(current(run), "open");
      report(run, runnerId);
      await worker.tick();
      expect(recordsOf(run).pullRequest?.signals ?? null).toBeNull();
      updateRunRecords(h.db, run.id, { laterPrState: { state: "merged", at: h.now } });
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([]);
      expect(recordsOf(run).worktreeKept).toBe("unpushed-commits");
    });

    it("일반 머지로 원격에 없는 커밋이 없으면 HEAD와 상관없이 지운다", async () => {
      const { run, runnerId, worker } = await startOne();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), {
        uncommittedChanges: false,
        unpushedCommits: false,
        headCommit: "def456",
      });
      h.putPullRequest(current(run), "merged");
      report(run, runnerId);
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([worktreeOf(run)]);
    });

    it("이미 push하지 않은 커밋으로 남긴 런은 다시 판정하지 않는다", async () => {
      const { run, runnerId, worker } = await startOne();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), unpushedAt("def456"));
      h.putPullRequest(current(run), "merged");
      report(run, runnerId);
      await worker.tick();
      h.runner(runnerId).worktreeWork.set(worktreeOf(run), unpushedAt(PR_HEAD));
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([]);
      expect(recordsOf(run).worktreeKept).toBe("unpushed-commits");
    });
  });

  it("Succeeded인데 PR이 없으면 확인하지 않고 운영자가 보게 남긴다 (R7-2)", async () => {
    const { run, runnerId, worker } = await startOne();
    const check = vi.spyOn(h.runner(runnerId), "checkWorktreeWork");
    report(run, runnerId);
    await worker.tick();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();

    expect(summarizeRunOutcome(ended(run))).toEqual({
      outcome: "succeeded",
      worktree: "operator-decides",
    });
    expect(check).not.toHaveBeenCalled();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run)).toMatchObject({ worktreeKept: null, worktreeRemovedAt: null });
  });

  it.each([
    { name: "PR 없이 Succeeded로 남긴 워크트리", outcome: "succeeded", work: undefined },
    {
      name: "push하지 않은 커밋 때문에 남긴 워크트리",
      outcome: "failed",
      work: { uncommittedChanges: true, unpushedCommits: true },
    },
  ] as const)(
    "운영자가 $name 를 지우라고 하면 일이 있어도 지운다 (R7-3)",
    async ({ outcome, work }) => {
      const { run, runnerId, worker } = await startOne();
      const worktree = worktreeOf(run);
      if (work !== undefined) h.runner(runnerId).worktreeWork.set(worktree, work);
      report(run, runnerId, outcome);
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([]);

      expect(requestWorktreeRemoval(h.db, run.id, h.now)).toEqual({ ok: true });
      await worker.tick();
      expect(h.runner(runnerId).removed).toEqual([worktree]);
      expect(recordsOf(run)).toMatchObject({
        worktreeRemovedAt: h.now,
        worktreeRemoveRequestedAt: null,
      });
    },
  );

  it("운영자가 지우라고 했는데 러너가 Offline이면 기다렸다가 돌아오면 지운다", async () => {
    const { run, runnerId, worker } = await startOne();
    const worktree = worktreeOf(run);
    report(run, runnerId);
    await worker.tick();
    requestWorktreeRemoval(h.db, run.id, h.now);
    h.setRunnerOnline(runnerId, false);
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeRemoveRequestedAt).not.toBeNull();

    h.setRunnerOnline(runnerId, true);
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([worktree]);
  });

  it("남긴 워크트리를 사람이 러너에서 지우면 러너 확인 때 지운 시각을 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const worktree = worktreeOf(run);
    h.runner(runnerId).worktreeWork.set(worktree, {
      uncommittedChanges: true,
      unpushedCommits: false,
    });
    report(run, runnerId, "failed");
    await worker.tick();
    expect(recordsOf(run).worktreeKept).toBe("uncommitted-changes");

    h.runner(runnerId).deleteWorktree(worktree);
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);
    expect(h.runner(runnerId).removed).toEqual([]);
  });
});

describe("PR·CI 상태와 마지막 로그", () => {
  it("끝나지 않은 런의 PR과 CI 상태를 폴링해 쓴다", async () => {
    const { run, worker } = await startOne();
    expect(recordsOf(run).pullRequest).toBeNull();
    h.putPullRequest(current(run), "open");
    await worker.tick();
    expect(recordsOf(run).pullRequest).toBeNull();
    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).pullRequest).toMatchObject({
      displayId: "#1",
      url: "https://code.example.com/acme/pull/1",
      ci: "success",
      checkedAt: h.now,
    });
  });

  it("런이 끝날 때 에이전트를 닫기 전에 마지막 200줄을 저장한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    fake.appendLog(worktreeOf(run), ...lines);
    const order: string[] = [];
    const read = fake.readLogTail.bind(fake);
    vi.spyOn(fake, "readLogTail").mockImplementation((target, opts) => {
      order.push("read");
      return read(target, opts);
    });
    const close = fake.closeAgent.bind(fake);
    vi.spyOn(fake, "closeAgent").mockImplementation((target) => {
      order.push("close");
      return close(target);
    });
    report(run, runnerId);
    await worker.tick();
    expect(order).toEqual(["read", "close"]);
    expect(recordsOf(run).lastLog).toEqual(lines.slice(-LAST_LOG_LINES));
  });
});

describe("web 요청 처리", () => {
  it("로그 꼬리 요청을 러너에서 읽어 결과를 쓰고 한 번만 처리한다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).appendLog(worktreeOf(run), "a", "b");
    requestLogTail(h.db, run.id, h.now);
    const spy = vi.spyOn(h.runner(runnerId), "readLogTail");
    await worker.tick();
    expect(getLogTailRequest(h.db, run.id)).toEqual({
      status: "done",
      requestedAt: h.now,
      completedAt: h.now,
      result: ["a", "b"],
    });
    await worker.tick();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("끝난 런의 로그 꼬리 요청은 저장한 마지막 로그를, Queued 런은 오류를 쓴다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).appendLog(worktreeOf(run), "last");
    report(run, runnerId);
    await worker.tick();
    const queued = h.assign("ENG-2", projectA);
    h.setRunnerOnline(runnerId, false);
    requestLogTail(h.db, run.id, h.now);
    requestLogTail(h.db, queued.id, h.now);
    await worker.tick();
    expect(getLogTailRequest(h.db, run.id)).toMatchObject({ status: "done", result: ["last"] });
    expect(getLogTailRequest(h.db, queued.id)).toMatchObject({
      status: "failed",
      error: JSON.stringify({ kind: "run-not-started" }),
    });
  });

  it("러너에 닿지 못하면 로그 꼬리 요청에 오류를 쓴다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).online = false;
    requestLogTail(h.db, run.id, h.now);
    await worker.tick();
    const status = getLogTailRequest(h.db, run.id);
    expect(status?.status).toBe("failed");
    expect(status?.status === "failed" && status.error).toContain("unreachable");
  });

  it("러너 확인 요청을 처리해 RunnerHealth를 쓰고 러너 확인 결과도 갱신한다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const worker = h.worker();
    await worker.tick();
    const check = vi.spyOn(h.runner(runnerId), "checkHealth");
    requestRunnerCheck(h.db, runnerId, h.now);
    await worker.tick();
    const status = getRunnerCheckRequest(h.db, runnerId);
    expect(status).toMatchObject({ status: "done", completedAt: h.now });
    expect(status?.status === "done" && status.result).toMatchObject({ online: true });
    expect(check).toHaveBeenCalledTimes(1);

    await worker.tick();
    expect(check).toHaveBeenCalledTimes(1);

    h.runner(runnerId).online = false;
    h.advance(1000);
    requestRunnerCheck(h.db, runnerId, h.now);
    await worker.tick();
    expect(getRunnerCheckRequest(h.db, runnerId)).toMatchObject({ status: "done" });
    const result = getRunnerCheckRequest(h.db, runnerId);
    expect(result?.status === "done" && result.result).toMatchObject({ online: false });
  });

  it("주기 확인이 돌 때가 된 러너에 확인 요청이 오면 그 tick에서 한 번만 확인한다 (0096)", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const worker = h.worker();
    await worker.tick();
    const check = vi.spyOn(h.runner(runnerId), "checkHealth");
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    requestRunnerCheck(h.db, runnerId, h.now);

    await worker.tick();

    expect(check).toHaveBeenCalledTimes(1);
    expect(getRunnerCheckRequest(h.db, runnerId)).toMatchObject({ status: "done" });
  });
});
