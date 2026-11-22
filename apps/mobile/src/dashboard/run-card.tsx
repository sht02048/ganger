import { StyleSheet, View } from "react-native";

import { Button, Card, Chip, StatusPill } from "../design/components";
import type { PillStatus } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import type { HomeRun } from "../demo/contract";
import { formatAgo, formatDuration, queuedLine } from "../format";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { PR_CHIPS_VISIBLE, prProblemsOf, todoTagOf } from "./model";
import type { PrProblem } from "./model";

function prProblemLabel(problem: PrProblem): string {
  switch (problem.kind) {
    case "ci-failed":
      return t("card.prChip.ciFailed");
    case "conflict":
      return t("card.prChip.conflict");
    case "behind":
      return t("card.prChip.behind", { count: problem.commits });
  }
}

function PrChips({ run }: { run: HomeRun }) {
  const problems = prProblemsOf(run.pullRequest?.signals ?? null);
  if (problems.length === 0) return null;
  const hidden = problems.length - PR_CHIPS_VISIBLE;
  return (
    <View style={styles.chips}>
      {problems.slice(0, PR_CHIPS_VISIBLE).map((problem) => (
        <Chip key={problem.kind} label={prProblemLabel(problem)} tone="problem" />
      ))}
      {hidden > 0 ? <Chip label={t("card.prChip.more", { count: hidden })} /> : null}
    </View>
  );
}

function BlockerChips({ run }: { run: HomeRun }) {
  if (run.state !== "queued") return null;
  const reason = run.queuedReason;
  if (reason.kind !== "blockers-waiting" && reason.kind !== "blockers-stuck") return null;
  const blockers =
    reason.kind === "blockers-waiting"
      ? [...reason.blockers, ...(reason.finished ?? [])]
      : reason.blockers;
  if (blockers.length === 0) return null;
  return (
    <View style={styles.chips}>
      {blockers.map((blocker) => (
        <Chip key={blocker.key} label={blocker.key} />
      ))}
    </View>
  );
}

function pillOf(run: HomeRun): PillStatus | null {
  const tag = todoTagOf(run);
  if (tag !== null) return tag;
  return run.state === "paused" ? "paused" : null;
}

function detailOf(run: HomeRun): string | null {
  switch (run.state) {
    case "waiting-for-input":
      if (run.input === null) return t("card.inputUnknown");
      return run.input.kind === "permission" ? run.input.detail : run.input.body;
    case "disconnected": {
      const runner = run.runner?.name ?? t("card.noRunner");
      return run.unreachableMs === null
        ? t("card.unreachable", { runner })
        : t("card.unreachableFor", { runner, duration: formatDuration(run.unreachableMs) });
    }
    case "paused":
      return t(`card.paused.${run.pauseSource}`);
    case "queued":
      return queuedLine(run);
    case "running":
    case "ended":
      return null;
  }
}

function noteOf(run: HomeRun): string | null {
  if (run.state === "disconnected") return t("card.disconnected");
  if (run.state === "waiting-for-input" && run.input?.kind === "permission") {
    return t("card.allowOnRunner");
  }
  return null;
}

function actionOf(run: HomeRun): { key: MessageKey; danger: boolean } | null {
  switch (todoTagOf(run)) {
    case "question":
      return { key: "card.answer", danger: false };
    case "human-check":
      return { key: "card.check", danger: false };
    case "permission":
      return { key: "card.deny", danger: true };
    case "failed":
      return { key: "card.retry", danger: false };
    case "waiting-for-input":
    case "disconnected":
    case null:
      return run.state === "paused" ? { key: "card.resume", danger: false } : null;
  }
}

function timeOf(run: HomeRun): string | null {
  switch (run.state) {
    case "queued":
      return formatDuration(run.waitMs);
    case "running":
      return run.executionMs === null ? null : formatDuration(run.executionMs);
    case "paused":
      return run.pausedMs === null ? null : formatDuration(run.pausedMs);
    case "waiting-for-input":
      return run.waitingMs === null ? null : formatDuration(run.waitingMs);
    case "disconnected":
      return null;
    case "ended":
      return formatAgo(run.endedAt, run.endedAgoMs);
  }
}

function isStuck(run: HomeRun): boolean {
  return run.state === "queued" && run.queuedReason.kind === "blockers-stuck";
}

export function RunCard({ run, onAction }: { run: HomeRun; onAction: () => void }) {
  const pill = pillOf(run);
  const detail = detailOf(run);
  const note = noteOf(run);
  const action = actionOf(run);
  const time = timeOf(run);
  const stuck = isStuck(run);
  const waitsOnBlockers =
    run.state === "queued" &&
    (run.queuedReason.kind === "blockers-waiting" || run.queuedReason.kind === "blockers-stuck");
  const meta = [
    waitsOnBlockers ? null : (run.runner?.name ?? t("card.noRunner")),
    waitsOnBlockers ? null : run.agent,
    run.cancelling ? t("card.cancelling") : null,
    run.pullRequest === null ? null : t("card.pullRequest", { pr: run.pullRequest.displayId }),
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <Card emphasis={stuck ? "problem" : "none"}>
      {pill === null ? null : <StatusPill status={pill} label={t(`status.${pill}`)} />}
      <Text variant="title" numberOfLines={2}>
        <Text variant="meta">{run.ticketKey} </Text>
        {run.ticketTitle}
      </Text>
      <BlockerChips run={run} />
      {detail === null ? null : (
        <Text variant="meta" tone={stuck ? "problem" : "secondary"}>
          {detail}
        </Text>
      )}
      {note === null ? null : <Text variant="meta">{note}</Text>}
      <PrChips run={run} />
      <View style={styles.footer}>
        <View style={styles.meta}>
          <Text variant="small" numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {time === null ? null : <Text variant="small">{time}</Text>}
      </View>
      {action === null ? null : (
        <Button
          label={t(action.key)}
          variant={action.danger ? "danger" : "secondary"}
          onPress={onAction}
        />
      )}
    </Card>
  );
}

function settledPrLabel(run: HomeRun & { state: "ended" }): string | null {
  if (run.pullRequest === null) return null;
  const pr = run.pullRequest.displayId;
  switch (run.prState) {
    case "merged":
      return t("card.prMerged", { pr });
    case "closed":
      return t("card.prClosed", { pr });
    case "open":
      return t("card.pullRequest", { pr });
    case "none":
      return null;
  }
}

export function SettledRow({ run }: { run: HomeRun & { state: "ended" } }) {
  const status = run.summary === "canceled" ? "canceled" : "succeeded";
  const trailing = [settledPrLabel(run), formatAgo(run.endedAt, run.endedAgoMs)]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <View style={styles.settled}>
      <StatusPill status={status} label={t(`status.${status}`)} />
      <View style={styles.settledTitle}>
        <Text variant="meta" tone="secondary" numberOfLines={1}>
          {run.ticketKey} {run.ticketTitle}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {trailing}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  footer: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  meta: { flex: 1 },
  settled: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    paddingVertical: space.s2,
  },
  settledTitle: { flex: 1 },
});
