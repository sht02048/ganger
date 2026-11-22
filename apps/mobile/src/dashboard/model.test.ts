import { describe, expect, it } from "vitest";

import type { HomeRun } from "../demo/contract";
import { busySnapshot, emptySnapshot } from "../demo/data";
import { dashboardSummary, formatAgo, formatDuration, queuedLine } from "../format";
import {
  buildBoard,
  columnRestCount,
  columnTodoCount,
  firstColumn,
  isInDoneWeek,
  prProblemsOf,
  runnerIssueCount,
} from "./model";

const NOW = new Date(2026, 10, 23, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const baseRun = {
  ticketTitle: "제목",
  workspace: { id: "ws", name: "Workspace" },
  runner: { name: "acme-runner", online: true },
  agent: "Claude",
  waitMs: 0,
  executionMs: null,
  pullRequest: null,
  cancelling: false,
};

function endedRun(
  key: string,
  summary: "succeeded" | "failed" | "canceled",
  agoMs: number,
  ticketId = key,
): HomeRun {
  return {
    ...baseRun,
    id: `run-${key}`,
    ticketId,
    ticketKey: key,
    state: "ended",
    summary,
    prState: "none",
    endedAt: new Date(NOW.getTime() - agoMs).toISOString(),
    endedAgoMs: agoMs,
  };
}

describe("buildBoard", () => {
  const board = buildBoard(busySnapshot(NOW).runs, NOW);

  it("Human Check를 Question과 따로 Running 칸 맨 위에 묶는다", () => {
    expect(board.running.humanCheck.map((run) => run.ticketKey)).toEqual(["ACME-142"]);
    expect(board.running.todo.map((run) => run.ticketKey)).toEqual([
      "ACME-138",
      "ACME-131",
      "ACME-127",
    ]);
  });

  it("Paused는 Running 칸에 있지만 처리할 일로 세지 않는다", () => {
    expect(board.running.rest.map((run) => run.state)).toContain("paused");
    expect(columnTodoCount(board, "running")).toBe(4);
    expect(columnRestCount(board, "running")).toBe(4);
  });

  it("Queued 칸에는 처리할 일 배지가 없다", () => {
    expect(columnTodoCount(board, "queued")).toBe(0);
    expect(columnRestCount(board, "queued")).toBe(5);
  });

  it("Done 칸의 꼬리표는 Failed뿐이다", () => {
    expect(board.done.todo.map((run) => run.ticketKey)).toEqual(["ACME-119"]);
    expect(board.done.settled.map((run) => run.ticketKey)).toEqual([
      "ACME-118",
      "ACME-117",
      "ACME-112",
    ]);
  });

  it("Failed는 7일이 지나도 남고, 나머지는 7일이 지나면 빠진다", () => {
    const old = buildBoard(
      [endedRun("OLD-1", "failed", 30 * DAY), endedRun("OLD-2", "succeeded", 30 * DAY)],
      NOW,
    );
    expect(old.done.todo).toHaveLength(1);
    expect(old.done.settled).toHaveLength(0);
  });

  it("같은 티켓의 Failed는 최신 런만 처리할 일로 남긴다", () => {
    const retried = buildBoard(
      [endedRun("A", "failed", 3 * HOUR, "same"), endedRun("B", "succeeded", HOUR, "same")],
      NOW,
    );
    expect(retried.done.todo).toHaveLength(0);
  });

  it("끝난 런 묶음은 5개까지 보이고 수는 전체를 센다", () => {
    const many = buildBoard(
      Array.from({ length: 7 }, (_, index) =>
        endedRun(`S-${index}`, "succeeded", (index + 1) * MINUTE),
      ),
      NOW,
    );
    expect(many.done.settled).toHaveLength(5);
    expect(many.done.settledTotal).toBe(7);
  });
});

describe("firstColumn", () => {
  it("처리할 일이 있는 칸부터 연다", () => {
    expect(firstColumn(buildBoard(busySnapshot(NOW).runs, NOW))).toBe("running");
    expect(firstColumn(buildBoard([endedRun("F", "failed", HOUR)], NOW))).toBe("done");
  });

  it("처리할 일이 없으면 Running을 연다", () => {
    expect(firstColumn(buildBoard([], NOW))).toBe("running");
  });
});

describe("isInDoneWeek", () => {
  it("오늘을 포함한 7개 날짜를 본다", () => {
    expect(isInDoneWeek(new Date(2026, 10, 17, 0, 0, 0).toISOString(), NOW)).toBe(true);
    expect(isInDoneWeek(new Date(2026, 10, 16, 23, 59, 59).toISOString(), NOW)).toBe(false);
  });
});

describe("prProblemsOf", () => {
  it("CI 실패, 충돌, 뒤처짐 순서로 돌려준다", () => {
    expect(prProblemsOf({ ciFailed: true, conflict: true, behindBy: 3 })).toEqual([
      { kind: "ci-failed" },
      { kind: "conflict" },
      { kind: "behind", commits: 3 },
    ]);
    expect(prProblemsOf({ ciFailed: false, conflict: null, behindBy: 0 })).toEqual([]);
    expect(prProblemsOf(null)).toEqual([]);
  });
});

describe("runnerIssueCount", () => {
  it("사용량 한도 러너는 세지 않는다", () => {
    expect(runnerIssueCount(busySnapshot(NOW).runners)).toBe(2);
  });
});

describe("시간 표기(ADR 0010)", () => {
  it.each([
    [30_000, "<1 min"],
    [25 * MINUTE, "25 min"],
    [63 * MINUTE, "1 hr 3 min"],
    [2 * HOUR, "2 hr"],
    [DAY, "1 day"],
    [2 * DAY + HOUR, "2 days"],
  ])("경과 %d ms는 %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it("지난 일은 상대 시간이고 하루가 넘으면 날짜다", () => {
    const at = new Date(2026, 10, 20, 9, 0, 0).toISOString();
    expect(formatAgo(at, 10_000)).toBe("Just now");
    expect(formatAgo(at, 25 * MINUTE)).toBe("25 min ago");
    expect(formatAgo(at, 3 * HOUR)).toBe("3 hr ago");
    expect(formatAgo(at, 2 * DAY)).toBe("11월 20일");
  });
});

describe("Queued 이유", () => {
  const queued = (
    queuedReason: Extract<HomeRun, { state: "queued" }>["queuedReason"],
    runner: { name: string; online: boolean } | null = baseRun.runner,
  ): Extract<HomeRun, { state: "queued" }> => ({
    ...baseRun,
    runner,
    id: "run-q",
    ticketId: "q",
    ticketKey: "Q-1",
    state: "queued",
    queuedReason,
  });

  it.each([
    [{ kind: "starting" as const }, "곧 시작해요"],
    [{ kind: "behind" as const }, "빈 러너를 기다려요"],
    [{ kind: "no-capacity" as const, runner: "acme-runner" }, "빈 러너를 기다려요"],
    [{ kind: "project-missing" as const }, "러너에서 프로젝트가 빠져 다시 고르는 중"],
    [{ kind: "assignment-blocked" as const }, "러너의 GitHub 인증이 깨져 기다리는 중"],
    [
      { kind: "usage-limit" as const, provider: "Claude", resetsInMs: 42 * MINUTE },
      "모든 러너가 Claude 한도에 닿아 42 min 뒤 풀려요",
    ],
    [{ kind: "blockers-waiting" as const, blockers: [] }, "선행 티켓을 기다려요"],
    [
      { kind: "blockers-stuck" as const, cause: "cycle" as const, blocker: null, blockers: [] },
      "선행 티켓과 서로 기다려요",
    ],
  ])("%j", (reason, text) => {
    expect(queuedLine(queued(reason))).toBe(text);
  });

  it("Offline 러너 이름에 맞는 조사를 붙인다", () => {
    expect(queuedLine(queued({ kind: "runner-offline" }, { name: "studio", online: false }))).toBe(
      "studio가 Offline이라 기다려요",
    );
    expect(queuedLine(queued({ kind: "runner-offline" }, { name: "mac", online: false }))).toBe(
      "mac가 Offline이라 기다려요",
    );
    expect(queuedLine(queued({ kind: "runner-offline" }, { name: "맥미니1", online: false }))).toBe(
      "맥미니1이 Offline이라 기다려요",
    );
    expect(queuedLine(queued({ kind: "runner-offline" }, null))).toBe(
      "맞는 러너가 Offline이라 기다려요",
    );
  });
});

describe("머리 요약", () => {
  it("처리할 일을 웹과 같은 순서로 말하고 한도 문장을 잇는다", () => {
    const { runs, runners } = busySnapshot(NOW);
    expect(dashboardSummary(buildBoard(runs, NOW), runners)).toBe(
      "처리할 일은 확인할 일 1개, 답할 질문 2개, 멈춘 런 2개예요. 한도에 닿은 러너 1대는 42 min 뒤 한도가 풀리면 다시 런을 받아요.",
    );
  });

  it("처리할 일이 없으면 진행 중인 런 수를 말한다", () => {
    const running: HomeRun = {
      ...baseRun,
      id: "run-r",
      ticketId: "r",
      ticketKey: "R-1",
      state: "running",
    };
    expect(dashboardSummary(buildBoard([running], NOW), [])).toBe(
      "처리할 일은 없고, 진행 중인 런이 1개 있어요.",
    );
  });

  it("아무 런도 없으면 없다고 말한다", () => {
    const { runs, runners } = emptySnapshot();
    expect(dashboardSummary(buildBoard(runs, NOW), runners)).toBe(
      "처리할 일도, 진행 중인 런도 없어요.",
    );
  });
});
