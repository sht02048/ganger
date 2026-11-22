import { isBlockerFinished } from "@ganger/core";
import { lastRun } from "./model.js";
import type { AssignRejectReason, TicketView } from "./model.js";

export const BULK_ASSIGN_LIMIT = 1000;

export type BulkChoiceKind =
  | "ready"
  | "waiting"
  | "blocker-canceled"
  | "blocker-unread"
  | "failed"
  | "canceled"
  | "succeeded"
  | "done"
  | "no-mapping";

export interface BlockerWaitHint {
  state: "waiting" | "canceled";
  key: string;
  rest: number;
}

export const BLOCKER_UNREAD = { state: "unread" } as const;

export type BlockerHint = BlockerWaitHint | typeof BLOCKER_UNREAD;

export interface BulkChoice {
  ticket: TicketView;
  kind: BulkChoiceKind;
  selectable: boolean;
  initiallySelected: boolean;
  waitingOn: BlockerHint | null;
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
  const canceled = unfinished.filter((blocker) => blocker.stateCategory === "canceled");
  const [firstCanceled] = canceled;
  if (firstCanceled !== undefined)
    return { state: "canceled", key: firstCanceled.key, rest: canceled.length - 1 };
  const [first] = unfinished;
  if (first === undefined) return null;
  return { state: "waiting", key: first.key, rest: unfinished.length - 1 };
}

function kindOf(ticket: TicketView, waitingOn: BlockerHint | null): BulkChoiceKind | null {
  const run = lastRun(ticket);
  if (ticket.isParentIssue) return null;
  if (ticket.assignability.kind === "active-run") return null;
  if (run !== undefined && run.state !== "ended") return null;
  const { category } = ticket.trackerState;
  if (category === "completed" || category === "canceled") return "done";
  if (ticket.assignability.kind === "no-mapping") return "no-mapping";
  if (run !== undefined) return run.summary;
  if (waitingOn === null) return "ready";
  switch (waitingOn.state) {
    case "waiting":
      return "waiting";
    case "canceled":
      return "blocker-canceled";
    case "unread":
      return "blocker-unread";
  }
}

function isSelectable(kind: BulkChoiceKind): boolean {
  return (
    kind === "ready" ||
    kind === "waiting" ||
    kind === "blocker-canceled" ||
    kind === "blocker-unread" ||
    kind === "failed" ||
    kind === "canceled"
  );
}

export function bulkChoices(
  children: ReadonlyArray<TicketView>,
  waitHints: ReadonlyMap<string, BlockerHint> = new Map(),
): BulkChoice[] {
  return children.flatMap((ticket): BulkChoice[] => {
    const hint = waitHints.get(ticket.id) ?? null;
    const kind = kindOf(ticket, hint);
    if (kind === null) return [];
    const selectable = isSelectable(kind);
    return [
      {
        ticket,
        kind,
        selectable,
        initiallySelected: kind === "ready" || kind === "waiting",
        waitingOn: selectable ? hint : null,
      },
    ];
  });
}

export function selectedBulkIds(
  choices: ReadonlyArray<BulkChoice>,
  firstSelected: ReadonlySet<string>,
  operatorChoices: ReadonlyMap<string, boolean>,
): ReadonlySet<string> {
  return new Set(
    choices
      .filter(
        ({ ticket, initiallySelected }) =>
          operatorChoices.get(ticket.id) ?? (firstSelected.has(ticket.id) && initiallySelected),
      )
      .map((choice) => choice.ticket.id),
  );
}

export function assignableChildCount(children: ReadonlyArray<TicketView>): number {
  return bulkChoices(children).filter((choice) => choice.selectable).length;
}

export function blockerReadTargets(children: ReadonlyArray<TicketView>): TicketView[] {
  return bulkChoices(children)
    .filter((choice) => choice.selectable)
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
