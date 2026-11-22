import type { IssueGroupPhase, IssueRowSurface, IssueStateKind } from "@ganger/ui";
import { lastRun, matchesFilter, matchesSearch } from "@ganger/app/tickets/model";
import type { TicketFilter, TicketView } from "@ganger/app/tickets/model";
import type {
  TicketGroup,
  TicketGrouping,
  TicketListView,
  VisibleTicketGrouping,
} from "@ganger/app/tickets/groups";
import { issueGroupsById, visibleGrouping } from "@ganger/app/tickets/groups";

export type TicketListRow =
  | { kind: "parent"; id: string; group: TicketGroup; expanded: boolean; surface: IssueRowSurface }
  | { kind: "child"; id: string; ticket: TicketView; surface: IssueRowSurface }
  | { kind: "loose-head"; id: string; count: number }
  | { kind: "loose"; id: string; ticket: TicketView }
  | { kind: "flat"; id: string; ticket: TicketView; group: TicketGroup | null };

export type TicketRowAction = "assign" | "new-run" | "answer" | "open-run";

export function issueStateKind(category: string): IssueStateKind {
  switch (category) {
    case "started":
      return "in-progress";
    case "completed":
      return "done";
    case "canceled":
      return "canceled";
    default:
      return "todo";
  }
}

export function rowActionOf(ticket: TicketView): TicketRowAction | null {
  const run = lastRun(ticket);
  if (run?.state === "waiting-for-input") return "answer";
  if (run?.state === "disconnected") return "open-run";
  const { category } = ticket.trackerState;
  if (
    ticket.isParentIssue ||
    ticket.assignability.kind !== "ready" ||
    category === "completed" ||
    category === "canceled"
  )
    return null;
  if (run === undefined) return "assign";
  return run.state === "ended" && run.summary !== "succeeded" ? "new-run" : null;
}

export function isGroupExpanded(
  group: TicketGroup,
  overrides: ReadonlyMap<string, boolean>,
  narrowed: boolean,
  selectedId: string | undefined,
): boolean {
  const override = overrides.get(group.id);
  if (override !== undefined) return override;
  if (narrowed) return true;
  if (group.children.some((child) => child.id === selectedId)) return true;
  return group.expandedByDefault;
}

function surfaceOf(index: number, count: number): IssueRowSurface {
  if (count === 1) return "only";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

export function groupedRows(
  visible: VisibleTicketGrouping,
  overrides: ReadonlyMap<string, boolean>,
  narrowed: boolean,
  selectedId: string | undefined,
): TicketListRow[] {
  const rows: TicketListRow[] = [];
  for (const { group, children } of visible.groups) {
    const expanded = isGroupExpanded(group, overrides, narrowed, selectedId);
    const shown = expanded ? children : [];
    const count = shown.length + 1;
    rows.push({ kind: "parent", id: group.id, group, expanded, surface: surfaceOf(0, count) });
    shown.forEach((ticket, index) => {
      rows.push({
        kind: "child",
        id: ticket.id,
        ticket,
        surface: surfaceOf(index + 1, count),
      });
    });
  }
  if (visible.loose.length > 0) {
    rows.push({ kind: "loose-head", id: "loose-head", count: visible.loose.length });
    for (const ticket of visible.loose) rows.push({ kind: "loose", id: ticket.id, ticket });
  }
  return rows;
}

export function flatRows(
  tickets: ReadonlyArray<TicketView>,
  grouping: TicketGrouping,
  filter: TicketFilter,
  query: string,
): TicketListRow[] {
  const groups = issueGroupsById(tickets, grouping);
  return tickets
    .filter((ticket) => matchesFilter(ticket, filter) && matchesSearch(ticket, query))
    .map((ticket) => ({
      kind: "flat",
      id: ticket.id,
      ticket,
      group: groups.get(ticket.id) ?? null,
    }));
}

export function listRows(input: {
  view: TicketListView;
  tickets: ReadonlyArray<TicketView>;
  grouping: TicketGrouping;
  filter: TicketFilter;
  query: string;
  overrides: ReadonlyMap<string, boolean>;
  selectedId: string | undefined;
}): TicketListRow[] {
  const { view, tickets, grouping, filter, query, overrides, selectedId } = input;
  if (view === "flat") return flatRows(tickets, grouping, filter, query);
  const narrowed = filter !== "all" || query.trim() !== "";
  return groupedRows(visibleGrouping(grouping, filter, query), overrides, narrowed, selectedId);
}

export function isSelectableRow(row: TicketListRow): boolean {
  return row.kind !== "loose-head";
}

export function withClosingGroupsOpen(
  overrides: ReadonlyMap<string, boolean>,
  phases: ReadonlyMap<string, IssueGroupPhase>,
): ReadonlyMap<string, boolean> {
  const closing = [...phases].filter(([, phase]) => phase === "closing");
  if (closing.length === 0) return overrides;
  const presented = new Map(overrides);
  for (const [id] of closing) presented.set(id, true);
  return presented;
}

export interface BlockRow {
  kind: TicketListRow["kind"];
  id: string;
  surface?: IssueRowSurface;
}

export function movingChildPhases(
  rows: ReadonlyArray<BlockRow>,
  phases: ReadonlyMap<string, IssueGroupPhase>,
): ReadonlyMap<string, IssueGroupPhase> {
  const moving = new Map<string, IssueGroupPhase>();
  if (phases.size === 0) return moving;
  let phase: IssueGroupPhase | undefined;
  for (const row of rows) {
    if (row.kind === "parent") phase = phases.get(row.id);
    else if (row.kind !== "child") phase = undefined;
    else if (phase !== undefined) moving.set(row.id, phase);
  }
  return moving;
}

export type TicketListSpace = { kind: "space"; key: string; height: number };
export type TicketBodyItem<R extends BlockRow = TicketListRow> =
  | TicketListSpace
  | { kind: "line"; row: R; index: number };
export type TicketListBlock<R extends BlockRow = TicketListRow> =
  | TicketListSpace
  | { kind: "row"; row: R }
  | {
      kind: "body";
      groupId: string;
      phase: IssueGroupPhase | undefined;
      childCount: number;
      items: TicketBodyItem<R>[];
    };

interface BlockWindow {
  start: number;
  end: number;
  offsets: ReadonlyArray<number>;
  collapsed: { start: number; end: number } | null;
}

function addSpace<R extends BlockRow>(
  list: Array<TicketListBlock<R>> | Array<TicketBodyItem<R>>,
  key: string,
  height: number,
): void {
  if (height <= 0) return;
  const last = list.at(-1);
  if (last?.kind === "space") last.height += height;
  else list.push({ kind: "space", key: `space-${key}`, height });
}

export function listBlocks<R extends BlockRow>(
  rows: ReadonlyArray<R>,
  window: BlockWindow,
  phases: ReadonlyMap<string, IssueGroupPhase>,
): TicketListBlock<R>[] {
  const { start, end, offsets, collapsed } = window;
  const inMain = (index: number) => index >= start && index < end;
  const inCollapsed = (index: number) =>
    collapsed !== null && index >= collapsed.start && index < collapsed.end;
  const heightOf = (index: number) => (offsets[index + 1] ?? 0) - (offsets[index] ?? 0);
  const blocks: TicketListBlock<R>[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (row === undefined) break;
    const shown = inMain(index) || inCollapsed(index);
    if (shown) blocks.push({ kind: "row", row });
    else addSpace(blocks, row.id, heightOf(index));
    index += 1;
    if (row.kind !== "parent") continue;
    let bodyEnd = index;
    while (rows[bodyEnd]?.kind === "child") bodyEnd += 1;
    if (bodyEnd === index) continue;
    const phase = phases.get(row.id);
    let anyShown = phase !== undefined && shown;
    for (let at = index; at < bodyEnd && !anyShown; at += 1) {
      anyShown = inMain(at) || (phase === undefined && inCollapsed(at));
    }
    if (!anyShown) {
      for (let at = index; at < bodyEnd; at += 1) {
        addSpace(blocks, rows[at]?.id ?? "", heightOf(at));
      }
      index = bodyEnd;
      continue;
    }
    const items: TicketBodyItem<R>[] = [];
    for (let at = index; at < bodyEnd; at += 1) {
      const child = rows[at];
      if (child === undefined) continue;
      if (inMain(at) || (phase === undefined && inCollapsed(at))) {
        const presented: R =
          phase !== undefined && child.kind === "child" && child.surface === "last"
            ? { ...child, surface: "middle" }
            : child;
        items.push({ kind: "line", row: presented, index: at - index });
      } else {
        addSpace(items, child.id, heightOf(at));
      }
    }
    blocks.push({
      kind: "body",
      groupId: row.id,
      phase,
      childCount: bodyEnd - index,
      items,
    });
    index = bodyEnd;
  }
  return blocks;
}
