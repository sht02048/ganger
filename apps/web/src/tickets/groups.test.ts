import { describe, expect, it } from "vitest";
import {
  groupTickets,
  issueGroupsById,
  ticketStage,
  visibleGrouping,
} from "@ganger/app/tickets/groups";
import { mergeTicketsPage, ticketId } from "@ganger/app/tickets/merge";
import { countByFilter, matchesFilter, matchesRunFilter } from "@ganger/app/tickets/model";
import type {
  TicketIssueRef,
  TicketRun,
  TicketRunsData,
  TicketView,
  TrackerTicketsData,
} from "@ganger/app/tickets/model";

const ready = {
  kind: "ready",
  defaults: { runnerProject: "p", agent: "claude", repos: [] },
} as const;

function ref(key: string, category = "unstarted"): TicketIssueRef {
  return { key, title: `${key} 제목`, url: null, state: { name: category, category } };
}

function ticket(key: string, change: Partial<TicketView> = {}): TicketView {
  return {
    id: ticketId("c", key),
    connection: "c",
    key,
    title: `${key} 제목`,
    url: null,
    trackerProject: { id: "web", name: "Web" },
    trackerState: { name: "Todo", category: "unstarted" },
    priority: "none",
    ancestors: [],
    isParentIssue: false,
    blockerWait: null,
    waitingTickets: [],
    labels: [],
    runs: [],
    mapping: null,
    assignability: ready,
    ...change,
  };
}

const state = (category: string) => ({ trackerState: { name: category, category } });
const under = (...keys: string[]) => ({ ancestors: keys.map((key) => ref(key)) });
const active = (runState: "running" | "waiting-for-input"): TicketRun => ({
  id: `run-${runState}`,
  runnerName: "runner-a",
  state: runState,
  elapsedMs: 0,
  waitingOn: null,
});
const parentIssue = { isParentIssue: true } as const;

describe("묶기(0171)", () => {
  it("맨 위 이슈로 묶고 중간 이슈도 그 묶음의 하위로 둔다", () => {
    const { groups, loose } = groupTickets([
      ticket("A", parentIssue),
      ticket("B", { ...under("A"), ...parentIssue }),
      ticket("C", under("B", "A")),
      ticket("D"),
    ]);
    expect(groups.map((group) => group.root.key)).toEqual(["A"]);
    expect(groups[0]?.children.map((child) => child.key)).toEqual(["C", "B"]);
    expect(loose.map((item) => item.key)).toEqual(["D"]);
  });

  it("3단계를 넘으면 읽어 온 티켓을 따라 더 위 이슈로 합친다", () => {
    const { groups } = groupTickets([
      ticket("Z"),
      ticket("A", under("Z")),
      ticket("B", under("A", "Z")),
      ticket("C", under("B", "A", "Z")),
      ticket("D", under("C", "B", "A")),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.root.key).toBe("Z");
  });

  it("상위 관계가 돌아도 멈추고 티켓을 잃지 않는다", () => {
    const { groups, loose } = groupTickets([ticket("A", under("B")), ticket("B", under("A"))]);
    expect(groups).toEqual([]);
    expect(loose.map((item) => item.key)).toEqual(["A", "B"]);
  });

  it("읽은 범위 밖 상위 이슈는 하위에 딸려 온 정보로 묶고 읽은 하위만 센다", () => {
    const { groups } = groupTickets([
      ticket("A", { ...under("OUT"), ...state("completed") }),
      ticket("B", under("OUT")),
    ]);
    expect(groups[0]?.rootTicket).toBeNull();
    expect(groups[0]?.root.title).toBe("OUT 제목");
    expect(groups[0]?.progress).toEqual({ done: 1, inProgress: 0, remaining: 1, total: 2 });
  });

  it("진행 수는 Done·진행 중·남음을 나누고 취소는 분모에서 뺀다", () => {
    const { groups } = groupTickets([
      ticket("A", { ...under("P"), ...state("completed") }),
      ticket("B", { ...under("P"), ...state("started") }),
      ticket("C", under("P")),
      ticket("D", { ...under("P"), ...state("canceled") }),
    ]);
    expect(groups[0]?.progress).toEqual({ done: 1, inProgress: 1, remaining: 1, total: 3 });
  });

  it("묶음 순서는 사람이 볼 일, 할당할 수 있음, 진행 중, 모두 끝남이고 같은 단계는 받은 순서다", () => {
    const { groups } = groupTickets([
      ticket("F1", { ...under("FIN"), ...state("completed") }),
      ticket("R1", {
        ...under("RUN"),
        runs: [active("running")],
        assignability: { kind: "active-run", runId: "r" },
      }),
      ticket("A1", under("ASG")),
      ticket("Q1", {
        ...under("ASK"),
        runs: [active("waiting-for-input")],
        assignability: { kind: "active-run", runId: "q" },
      }),
      ticket("A2", under("ASG2")),
    ]);
    expect(groups.map((group) => group.root.key)).toEqual(["ASK", "ASG", "ASG2", "RUN", "FIN"]);
  });

  it("트래커에서 끝난 티켓은 지난 실패 런이 있어도 끝난 단계다", () => {
    const failed: TicketRun = {
      id: "r",
      runnerName: null,
      state: "ended",
      endedAt: "2026-11-18T00:00:00.000Z",
      endedAgoMs: 0,
      agentResult: "reported-failure",
      prState: "none",
      laterPrState: null,
      pullRequest: null,
      summary: "failed",
    };
    expect(ticketStage(ticket("A", { ...state("completed"), runs: [failed] }))).toBe("finished");
    expect(ticketStage(ticket("B", { runs: [failed] }))).toBe("attention");
  });

  it("트래커에서 끝났어도 답을 기다리는 런은 사람이 볼 일이고 묶음을 펼친다", () => {
    const { groups } = groupTickets([
      ticket("A", {
        ...under("P"),
        ...state("completed"),
        runs: [active("waiting-for-input")],
        assignability: { kind: "active-run", runId: "q" },
      }),
    ]);
    expect(groups[0]?.stage).toBe("attention");
    expect(groups[0]?.expandedByDefault).toBe(true);
  });

  it("중간 단계 이슈도 자기 아래 티켓으로 상위 이슈 묶음을 가진다", () => {
    const tickets = [
      ticket("A", parentIssue),
      ticket("B", { ...under("A"), ...parentIssue }),
      ticket("C", under("B", "A")),
    ];
    const byId = issueGroupsById(tickets, groupTickets(tickets));
    expect(byId.get(ticketId("c", "B"))?.children.map((child) => child.key)).toEqual(["C"]);
    expect(byId.get(ticketId("c", "A"))?.children).toHaveLength(2);
  });

  it("상위 이슈 자기 런이 답을 기다리면 사람이 볼 일이고, 끝난 자기 런은 단계에 넣지 않는다", () => {
    const own = (runs: TicketRun[]) =>
      groupTickets([
        ticket("P", { ...parentIssue, runs }),
        ticket("A", { ...under("P"), ...state("completed") }),
      ]).groups[0];
    expect(own([active("waiting-for-input")])?.stage).toBe("attention");
    expect(own([active("waiting-for-input")])?.expandedByDefault).toBe(false);
    expect(own([active("running")])?.stage).toBe("finished");
    expect(own([])?.stage).toBe("finished");
  });

  it("하위가 모두 끝난 묶음만 접어 둔다", () => {
    const { groups } = groupTickets([
      ticket("A", { ...under("DONE"), ...state("completed") }),
      ticket("B", { ...under("DONE"), ...state("canceled") }),
      ticket("C", { ...under("OPEN"), ...state("completed") }),
      ticket("D", under("OPEN")),
    ]);
    const expanded = Object.fromEntries(groups.map((g) => [g.root.key, g.expandedByDefault]));
    expect(expanded).toEqual({ DONE: false, OPEN: true });
  });
});

describe("묶기 보기의 거르기·찾기(0171)", () => {
  const tickets = [
    ticket("P", { ...parentIssue, title: "결제 개편" }),
    ticket("A", {
      ...under("P"),
      title: "버튼 고치기",
      runs: [active("running")],
      assignability: { kind: "active-run", runId: "r" },
    }),
    ticket("B", { ...under("P"), title: "문구 고치기" }),
    ticket("L", { title: "따로 있는 일" }),
  ];
  const grouping = groupTickets(tickets);
  const keys = (filter: Parameters<typeof visibleGrouping>[1], query: string) => {
    const visible = visibleGrouping(grouping, filter, query);
    return {
      groups: visible.groups.map(({ group, children }) => [
        group.root.key,
        children.map((c) => c.key),
      ]),
      loose: visible.loose.map((item) => item.key),
    };
  };

  it("거르기는 맞는 하위만 남기고 진행 수는 전체 기준이다", () => {
    expect(keys("in-progress", "")).toEqual({ groups: [["P", ["A"]]], loose: [] });
    expect(visibleGrouping(grouping, "in-progress", "").groups[0]?.group.progress.total).toBe(2);
  });

  it("맞는 하위가 없는 묶음은 숨긴다", () => {
    expect(keys("done", "")).toEqual({ groups: [], loose: [] });
  });

  it("상위 이슈 자기 런만 거르기에 맞으면 묶음을 숨긴다", () => {
    const own = groupTickets([
      ticket("P", {
        runs: [active("waiting-for-input")],
        assignability: { kind: "active-run", runId: "x" },
      }),
      ticket("A", under("P")),
    ]);
    expect(visibleGrouping(own, "todo", "").groups).toEqual([]);
  });

  it("찾는 말이 상위 이슈에 맞으면 묶음 전체를 보인다", () => {
    expect(keys("all", "결제")).toEqual({ groups: [["P", ["B", "A"]]], loose: [] });
  });

  it("찾는 말이 하위에만 맞으면 상위 줄과 맞는 하위만 보인다", () => {
    expect(keys("all", "문구")).toEqual({ groups: [["P", ["B"]]], loose: [] });
  });
});

describe("상위 이슈 할당(0171)", () => {
  const runs: TicketRunsData = {
    workspace: { kind: "one", workspace: { id: "w", name: "W" } },
    runners: [],
    agents: ["claude"],
    projects: [
      {
        connection: "c",
        projectId: "web",
        name: "Web",
        mapping: {
          agent: "claude",
          defaultRepo: "p",
          repos: [{ project: "p", isDefault: true, labelId: null }],
        },
        autoAssignLabel: null,
      },
    ],
    repoNames: {},
    runsByTicket: {},
    waitingByBlocker: {},
  };
  const view = (key: string, ancestors: TicketIssueRef[] = []) => ({
    connection: "c",
    projectId: "web",
    projectName: "Web",
    key,
    title: key,
    url: null,
    state: { name: "Todo", category: "unstarted" },
    priority: "none" as const,
    labels: [],
    ancestors,
  });
  const tracker: TrackerTicketsData = {
    workspace: runs.workspace,
    tickets: [view("P"), view("A", [ref("P")]), view("L")],
    labels: [],
    errors: [],
    truncated: [],
  };

  it("하위가 있는 이슈는 화면의 할당할 수 있음에서 빠지고, 서버 할당 판정은 그대로다", () => {
    const { tickets } = mergeTicketsPage(runs, tracker);
    const parent = tickets.find((t) => t.key === "P");
    expect(parent?.isParentIssue).toBe(true);
    expect(parent?.assignability.kind).toBe("ready");
    expect(matchesRunFilter(parent ?? tickets[0]!, "assignable")).toBe(true);
    expect(tickets.filter((t) => matchesFilter(t, "assignable")).map((t) => t.key)).toEqual([
      "A",
      "L",
    ]);
    expect(countByFilter(tickets).assignable).toBe(2);
  });

  it("상위 이슈에 도는 런이 있으면 그 런을 그대로 가리킨다", () => {
    const withRun: TicketRunsData = {
      ...runs,
      runsByTicket: {
        [ticketId("c", "P")]: {
          runs: [active("running")],
          activeRunId: "run-running",
          retryRepo: null,
          blockerWait: null,
        },
      },
    };
    const parent = mergeTicketsPage(withRun, tracker).tickets.find((t) => t.key === "P");
    expect(parent?.assignability).toEqual({ kind: "active-run", runId: "run-running" });
  });
});
