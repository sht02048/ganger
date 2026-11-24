import * as stylex from "@stylexjs/stylex";
import {
  CommitHistory,
  ExternalIconLink,
  SignalList,
  SignalRow,
  SplitButton,
  Text,
  TextLink,
  showToast,
} from "@ganger/ui";
import type { CommitHistoryLoad, SignalTone } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import type { MergePrResult } from "@ganger/app/home/merge-pr";
import type { HomeCommitSummary, HomePullRequest, HomeRun } from "@ganger/app/home/model";
import type { MergeView, PrCommitView } from "@ganger/app/pr-signals-view";
import type { MergeMethod, RunId } from "@ganger/core";
import { useTime } from "../format/time";
import { usePrReadDiagnosisText } from "../pr-read-diagnosis";
import { prCiFailed } from "./sheet-tabs";

const GITHUB_TOKEN_SETTINGS_HREF = "/settings/connections";

export type MergeHandler = (
  runId: RunId,
  method: MergeMethod,
  expectedHead: string,
) => Promise<MergePrResult>;

export type CommitsLoader = (runId: RunId) => Promise<PrCommitView[] | null>;

export function PrTabContent({
  run,
  onMerge,
  onLoadCommits,
}: {
  run: HomeRun;
  onMerge: MergeHandler;
  onLoadCommits: CommitsLoader;
}) {
  const pr = run.pullRequest;
  const columnRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={columnRef} tabIndex={-1} {...stylex.props(styles.column)}>
      {pr === null ? null : pr.state === "open" && pr.merge !== null ? (
        <MergeControl
          key={pr.displayId}
          runId={run.id}
          merge={pr.merge}
          onMerge={onMerge}
          onMerged={() => columnRef.current?.focus()}
        />
      ) : null}
      {pr === null ? (
        <NoPullRequest run={run} />
      ) : (
        <PrStatusRows runId={run.id} pr={pr} onLoadCommits={onLoadCommits} />
      )}
    </div>
  );
}

function MergeControl({
  runId,
  merge,
  onMerge,
  onMerged,
}: {
  runId: RunId;
  merge: MergeView;
  onMerge: MergeHandler;
  onMerged: () => void;
}) {
  const t = useTranslations("home.sheet.pr.merge");
  const [picked, setPicked] = useState<MergeMethod>(merge.defaultMethod);
  const [sending, setSending] = useState(false);
  const noteId = useId();
  const method = merge.methods.includes(picked) ? picked : merge.defaultMethod;
  const describeFailure = useMergeFailure();
  const send = async () => {
    setSending(true);
    try {
      const result = await onMerge(runId, method, merge.headCommit);
      showToast(result.ok ? t("done") : describeFailure(result));
      if (result.ok) onMerged();
    } catch {
      showToast(t("failed.network"));
    } finally {
      setSending(false);
    }
  };
  return (
    <div data-merge-control="" {...stylex.props(styles.merge)}>
      <SplitButton<MergeMethod>
        value={method}
        options={merge.methods.map((value) => ({ value, label: t(`option.${value}`) }))}
        onValueChange={setPicked}
        menuLabel={t("methodMenu")}
        disabled={merge.blocked !== null || merge.noPermission}
        busy={{ active: sending, label: t("busy") }}
        onClick={() => void send()}
        {...(merge.noPermission ? { describedBy: noteId } : {})}
      >
        {t(`button.${method}`)}
      </SplitButton>
      {merge.noPermission ? (
        <Text variant="ui" tone="muted" as="p" id={noteId}>
          {t("noPermission")} ·{" "}
          <TextLink href={GITHUB_TOKEN_SETTINGS_HREF}>{t("toSettings")}</TextLink>
        </Text>
      ) : null}
    </div>
  );
}

function useMergeFailure(): (result: Extract<MergePrResult, { ok: false }>) => string {
  const t = useTranslations("home.sheet.pr.merge.failed");
  return (result) =>
    result.reason === "blocked" && result.message !== null
      ? t("blockedBecause", { message: result.message })
      : t(result.reason);
}

function NoPullRequest({ run }: { run: HomeRun }) {
  const t = useTranslations("home.sheet.pr");
  const diagnosisText = usePrReadDiagnosisText();
  if (run.state === "ended") {
    if (run.prState !== "unknown") return <Text variant="body">{t("noneEnded")}</Text>;
    const diagnosis = run.prReadDiagnosis ?? null;
    return (
      <div {...stylex.props(styles.empty)}>
        <Text variant="body">{t("unread")}</Text>
        {diagnosis === null ? null : (
          <Text variant="ui" tone="muted" as="p">
            {diagnosisText(diagnosis, "run")}
          </Text>
        )}
      </div>
    );
  }
  return (
    <div {...stylex.props(styles.empty)}>
      <Text variant="body">{t("none")}</Text>
      <Text variant="ui" tone="muted" as="p">
        {t("noneYet")}
      </Text>
    </div>
  );
}

function PrStatusRows({
  runId,
  pr,
  onLoadCommits,
}: {
  runId: RunId;
  pr: HomePullRequest;
  onLoadCommits: CommitsLoader;
}) {
  return (
    <>
      <SignalList>
        {pr.state === "open" ? <OpenPrRows pr={pr} /> : <SettledPrRow pr={pr} />}
        <PrLinkRow pr={pr} />
      </SignalList>
      {pr.commitSummary === null ? null : (
        <PrCommits runId={runId} summary={pr.commitSummary} onLoadCommits={onLoadCommits} />
      )}
    </>
  );
}

interface LoadedCommits {
  summaryKey: string;
  commits: PrCommitView[];
}

function summaryKeyOf(summary: HomeCommitSummary): string {
  return `${summary.count}:${summary.latestAt}`;
}

function agoAsOfSummary(summary: HomeCommitSummary, committedAt: string): number {
  const now = Date.parse(summary.latestAt) + summary.latestAgoMs;
  return Math.max(0, now - Date.parse(committedAt));
}

function useRunCommits(
  runId: RunId,
  summaryKey: string,
  onLoadCommits: CommitsLoader,
): {
  loaded: LoadedCommits | null;
  failed: boolean;
  setExpanded: (expanded: boolean) => void;
  retry: () => void;
} {
  const [expanded, setExpanded] = useState(false);
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedCommits | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const request = (key: string) => {
    const id = latestRequest.current + 1;
    latestRequest.current = id;
    setRequestedKey(key);
    setFailedKey(null);
    onLoadCommits(runId).then(
      (commits) => {
        if (latestRequest.current !== id) return;
        if (commits === null) setFailedKey(key);
        else setLoaded({ summaryKey: key, commits });
      },
      () => {
        if (latestRequest.current === id) setFailedKey(key);
      },
    );
  };
  const wanted = expanded && requestedKey !== summaryKey;
  useEffect(() => {
    if (wanted) request(summaryKey);
  }, [wanted, summaryKey]);
  useEffect(
    () => () => {
      latestRequest.current += 1;
    },
    [],
  );
  return {
    loaded,
    failed: failedKey !== null && loaded === null,
    setExpanded,
    retry: () => request(summaryKey),
  };
}

function PrCommits({
  runId,
  summary,
  onLoadCommits,
}: {
  runId: RunId;
  summary: HomeCommitSummary;
  onLoadCommits: CommitsLoader;
}) {
  const t = useTranslations("home.sheet");
  const { ago } = useTime();
  const { loaded, failed, setExpanded, retry } = useRunCommits(
    runId,
    summaryKeyOf(summary),
    onLoadCommits,
  );
  const load: CommitHistoryLoad | null =
    loaded !== null
      ? null
      : failed
        ? {
            kind: "failed",
            message: t("pr.commitsFailed"),
            retryLabel: t("pr.commitsRetry"),
            onRetry: retry,
          }
        : { kind: "loading", label: t("pr.commitsLoading") };
  return (
    <CommitHistory
      summary={t("pr.commits", {
        count: summary.count,
        ago: ago(summary.latestAt, summary.latestAgoMs),
      })}
      newTabLabel={t("newTab")}
      load={load}
      onExpandedChange={setExpanded}
      commits={(loaded?.commits ?? []).map((commit) => ({
        id: commit.oid,
        headline: commit.headline,
        sha: commit.shortSha,
        author: commit.author,
        time: ago(commit.committedAt, agoAsOfSummary(summary, commit.committedAt)),
        href: commit.url,
      }))}
    />
  );
}

function OpenPrRows({ pr }: { pr: HomePullRequest }) {
  const t = useTranslations("home.sheet.pr");
  const blocked = pr.merge?.blocked ?? null;
  const conflict = blocked === "conflict" ? true : (pr.signals?.conflict ?? null);
  const behindBy = pr.signals?.behindBy ?? null;
  const ruleBlocked = (blocked === "rules" && !prCiFailed(pr)) || blocked === "draft";
  return (
    <>
      <CiRow pr={pr} />
      <SignalRow label={t("conflict")} tone={conflictTone(conflict)}>
        {t(
          conflict === null
            ? "conflictValue.unknown"
            : conflict
              ? "conflictValue.some"
              : "conflictValue.none",
        )}
      </SignalRow>
      <SignalRow label={t("base")} tone={blocked === "behind" ? "problem" : baseTone(behindBy)}>
        {blocked === "behind" && (behindBy === null || behindBy === 0)
          ? t("baseValue.mustUpdate")
          : behindBy === null
            ? t("baseValue.unknown")
            : behindBy > 0
              ? t("baseValue.behind", { count: behindBy })
              : t("baseValue.upToDate")}
      </SignalRow>
      {ruleBlocked ? (
        <SignalRow label={t("rules")} tone="problem">
          {t(blocked === "draft" ? "rulesValue.draft" : "rulesValue.blocked")}
        </SignalRow>
      ) : null}
    </>
  );
}

function CiRow({ pr }: { pr: HomePullRequest }) {
  const t = useTranslations("home.sheet.pr");
  const failed = prCiFailed(pr);
  const failedChecks = failed ? (pr.signals?.failedChecks ?? []) : [];
  const checkList = new Intl.ListFormat(useLocale(), { type: "conjunction" });
  return (
    <SignalRow
      label={t("ci")}
      tone={ciTone(pr, failed)}
      {...(failedChecks.length === 0 ? {} : { detail: checkList.format(failedChecks) })}
    >
      {useCiText(pr, failed)}
    </SignalRow>
  );
}

function useCiText(pr: HomePullRequest, failed: boolean): string {
  const t = useTranslations("home.sheet.pr.ciValue");
  const total = pr.signals?.checkTotal ?? null;
  if (failed) {
    const count = pr.signals?.failedCount ?? 0;
    if (total === null || count === 0) return t("failure");
    return t(pr.signals?.checksTruncated === true ? "failedOfAtLeast" : "failedOf", {
      total,
      failed: count,
    });
  }
  if (ciPassed(pr, failed)) return total === null ? t("success") : t("passed", { count: total });
  return t(pr.ci === "failure" ? "unknown" : pr.ci);
}

function SettledPrRow({ pr }: { pr: HomePullRequest }) {
  const t = useTranslations("home.sheet.pr");
  const { ago } = useTime();
  if (pr.state === "closed")
    return (
      <SignalRow label={t("state")} tone="neutral">
        {t("closed")}
      </SignalRow>
    );
  return (
    <SignalRow label={t("state")}>
      {pr.settledAt === null || pr.settledAgoMs === null
        ? t("merged")
        : t("mergedAgo", { ago: ago(pr.settledAt, pr.settledAgoMs) })}
    </SignalRow>
  );
}

function PrLinkRow({ pr }: { pr: HomePullRequest }) {
  const t = useTranslations("home.sheet");
  const branches = branchesText(pr, (head, base) => t("pr.branches", { head, base }));
  return (
    <SignalRow label={t("pr.link")} {...(branches === null ? {} : { detail: branches })}>
      <span {...stylex.props(styles.linkLine)}>
        <Text variant="ui" wrap="anywhere">
          {pr.title === null
            ? pr.displayId
            : t("pr.linkValue", { pr: pr.displayId, title: pr.title })}
        </Text>
        <ExternalIconLink
          href={pr.url}
          label={`${t("openPr", { pr: pr.displayId })} (${t("newTab")})`}
        />
      </span>
    </SignalRow>
  );
}

function branchesText(
  pr: HomePullRequest,
  format: (head: string, base: string) => string,
): string | null {
  if (pr.branch === null) return null;
  return pr.baseBranch === null ? pr.branch : format(pr.branch, pr.baseBranch);
}

function ciPassed(pr: HomePullRequest, failed: boolean): boolean {
  if (failed) return false;
  return pr.ci === "success" || (pr.ci === "failure" && pr.signals?.checkTotal != null);
}

function ciTone(pr: HomePullRequest, failed: boolean): SignalTone {
  if (failed) return "problem";
  return ciPassed(pr, failed) ? "pass" : "neutral";
}

function conflictTone(conflict: boolean | null): SignalTone {
  if (conflict === null) return "neutral";
  return conflict ? "problem" : "pass";
}

function baseTone(behindBy: number | null): SignalTone {
  if (behindBy === null) return "neutral";
  return behindBy > 0 ? "warning" : "pass";
}

const styles = stylex.create({
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minWidth: 0,
  },
  merge: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  empty: { display: "flex", flexDirection: "column", gap: space.s1 },
  linkLine: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
});
