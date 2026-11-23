import { AdapterError, summarizeRunOutcome, toPullRequestId } from "@ganger/core";
import type {
  CodeHostErrorDetail,
  PrReadError,
  RunnerErrorDetail,
  WorktreeRef,
} from "@ganger/core";
import {
  DEFAULT_MAX_RUN_MS,
  getRun,
  getRunWithRecords,
  requestRunCancel,
  saveCodeHostConnection,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { toCodeHostKind } from "@ganger/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  PR_READ_RETRY_FIRST_MS,
  PR_READ_RETRY_MAX_MS,
  isNewMerge,
  prReadErrorOf,
  prReadRetryDelayMs,
  pullRequestRecord,
} from "./context.js";
import { Harness, projectA } from "./test-fixtures.js";
import type { Worker } from "./worker.js";

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

const MINUTE = 60_000;

function current(run: StoredRun): StoredRun {
  const found = getRun(h.db, run.id);
  if (found === null) throw new Error(`run ${run.id} is gone`);
  return found;
}

function ended(run: StoredRun) {
  const found = getRunWithRecords(h.db, run.id);
  if (found?.run.state !== "ended") throw new Error(`run ${run.id} has not ended`);
  return { run: found.run, records: found.records };
}

function worktreeOf(run: StoredRun): WorktreeRef {
  const found = current(run);
  if (found.state === "queued" || found.worktree === null) throw new Error("run has not started");
  return found.worktree;
}

function finish(run: StoredRun): void {
  const found = current(run);
  if (found.state === "queued" || found.runnerId === null || found.worktree === null) {
    throw new Error(`run ${run.id} has not started`);
  }
  h.runner(found.runnerId).report(found.worktree, { outcome: "succeeded", body: "끝났어요" });
}

function codeHostFails(error: unknown): MockInstance {
  return vi.spyOn(h.codeHost, "findPullRequestsByBranch").mockRejectedValue(error);
}

function codeHostError(detail: CodeHostErrorDetail): AdapterError<CodeHostErrorDetail> {
  return new AdapterError(detail);
}

async function startTwoOnOneSlot(): Promise<{
  run: StoredRun;
  waiting: StoredRun;
  worker: Worker;
  runnerId: ReturnType<Harness["addRunner"]>;
}> {
  const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
  const run = h.assign("ENG-1", projectA);
  const waiting = h.assign("ENG-2", projectA);
  const worker = h.worker();
  await worker.tick();
  expect([current(run).state, current(waiting).state]).toEqual(["running", "queued"]);
  return { run, waiting, worker, runnerId };
}

describe("PR을 읽지 못해도 런을 끝낸다", () => {
  const failures: Array<{ name: string; error: unknown; reason: PrReadError }> = [
    {
      name: "토큰이 저장소를 볼 수 없음(NOT_FOUND)",
      error: codeHostError({ kind: "not-found" }),
      reason: "no-access",
    },
    {
      name: "권한 오류(FORBIDDEN)",
      error: codeHostError({ kind: "unauthorized" }),
      reason: "no-access",
    },
    {
      name: "네트워크 오류",
      error: codeHostError({ kind: "network", cause: new Error("reset") }),
      reason: "other",
    },
    { name: "어댑터 밖 오류", error: new Error("boom"), reason: "other" },
  ];

  it.each(failures)(
    "$name 이면 한 tick 안에 PR 못 읽음으로 끝내고 러너 자리를 비운다",
    async ({ error, reason }) => {
      const { run, waiting, worker } = await startTwoOnOneSlot();
      codeHostFails(error);
      finish(run);

      await worker.tick();

      const found = ended(run);
      expect(found.run).toMatchObject({ agentResult: "reported-success", prState: "unknown" });
      expect(found.records.prReadError).toBe(reason);
      expect(found.records.reportBody).toBe("끝났어요");
      expect(current(waiting).state).toBe("running");
      expect(summarizeRunOutcome(found.run)).toEqual({
        outcome: "succeeded",
        worktree: "keep-until-pr-settles",
      });
      const readFailed = h.warnings.find((w) => w.event === "run.pr_read_failed");
      expect(readFailed?.fields).toMatchObject({ runId: run.id, reason });
      expect(h.warnings.map((w) => w.event)).not.toContain("run.watch_failed");
    },
  );

  it("PR을 읽으면 한 tick 안에 그 PR 상태로 끝내고 러너 자리를 비운다", async () => {
    const { run, waiting, worker } = await startTwoOnOneSlot();
    h.putPullRequest(current(run), "open");
    finish(run);

    await worker.tick();

    const found = ended(run);
    expect(found.run.prState).toBe("open");
    expect(found.records.prReadError).toBeNull();
    expect(found.records.pullRequest?.displayId).toBe("#1");
    expect(current(waiting).state).toBe("running");
    expect(h.warnings.map((w) => w.event)).not.toContain("run.pr_read_failed");
  });

  it("런 도중 읽어 둔 PR 기록은 끝날 때 못 읽어도 지우지 않는다", async () => {
    const { run, worker } = await startTwoOnOneSlot();
    h.putPullRequest(current(run), "open");
    h.advance(MINUTE);
    await worker.tick();
    codeHostFails(codeHostError({ kind: "not-found" }));
    finish(run);

    await worker.tick();

    const found = ended(run);
    expect(found.run.prState).toBe("unknown");
    expect(found.records.pullRequest?.displayId).toBe("#1");
  });

  it("러너 진행을 읽지 못한 채 취소해도 PR 못 읽음으로 끝낸다", async () => {
    const { run, runnerId, worker } = await startTwoOnOneSlot();
    vi.spyOn(h.runner(runnerId), "pollRun").mockRejectedValue(
      new AdapterError<RunnerErrorDetail>({ kind: "malformed-output", raw: "?" }),
    );
    codeHostFails(codeHostError({ kind: "not-found" }));
    requestRunCancel(h.db, run.id, h.now);

    await worker.tick();

    const found = ended(run);
    expect(found.run).toMatchObject({ agentResult: "canceled", prState: "unknown" });
    expect(found.records.prReadError).toBe("no-access");
  });

  it("러너가 등록에서 빠진 채 시간이 지나도 PR 못 읽음으로 끝낸다", async () => {
    const { run, worker } = await startTwoOnOneSlot();
    h.db.$client.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM runner_projects;
      DELETE FROM runners;
      PRAGMA foreign_keys = ON;
    `);
    codeHostFails(codeHostError({ kind: "network", cause: new Error("reset") }));
    h.advance(DEFAULT_MAX_RUN_MS);

    await worker.tick();

    const found = ended(run);
    expect(found.run).toMatchObject({ agentResult: "runner-disconnected", prState: "unknown" });
    expect(found.records.prReadError).toBe("other");
  });
});

describe("PR 다시 읽기", () => {
  async function endUnread(): Promise<{
    run: StoredRun;
    worker: Worker;
    runnerId: ReturnType<Harness["addRunner"]>;
    reads: MockInstance;
  }> {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    const reads = codeHostFails(codeHostError({ kind: "not-found" }));
    finish(run);
    await worker.tick();
    expect(ended(run).run.prState).toBe("unknown");
    reads.mockClear();
    return { run, worker, runnerId, reads };
  }

  it("간격은 1분에서 시작해 두 배씩 늘고 30분을 넘지 않는다", () => {
    expect(PR_READ_RETRY_FIRST_MS).toBe(MINUTE);
    expect(PR_READ_RETRY_MAX_MS).toBe(30 * MINUTE);
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(prReadRetryDelayMs)).toEqual(
      [1, 2, 4, 8, 16, 30, 30, 30].map((m) => m * MINUTE),
    );
  });

  it("못 읽은 동안 간격을 늘려 가며 다시 읽고 워크트리를 지우지 않는다", async () => {
    const { run, worker, runnerId, reads } = await endUnread();

    h.advance(MINUTE - 1);
    await worker.tick();
    expect(reads).not.toHaveBeenCalled();

    h.advance(1);
    await worker.tick();
    expect(reads).toHaveBeenCalledTimes(1);

    h.advance(2 * MINUTE - 1);
    await worker.tick();
    expect(reads).toHaveBeenCalledTimes(1);
    h.advance(1);
    await worker.tick();
    expect(reads).toHaveBeenCalledTimes(2);

    for (const minutes of [4, 8, 16, 30, 30]) {
      h.advance(minutes * MINUTE - 1);
      await worker.tick();
      h.advance(1);
      await worker.tick();
    }
    expect(reads).toHaveBeenCalledTimes(7);

    expect(ended(run).run.prState).toBe("unknown");
    expect(h.runner(runnerId).removed).not.toContain(worktreeOf(run));
  });

  it("GitHub 토큰이 바뀌면 간격을 기다리지 않고 다음 tick에 바로 다시 읽는다", async () => {
    const { run, worker, reads } = await endUnread();
    reads.mockRestore();
    h.putPullRequest(current(run), "open");

    await worker.tick();
    expect(ended(run).run.prState).toBe("unknown");

    saveCodeHostConnection(h.db, h.secretBox, {
      id: toCodeHostConnectionId("code-1"),
      kind: toCodeHostKind("fake"),
      name: "Acme",
      config: {},
      secrets: { token: "new-token" },
    });
    await worker.tick();

    const found = ended(run);
    expect(found.run.prState).toBe("open");
    expect(found.records.prReadError).toBeNull();
  });

  it("다시 읽을 때 이유가 바뀌면 이유를 고친다", async () => {
    const { run, worker, reads } = await endUnread();
    reads.mockRejectedValue(codeHostError({ kind: "network", cause: new Error("reset") }));

    h.advance(MINUTE);
    await worker.tick();

    expect(ended(run).records.prReadError).toBe("other");
  });

  it.each([
    { pr: "merged", removed: true },
    { pr: "closed", removed: true },
    { pr: "none", removed: false },
    { pr: "open", removed: false },
  ] as const)(
    "읽으면 PR 상태($pr)를 채우고 그 tick에 워크트리 규칙을 적용한다",
    async ({ pr, removed }) => {
      const { run, worker, runnerId, reads } = await endUnread();
      reads.mockRestore();
      if (pr !== "none") h.putPullRequest(current(run), pr);

      h.advance(MINUTE);
      await worker.tick();

      const found = ended(run);
      expect(found.run.prState).toBe(pr);
      expect(found.records.prReadError).toBeNull();
      expect(found.records.pullRequest === null).toBe(pr === "none");
      expect(h.runner(runnerId).removed.includes(worktreeOf(run))).toBe(removed);
      expect(found.records.worktreeRemovedAt === null).toBe(!removed);
    },
  );
});

describe("두 PR 찾기 중 하나만 권한 오류", () => {
  it("다른 찾기가 먼저 다른 오류로 실패해도 이유는 no-access 다", async () => {
    const { run, worker } = await startTwoOnOneSlot();
    vi.spyOn(h.codeHost, "findPullRequestsByBranch").mockRejectedValue(
      codeHostError({ kind: "not-found" }),
    );
    vi.spyOn(h.codeHost, "findPullRequestsByTicketKey").mockRejectedValue(
      codeHostError({ kind: "network", cause: new Error("reset") }),
    );
    finish(run);

    await worker.tick();

    expect(ended(run).records.prReadError).toBe("no-access");
  });
});

describe("다시 읽어 PR 이 없으면", () => {
  it("런 도중 읽어 둔 PR 기록을 지운다", async () => {
    const { run, worker } = await startTwoOnOneSlot();
    h.putPullRequest(current(run), "open");
    h.advance(MINUTE);
    await worker.tick();
    const reads = codeHostFails(codeHostError({ kind: "not-found" }));
    finish(run);
    await worker.tick();
    expect(ended(run).records.pullRequest?.displayId).toBe("#1");

    reads.mockResolvedValue([]);
    vi.spyOn(h.codeHost, "findPullRequestsByTicketKey").mockResolvedValue([]);
    h.advance(MINUTE);
    await worker.tick();

    const found = ended(run);
    expect(found.run.prState).toBe("none");
    expect(found.records.pullRequest).toBeNull();
  });
});

describe("이유 구분", () => {
  it.each([
    [codeHostError({ kind: "not-found" }), "no-access"],
    [codeHostError({ kind: "unauthorized" }), "no-access"],
    [codeHostError({ kind: "rate-limited", resetAt: null }), "other"],
    [codeHostError({ kind: "network", cause: null }), "other"],
    [new AdapterError({ kind: "malformed-output", raw: "?" }), "other"],
    [new Error("boom"), "other"],
    ["not an error", "other"],
  ] as const)("%o 는 %s", (error, reason) => {
    expect(prReadErrorOf(error)).toBe(reason);
  });
});

describe("PR 기록 만들기 (0150)", () => {
  const snapshot = {
    id: toPullRequestId("7"),
    displayId: "#7",
    url: "https://code.example.com/acme/web/pull/7",
    title: "ACME-7",
    body: "",
    createdAt: new Date(0),
    mergedAt: null,
    headBranch: "feat/acme-7",
    sourceRepo: null,
    headCommit: "abc",
    baseBranch: "main",
    ci: "failure",
    signals: null,
  };

  it.each(["merged", "closed"])("PR 정보를 못 읽어도 %s PR 은 열림이 아니라고 적는다", (state) => {
    const record = pullRequestRecord({ ...snapshot, state }, new Date(1));
    expect(record.signals).toMatchObject({
      open: false,
      ciFailed: false,
      conflict: null,
      title: snapshot.title,
      baseBranch: "main",
    });
  });

  it("PR 정보를 못 읽은 열린 PR 은 값을 지어내지 않는다", () => {
    const record = pullRequestRecord({ ...snapshot, state: "open" }, new Date(1));
    expect(record.signals).toBeNull();
  });
});

describe("운영자가 Ganger 에서 머지한 PR (0201)", () => {
  const merged = {
    id: toPullRequestId("7"),
    displayId: "#7",
    url: "https://code.example.com/acme/web/pull/7",
    title: "ACME-7",
    body: "",
    state: "merged",
    createdAt: new Date(0),
    mergedAt: new Date(1_000),
    headBranch: "feat/acme-7",
    sourceRepo: null,
    headCommit: "abc",
    baseBranch: "main",
    ci: "success",
    signals: null,
  };

  it("머지된 PR 기록에 머지 시각과 상태를 남긴다", () => {
    expect(pullRequestRecord(merged, new Date(2_000)).signals?.settled).toEqual({
      state: "merged",
      at: new Date(1_000).toISOString(),
    });
  });

  it("서버가 머지하고 이미 머지됨으로 적어 둔 PR 도 새 머지로 알아본다", () => {
    const byServer = pullRequestRecord(merged, new Date(2_000), {
      operatorMergedAt: new Date(2_000).toISOString(),
    });
    const byWorker = pullRequestRecord(merged, new Date(2_000));
    expect(isNewMerge(byServer, merged)).toBe(true);
    expect(isNewMerge(byWorker, merged)).toBe(false);
  });
});
