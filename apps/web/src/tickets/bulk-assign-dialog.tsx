import * as stylex from "@stylexjs/stylex";
import {
  Button,
  DependencyGraph,
  Dialog,
  DialogClose,
  Spinner,
  Text,
  VisuallyHidden,
  showToast,
} from "@ganger/ui";
import type { DependencyGraphNode } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { BulkAssignInput, BulkAssignResult } from "@ganger/app/tickets/assign";
import {
  blockerReadTargets,
  bulkAssignmentsFor,
  bulkChoices,
  selectedBulkIds,
} from "@ganger/app/tickets/bulk-assign";
import type { BlockerHint, BulkAssignItemResult } from "@ganger/app/tickets/bulk-assign";
import {
  blockerHintOfReading,
  buildBulkGraph,
  bulkGraphState,
} from "@ganger/app/tickets/bulk-assign-graph";
import type {
  BlockerReading,
  BulkGraph,
  BulkGraphTicket,
  BulkNodeNote,
} from "@ganger/app/tickets/bulk-assign-graph";
import type { TicketGroup } from "@ganger/app/tickets/groups";
import { ticketId } from "@ganger/app/tickets/merge";
import type { TicketBlockersResult, TicketView } from "@ganger/app/tickets/model";

const BLOCKER_READS_AT_ONCE = 4;

export interface BulkAssignDialogProps {
  group: TicketGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssignMany: (input: BulkAssignInput) => Promise<BulkAssignResult>;
  onReadBlockers: (ticket: TicketView) => Promise<TicketBlockersResult>;
  onAssigned: () => void;
  finalFocus: () => HTMLElement | null;
}

async function readBlockers(
  read: BulkAssignDialogProps["onReadBlockers"],
  ticket: TicketView,
): Promise<BlockerReading> {
  try {
    const result = await read(ticket);
    return result.ok ? { kind: "read", blockers: result.blockers } : { kind: "unread" };
  } catch {
    return { kind: "unread" };
  }
}

function useBlockerReadings(
  targets: ReadonlyArray<TicketView>,
  onReadBlockers: BulkAssignDialogProps["onReadBlockers"],
  open: boolean,
): { readings: ReadonlyMap<string, BlockerReading>; reading: boolean } {
  const [readings, setReadings] = useState<ReadonlyMap<string, BlockerReading>>(new Map());
  const requested = useRef(new Set<string>());
  const queue = useRef<TicketView[]>([]);
  const readers = useRef(0);
  const latestRead = useRef(onReadBlockers);
  const readsAllowed = useRef(false);
  useEffect(() => {
    readsAllowed.current = open;
    return () => {
      readsAllowed.current = false;
    };
  }, [open]);
  useEffect(() => {
    for (const ticket of targets) {
      if (requested.current.has(ticket.id)) continue;
      requested.current.add(ticket.id);
      queue.current.push(ticket);
    }
    const readNext = async (): Promise<void> => {
      try {
        while (readsAllowed.current) {
          const ticket = queue.current.shift();
          if (ticket === undefined) return;
          const result = await readBlockers(latestRead.current, ticket);
          if (!readsAllowed.current) return;
          setReadings((current) => new Map(current).set(ticket.id, result));
        }
      } finally {
        readers.current -= 1;
      }
    };
    while (readers.current < BLOCKER_READS_AT_ONCE && queue.current.length > 0) {
      readers.current += 1;
      void readNext();
    }
  }, [targets]);
  return { readings, reading: targets.some((ticket) => !readings.has(ticket.id)) };
}

function hintsOf(readings: ReadonlyMap<string, BlockerReading>): ReadonlyMap<string, BlockerHint> {
  const hints = new Map<string, BlockerHint>();
  for (const [id, result] of readings) {
    const hint = blockerHintOfReading(result);
    if (hint !== null) hints.set(id, hint);
  }
  return hints;
}

type Outcome = { kind: "results"; results: BulkAssignItemResult[] } | { kind: "failed" } | null;

export function BulkAssignDialog({
  group,
  open,
  onOpenChange,
  onAssignMany,
  onReadBlockers,
  onAssigned,
  finalFocus,
}: BulkAssignDialogProps) {
  const t = useTranslations("tickets.bulkAssign");
  const tResult = useTranslations("tickets.bulkAssign.result");
  const targets = useMemo(() => blockerReadTargets(group.children), [group.children]);
  const { readings, reading } = useBlockerReadings(targets, onReadBlockers, open);
  const choices = useMemo(
    () => bulkChoices(group.children, hintsOf(readings)),
    [group.children, readings],
  );
  const graph = useMemo(() => buildBulkGraph(choices, readings), [choices, readings]);
  const [assigned, setAssigned] = useState<ReadonlySet<string>>(new Set());
  const [firstSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        bulkChoices(group.children)
          .filter((choice) => choice.initiallySelected)
          .map((choice) => choice.ticket.id),
      ),
  );
  const [operatorChoices, setOperatorChoices] = useState<ReadonlyMap<string, boolean>>(new Map());
  const selected = selectedBulkIds(choices, firstSelected, operatorChoices);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const assignments = bulkAssignmentsFor(choices, selected);
  const count = assignments.length;

  const submit = () => {
    if (sending.current || reading || count === 0) return;
    sending.current = true;
    setPending(true);
    setOutcome(null);
    onAssignMany({ assignments }).then(
      ({ results }) => {
        sending.current = false;
        setPending(false);
        const succeeded = results.filter((result) => result.ok);
        if (succeeded.length > 0) onAssigned();
        setAssigned((current) => {
          const next = new Set(current);
          for (const result of succeeded) next.add(ticketId(result.connection, result.ticketKey));
          return next;
        });
        setOperatorChoices((current) => {
          const next = new Map(current);
          for (const result of succeeded)
            next.set(ticketId(result.connection, result.ticketKey), false);
          return next;
        });
        if (succeeded.length === results.length) {
          showToast(tResult("assigned", { count: succeeded.length }));
          onOpenChange(false);
          return;
        }
        setOutcome({ kind: "results", results });
      },
      () => {
        sending.current = false;
        setPending(false);
        setOutcome({ kind: "failed" });
      },
    );
  };

  return (
    <Dialog
      title={t("title")}
      description={t("description", { key: group.root.key, title: group.root.title })}
      open={open}
      scrollBody
      wide
      finalFocus={finalFocus}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
      {...(outcome === null ? {} : { status: <BulkAssignOutcome outcome={outcome} /> })}
      actions={
        <>
          <DialogClose>{t("close")}</DialogClose>
          <Button
            variant="primary"
            disabled={count === 0}
            busy={{
              active: pending || reading,
              label: pending ? t("submitting") : t("checkingBlockers"),
            }}
            onClick={submit}
          >
            {t("submit", { count })}
          </Button>
        </>
      }
    >
      {reading ? (
        <div role="status" {...stylex.props(styles.reading)}>
          <Spinner />
          <Text variant="ui" tone="muted">
            {t("checkingBlockers")}
          </Text>
        </div>
      ) : (
        <BulkAssignGraph
          graph={graph}
          selected={selected}
          assigned={assigned}
          disabled={pending}
          onToggle={(id, checked) => {
            setOperatorChoices((current) => new Map(current).set(id, checked));
          }}
        />
      )}
      <BulkAssignAnnouncement outcome={outcome} />
    </Dialog>
  );
}

export function BulkAssignGraph({
  graph,
  selected,
  assigned,
  disabled,
  onToggle,
}: {
  graph: BulkGraph;
  selected: ReadonlySet<string>;
  assigned: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const t = useTranslations("tickets.bulkAssign");
  const tHint = useTranslations("tickets.bulkAssign.hint");
  const tNote = useTranslations("tickets.bulkAssign.note");
  const state = bulkGraphState(graph, selected, assigned);
  const noteText = (note: BulkNodeNote): string => {
    switch (note.kind) {
      case "now":
        return tNote("now");
      case "after":
        return tNote("after", { key: note.key, rest: note.rest });
      case "held":
        return tNote("held", { key: note.key, rest: note.rest });
      case "cycle":
        return tNote("cycle", { key: note.key, rest: note.rest });
      case "blocker-canceled":
        return tHint("blocker-canceled", { key: note.key, rest: note.rest });
      case "blocker-unread":
        return tHint("blocker-unread");
    }
  };
  const descriptionOf = (ticket: BulkGraphTicket): string => {
    const note = noteText(state.noteOf(ticket));
    const { kind } = ticket.choice;
    if (kind !== "failed" && kind !== "canceled") return note;
    return tHint("runAndBlocker", { run: tHint(kind), blocker: note });
  };
  const columnLabel = (column: number): string => {
    if (column === 0) return t("columnNow");
    return column === 1 ? t("columnNext") : t("columnLater");
  };
  const nodes: DependencyGraphNode[] = [
    ...graph.outside.map((blocker): DependencyGraphNode => ({
      id: blocker.id,
      column: blocker.column,
      row: blocker.row,
      ticketKey:
        blocker.key === null
          ? t("outsideUnreadKey")
          : t("outsideKey", { key: blocker.key, state: blocker.stateName ?? "" }),
      title: blocker.title ?? t("outsideUnreadTitle"),
      tone: blocker.stuck ? "problem" : "default",
    })),
    ...graph.tickets.map((ticket): DependencyGraphNode => ({
      id: ticket.id,
      column: ticket.column,
      row: ticket.row,
      ticketKey: ticket.choice.ticket.key,
      title: ticket.choice.ticket.title,
      tone: state.blocked.has(ticket.id) ? "problem" : "default",
      check: {
        checked: selected.has(ticket.id),
        disabled,
        description: descriptionOf(ticket),
        onCheckedChange: (checked) => onToggle(ticket.id, checked),
      },
    })),
  ];
  return (
    <div {...stylex.props(styles.graph)}>
      {nodes.length === 0 ? null : (
        <DependencyGraph
          label={t("listLabel")}
          scrollLabel={t("scrollLabel")}
          columns={Array.from({ length: graph.columnCount }, (_, column) => ({
            number: column + 1,
            label: columnLabel(column),
          }))}
          nodes={nodes}
          edges={graph.links.map((link) => ({
            from: link.from,
            to: link.to,
            tone: state.toneOf(link),
          }))}
          {...(graph.dividerRow === null ? {} : { dividerRow: graph.dividerRow })}
        />
      )}
      {graph.cycles.map((keys) => (
        <Text key={keys.join(",")} variant="ui" tone="problem" as="p">
          {t("cycle", { keys: keys.join(", ") })}
        </Text>
      ))}
      <Text variant="meta" as="p">
        {t("legend")}
      </Text>
      {graph.unavailableCount === 0 ? null : (
        <Text variant="meta" as="p">
          {t("unavailable", { count: graph.unavailableCount })}
        </Text>
      )}
    </div>
  );
}

function useOutcomeLines(outcome: Outcome): string[] {
  const t = useTranslations("tickets.bulkAssign.result");
  const tError = useTranslations("tickets.assign.error");
  const lines: string[] = [];
  if (outcome?.kind === "failed") lines.push(tError("failed"));
  if (outcome?.kind === "results") {
    const assigned = outcome.results.filter((result) => result.ok).length;
    if (assigned > 0) lines.push(t("assigned", { count: assigned }));
    for (const result of outcome.results) {
      if (result.ok) continue;
      lines.push(
        t("failedTicket", {
          key: result.ticketKey,
          reason: result.reason === "failed" ? t("retry") : tError(result.reason),
        }),
      );
    }
  }
  return lines;
}

export function BulkAssignOutcome({ outcome }: { outcome: Outcome }) {
  const lines = useOutcomeLines(outcome);
  return (
    <div aria-hidden="true" {...stylex.props(styles.outcome)}>
      {lines.map((line) => (
        <Text key={line} variant="ui" as="p">
          {line}
        </Text>
      ))}
    </div>
  );
}

export function BulkAssignAnnouncement({ outcome }: { outcome: Outcome }) {
  const lines = useOutcomeLines(outcome);
  return (
    <VisuallyHidden>
      <span role="status">{lines.join(" ")}</span>
    </VisuallyHidden>
  );
}

const styles = stylex.create({
  outcome: { display: "flex", flexDirection: "column", gap: space.s1 },
  graph: { display: "flex", flexDirection: "column", gap: space.s3 },
  reading: { display: "flex", alignItems: "center", gap: space.s2, paddingBlock: space.s6 },
});
