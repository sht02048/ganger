import * as stylex from "@stylexjs/stylex";
import { ExternalIconLink, SignalList, SignalRow, Text } from "@ganger/ui";
import type { SignalTone } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useTranslations } from "use-intl";
import type { HomePullRequest, HomeRun } from "@ganger/app/home/model";
import { useTime } from "../format/time";
import { prCiFailed } from "./sheet-tabs";

export function PrTabContent({ run }: { run: HomeRun }) {
  const pr = run.pullRequest;
  return (
    <div {...stylex.props(styles.column)}>
      {pr === null ? <NoPullRequest run={run} /> : <PrStatusRows pr={pr} />}
    </div>
  );
}

function NoPullRequest({ run }: { run: HomeRun }) {
  const t = useTranslations("home.sheet.pr");
  if (run.state === "ended") {
    return <Text variant="body">{run.prState === "unknown" ? t("unread") : t("noneEnded")}</Text>;
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

function PrStatusRows({ pr }: { pr: HomePullRequest }) {
  return (
    <SignalList>
      {pr.state === "open" ? <OpenPrRows pr={pr} /> : <SettledPrRow pr={pr} />}
      <PrLinkRow pr={pr} />
    </SignalList>
  );
}

function OpenPrRows({ pr }: { pr: HomePullRequest }) {
  const t = useTranslations("home.sheet.pr");
  const conflict = pr.signals?.conflict ?? null;
  const behindBy = pr.signals?.behindBy ?? null;
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
      <SignalRow label={t("base")} tone={baseTone(behindBy)}>
        {behindBy === null
          ? t("baseValue.unknown")
          : behindBy > 0
            ? t("baseValue.behind", { count: behindBy })
            : t("baseValue.upToDate")}
      </SignalRow>
    </>
  );
}

function CiRow({ pr }: { pr: HomePullRequest }) {
  const t = useTranslations("home.sheet.pr");
  const failed = prCiFailed(pr);
  const failedChecks = failed ? (pr.signals?.failedChecks ?? []) : [];
  return (
    <SignalRow label={t("ci")} tone={ciTone(pr, failed)}>
      <span {...stylex.props(styles.stack)}>
        <span>{useCiText(pr, failed)}</span>
        {failedChecks.length === 0 ? null : (
          <Text variant="meta" wrap="anywhere">
            {failedChecks.join(", ")}
          </Text>
        )}
      </span>
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
  if (pr.ci === "success") return total === null ? t("success") : t("passed", { count: total });
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
    <SignalRow label={t("state")} tone="pass">
      {pr.settledAt === null || pr.settledAgoMs === null
        ? t("merged")
        : t("mergedAgo", { ago: ago(pr.settledAt, pr.settledAgoMs) })}
    </SignalRow>
  );
}

function PrLinkRow({ pr }: { pr: HomePullRequest }) {
  const t = useTranslations("home.sheet");
  return (
    <SignalRow label={t("pr.link")}>
      <span {...stylex.props(styles.stack)}>
        <span {...stylex.props(styles.linkLine)}>
          <span>{pr.displayId}</span>
          <ExternalIconLink
            href={pr.url}
            label={`${t("openPr", { pr: pr.displayId })} (${t("newTab")})`}
          />
        </span>
        {pr.branch === null ? null : (
          <Text variant="meta" wrap="anywhere">
            {pr.branch}
          </Text>
        )}
      </span>
    </SignalRow>
  );
}

function ciTone(pr: HomePullRequest, failed: boolean): SignalTone {
  if (failed) return "problem";
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

const styles = stylex.create({
  column: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  empty: { display: "flex", flexDirection: "column", gap: space.s1 },
  stack: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  linkLine: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
});
