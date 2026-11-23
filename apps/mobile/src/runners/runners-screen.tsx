import type { AppProviderUsage, AppRunner, AppUsageLimit, AppUsageWindow } from "@ganger/api";
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
  return [...cause, ...runner.limits.map(limitText)];
}

function problemStatus(runner: AppRunner): "offline" | "runner-issue" | "unknown" {
  if (runner.cause === "offline") return "offline";
  return runner.cause === "unknown" && runner.limits.length === 0 ? "unknown" : "runner-issue";
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
  const problems = runners.filter((runner) => runner.cause !== null || runner.limits.length > 0);
  return (
    <View style={styles.root}>
      {band}
      <ScreenHeader title={t("runners.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {runners.length === 0 ? <Text variant="meta">{emptyMessage}</Text> : null}
        {problems.length === 0 ? null : (
          <Text variant="meta" tone="secondary" heading>
            {t("runners.problems")}
          </Text>
        )}
        {problems.map((runner) => (
          <ProblemCard key={runner.id} runner={runner} />
        ))}
        {runners.length === 0 ? null : (
          <Text variant="meta" tone="secondary" heading>
            {t("runners.list")}
          </Text>
        )}
        {runners.map((runner) => (
          <RunnerCard key={runner.id} runner={runner} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space.s4, gap: space.s3 },
  runnerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  usage: { gap: space.s1 },
  usageText: { flexDirection: "row", justifyContent: "space-between" },
});
