import { isBlockerFinished } from "@ganger/core";
import { lastRun } from "./model.js";
import type { AssignRejectReason, TicketView } from "./model.js";

export const BULK_ASSIGN_LIMIT = 1000;

export type BulkChoiceKind =
  | "ready"
  | "waiting"
  | "failed"
  | "canceled"
  | "succeeded"
  | "done"
  | "no-mapping";

export interface BlockerWaitHint {
  key: string;
  rest: number;
}

export interface BulkChoice {
  ticket: TicketView;
  kind: BulkChoiceKind;
  selectable: boolean;
  initiallySelected: boolean;
  waitingOn: BlockerWaitHint | null;
}

export type BulkAssignFailure = AssignRejectReason | "failed";

export type BulkAssignItemResult =
  | { connection: string; ticketKey: string; ok: true; runId: string }
  | { connection: string; ticketKey: string; ok: false; reason: BulkAssignFailure };

export interface BulkAssignment {
  connection: string;
  ticketKey: string;
  ticketTitle: string;
  trackerProject: string;
  runnerProject: string;
  runnerId: null;
  agent: string;
}

export function blockerWaitHint(
  blockers: ReadonlyArray<{ key: string; stateCategory: string }>,
): BlockerWaitHint | null {
  const unfinished = blockers.filter((blocker) => !isBlockerFinished(blocker.stateCategory));
  const [first] = unfinished;
  if (first === undefined || unfinished.some((blocker) => blocker.stateCategory === "canceled"))
    return null;
  return { key: first.key, rest: unfinished.length - 1 };
}

function kindOf(ticket: TicketView, waitingOn: BlockerWaitHint | null): BulkChoiceKind | null {
  const run = lastRun(ticket);
  if (ticket.isParentIssue) return null;
  if (ticket.assignability.kind === "active-run") return null;
  if (run !== undefined && run.state !== "ended") return null;
  const { category } = ticket.trackerState;
  if (category === "completed" || category === "canceled") return "done";
  if (ticket.assignability.kind === "no-mapping") return "no-mapping";
  if (run !== undefined) return run.summary;
  return waitingOn === null ? "ready" : "waiting";
}

function isSelectable(kind: BulkChoiceKind): boolean {
  return kind === "ready" || kind === "waiting" || kind === "failed" || kind === "canceled";
}

export function bulkChoices(
  children: ReadonlyArray<TicketView>,
  waitHints: ReadonlyMap<string, BlockerWaitHint> = new Map(),
): BulkChoice[] {
  return children.flatMap((ticket): BulkChoice[] => {
    const hint = waitHints.get(ticket.id) ?? null;
    const kind = kindOf(ticket, hint);
    if (kind === null) return [];
    return [
      {
        ticket,
        kind,
        selectable: isSelectable(kind),
        initiallySelected: kind === "ready" || kind === "waiting",
        waitingOn: kind === "waiting" ? hint : null,
      },
    ];
  });
}

export function assignableChildCount(children: ReadonlyArray<TicketView>): number {
  return bulkChoices(children).filter((choice) => choice.selectable).length;
}

export function blockerReadTargets(children: ReadonlyArray<TicketView>): TicketView[] {
  return bulkChoices(children)
    .filter((choice) => choice.kind === "ready")
    .map((choice) => choice.ticket);
}

export function bulkAssignmentsFor(
  choices: ReadonlyArray<BulkChoice>,
  selectedIds: ReadonlySet<string>,
): BulkAssignment[] {
  return choices.flatMap((choice): BulkAssignment[] => {
    const { ticket } = choice;
    if (!choice.selectable || !selectedIds.has(ticket.id)) return [];
    if (ticket.assignability.kind !== "ready") return [];
    const { defaults } = ticket.assignability;
    return [
      {
        connection: ticket.connection,
        ticketKey: ticket.key,
        ticketTitle: ticket.title,
        trackerProject: ticket.trackerProject.id,
        runnerProject: defaults.runnerProject,
        runnerId: null,
        agent: defaults.agent,
      },
    ];
  });
}
