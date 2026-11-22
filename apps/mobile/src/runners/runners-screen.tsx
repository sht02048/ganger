import { ScrollView, StyleSheet, View } from "react-native";

import { Card, Meter, StatusPill } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import type { RunnerView, UsageLimit, UsageLine } from "../demo/contract";
import { formatDuration } from "../format";
import { t } from "../i18n";
import { ScreenHeader } from "../screen-header";

function limitText(limit: UsageLimit): string {
  const window = t(`runners.window.${limit.window}`);
  return limit.resetsInMs === null
    ? t("runners.limitUnknown", { provider: limit.provider, window })
    : t("runners.limit", {
        provider: limit.provider,
        window,
        duration: formatDuration(limit.resetsInMs),
      });
}

function problemLines(runner: RunnerView): string[] {
  const cause =
    runner.cause === "offline"
      ? [
          runner.offlineMs === null
            ? t("runners.offline")
            : t("runners.offlineFor", { duration: formatDuration(runner.offlineMs) }),
        ]
      : runner.cause === "auth"
        ? [t("runners.auth")]
        : [];
  return [...cause, ...runner.limits.map(limitText)];
}

function ProblemCard({ runner }: { runner: RunnerView }) {
  return (
    <Card emphasis="problem">
      <StatusPill
        status={runner.cause === "offline" ? "offline" : "runner-issue"}
        label={t(runner.cause === "offline" ? "status.offline" : "status.runner-issue")}
      />
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

function UsageMeter({ line }: { line: UsageLine }) {
  const label = t("runners.usage", {
    provider: line.provider,
    window: t(`runners.window.${line.window}`),
  });
  return (
    <View style={styles.usage}>
      <View style={styles.usageText}>
        <Text variant="small">{label}</Text>
        <Text variant="small">{t("runners.usageValue", { percent: line.usedPercent })}</Text>
      </View>
      <Meter label={label} percent={line.usedPercent} />
    </View>
  );
}

function RunnerCard({ runner }: { runner: RunnerView }) {
  const offline = runner.cause === "offline";
  return (
    <Card>
      <View style={styles.runnerHead}>
        <Text variant="title">{runner.name}</Text>
        <StatusPill
          status={offline ? "offline" : "online"}
          label={t(offline ? "status.offline" : "status.online")}
        />
      </View>
      <Text variant="meta">
        {t("runners.capacity", { total: runner.capacity, used: runner.used })}
      </Text>
      {runner.usage.map((line) => (
        <UsageMeter key={`${line.provider}-${line.window}`} line={line} />
      ))}
    </Card>
  );
}

export function RunnersScreen({
  runners,
  onBack,
}: {
  runners: ReadonlyArray<RunnerView>;
  onBack: () => void;
}) {
  const problems = runners.filter((runner) => runner.cause !== null || runner.limits.length > 0);
  return (
    <View style={styles.root}>
      <ScreenHeader title={t("runners.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {runners.length === 0 ? <Text variant="meta">{t("runners.empty")}</Text> : null}
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
