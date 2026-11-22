import { isBlockerFinished } from "@ganger/core";
import type { BlockerView } from "../runs/model.js";
import { BLOCKER_UNREAD, blockerWaitHint } from "./bulk-assign.js";
import type { BlockerHint, BulkChoice } from "./bulk-assign.js";

export type BlockerReading =
  | { kind: "read"; blockers: ReadonlyArray<BlockerView> }
  | { kind: "unread" };

export interface BulkGraphTicket {
  id: string;
  choice: BulkChoice;
  column: number;
  row: number;
  belowDivider: boolean;
  blockedByStuck: boolean;
  insideBlockers: ReadonlyArray<string>;
  waitingKeys: ReadonlyArray<string>;
  cycleKeys: ReadonlyArray<string>;
}

export interface BulkGraphOutside {
  id: string;
  key: string | null;
  title: string | null;
  stateName: string | null;
  stuck: boolean;
  column: number;
  row: number;
}

export interface BulkGraphLink {
  from: string;
  to: string;
  kind: "inside" | "waiting" | "stuck";
}

export interface BulkGraph {
  columnCount: number;
  tickets: ReadonlyArray<BulkGraphTicket>;
  outside: ReadonlyArray<BulkGraphOutside>;
  links: ReadonlyArray<BulkGraphLink>;
  dividerRow: number | null;
  cycles: ReadonlyArray<ReadonlyArray<string>>;
  unavailableCount: number;
}

export type BulkLinkTone = "default" | "waiting" | "problem";

export type BulkNodeNote =
  | { kind: "now" }
  | { kind: "after"; key: string; rest: number }
  | { kind: "held"; key: string; rest: number }
  | { kind: "cycle"; key: string; rest: number }
  | { kind: "blocker-canceled"; key: string; rest: number }
  | { kind: "blocker-unread" };

export interface BulkGraphState {
  blocked: ReadonlySet<string>;
  toneOf: (link: BulkGraphLink) => BulkLinkTone;
  noteOf: (ticket: BulkGraphTicket) => BulkNodeNote;
}

interface OutsideBlocker {
  id: string;
  key: string | null;
  title: string | null;
  stateName: string | null;
  stuck: boolean;
}

interface TicketLinks {
  inside: string[];
  outside: OutsideBlocker[];
}

export function blockerHintOfReading(reading: BlockerReading): BlockerHint | null {
  return reading.kind === "unread" ? BLOCKER_UNREAD : blockerWaitHint(reading.blockers);
}

function linksOf(
  ticketId: string,
  reading: BlockerReading | undefined,
  idByKey: ReadonlyMap<string, string>,
): TicketLinks {
  if (reading === undefined) return { inside: [], outside: [] };
  if (reading.kind === "unread") {
    return {
      inside: [],
      outside: [{ id: `unread:${ticketId}`, key: null, title: null, stateName: null, stuck: true }],
    };
  }
  const inside = new Set<string>();
  const outside = new Map<string, OutsideBlocker>();
  for (const blocker of reading.blockers) {
    if (isBlockerFinished(blocker.stateCategory)) continue;
    const canceled = blocker.stateCategory === "canceled";
    const insideId = canceled ? undefined : idByKey.get(blocker.key);
    if (insideId !== undefined) {
      inside.add(insideId);
      continue;
    }
    outside.set(blocker.key, {
      id: `outside:${blocker.key}`,
      key: blocker.key,
      title: blocker.title,
      stateName: blocker.stateName,
      stuck: canceled,
    });
  }
  return { inside: [...inside], outside: [...outside.values()] };
}

function stronglyConnected(
  ids: ReadonlyArray<string>,
  nextOf: (id: string) => ReadonlyArray<string>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  const visit = (id: string): void => {
    const order = index.size;
    index.set(id, order);
    low.set(id, order);
    stack.push(id);
    onStack.add(id);
    let lowest = order;
    for (const next of nextOf(id)) {
      if (!index.has(next)) {
        visit(next);
        lowest = Math.min(lowest, low.get(next) ?? lowest);
      } else if (onStack.has(next)) {
        lowest = Math.min(lowest, index.get(next) ?? lowest);
      }
    }
    low.set(id, lowest);
    if (lowest !== order) return;
    const component: string[] = [];
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    components.push(component);
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return components.reverse();
}

function reachableFrom(
  seeds: Iterable<string>,
  nextOf: (id: string) => ReadonlyArray<string>,
): Set<string> {
  const reached = new Set(seeds);
  const pending = [...reached];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const next of nextOf(id)) {
      if (reached.has(next)) continue;
      reached.add(next);
      pending.push(next);
    }
  }
  return reached;
}

function rowCounter(start: number): (column: number) => number {
  const used = new Map<number, number>();
  return (column) => {
    const row = used.get(column) ?? start;
    used.set(column, row + 1);
    return row;
  };
}

export function buildBulkGraph(
  choices: ReadonlyArray<BulkChoice>,
  readings: ReadonlyMap<string, BlockerReading>,
): BulkGraph {
  const candidates = choices.filter((choice) => choice.selectable);
  const ids = candidates.map((choice) => choice.ticket.id);
  const idByKey = new Map(candidates.map((choice) => [choice.ticket.key, choice.ticket.id]));
  const keyById = new Map(candidates.map((choice) => [choice.ticket.id, choice.ticket.key]));
  const keyOf = (id: string): string => keyById.get(id) ?? id;
  const linksById = new Map(
    candidates.map((choice) => [
      choice.ticket.id,
      linksOf(choice.ticket.id, readings.get(choice.ticket.id), idByKey),
    ]),
  );
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [id, links] of linksById) {
    for (const blocker of links.inside) dependents.get(blocker)?.push(id);
  }
  const dependentsOf = (id: string): ReadonlyArray<string> => dependents.get(id) ?? [];
  const components = stronglyConnected(ids, dependentsOf);

  const cycleById = new Map<string, ReadonlyArray<string>>();
  const cycles: string[][] = [];
  for (const component of components) {
    const [only] = component;
    const selfLoop =
      component.length === 1 &&
      only !== undefined &&
      (linksById.get(only)?.inside.includes(only) ?? false);
    if (component.length < 2 && !selfLoop) continue;
    const ordered = ids.filter((id) => component.includes(id));
    cycles.push(ordered.map(keyOf));
    for (const id of ordered) {
      const others = ordered.filter((other) => other !== id).map(keyOf);
      cycleById.set(id, others.length > 0 ? others : [keyOf(id)]);
    }
  }

  const stuckSeeds = ids.filter(
    (id) =>
      cycleById.has(id) || (linksById.get(id)?.outside.some((blocker) => blocker.stuck) ?? false),
  );
  const belowDivider = reachableFrom(stuckSeeds, dependentsOf);

  const columnById = new Map<string, number>();
  for (const component of components) {
    let column = 0;
    for (const id of component) {
      const links = linksById.get(id);
      if (links === undefined) continue;
      if (links.outside.length > 0) column = Math.max(column, 1);
      for (const blocker of links.inside) {
        if (component.includes(blocker)) continue;
        column = Math.max(column, (columnById.get(blocker) ?? 0) + 1);
      }
    }
    for (const id of component) columnById.set(id, column);
  }

  const outsideById = new Map<string, OutsideBlocker>();
  const outsideDependents = new Map<string, string[]>();
  for (const [id, links] of linksById) {
    for (const blocker of links.outside) {
      outsideById.set(blocker.id, blocker);
      outsideDependents.set(blocker.id, [...(outsideDependents.get(blocker.id) ?? []), id]);
    }
  }
  const outsideBelow = (blocker: OutsideBlocker): boolean =>
    blocker.stuck ||
    (outsideDependents.get(blocker.id) ?? []).every((dependent) => belowDivider.has(dependent));

  const mainRow = rowCounter(0);
  const rowById = new Map<string, number>();
  for (const id of ids) {
    if (!belowDivider.has(id)) rowById.set(id, mainRow(columnById.get(id) ?? 0));
  }
  for (const blocker of outsideById.values()) {
    if (!outsideBelow(blocker)) rowById.set(blocker.id, mainRow(0));
  }
  const mainRows = rowById.size === 0 ? 0 : Math.max(...rowById.values()) + 1;
  const lowerRow = rowCounter(mainRows);
  for (const blocker of outsideById.values()) {
    if (outsideBelow(blocker)) rowById.set(blocker.id, lowerRow(0));
  }
  for (const id of ids) {
    if (belowDivider.has(id)) rowById.set(id, lowerRow(columnById.get(id) ?? 0));
  }

  const tickets = candidates.map((choice): BulkGraphTicket => {
    const { id } = choice.ticket;
    const links = linksById.get(id);
    return {
      id,
      choice,
      column: columnById.get(id) ?? 0,
      row: rowById.get(id) ?? 0,
      belowDivider: belowDivider.has(id),
      blockedByStuck: stuckSeeds.includes(id),
      insideBlockers: links?.inside ?? [],
      waitingKeys: [
        ...(links?.inside ?? []).map(keyOf),
        ...(links?.outside ?? []).flatMap((blocker) => (blocker.key === null ? [] : [blocker.key])),
      ],
      cycleKeys: cycleById.get(id) ?? [],
    };
  });
  const outside = [...outsideById.values()].map((blocker): BulkGraphOutside => ({
    ...blocker,
    column: 0,
    row: rowById.get(blocker.id) ?? 0,
  }));
  const links = [...linksById].flatMap(([id, ticketLinks]): BulkGraphLink[] => [
    ...ticketLinks.inside.map((from): BulkGraphLink => ({ from, to: id, kind: "inside" })),
    ...ticketLinks.outside.map((blocker): BulkGraphLink => ({
      from: blocker.id,
      to: id,
      kind: blocker.stuck ? "stuck" : "waiting",
    })),
  ]);
  const hasLower = belowDivider.size > 0 || outside.some(outsideBelow);
  return {
    columnCount: Math.max(1, ...tickets.map((ticket) => ticket.column + 1)),
    tickets,
    outside,
    links,
    dividerRow: hasLower && mainRows > 0 ? mainRows : null,
    cycles,
    unavailableCount: choices.length - candidates.length,
  };
}

export function bulkGraphState(
  graph: BulkGraph,
  selected: ReadonlySet<string>,
  assigned: ReadonlySet<string> = new Set(),
): BulkGraphState {
  const goesAhead = (id: string) => selected.has(id) || assigned.has(id);
  const dependents = new Map<string, string[]>();
  for (const ticket of graph.tickets) {
    for (const blocker of ticket.insideBlockers) {
      dependents.set(blocker, [...(dependents.get(blocker) ?? []), ticket.id]);
    }
  }
  const seeds = graph.tickets
    .filter((ticket) => ticket.blockedByStuck || ticket.insideBlockers.some((id) => !goesAhead(id)))
    .map((ticket) => ticket.id);
  const blocked = reachableFrom(seeds, (id) => dependents.get(id) ?? []);
  const keyById = new Map(graph.tickets.map((ticket) => [ticket.id, ticket.choice.ticket.key]));

  const toneOf = (link: BulkGraphLink): BulkLinkTone => {
    switch (link.kind) {
      case "waiting":
        return "waiting";
      case "stuck":
        return "problem";
      case "inside":
        return goesAhead(link.from) && !blocked.has(link.from) ? "default" : "problem";
    }
  };

  const noteOf = (ticket: BulkGraphTicket): BulkNodeNote => {
    const [firstCycle] = ticket.cycleKeys;
    if (firstCycle !== undefined) {
      return { kind: "cycle", key: firstCycle, rest: ticket.cycleKeys.length - 1 };
    }
    const hint = ticket.choice.waitingOn;
    if (hint?.state === "canceled") {
      return { kind: "blocker-canceled", key: hint.key, rest: hint.rest };
    }
    if (hint?.state === "unread") return { kind: "blocker-unread" };
    const holding = ticket.insideBlockers
      .filter((id) => !goesAhead(id) || blocked.has(id))
      .flatMap((id) => keyById.get(id) ?? []);
    const [firstHolding] = holding;
    if (firstHolding !== undefined) {
      return { kind: "held", key: firstHolding, rest: holding.length - 1 };
    }
    const [firstWaiting] = ticket.waitingKeys;
    if (firstWaiting !== undefined) {
      return { kind: "after", key: firstWaiting, rest: ticket.waitingKeys.length - 1 };
    }
    return { kind: "now" };
  };

  return { blocked, toneOf, noteOf };
}
