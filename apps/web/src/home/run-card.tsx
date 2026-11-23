import {
  Button,
  KanbanCard,
  Menu,
  MenuItem,
  MoreIcon,
  PrChip,
  PrChipMore,
  StatusPill,
  Text,
} from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import type { RunControl, RunId } from "@ganger/core";
import { useId, useState } from "react";
import type { ReactNode, Ref } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { HomeRun, PrProblem } from "@ganger/app/home/model";
import { PR_CHIPS_VISIBLE, prProblemsOf, todoTagOf } from "@ganger/app/home/model";
import type { PrSignalsView } from "@ganger/app/pr-signals-view";
import { availableRunControl } from "@ganger/app/run-control-view";
import type { RunControlView } from "@ganger/app/run-control-view";
import { questionSummary } from "@ganger/app/question";
import { allBlockersOf, blockerReasonOf } from "@ganger/app/runs/model";
import type { BlockerReason } from "@ganger/app/runs/model";
import { BlockerChipList } from "../blockers";
import { useRunText } from "./run-text";

export type SheetMode = "summary" | "answer";

interface CardParts {
  detail?: ReactNode;
  detailTone?: "problem";
  blockers?: ReactNode;
  stuck?: boolean;
  meta?: ReactNode;
  metaTone?: "problem";
  time?: ReactNode;
  action?: ReactNode;
  actionFullWidth?: boolean;
  menu?: ReactNode;
}

export function cardTag(run: HomeRun, tagged: boolean): PillStatus | null {
  return (tagged ? todoTagOf(run) : null) ?? (run.state === "paused" ? "paused" : null);
}

export function RunCard({
  run,
  tagged,
  all,
  selected,
  lastTags,
  openRef,
  onOpen,
  onControl,
}: {
  run: HomeRun;
  tagged: boolean;
  all: boolean;
  selected: boolean;
  lastTags: ReadonlyMap<RunId, PillStatus | null>;
  openRef: Ref<HTMLButtonElement>;
  onOpen: (mode: SheetMode) => void;
  onControl: (control: RunControl) => Promise<boolean>;
}) {
  const todoTag = tagged ? todoTagOf(run) : null;
  const tag = cardTag(run, tagged);
  const [popNewPill, setPopNewPill] = useState(
    () => lastTags.has(run.id) && lastTags.get(run.id) !== tag,
  );
  if (tag === null && !popNewPill) setPopNewPill(true);
  const titleId = useId();
  const [sending, setSending] = useState(false);
  const [rejected, setRejected] = useState(false);
  const control = (kind: RunControl): void => {
    if (sending) return;
    setSending(true);
    setRejected(false);
    void onControl(kind)
      .then((reached) => setRejected(!reached))
      .finally(() => setSending(false));
  };
  const parts = useCardParts(run, todoTag !== null, all, titleId, onOpen, {
    onControl: control,
    sending,
    rejected,
  });
  const statusName = useRunText().statusName;
  const prChips = usePrChips(run.pullRequest?.signals ?? null);
  return (
    <KanbanCard
      {...(tag === null
        ? {}
        : {
            tag: (
              <StatusPill status={tag} changeMotion popOnMount={popNewPill}>
                {statusName(tag)}
              </StatusPill>
            ),
          })}
      ticketKey={run.ticketKey}
      title={
        run.ticketTitle === null ? null : (
          <Text variant="title" as="span">
            {run.ticketTitle}
          </Text>
        )
      }
      titleId={titleId}
      {...parts}
      {...(prChips === null ? {} : { prChips })}
      selected={selected}
      openRef={openRef}
      onOpen={() => onOpen("summary")}
    />
  );
}

function usePrChips(signals: PrSignalsView | null): ReactNode {
  const t = useTranslations("home.card.prChip");
  const problems = prProblemsOf(signals);
  if (problems.length === 0) return null;
  const label = (problem: PrProblem): string => {
    switch (problem.kind) {
      case "ci-failed":
        return t("ciFailed");
      case "conflict":
        return t("conflict");
      case "behind":
        return t("behind", { count: problem.commits });
    }
  };
  const rest = problems.slice(PR_CHIPS_VISIBLE);
  return (
    <>
      {problems.slice(0, PR_CHIPS_VISIBLE).map((problem) => (
        <PrChip key={problem.kind} kind={problem.kind}>
          {label(problem)}
        </PrChip>
      ))}
      {rest.length === 0 ? null : (
        <PrChipMore hiddenLabel={rest.map(label).join(", ")}>
          {t("more", { count: rest.length })}
        </PrChipMore>
      )}
    </>
  );
}

function useCardParts(
  run: HomeRun,
  tagged: boolean,
  all: boolean,
  titleId: string,
  onOpen: (mode: SheetMode) => void,
  {
    onControl,
    sending,
    rejected,
  }: { onControl: (control: RunControl) => void; sending: boolean; rejected: boolean },
): CardParts {
  const t = useTranslations("home.card");
  const tDomain = useTranslations("domain");
  const text = useRunText();
  const { ago, elapsed } = useTime();
  const controlFlag = controlPendingKey(run.control);
  const withFlags = (line: string) =>
    [line, run.cancelling ? t("cancelling") : null, controlFlag === null ? null : t(controlFlag)]
      .filter((part) => part !== null)
      .join(" · ");
  const runner = withFlags(text.runnerLine(run, all));
  const available = availableRunControl(run.state, run.cancelling, run.control);
  const failed = rejected
    ? { detail: t("requestFailed"), detailTone: "problem" as const }
    : run.control?.status === "failed"
      ? {
          detail: t(run.control.control === "pause" ? "pauseFailed" : "resumeFailed", {
            reason: tDomain(`runControlFailure.${run.control.reason}`),
          }),
          detailTone: "problem" as const,
        }
      : {};
  switch (run.state) {
    case "queued": {
      const waiting = blockerReasonOf(run.queuedReason);
      if (waiting === null)
        return { detail: text.queued(run), meta: runner, time: elapsed(run.waitMs) };
      const stuck = waiting.kind === "blockers-stuck";
      const blockers = allBlockersOf(waiting);
      const keylessLine = keylessBlockerLine(waiting);
      return {
        ...(blockers.length === 0
          ? {}
          : {
              blockers: <BlockerChipList blockers={blockers} cycleKey={cycleBlockerKey(waiting)} />,
            }),
        stuck,
        meta: [
          run.cancelling ? t("cancelling") : null,
          keylessLine === null ? text.queued(run) : t(`blockerLine.${keylessLine}`),
          all ? run.workspace.name : null,
        ]
          .filter((part) => part !== null)
          .join(" · "),
        ...(stuck ? { metaTone: "problem" as const } : {}),
        time: elapsed(run.waitMs),
      };
    }
    case "running":
      return {
        ...failed,
        meta: runner,
        ...(run.executionMs === null ? {} : { time: elapsed(run.executionMs) }),
        ...(available === "pause"
          ? {
              menu: (
                <Menu
                  variant="icon"
                  label={t("menu", { key: run.ticketKey })}
                  trigger={<MoreIcon />}
                >
                  <MenuItem value="pause" onSelect={() => onControl("pause")}>
                    {t("pause")}
                  </MenuItem>
                </Menu>
              ),
            }
          : {}),
      };
    case "paused":
      return {
        detail: tDomain(`pauseSource.${run.pauseSource}`),
        ...failed,
        meta: runner,
        ...(run.pausedMs === null
          ? {}
          : { time: t("pausedFor", { elapsed: elapsed(run.pausedMs) }) }),
        ...(available === "resume"
          ? {
              action: (
                <Button
                  variant="secondary"
                  aria-describedby={titleId}
                  aria-disabled={sending}
                  aria-busy={sending}
                  onClick={() => onControl("resume")}
                >
                  {t("resume")}
                </Button>
              ),
            }
          : {}),
      };
    case "waiting-for-input": {
      const time = run.waitingMs === null ? {} : { time: elapsed(run.waitingMs) };
      const input = run.input;
      if (input === null) return { detail: t("inputUnknown"), meta: runner, ...time };
      switch (input.kind) {
        case "question":
          return input.answered
            ? { detail: questionSummary(input.body, input.choices), meta: t("answered"), ...time }
            : {
                detail: questionSummary(input.body, input.choices),
                meta: runner,
                ...time,
                action: (
                  <Button
                    variant="secondary"
                    aria-describedby={titleId}
                    onClick={() => onOpen("answer")}
                  >
                    {t("answer")}
                  </Button>
                ),
              };
        case "human-check":
          return input.answered
            ? { detail: firstLineOf(input.body), meta: t("answered"), ...time }
            : {
                meta: runner,
                ...time,
                actionFullWidth: true,
                action: (
                  <Button
                    variant="check"
                    block
                    aria-describedby={titleId}
                    onClick={() => onOpen("answer")}
                  >
                    {t("check")}
                  </Button>
                ),
              };
        case "permission":
          return {
            detail: t("permission", { command: input.detail }),
            meta: input.denied ? t("denied") : runner,
            ...time,
          };
      }
      return {};
    }
    case "disconnected":
      return { detail: text.unreachable(run), meta: withFlags(text.agentName(run.agent)) };
    case "ended": {
      const time = ago(run.endedAt, run.endedAgoMs);
      const pr = run.pullRequest;
      const prUnread = run.prReadError === null ? null : t("prUnread");
      const prLine = prUnread ?? (pr === null ? null : t("pullRequest", { pr: pr.displayId }));
      if (tagged && run.summary === "failed")
        return {
          detail: text.agentResult(run),
          meta: prUnread === null ? runner : `${runner} · ${prUnread}`,
          time,
        };
      return {
        meta: [text.statusName(run.summary), prLine, all ? run.workspace.name : null]
          .filter((part) => part !== null)
          .join(" · "),
        time,
      };
    }
  }
}

function keylessBlockerLine(
  reason: BlockerReason,
): "waiting" | "canceled" | "unreadable" | "cycle" | null {
  if (reason.blockers.length === 0) return null;
  return reason.kind === "blockers-waiting" ? "waiting" : reason.cause;
}

function cycleBlockerKey(reason: BlockerReason): string | null {
  return reason.kind === "blockers-stuck" && reason.cause === "cycle"
    ? (reason.blocker?.key ?? null)
    : null;
}

function firstLineOf(body: string): string {
  return body.split("\n", 1)[0] ?? "";
}

function controlPendingKey(control: RunControlView | null): "pausing" | "resuming" | null {
  if (control?.status !== "pending") return null;
  return control.control === "pause" ? "pausing" : "resuming";
}
