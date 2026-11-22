import { ticketId } from "./merge.js";
import { isTodo, lastRun, matchesFilter, matchesSearch } from "./model.js";
import type { TicketFilter, TicketIssueRef, TicketView } from "./model.js";

export const TICKET_VIEWS = ["grouped", "flat"] as const;
export type TicketListView = (typeof TICKET_VIEWS)[number];

export type TicketStage = "attention" | "assignable" | "in-progress" | "finished";

const STAGE_ORDER: ReadonlyArray<TicketStage> = [
  "attention",
  "assignable",
  "in-progress",
  "finished",
];

export interface TicketProgress {
  done: number;
  inProgress: number;
  remaining: number;
  total: number;
}

export interface TicketGroup {
  id: string;
  connection: string;
  root: TicketIssueRef;
  rootTicket: TicketView | null;
  children: ReadonlyArray<TicketView>;
  progress: TicketProgress;
  stage: TicketStage;
  expandedByDefault: boolean;
}

export interface TicketGrouping {
  groups: ReadonlyArray<TicketGroup>;
  loose: ReadonlyArray<TicketView>;
}

export interface VisibleTicketGroup {
  group: TicketGroup;
  children: ReadonlyArray<TicketView>;
}

export interface VisibleTicketGrouping {
  groups: ReadonlyArray<VisibleTicketGroup>;
  loose: ReadonlyArray<TicketView>;
}

function isFinishedInTracker(ticket: TicketView): boolean {
  const { category } = ticket.trackerState;
  return category === "completed" || category === "canceled";
}

export function ticketStage(ticket: TicketView): TicketStage {
  if (isFinishedInTracker(ticket)) return "finished";
  const run = lastRun(ticket);
  if (run !== undefined && isTodo(run)) return "attention";
  if (ticket.assignability.kind === "ready" && matchesFilter(ticket, "assignable"))
    return "assignable";
  return "in-progress";
}

function stageRank(stage: TicketStage): number {
  return STAGE_ORDER.indexOf(stage);
}

function byStage<T>(items: ReadonlyArray<T>, stageOf: (item: T) => TicketStage): T[] {
  return items.toSorted((a, b) => stageRank(stageOf(a)) - stageRank(stageOf(b)));
}

export function progressOf(children: ReadonlyArray<TicketView>): TicketProgress {
  const progress: TicketProgress = { done: 0, inProgress: 0, remaining: 0, total: 0 };
  for (const child of children) {
    const { category } = child.trackerState;
    if (category === "canceled") continue;
    progress.total += 1;
    if (category === "completed") progress.done += 1;
    else if (category === "started") progress.inProgress += 1;
    else progress.remaining += 1;
  }
  return progress;
}

function topIssueOf(
  ticket: TicketView,
  loaded: ReadonlyMap<string, TicketView>,
): { id: string; ref: TicketIssueRef } | null {
  let top = ticket.ancestors.at(-1);
  if (top === undefined) return null;
  const seen = new Set([ticketId(ticket.connection, ticket.key)]);
  for (;;) {
    const id = ticketId(ticket.connection, top.key);
    const above = seen.has(id) ? undefined : loaded.get(id)?.ancestors.at(-1);
    seen.add(id);
    if (above === undefined) return { id, ref: top };
    top = above;
  }
}

function refOf(ticket: TicketView): TicketIssueRef {
  return { key: ticket.key, title: ticket.title, url: ticket.url, state: ticket.trackerState };
}

interface GroupDraft {
  id: string;
  connection: string;
  root: TicketIssueRef;
  rootTicket: TicketView | null;
  children: TicketView[];
}

export function groupTickets(tickets: ReadonlyArray<TicketView>): TicketGrouping {
  const loaded = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const tops = new Map(tickets.map((ticket) => [ticket.id, topIssueOf(ticket, loaded)]));
  const parentIds = new Set(
    tickets.flatMap((ticket) => {
      const top = tops.get(ticket.id);
      return top === null || top === undefined || top.id === ticket.id ? [] : [top.id];
    }),
  );
  const drafts = new Map<string, GroupDraft>();
  const loose: TicketView[] = [];
  for (const ticket of tickets) {
    const topId = tops.get(ticket.id)?.id ?? ticket.id;
    if (!parentIds.has(topId)) {
      loose.push(ticket);
      continue;
    }
    let draft = drafts.get(topId);
    if (draft === undefined) {
      const rootTicket = loaded.get(topId) ?? null;
      const fallback = tops.get(ticket.id)?.ref;
      draft = {
        id: topId,
        connection: ticket.connection,
        root: rootTicket === null ? (fallback ?? refOf(ticket)) : refOf(rootTicket),
        rootTicket,
        children: [],
      };
      drafts.set(topId, draft);
    }
    if (topId !== ticket.id) draft.children.push(ticket);
  }
  const groups = [...drafts.values()].map((draft): TicketGroup => {
    const children = byStage(draft.children, ticketStage);
    const stage = children.reduce<TicketStage>((best, child) => {
      const next = ticketStage(child);
      return stageRank(next) < stageRank(best) ? next : best;
    }, "finished");
    return {
      ...draft,
      children,
      progress: progressOf(children),
      stage,
      expandedByDefault: stage !== "finished",
    };
  });
  return { groups: byStage(groups, (group) => group.stage), loose: byStage(loose, ticketStage) };
}

export function visibleGrouping(
  grouping: TicketGrouping,
  filter: TicketFilter,
  query: string,
): VisibleTicketGrouping {
  const groups: VisibleTicketGroup[] = [];
  for (const group of grouping.groups) {
    const rootMatches = matchesSearch(group.root, query);
    const children = group.children.filter(
      (child) => matchesFilter(child, filter) && (rootMatches || matchesSearch(child, query)),
    );
    const rootItselfMatches =
      rootMatches && group.rootTicket !== null && matchesFilter(group.rootTicket, filter);
    if (children.length > 0 || rootItselfMatches) groups.push({ group, children });
  }
  return {
    groups,
    loose: grouping.loose.filter(
      (ticket) => matchesFilter(ticket, filter) && matchesSearch(ticket, query),
    ),
  };
}
