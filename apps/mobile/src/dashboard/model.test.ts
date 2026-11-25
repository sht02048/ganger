import { dashboardSchema } from "@ganger/api";
import type { AppDashboard } from "@ganger/api";
import { describe, expect, it } from "vitest";

import { busySnapshot, emptySnapshot } from "../demo/data";
import { dashboardSummary, formatAgo, formatDuration, queuedLine } from "../format";
import {
  ALL_WORKSPACES,
  buildBoard,
  columnRestCount,
  columnTodoCount,
  firstColumn,
  hasNoRuns,
} from "./model";
import type { DashboardRun, EndedRun, QueuedRun, UnknownStateRun } from "./model";

const NOW = new Date(2026, 10, 23, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const baseRun = {
  id: "run-1",
  ticketId: "ticket-1",
  ticketKey: "ACME-1",
  ticketTitle: "제목",
  trackerProject: "ACME",
  workspace: { id: "ws", name: "Workspace" },
  runner: { name: "acme-runner", online: true },
  agent: "Claude",
  waitMs: 0,
  executionMs: null,
  pullRequest: null,
  cancelling: false,
  control: null,
  todoTag: null,
};

function endedRun(key: string, summary: EndedRun["summary"]): EndedRun {
  return {
    ...baseRun,
    id: `run-${key}`,
    ticketKey: key,
    state: "ended",
    summary,
    agentResult: summary === "failed" ? "reported-failure" : "reported-success",
    prState: "none",
    prReadError: null,
    endedAt: NOW.toISOString(),
    endedAgoMs: MINUTE,
  };
}

function dashboardWith(columns: Partial<AppDashboard["columns"]>): AppDashboard {
  const empty = emptySnapshot().dashboardFor(ALL_WORKSPACES);
  return { ...empty, columns: { ...empty.columns, ...columns } };
}

describe("데모 데이터", () => {
  it("모든 Workspace와 Workspace별 Dashboard가 API 계약을 통과한다", () => {
    const snapshot = busySnapshot(NOW);
    for (const id of [ALL_WORKSPACES, ...snapshot.workspaces.map((workspace) => workspace.id)]) {
      expect(dashboardSchema.safeParse(snapshot.dashboardFor(id)).success).toBe(true);
    }
    expect(dashboardSchema.safeParse(emptySnapshot().dashboardFor(ALL_WORKSPACES)).success).toBe(
      true,
    );
  });

  it("Workspace를 고르면 그 Workspace의 런만 담는다", () => {
    const dashboard = busySnapshot(NOW).dashboardFor("ws-growth");
    expect(dashboard.workspace).toMatchObject({ kind: "one", workspace: { name: "Growth" } });
    const board = buildBoard(dashboard);
    for (const run of [...board.queued, ...board.running.todo, ...board.running.rest]) {
      expect(run.workspace.id).toBe("ws-growth");
    }
  });
});

describe("buildBoard", () => {
  const board = buildBoard(busySnapshot(NOW).dashboardFor(ALL_WORKSPACES));

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
      "ACME-116",
      "ACME-114",
      "ACME-112",
    ]);
  });

  it("끝난 런 묶음은 5개까지 보이고 수는 전체를 센다", () => {
    const many = buildBoard(
      dashboardWith({
        done: {
          todo: [],
          rest: Array.from({ length: 7 }, (_, index) => endedRun(`S-${index}`, "succeeded")),
        },
      }),
    );
    expect(many.done.settled).toHaveLength(5);
    expect(many.done.settledTotal).toBe(7);
  });
});

describe("firstColumn", () => {
  it("처리할 일이 있는 칸부터 연다", () => {
    expect(firstColumn(buildBoard(busySnapshot(NOW).dashboardFor(ALL_WORKSPACES)))).toBe("running");
    const failed: EndedRun = { ...endedRun("F", "failed"), todoTag: "failed" };
    expect(firstColumn(buildBoard(dashboardWith({ done: { todo: [failed], rest: [] } })))).toBe(
      "done",
    );
  });

  it("처리할 일이 없으면 Running을 연다", () => {
    expect(firstColumn(buildBoard(dashboardWith({})))).toBe("running");
  });
});

describe("hasNoRuns", () => {
  it("어느 칸에든 런이 있으면 비어 있지 않다", () => {
    expect(hasNoRuns(dashboardWith({}))).toBe(true);
    expect(
      hasNoRuns(dashboardWith({ done: { todo: [], rest: [endedRun("S", "succeeded")] } })),
    ).toBe(false);
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
    queuedReason: QueuedRun["queuedReason"],
    runner: DashboardRun["runner"] = baseRun.runner,
  ): QueuedRun => ({ ...baseRun, runner, state: "queued", queuedReason });
  const blocker = { key: "A-1", title: "선행", stateName: "Todo", stateCategory: "unstarted" };
  const reasons: Array<[QueuedRun["queuedReason"], string]> = [
    [{ kind: "starting" }, "곧 시작해요"],
    [{ kind: "behind" }, "빈 러너를 기다려요"],
    [{ kind: "no-capacity", runner: "acme-runner" }, "빈 러너를 기다려요"],
    [{ kind: "project-missing" }, "러너에서 프로젝트가 빠져 다시 고르는 중"],
    [{ kind: "assignment-blocked" }, "러너의 GitHub 인증이 깨져 기다리는 중"],
    [
      { kind: "usage-limit", provider: "Claude", resetsInMs: 42 * MINUTE },
      "모든 러너가 Claude 한도에 닿아 42 min 뒤 풀려요",
    ],
    [{ kind: "blockers-waiting", blockers: [], finished: [] }, "선행 티켓을 기다려요"],
    [
      { kind: "blockers-stuck", cause: "cycle", blocker: null, blockers: [] },
      "선행 티켓을 읽지 못했어요",
    ],
    [
      { kind: "blockers-stuck", cause: "cycle", blocker, blockers: [blocker] },
      "선행 티켓과 서로 기다려요",
    ],
  ];

  it.each(reasons)("%j", (reason, text) => {
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
  const summaryOf = (summary: Partial<AppDashboard["summary"]>) => ({
    ...emptySnapshot().dashboardFor(ALL_WORKSPACES),
    summary: { ...emptySnapshot().dashboardFor(ALL_WORKSPACES).summary, ...summary },
  });

  it("처리할 일을 웹과 같은 순서로 말하고 한도 문장을 잇는다", () => {
    expect(dashboardSummary(busySnapshot(NOW).dashboardFor(ALL_WORKSPACES))).toBe(
      "처리할 일은 확인할 일 1개, 답할 질문 2개, 멈춘 런 2개예요. 한도에 닿은 러너 1대는 42 min 뒤 한도가 풀리면 다시 런을 받아요.",
    );
  });

  it("처리할 일이 없으면 진행 중인 런 수를 말한다", () => {
    expect(dashboardSummary(summaryOf({ inProgress: 1 }))).toBe(
      "처리할 일은 없고, 진행 중인 런이 1개 있어요.",
    );
  });

  it("풀리는 때를 모르는 한도는 러너 수만 말한다", () => {
    expect(dashboardSummary(summaryOf({ limitedRunners: 2, soonestLimitResetMs: null }))).toBe(
      "처리할 일도, 진행 중인 런도 없어요. 한도에 닿은 러너가 2대 있어요.",
    );
  });

  it("아무 런도 없으면 없다고 말한다", () => {
    expect(dashboardSummary(emptySnapshot().dashboardFor(ALL_WORKSPACES))).toBe(
      "처리할 일도, 진행 중인 런도 없어요.",
    );
  });
});

describe("Done 칸의 모르는 상태", () => {
  it("끝난 런과 따로 담아 개수에 넣는다", () => {
    const ended = endedRun("S", "succeeded");
    const unknownRun: UnknownStateRun = {
      id: "unknown-run",
      ticketId: ended.ticketId,
      ticketKey: "U",
      ticketTitle: ended.ticketTitle,
      trackerProject: ended.trackerProject,
      workspace: ended.workspace,
      runner: ended.runner,
      agent: ended.agent,
      waitMs: ended.waitMs,
      executionMs: ended.executionMs,
      pullRequest: ended.pullRequest,
      cancelling: ended.cancelling,
      control: ended.control,
      todoTag: null,
      state: "unknown",
    };
    const board = buildBoard(dashboardWith({ done: { todo: [], rest: [ended, unknownRun] } }));
    expect(board.done.unknownState.map((run) => run.ticketKey)).toEqual(["U"]);
    expect(board.done.settledTotal).toBe(1);
    expect(columnRestCount(board, "done")).toBe(2);
  });
});

describe("모르는 선행 티켓 원인", () => {
  it("선행 티켓 목록이 비어도 읽지 못했다고 하지 않는다", () => {
    const queued: QueuedRun = {
      ...endedRunBase(),
      state: "queued",
      queuedReason: { kind: "blockers-stuck", cause: "unknown", blocker: null, blockers: [] },
    };
    expect(queuedLine(queued)).toBe("선행 티켓을 알 수 없는 이유로 기다려요");
  });
});

function endedRunBase() {
  const { id, ticketId, ticketKey, ticketTitle, trackerProject, workspace, runner, agent } =
    endedRun("Q", "succeeded");
  return {
    id,
    ticketId,
    ticketKey,
    ticketTitle,
    trackerProject,
    workspace,
    runner,
    agent,
    waitMs: 0,
    executionMs: null,
    pullRequest: null,
    cancelling: false,
    control: null,
    todoTag: null,
  };
}
