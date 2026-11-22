import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Card,
  DefinitionItem,
  DefinitionList,
  ExternalIcon,
  PanelSection,
  Sheet,
  SignalList,
  SignalRow,
  StatusPill,
  Text,
  TextLink,
  buttonStyles,
} from "@ganger/ui";
import type { SignalTone } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useRef } from "react";
import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";
import type { BoardRun } from "@ganger/app/runs/board";
import { currentPrState } from "@ganger/app/runs/model";
import type { RunView } from "@ganger/app/runs/model";
import { useTime } from "../format/time";
import { useAgentName, useQueuedReasonText } from "../labels";
import { nextStepAction, useRunNextStepText } from "../run-next-step";
import { runStatus, useStatusName } from "../status";

type RunPullRequest = NonNullable<RunView["pullRequest"]>;
type PanelPrState = "open" | "merged" | "closed" | "unknown";

export function RunSheet({
  run,
  returnFocus,
  detailHref,
  onOpenDetail,
  onClose,
}: {
  run: BoardRun | null;
  returnFocus: () => HTMLElement | null;
  detailHref: string;
  onOpenDetail: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("runs.panel");
  const statusName = useStatusName();
  const last = useRef<{ run: BoardRun; detailHref: string } | null>(null);
  if (run !== null) last.current = { run, detailHref };
  const shown = last.current;
  if (shown === null) return null;
  const status = runStatus(shown.run);
  return (
    <Sheet
      open={run !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      status={<StatusPill status={status}>{statusName(status)}</StatusPill>}
      title={shown.run.ticketTitle ?? shown.run.ticketKey}
      subtitle={t("where", { key: shown.run.ticketKey, project: shown.run.trackerProject })}
      closeLabel={t("close")}
      finalFocus={returnFocus}
    >
      <RunPanelBody run={shown.run} detailHref={shown.detailHref} onOpenDetail={onOpenDetail} />
    </Sheet>
  );
}

export function RunPanelBody({
  run,
  detailHref,
  onOpenDetail,
}: {
  run: BoardRun;
  detailHref: string;
  onOpenDetail: () => void;
}) {
  const agentName = useAgentName();
  const t = useTranslations("runs.panel");
  const domain = useTranslations("domain");
  const when = useRunWhen(run);
  const reason = useRunReason(run);
  const pr = run.pullRequest;
  const cancelling = run.state !== "ended" && run.cancelling;
  const nextStepText = useRunNextStepText()(run.nextStep);
  const stepAction = nextStepAction(run.nextStep);
  const stepHref =
    run.nextStep === "pr-ci-failed" && pr !== null
      ? prChecksUrl(pr.url)
      : run.nextStep === "pr-conflict" && pr !== null
        ? pr.url
        : detailHref;
  const opensHost = run.nextStep === "pr-ci-failed" || run.nextStep === "pr-conflict";
  const canContinue = run.canContinue && (opensHost || run.nextStep === "failed");
  const openDetailInApp = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    onOpenDetail();
  };

  return (
    <div {...stylex.props(styles.body)}>
      {cancelling || when !== "" ? (
        <Text variant="meta" numeric>
          {cancelling ? `${t("cancelling")} ` : null}
          {when}
        </Text>
      ) : null}
      {nextStepText === null ? (
        <Text variant="body">{reason}</Text>
      ) : (
        <Card padding="compact" surface="inset" label={t("todoTitle")}>
          <div data-next-step={nextStepText.kind} {...stylex.props(styles.todo)}>
            <Text variant="title">{t("todoTitle")}</Text>
            <Text variant="body">{nextStepText.body}</Text>
            {stepAction === null && !canContinue ? null : (
              <Actions>
                {nextStepText.action === null ? null : (
                  <a
                    href={stepHref}
                    {...(opensHost
                      ? { target: "_blank", rel: "noreferrer" }
                      : { onClick: openDetailInApp })}
                    data-variant="secondary"
                    {...stylex.props(...buttonStyles("secondary"))}
                  >
                    {stepAction === null ||
                    stepAction === "pr-ci-failed" ||
                    stepAction === "pr-conflict"
                      ? nextStepText.action
                      : t(`inDetail.${stepAction}`)}
                    {opensHost ? <ExternalIcon /> : null}
                  </a>
                )}
                {canContinue ? (
                  <a
                    href={detailHref}
                    onClick={openDetailInApp}
                    data-variant="secondary"
                    {...stylex.props(...buttonStyles("secondary"))}
                  >
                    {t("continue")}
                  </a>
                ) : null}
              </Actions>
            )}
          </div>
        </Card>
      )}
      <PrSection run={run} />
      <PanelSection title={t("runInfo")}>
        <DefinitionList>
          <DefinitionItem label={t("agent")}>{agentName(run.agent)}</DefinitionItem>
          {run.state === "ended" ? (
            <DefinitionItem label={t("agentResult")}>
              {domain(`agentResult.${run.agentResult}`)}
            </DefinitionItem>
          ) : null}
        </DefinitionList>
      </PanelSection>
      <Actions>
        <a
          href={detailHref}
          data-variant="primary"
          onClick={openDetailInApp}
          {...stylex.props(...buttonStyles("primary"))}
        >
          {t("openDetail")}
        </a>
        {pr === null ? null : (
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            data-variant="secondary"
            {...stylex.props(...buttonStyles("secondary"))}
          >
            {t("openPr", { pr: pr.displayId })}
            <ExternalIcon />
          </a>
        )}
      </Actions>
    </div>
  );
}

function useRunWhen(run: RunView): string {
  const t = useTranslations("runs.panel");
  const { ago, duration, elapsed } = useTime();
  switch (run.state) {
    case "queued":
      return t("waitingFor", { duration: duration(run.waitMs) });
    case "running":
    case "waiting-for-input":
    case "disconnected":
      return elapsed(run.executionMs ?? 0);
    case "paused":
      return run.pausedMs === null ? "" : t("pausedFor", { duration: duration(run.pausedMs) });
    case "ended":
      return t("endedAgo", {
        ago: ago(run.endedAt, run.endedAgoMs),
        duration: duration(run.executionMs ?? 0),
      });
  }
}

function useRunReason(run: BoardRun): string {
  const t = useTranslations("runs.panel");
  const queuedReasonText = useQueuedReasonText();
  if (run.state !== "ended" && run.cancelling) return t("cancellingReason");
  switch (run.state) {
    case "queued":
      return queuedReasonText(run.queuedReason);
    case "waiting-for-input":
      if (run.handledInput === "answered") return t("reason.answerSent");
      if (run.handledInput === "denied") return t("reason.permissionDenied");
      return t("reason.waiting-for-input");
    case "running":
      return t("reason.running");
    case "disconnected":
      return t(run.paused ? "reason.disconnectedPaused" : "reason.disconnected");
    case "paused":
      return t("reason.paused");
    case "ended": {
      const reason = t(`reason.${run.summary}`);
      const openWithFailedCi =
        currentPrState(run) === "open" && run.pullRequest?.signals?.ciFailed === true;
      return openWithFailedCi ? t("reasonWithCiFailed", { reason }) : reason;
    }
  }
}

function isCiFailed(pr: RunPullRequest): boolean {
  return pr.signals === null ? pr.ci === "failure" : pr.signals.ciFailed;
}

function panelPrState(run: RunView): PanelPrState | null {
  if (run.state !== "ended") return run.pullRequest?.signals == null ? null : "open";
  const state = currentPrState(run);
  return state === "none" ? null : state;
}

function PrSection({ run }: { run: RunView }) {
  const t = useTranslations("runs.panel");
  const s = useTranslations("runs.panel.prSection");
  const { ago } = useTime();
  const pr = run.pullRequest;
  const state = panelPrState(run);
  const unreadText =
    run.state === "ended" && state === "unknown"
      ? t(`prUnread.${run.prReadError ?? "other"}`)
      : null;

  return (
    <PanelSection
      title={pr === null ? s("title") : s("titleWithId", { pr: pr.displayId })}
      {...(state === null || (pr === null && state !== "unknown")
        ? {}
        : { detail: s(`state.${state}`) })}
      {...(pr === null ? {} : { meta: s("readAt", { time: ago(pr.checkedAt, pr.checkedAgoMs) }) })}
    >
      {unreadText !== null ? (
        <Text variant="ui" as="p">
          {unreadText}
        </Text>
      ) : pr === null ? (
        <Text variant="meta" as="p">
          {s("none")}
        </Text>
      ) : (
        <PrSignals
          pr={pr}
          showMergeRows={state !== "merged" && state !== "closed" && pr.closedOnHost === false}
        />
      )}
    </PanelSection>
  );
}

function PrSignals({ pr, showMergeRows }: { pr: RunPullRequest; showMergeRows: boolean }) {
  const s = useTranslations("runs.panel.prSection");
  const conflict = pr.signals?.conflict ?? null;
  const behindBy = pr.signals?.behindBy ?? null;
  const ciFailed = isCiFailed(pr);
  return (
    <SignalList>
      <SignalRow
        label={s("ci")}
        tone={ciTone(pr, ciFailed)}
        {...(ciFailed
          ? {
              action: (
                <TextLink href={prChecksUrl(pr.url)} external>
                  {s("failedChecks")}
                </TextLink>
              ),
            }
          : {})}
      >
        {useCiText(pr, ciFailed)}
      </SignalRow>
      {!showMergeRows ? null : (
        <>
          <SignalRow label={s("conflict")} tone={conflictTone(conflict)}>
            {s(
              conflict === null
                ? "conflictValue.unknown"
                : conflict
                  ? "conflictValue.some"
                  : "conflictValue.none",
            )}
          </SignalRow>
          <SignalRow label={s("base")} tone={baseTone(behindBy)}>
            {behindBy === null
              ? s("baseValue.unknown")
              : behindBy > 0
                ? s("baseValue.behind", { count: behindBy })
                : s("baseValue.upToDate")}
          </SignalRow>
        </>
      )}
    </SignalList>
  );
}

function useCiText(pr: RunPullRequest, ciFailed: boolean): string {
  const s = useTranslations("runs.panel.prSection.ciValue");
  if (!ciFailed) return s(pr.ci);
  const total = pr.signals?.checkTotal ?? null;
  const failed = pr.signals?.failedCount ?? 0;
  if (total === null || failed === 0) return s("failure");
  return s(pr.signals?.checksTruncated === true ? "failedOfAtLeast" : "failedOf", {
    total,
    failed,
  });
}

function ciTone(pr: RunPullRequest, ciFailed: boolean): SignalTone {
  if (ciFailed) return "problem";
  return pr.ci === "success" ? "pass" : "neutral";
}

function conflictTone(conflict: boolean | null): SignalTone {
  if (conflict === null) return "neutral";
  return conflict ? "problem" : "pass";
}

function baseTone(behindBy: number | null): SignalTone {
  if (behindBy === null) return "neutral";
  return behindBy > 0 ? "warning" : "pass";
}

function prChecksUrl(url: string): string {
  return `${url.replace(/\/+$/, "")}/checks`;
}

export function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  todo: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
});
