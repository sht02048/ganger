import type {
  AppProviderUsage,
  AppRunner,
  AppRunnerGhAccounts,
  AppUsageLimit,
  AppUsageWindow,
  V1GhAccount,
} from "@ganger/api";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Card, Meter, StatusPill } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { formatDuration, providerName } from "../format";
import { t } from "../i18n";
import { ScreenHeader } from "../screen-header";

function limitText(limit: AppUsageLimit): string {
  const window = t(`runners.window.${limit.window}`);
  const provider = providerName(limit.provider);
  return limit.resetsInMs === null
    ? t("runners.limitUnknown", { provider, window })
    : t("runners.limit", {
        provider,
        window,
        duration: formatDuration(limit.resetsInMs),
      });
}

function problemLines(runner: AppRunner): string[] {
  const cause =
    runner.cause === "offline"
      ? [
          runner.offlineMs === null
            ? t("runners.offline")
            : t("runners.offlineFor", { duration: formatDuration(runner.offlineMs) }),
        ]
      : runner.cause === "auth"
        ? [t("runners.auth")]
        : runner.cause === "unknown"
          ? [t("runners.unknownCause")]
          : [];
  const ghLogin = expiredGhLogin(runner);
  const gh = ghLogin === null ? [] : [t("runners.gh.expiredProblem", { login: ghLogin })];
  return [...cause, ...runner.limits.map(limitText), ...gh];
}

function hasProblem(runner: AppRunner): boolean {
  return runner.cause !== null || runner.limits.length > 0 || expiredGhLogin(runner) !== null;
}

function problemStatus(runner: AppRunner): "offline" | "runner-issue" | "unknown" {
  if (runner.cause === "offline") return "offline";
  const onlyUnknown =
    runner.cause === "unknown" && runner.limits.length === 0 && expiredGhLogin(runner) === null;
  return onlyUnknown ? "unknown" : "runner-issue";
}

function ProblemCard({ runner }: { runner: AppRunner }) {
  const status = problemStatus(runner);
  return (
    <Card emphasis={status === "unknown" ? "none" : "problem"}>
      <StatusPill status={status} label={t(`status.${status}`)} />
      <Text variant="title">{runner.name}</Text>
      {problemLines(runner).map((line) => (
        <Text key={line} variant="meta" tone="secondary">
          {line}
        </Text>
      ))}
      <Text variant="meta">{t("runners.fixElsewhere")}</Text>
    </Card>
  );
}

function UsageMeter({ provider, window }: { provider: string; window: AppUsageWindow }) {
  const label = t("runners.usage", {
    provider,
    window: t(`runners.window.${window.kind}`),
  });
  return (
    <View style={styles.usage}>
      <View style={styles.usageText}>
        <Text variant="small">{label}</Text>
        <Text variant="small">{t("runners.usageValue", { percent: window.usedPercent })}</Text>
      </View>
      <Meter label={label} percent={window.usedPercent} />
    </View>
  );
}

function RunnerUsage({ usage }: { usage: AppRunner["usage"] }) {
  if (usage === null) return <Text variant="small">{t("runners.usageNotRead")}</Text>;
  if (usage.kind !== "read") {
    return <Text variant="small">{t("runners.usageUnreadable")}</Text>;
  }
  const using = usage.providers.filter(
    (provider) => provider.status === "ok" || provider.status === "error",
  );
  const namesWith = (status: AppProviderUsage["status"]) =>
    usage.providers
      .filter((provider) => provider.status === status)
      .map((provider) => providerName(provider.provider))
      .join(t("runners.usageListSeparator"));
  const signedOut = namesWith("signed-out");
  const unavailable = namesWith("unavailable");
  const unknownStatus = namesWith("unknown");
  return (
    <>
      {using.map((provider) => (
        <ProviderWindows key={provider.provider} usage={provider} />
      ))}
      {signedOut === "" ? null : (
        <Text variant="small">{t("runners.usageSignedOut", { providers: signedOut })}</Text>
      )}
      {unavailable === "" ? null : (
        <Text variant="small">{t("runners.usageUnavailable", { providers: unavailable })}</Text>
      )}
      {unknownStatus === "" ? null : (
        <Text variant="small">{t("runners.usageUnknown", { providers: unknownStatus })}</Text>
      )}
    </>
  );
}

function ProviderWindows({ usage }: { usage: AppProviderUsage }) {
  const name = providerName(usage.provider);
  if (usage.status === "error") {
    return <Text variant="small">{t("runners.usageError", { provider: name })}</Text>;
  }
  if (usage.windows.length === 0) {
    return <Text variant="small">{t("runners.usageNoWindows", { provider: name })}</Text>;
  }
  return (
    <>
      {usage.windows.map((window, index) => (
        <UsageMeter key={`${window.kind}:${index}`} provider={name} window={window} />
      ))}
    </>
  );
}

function shownGhAccount(gh: AppRunnerGhAccounts | null | undefined): V1GhAccount | null {
  if (gh?.kind !== "logged-in") return null;
  return gh.accounts.find((account) => account.active) ?? gh.accounts[0] ?? null;
}

function isExpiredInUse(account: V1GhAccount): boolean {
  return account.active && account.expired;
}

function expiredGhLogin(runner: AppRunner): string | null {
  const account = shownGhAccount(runner.ghAccounts);
  return account !== null && isExpiredInUse(account) ? account.login : null;
}

function ghStatusText(gh: AppRunnerGhAccounts | null): string {
  if (gh === null) return t("runners.gh.notRead");
  switch (gh.kind) {
    case "logged-in":
    case "unknown":
      return t("runners.gh.unknown");
    case "logged-out":
      return t("runners.gh.loggedOut");
    case "not-installed":
      return t("runners.gh.notInstalled");
    case "unreadable":
      return t("runners.gh.unreadable");
  }
}

function GhRow({ gh }: { gh: AppRunnerGhAccounts | null }) {
  const account = shownGhAccount(gh);
  return (
    <View style={styles.ghRow}>
      <Text variant="small" tone="tertiary">
        {t("runners.gh.label")}
      </Text>
      <View style={styles.ghValue}>
        {account === null ? (
          <Text variant="small" tone="secondary" numberOfLines={1}>
            {ghStatusText(gh)}
          </Text>
        ) : isExpiredInUse(account) ? (
          <Text variant="small" tone="problem" numberOfLines={1}>
            {t("runners.gh.expired", { login: account.login })}
          </Text>
        ) : (
          <Text variant="small" tone="secondary" numberOfLines={1}>
            {t("runners.gh.account", { login: account.login, host: account.host })}
          </Text>
        )}
      </View>
    </View>
  );
}

function RunnerCard({ runner }: { runner: AppRunner }) {
  const status =
    runner.cause === "offline" ? "offline" : runner.cause === "unknown" ? "unknown" : "online";
  return (
    <Card>
      <View style={styles.runnerHead}>
        <Text variant="title">{runner.name}</Text>
        <StatusPill status={status} label={t(`status.${status}`)} />
      </View>
      <Text variant="meta">
        {t("runners.capacity", { total: runner.capacity, used: runner.used })}
      </Text>
      <RunnerUsage usage={runner.usage} />
      {runner.ghAccounts === undefined ? null : <GhRow gh={runner.ghAccounts} />}
    </Card>
  );
}

export function RunnersScreen({
  runners,
  onBack,
  band = null,
  loading = false,
  unavailable = false,
}: {
  runners: ReadonlyArray<AppRunner>;
  onBack: () => void;
  band?: ReactNode;
  loading?: boolean;
  unavailable?: boolean;
}) {
  const emptyMessage = loading
    ? t("common.loading")
    : unavailable
      ? t("runners.unavailable")
      : t("runners.empty");
  const problems = runners.filter(hasProblem);
  return (
    <View style={styles.root}>
      {band}
      <ScreenHeader title={t("runners.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {runners.length === 0 ? <Text variant="meta">{emptyMessage}</Text> : null}
        {problems.length === 0 ? null : (
          <RunnerSection title={t("runners.problems")}>
            {problems.map((runner) => (
              <ProblemCard key={runner.id} runner={runner} />
            ))}
          </RunnerSection>
        )}
        {runners.length === 0 ? null : (
          <RunnerSection title={t("runners.list")}>
            {runners.map((runner) => (
              <RunnerCard key={runner.id} runner={runner} />
            ))}
          </RunnerSection>
        )}
      </ScrollView>
    </View>
  );
}

function RunnerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="meta" tone="secondary" heading>
        {title}
      </Text>
      <View style={styles.cards}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space.s4, gap: space.s6 },
  section: { gap: space.s2 },
  cards: { gap: space.s3 },
  runnerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  usage: { gap: space.s1 },
  ghValue: { flexShrink: 1 },
  ghRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.s2,
  },
  usageText: { flexDirection: "row", justifyContent: "space-between" },
});
