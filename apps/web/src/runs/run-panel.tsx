import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  ExternalIcon,
  PanelHeader,
  PanelSection,
  SignalList,
  SignalRow,
  StatusPill,
  Text,
  TextLink,
  buttonStyles,
} from "@ganger/ui";
import type { SignalTone } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";
import { currentPrState } from "@ganger/app/runs/model";
import type { RunView } from "@ganger/app/runs/model";
import { useTime } from "../format/time";
import { useAgentName, useQueuedReasonText } from "../labels";
import { runStatus, useStatusName } from "../status";

type RunPullRequest = NonNullable<RunView["pullRequest"]>;
type PanelPrState = "open" | "merged" | "closed" | "unknown";

export function RunPanel({
  run,
  detailHref,
  onOpenDetail,
}: {
  run: RunView;
  detailHref: string;
  onOpenDetail: () => void;
}) {
  const agentName = useAgentName();
  const t = useTranslations("runs.panel");
  const domain = useTranslations("domain");
  const statusName = useStatusName();
  const status = runStatus(run);
  const when = useRunWhen(run);
  const reason = useRunReason(run);
  const pr = run.pullRequest;
  const cancelling = run.state !== "ended" && run.cancelling;

  return (
    <DetailPanel>
      <PanelHeader
        eyebrow={
          <Text variant="meta" numeric wrap="anywhere">
            {t("where", { key: run.ticketKey, project: run.trackerProject })}
            {run.branch === null ? null : (
              <>
                {t("whereSeparator")}
                <Text variant="meta" mono>
                  {run.branch}
                </Text>
              </>
            )}
          </Text>
        }
        status={
          <>
            <StatusPill status={status}>{statusName(status)}</StatusPill>
            {cancelling ? <Text variant="meta">{t("cancelling")}</Text> : null}
            {when === "" ? null : (
              <Text variant="meta" numeric>
                {when}
              </Text>
            )}
          </>
        }
        title={run.ticketTitle ?? run.ticketKey}
        reason={reason}
      />
      <Actions>
        <a
          href={detailHref}
          data-variant="primary"
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onOpenDetail();
          }}
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
      <PrSection run={run} />
      <PanelSection title={t("runInfo")}>
        <DefinitionList>
          <DefinitionItem label={t("runner")} empty={run.runner === null}>
            {run.runner === null ? (
              t("noRunner")
            ) : (
              <span {...stylex.props(styles.inline)}>
                {run.runner.name}
                {run.runner.online ? null : (
                  <StatusPill status="offline">{statusName("offline")}</StatusPill>
                )}
              </span>
            )}
          </DefinitionItem>
          <DefinitionItem label={t("agent")}>{agentName(run.agent)}</DefinitionItem>
          {run.state === "ended" ? (
            <DefinitionItem label={t("agentResult")}>
              {domain(`agentResult.${run.agentResult}`)}
            </DefinitionItem>
          ) : null}
        </DefinitionList>
      </PanelSection>
    </DetailPanel>
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

function useRunReason(run: RunView): string {
  const t = useTranslations("runs.panel");
  const queuedReasonText = useQueuedReasonText();
  if (run.state !== "ended" && run.cancelling) return t("cancellingReason");
  switch (run.state) {
    case "queued":
      return queuedReasonText(run.queuedReason);
    case "running":
    case "waiting-for-input":
      return t(`reason.${run.state}`);
    case "disconnected":
      return t(run.paused ? "reason.disconnectedPaused" : "reason.disconnected");
    case "paused":
      return t("reason.paused");
    case "ended": {
      const reason = t(`reason.${run.summary}`);
      const openWithFailedCi =
        currentPrState(run) === "open" && run.pullRequest !== null && isCiFailed(run.pullRequest);
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
  const signals = pr?.signals ?? null;
  const readAgoMs = pr?.signalsReadAgoMs ?? null;
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
      {...(signals === null || readAgoMs === null
        ? {}
        : { meta: s("readAt", { time: ago(signals.checkedAt, readAgoMs) }) })}
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
        <PrSignals pr={pr} showMergeRows={signals !== null || state === "open"} />
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

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const styles = stylex.create({
  inline: { display: "inline-flex", alignItems: "center", gap: space.s2 },
});
