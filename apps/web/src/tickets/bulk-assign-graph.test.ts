import { describe, expect, it } from "vitest";
import { bulkChoices } from "@ganger/app/tickets/bulk-assign";
import {
  blockerHintOfReading,
  buildBulkGraph,
  bulkGraphState,
} from "@ganger/app/tickets/bulk-assign-graph";
import type { BlockerReading, BulkGraph } from "@ganger/app/tickets/bulk-assign-graph";
import type { BlockerHint } from "@ganger/app/tickets/bulk-assign";
import type { TicketRun, TicketView } from "@ganger/app/tickets/model";

const defaults = { runnerProject: "github:acme/web", agent: "claude", repos: [] };
const idOf = (key: string) => JSON.stringify(["conn-acme", key]);

function child(key: string, overrides: Partial<TicketView> = {}): TicketView {
  return {
    id: idOf(key),
    connection: "conn-acme",
    key,
    title: `${key} 제목`,
    url: null,
    trackerProject: { id: "tp-web", name: "Web" },
    trackerState: { name: "Todo", category: "unstarted" },
    priority: "none",
    ancestors: [],
    isParentIssue: false,
    blockerWait: null,
    waitingTickets: [],
    labels: [],
    runs: [],
    mapping: defaults,
    assignability: { kind: "ready", defaults },
    ...overrides,
  };
}

const succeededRun: TicketRun = {
  id: "run-done",
  runnerName: "runner-a",
  state: "ended",
  endedAt: "2026-11-22T00:00:00.000Z",
  endedAgoMs: 0,
  agentResult: "reported-failure",
  prState: "none",
  laterPrState: null,
  pullRequest: null,
  summary: "succeeded",
};

function on(...blockers: Array<[string, string]>): BlockerReading {
  return {
    kind: "read",
    blockers: blockers.map(([key, stateCategory]) => ({
      key,
      title: `${key} 제목`,
      stateName: stateCategory,
      stateCategory,
    })),
  };
}

function graphOf(
  tickets: ReadonlyArray<TicketView>,
  byKey: Readonly<Record<string, BlockerReading>> = {},
): BulkGraph {
  const readings = new Map(
    tickets.map((ticket) => [ticket.id, byKey[ticket.key] ?? on()] as const),
  );
  const hints = new Map<string, BlockerHint>();
  for (const [id, reading] of readings) {
    const hint = blockerHintOfReading(reading);
    if (hint !== null) hints.set(id, hint);
  }
  return buildBulkGraph(bulkChoices(tickets, hints), readings);
}

const place = (graph: BulkGraph, key: string) => {
  const found = graph.tickets.find((ticket) => ticket.choice.ticket.key === key);
  if (found === undefined) throw new Error(`no ${key}`);
  return found;
};

const all = (graph: BulkGraph) => new Set(graph.tickets.map((ticket) => ticket.id));

function without(graph: BulkGraph, ...keys: string[]): Set<string> {
  const selected = all(graph);
  for (const key of keys) selected.delete(idOf(key));
  return selected;
}

describe("시작 차례 열(0182)", () => {
  it("선행 관계의 단계로 열을 정하고 가장 긴 경로를 따른다", () => {
    const graph = graphOf([child("A-1"), child("A-2"), child("A-3"), child("A-4")], {
      "A-2": on(["A-1", "unstarted"]),
      "A-3": on(["A-2", "unstarted"]),
      "A-4": on(["A-1", "unstarted"], ["A-3", "unstarted"]),
    });
    expect(["A-1", "A-2", "A-3", "A-4"].map((key) => place(graph, key).column)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(graph.columnCount).toBe(4);
    expect(graph.dividerRow).toBeNull();
  });

  it("끝난 선행 티켓은 관계도에 넣지 않는다", () => {
    const graph = graphOf([child("A-1"), child("A-2")], { "A-2": on(["A-1", "completed"]) });
    expect(place(graph, "A-2").column).toBe(0);
    expect(graph.links).toEqual([]);
    expect(graph.outside).toEqual([]);
  });
});

describe("하위 티켓 밖의 선행 티켓(0182)", () => {
  it("안 끝났으면 1열 점선 상자로 두고 회색 화살표로 잇는다", () => {
    const graph = graphOf([child("A-1")], { "A-1": on(["B-9", "started"]) });
    expect(graph.outside).toMatchObject([{ key: "B-9", stuck: false, column: 0 }]);
    expect(place(graph, "A-1")).toMatchObject({ column: 1, belowDivider: false });
    const state = bulkGraphState(graph, all(graph));
    expect(graph.links.map(state.toneOf)).toEqual(["waiting"]);
    expect(state.blocked.size).toBe(0);
  });

  it("여러 하위 티켓이 기다리는 밖의 선행 티켓은 상자 하나다", () => {
    const graph = graphOf([child("A-1"), child("A-2")], {
      "A-1": on(["B-9", "started"]),
      "A-2": on(["B-9", "started"]),
    });
    expect(graph.outside).toHaveLength(1);
    expect(graph.links).toHaveLength(2);
  });

  it("취소됐으면 구분선 아래로 보내고 뒤 티켓까지 함께 내린다", () => {
    const graph = graphOf([child("A-0"), child("A-1"), child("A-2")], {
      "A-1": on(["B-9", "canceled"]),
      "A-2": on(["A-1", "unstarted"]),
    });
    expect(graph.dividerRow).toBe(1);
    expect(place(graph, "A-0").belowDivider).toBe(false);
    expect(place(graph, "A-1").belowDivider).toBe(true);
    expect(place(graph, "A-2").belowDivider).toBe(true);
    expect(graph.outside[0]).toMatchObject({ stuck: true, row: 1 });
    const state = bulkGraphState(graph, all(graph));
    expect(state.blocked.has(idOf("A-1"))).toBe(true);
    expect(state.blocked.has(idOf("A-2"))).toBe(true);
    expect(state.noteOf(place(graph, "A-1"))).toEqual({
      kind: "blocker-canceled",
      key: "B-9",
      rest: 0,
    });
  });

  it("읽지 못했으면 구분선 아래에 키 없는 상자로 둔다", () => {
    const graph = graphOf([child("A-0"), child("A-1")], { "A-1": { kind: "unread" } });
    expect(graph.outside).toMatchObject([{ key: null, stuck: true }]);
    expect(place(graph, "A-1").belowDivider).toBe(true);
    expect(bulkGraphState(graph, all(graph)).noteOf(place(graph, "A-1"))).toEqual({
      kind: "blocker-unread",
    });
  });

  it("고를 수 없는 하위 티켓이 안 끝났으면 밖의 선행 티켓으로 그린다", () => {
    const graph = graphOf([child("A-1", { runs: [succeededRun] }), child("A-2")], {
      "A-2": on(["A-1", "started"]),
    });
    expect(graph.outside).toMatchObject([{ key: "A-1", stuck: false }]);
    expect(graph.unavailableCount).toBe(1);
  });
});

describe("서로 기다리는 티켓(0182)", () => {
  it("순환은 구분선 아래 같은 열에 두고 서로의 키를 알려 준다", () => {
    const graph = graphOf([child("A-0"), child("A-1"), child("A-2")], {
      "A-1": on(["A-2", "unstarted"]),
      "A-2": on(["A-1", "unstarted"]),
    });
    expect(graph.cycles).toEqual([["A-1", "A-2"]]);
    expect(place(graph, "A-1").belowDivider).toBe(true);
    expect(place(graph, "A-1").column).toBe(place(graph, "A-2").column);
    const state = bulkGraphState(graph, all(graph));
    expect(state.noteOf(place(graph, "A-1"))).toEqual({ kind: "cycle", key: "A-2", rest: 0 });
    expect(graph.links.map(state.toneOf)).toEqual(["problem", "problem"]);
  });

  it("자기 자신을 기다리는 티켓도 순환이다", () => {
    const graph = graphOf([child("A-1")], { "A-1": on(["A-1", "unstarted"]) });
    expect(graph.cycles).toEqual([["A-1"]]);
    expect(bulkGraphState(graph, all(graph)).blocked.has(idOf("A-1"))).toBe(true);
  });

  it("순환 뒤의 티켓도 시작하지 못한다", () => {
    const graph = graphOf([child("A-1"), child("A-2"), child("A-3")], {
      "A-1": on(["A-2", "unstarted"]),
      "A-2": on(["A-1", "unstarted"]),
      "A-3": on(["A-2", "unstarted"]),
    });
    const state = bulkGraphState(graph, all(graph));
    expect(place(graph, "A-3").belowDivider).toBe(true);
    expect(state.noteOf(place(graph, "A-3"))).toMatchObject({ kind: "held", key: "A-2" });
  });
});

describe("앞 티켓 체크 해제(0182)", () => {
  const chain = () =>
    graphOf([child("A-1"), child("A-2"), child("A-3"), child("A-4")], {
      "A-2": on(["A-1", "unstarted"]),
      "A-3": on(["A-2", "unstarted"]),
    });

  it("여러 단계로 전파하고 상관없는 티켓은 그대로 둔다", () => {
    const graph = chain();
    const state = bulkGraphState(graph, without(graph, "A-1"));
    expect([...state.blocked].sort()).toEqual([idOf("A-2"), idOf("A-3")].sort());
    expect(graph.links.map(state.toneOf)).toEqual(["problem", "problem"]);
    expect(state.noteOf(place(graph, "A-3"))).toEqual({ kind: "held", key: "A-2", rest: 0 });
  });

  it("다시 체크하면 정상으로 돌아오고 설명은 앞 티켓 뒤에 시작한다고 말한다", () => {
    const graph = chain();
    const state = bulkGraphState(graph, all(graph));
    expect(state.blocked.size).toBe(0);
    expect(graph.links.map(state.toneOf)).toEqual(["default", "default"]);
    expect(state.noteOf(place(graph, "A-2"))).toEqual({ kind: "after", key: "A-1", rest: 0 });
    expect(state.noteOf(place(graph, "A-1"))).toEqual({ kind: "now" });
  });

  it("이미 할당한 앞 티켓은 체크가 풀려도 막지 않는다", () => {
    const graph = chain();
    const state = bulkGraphState(graph, without(graph, "A-1"), new Set([idOf("A-1")]));
    expect(state.blocked.size).toBe(0);
  });
});

describe("고를 수 없는 하위 티켓(0182)", () => {
  it("관계도에서 빼고 개수만 센다", () => {
    const graph = graphOf([
      child("A-1"),
      child("A-2", { runs: [succeededRun] }),
      child("A-3", { trackerState: { name: "Done", category: "completed" } }),
      child("A-4", { mapping: null, assignability: { kind: "no-mapping" } }),
    ]);
    expect(graph.tickets.map((ticket) => ticket.choice.ticket.key)).toEqual(["A-1"]);
    expect(graph.unavailableCount).toBe(3);
  });
});
