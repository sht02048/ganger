import type { IssueRowSurface, IssueStateKind } from "@ganger/ui";
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
  if (ticket.assignability.kind !== "ready" || category === "completed" || category === "canceled")
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
