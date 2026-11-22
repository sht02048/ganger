import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENDED_DAYS,
  RUNNER_CARD_VISIBLE_RUNS,
  WAITING_CARD_VISIBLE_RUNS,
  foldRuns,
  needsReview,
  prProblemOf,
  runWord,
  runnerCards,
  situationParts,
  waitingRuns,
} from "./board.js";
import type { BoardRun, RunnerSeats, WaitingFor } from "./board.js";

const base = {
  ticketTitle: null,
  trackerProject: "Web",
  branch: null,
  runner: null,
  agent: "claude",
  waitMs: 0,
  executionMs: 0,
  pullRequest: null,
  attention: false,
  runnerId: "a",
  waitingFor: null,
  nextStep: "none" as const,
  canContinue: false,
};

function active(
  id: string,
  state: "running" | "waiting-for-input",
  runnerId = "a",
  waitingFor: WaitingFor | null = null,
): BoardRun {
  return { ...base, id, ticketKey: id, state, cancelling: false, runnerId, waitingFor };
}

function disconnected(id: string, runnerId = "a"): BoardRun {
  return {
    ...base,
    id,
    ticketKey: id,
    state: "disconnected",
    paused: false,
    cancelling: false,
    runnerId,
  };
}

function paused(id: string, runnerId = "a"): BoardRun {
  return {
    ...base,
    id,
    ticketKey: id,
    state: "paused",
    pausedMs: 1,
    cancelling: false,
    runnerId,
  };
}

function queued(id: string, waitMs: number): BoardRun {
  return {
    ...base,
    id,
    ticketKey: id,
    state: "queued",
    queuedReason: { kind: "behind" },
    cancelling: false,
    runnerId: null,
    waitMs,
  };
}

function signals(change: { ciFailed?: boolean; conflict?: boolean | null }) {
  return {
    ciFailed: change.ciFailed ?? false,
    checkTotal: 1,
    failedCount: change.ciFailed === true ? 1 : 0,
    failedChecks: [],
    checksTruncated: false,
    conflict: change.conflict ?? false,
    behindBy: 0,
    checkedAt: "2026-11-22T00:00:00.000Z",
  };
}

function ended(
  summary: "succeeded" | "failed" | "canceled",
  change: {
    pr?: ReturnType<typeof signals>;
    laterPrState?: "merged" | "closed" | null;
  } = {},
): BoardRun {
  return {
    ...base,
    id: summary,
    ticketKey: summary,
    state: "ended",
    endedAt: "2026-11-22T00:00:00.000Z",
    endedAgoMs: 0,
    agentResult: summary === "succeeded" ? "reported-success" : "reported-failure",
    prState: change.pr === undefined ? "none" : "open",
    laterPrState: change.laterPrState ?? null,
    prReadError: null,
    summary,
    attention: false,
    nextStep:
      change.laterPrState === "merged" || change.pr === undefined
        ? summary === "failed"
          ? "failed"
          : "none"
        : change.pr.ciFailed
          ? "pr-ci-failed"
          : change.pr.conflict === true
            ? "pr-conflict"
            : "none",
    pullRequest:
      change.pr === undefined
        ? null
        : {
            displayId: "#1",
            url: "https://code.example.com/acme/web/pull/1",
            ci: "failure",
            signals: change.pr,
            checkedAt: "2026-11-22T00:00:00.000Z",
            checkedAgoMs: 0,
            closedOnHost: false,
          },
  };
}

function seat(id: string, online = true, capacity = 2): RunnerSeats {
  return { id, name: id, online, capacity, used: 0 };
}

describe("러너 카드", () => {
  it("답·끊김 > 도는 런 > 빈 러너 > 꺼진 러너 순이고 같은 단계는 이름 순이다", () => {
    const cards = runnerCards(
      [
        seat("off"),
        seat("idle-b"),
        seat("idle-a"),
        seat("busy"),
        seat("ask"),
        seat("cut", false),
      ].map((s) => (s.id === "off" ? { ...s, online: false } : s)),
      [
        active("r1", "running", "busy"),
        active("r2", "waiting-for-input", "ask"),
        disconnected("r3", "cut"),
      ],
    );
    expect(cards.map((c) => c.id)).toEqual(["ask", "cut", "busy", "idle-a", "idle-b", "off"]);
  });

  it("꺼진 러너에 끊긴 런이 있으면 흐리게 하지 않고, 런이 없을 때만 흐리게 한다", () => {
    const cards = runnerCards([seat("cut", false), seat("off", false)], [disconnected("r", "cut")]);
    expect(cards.map((c) => [c.id, c.dimmed])).toEqual([
      ["cut", false],
      ["off", true],
    ]);
  });

  it("카드 안은 끝나지 않은 런만이고 답을 기다리는 런이 먼저다", () => {
    const [card] = runnerCards(
      [seat("a")],
      [
        paused("p"),
        active("run", "running"),
        disconnected("cut"),
        active("ask", "waiting-for-input"),
        queued("q", 5),
      ],
    );
    expect(card?.runs.map((r) => r.id)).toEqual(["ask", "cut", "run", "p"]);
  });

  it("러너 조건이 있으면 그 러너 카드만, 프로젝트·에이전트 조건이면 런이 있는 카드만 둔다", () => {
    const runs = [active("r", "running", "a")];
    expect(runnerCards([seat("a"), seat("b")], runs, [], "b").map((c) => c.id)).toEqual(["b"]);
    expect(
      runnerCards([seat("a"), seat("b")], runs, [{ key: "agent", agent: "claude" }]).map(
        (c) => c.id,
      ),
    ).toEqual(["a"]);
  });

  it("지워진 러너의 런도 잃지 않고 꺼진 카드로 보인다", () => {
    const [card] = runnerCards([], [active("r", "running", "gone")]);
    expect(card).toMatchObject({ id: "gone", online: false, dimmed: false, capacity: 0 });
  });
});

describe("접기", () => {
  it.each([
    [RUNNER_CARD_VISIBLE_RUNS, 4, 4, 0],
    [RUNNER_CARD_VISIBLE_RUNS, 5, 4, 1],
    [WAITING_CARD_VISIBLE_RUNS, 5, 5, 0],
    [WAITING_CARD_VISIBLE_RUNS, 12, 5, 7],
  ])("한도 %i, 런 %i개면 %i개 보이고 %i개 접는다", (limit, total, shown, hidden) => {
    const runs = Array.from({ length: total }, (_, i) => i);
    const folded = foldRuns(runs, limit, false);
    expect([folded.shown.length, folded.hidden]).toEqual([shown, hidden]);
    expect(foldRuns(runs, limit, true)).toEqual({ shown: runs, hidden: 0 });
  });

  it("자리를 기다리는 카드는 오래 기다린 순이다", () => {
    const list = waitingRuns([queued("new", 1), active("r", "running"), queued("old", 9)]);
    expect(list.map((r) => r.id)).toEqual(["old", "new"]);
  });
});

describe("상황 문장", () => {
  it("모두 0 이면 도는 런이 없다는 한 문장이다", () => {
    expect(situationParts([])).toEqual([{ key: "none" }]);
  });

  it("0 인 부분은 빼고 끊긴 런을 맨 앞에 둔다", () => {
    expect(
      situationParts([
        queued("q", 1),
        active("r", "running"),
        active("w", "waiting-for-input"),
        disconnected("d"),
      ]),
    ).toEqual([
      { key: "disconnected", count: 1 },
      { key: "runningAndWaiting", running: 1, waiting: 1 },
      { key: "queued", count: 1 },
    ]);
    expect(situationParts([active("r", "running")])).toEqual([{ key: "running", count: 1 }]);
    expect(situationParts([active("w", "waiting-for-input")])).toEqual([
      { key: "waiting", count: 1 },
    ]);
    expect(situationParts([queued("q", 1)])).toEqual([{ key: "queued", count: 1 }]);
  });
});

describe("상태 한 마디", () => {
  it("끝나지 않은 런의 상태를 한 마디로 옮긴다", () => {
    expect(runWord(active("r", "running"))).toBe("running");
    expect(runWord(active("q", "waiting-for-input", "a", "question"))).toBe("question");
    expect(runWord(active("p", "waiting-for-input", "a", "permission"))).toBe("permission");
    expect(runWord(active("h", "waiting-for-input", "a", "human-check"))).toBe("human-check");
    expect(runWord(active("u", "waiting-for-input"))).toBe("question");
    expect(runWord(paused("p"))).toBe("paused");
    expect(runWord(disconnected("d"))).toBe("disconnected");
    expect(runWord(queued("q", 1))).toBe("queued");
  });

  it("끝난 런은 PR 문제가 있을 때만 확인 필요다", () => {
    expect(runWord(ended("succeeded"))).toBe("done");
    expect(runWord(ended("succeeded", { pr: signals({ ciFailed: true }) }))).toBe("needs-review");
    expect(runWord(ended("succeeded", { pr: signals({ conflict: true }) }))).toBe("needs-review");
    expect(runWord(ended("failed"))).toBe("failed");
    expect(runWord(ended("canceled"))).toBe("canceled");
  });

  it("병합된 PR 의 지난 CI 실패는 문제로 치지 않는다", () => {
    const merged = ended("succeeded", { pr: signals({ ciFailed: true }), laterPrState: "merged" });
    expect(prProblemOf(merged)).toBeNull();
    expect(runWord(merged)).toBe("done");
    expect(needsReview(merged)).toBe(false);
  });

  it("확인 필요는 처리할 일이 남은 Failed 와 PR 문제가 있는 Succeeded 다", () => {
    expect(needsReview(ended("failed"))).toBe(true);
    expect(needsReview({ ...ended("failed"), nextStep: "none" })).toBe(false);
    const conflict = ended("succeeded", { pr: signals({ conflict: true }) });
    expect(needsReview(conflict)).toBe(true);
    expect(needsReview({ ...conflict, nextStep: "none" })).toBe(false);
    expect(runWord({ ...conflict, nextStep: "none" })).toBe("done");
    expect(needsReview(ended("succeeded"))).toBe(false);
    expect(needsReview(ended("canceled"))).toBe(false);
    expect(needsReview(active("r", "running"))).toBe(false);
  });

  it("끝난 런의 기본 기간은 7일이다(운영자 결정 2026-11-22)", () => {
    expect(DEFAULT_ENDED_DAYS).toBe(7);
  });
});
