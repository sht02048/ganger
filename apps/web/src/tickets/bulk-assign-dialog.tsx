import * as stylex from "@stylexjs/stylex";
import { Button, Checkbox, Dialog, DialogClose, Text, VisuallyHidden, showToast } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { BulkAssignInput, BulkAssignResult } from "@ganger/app/tickets/assign";
import {
  blockerReadTargets,
  blockerWaitHint,
  bulkAssignmentsFor,
  bulkChoices,
} from "@ganger/app/tickets/bulk-assign";
import type {
  BlockerWaitHint,
  BulkAssignItemResult,
  BulkChoice,
} from "@ganger/app/tickets/bulk-assign";
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

function useBlockerHints(
  targets: ReadonlyArray<TicketView>,
  onReadBlockers: BulkAssignDialogProps["onReadBlockers"],
  open: boolean,
): ReadonlyMap<string, BlockerWaitHint> {
  const [hints, setHints] = useState<ReadonlyMap<string, BlockerWaitHint>>(new Map());
  const firstTargets = useRef(targets);
  const readBlockers = useRef(onReadBlockers);
  const dialogOpen = useRef(open);
  useEffect(() => {
    dialogOpen.current = open;
  }, [open]);
  useEffect(() => {
    let stopped = false;
    const queue = [...firstTargets.current];
    const readNext = async (): Promise<void> => {
      for (let ticket = queue.shift(); ticket !== undefined; ticket = queue.shift()) {
        const id = ticket.id;
        const result = await readBlockers.current(ticket).catch(() => null);
        if (stopped || !dialogOpen.current) return;
        if (result === null || !result.ok) continue;
        const hint = blockerWaitHint(result.blockers);
        if (hint !== null) setHints((current) => new Map(current).set(id, hint));
      }
    };
    for (let reader = 0; reader < BLOCKER_READS_AT_ONCE; reader += 1) void readNext();
    return () => {
      stopped = true;
    };
  }, []);
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
  const hints = useBlockerHints(targets, onReadBlockers, open);
  const choices = useMemo(() => bulkChoices(group.children, hints), [group.children, hints]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        bulkChoices(group.children)
          .filter((choice) => choice.initiallySelected)
          .map((choice) => choice.ticket.id),
      ),
  );
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const assignments = bulkAssignmentsFor(choices, selected);
  const count = assignments.length;

  const submit = () => {
    if (sending.current || count === 0) return;
    sending.current = true;
    setPending(true);
    setOutcome(null);
    onAssignMany({ assignments }).then(
      ({ results }) => {
        sending.current = false;
        setPending(false);
        const succeeded = results.filter((result) => result.ok);
        if (succeeded.length > 0) onAssigned();
        setSelected((current) => {
          const next = new Set(current);
          for (const result of succeeded)
            next.delete(ticketId(result.connection, result.ticketKey));
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
            busy={{ active: pending, label: t("submitting") }}
            onClick={submit}
          >
            {t("submit", { count })}
          </Button>
        </>
      }
    >
      <BulkChoiceList
        choices={choices}
        selected={selected}
        disabled={pending}
        onToggle={(id, checked) => {
          setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
          });
        }}
      />
      <BulkAssignAnnouncement outcome={outcome} />
    </Dialog>
  );
}

export function BulkChoiceList({
  choices,
  selected,
  disabled,
  onToggle,
}: {
  choices: ReadonlyArray<BulkChoice>;
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const t = useTranslations("tickets.bulkAssign");
  const tHint = useTranslations("tickets.bulkAssign.hint");
  const hintOf = (choice: BulkChoice): string | null => {
    switch (choice.kind) {
      case "ready":
        return null;
      case "waiting":
        return choice.waitingOn === null
          ? null
          : tHint("waiting", { key: choice.waitingOn.key, rest: choice.waitingOn.rest });
      case "failed":
      case "canceled":
      case "succeeded":
      case "done":
      case "no-mapping":
        return tHint(choice.kind);
    }
  };
  return (
    <div role="group" aria-label={t("listLabel")} {...stylex.props(styles.list)}>
      {choices.map((choice) => {
        const hint = hintOf(choice);
        return (
          <Checkbox
            key={choice.ticket.id}
            label={`${choice.ticket.key} ${choice.ticket.title}`}
            checked={choice.selectable && selected.has(choice.ticket.id)}
            disabled={disabled || !choice.selectable}
            onCheckedChange={(checked) => onToggle(choice.ticket.id, checked)}
            {...(hint === null ? {} : { description: hint })}
          />
        );
      })}
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
  list: { display: "flex", flexDirection: "column", gap: space.px2 },
  outcome: { display: "flex", flexDirection: "column", gap: space.s1 },
});
