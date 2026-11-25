import { StyleSheet, View } from "react-native";

import { Button, Card, Chip, PopoverMenu, StatusPill } from "../design/components";
import type { ButtonVariant, MenuItem, PillStatus } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { agentName, formatAgo, formatDuration, queuedLine } from "../format";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { isWebLink } from "../runs/body-parts";
import { PR_CHIPS_VISIBLE } from "./model";
import type { DashboardRun, EndedRun, PrProblem } from "./model";

export function prProblemLabel(problem: PrProblem): string {
  switch (problem.kind) {
    case "ci-failed":
      return t("card.prChip.ciFailed");
    case "conflict":
      return t("card.prChip.conflict");
    case "behind":
      return t("card.prChip.behind", { count: problem.commits });
    case "unknown":
      return t("card.prChip.unknown");
  }
}

export function prProblemTone({ kind }: PrProblem): "problem" | "neutral" {
  return kind === "ci-failed" || kind === "conflict" ? "problem" : "neutral";
}

function PrChips({ run }: { run: DashboardRun }) {
  const problems = run.pullRequest?.problems ?? [];
  if (problems.length === 0) return null;
  const hidden = problems.length - PR_CHIPS_VISIBLE;
  return (
    <View style={styles.chips}>
      {problems.slice(0, PR_CHIPS_VISIBLE).map((problem, index) => (
        <Chip
          key={`${problem.kind}:${index}`}
          label={prProblemLabel(problem)}
          tone={prProblemTone(problem)}
        />
      ))}
      {hidden > 0 ? <Chip label={t("card.prChip.more", { count: hidden })} /> : null}
    </View>
  );
}

function BlockerChips({ run }: { run: DashboardRun }) {
  if (run.state !== "queued") return null;
  const reason = run.queuedReason;
  if (reason.kind !== "blockers-waiting" && reason.kind !== "blockers-stuck") return null;
  const blockers =
    reason.kind === "blockers-waiting" ? [...reason.blockers, ...reason.finished] : reason.blockers;
  if (blockers.length === 0) return null;
  return (
    <View style={styles.chips}>
      {blockers.map((blocker) => (
        <Chip key={blocker.key} label={blocker.key} />
      ))}
    </View>
  );
}

function pillOf(run: DashboardRun): PillStatus | null {
  if (run.todoTag !== null) return run.todoTag;
  if (run.state === "unknown") return "unknown";
  return run.state === "paused" ? "paused" : null;
}

function inputHandled(run: DashboardRun): boolean {
  if (run.state !== "waiting-for-input" || run.input === null) return false;
  if (run.input.kind === "unknown") return false;
  return run.input.kind === "permission" ? run.input.denied : run.input.answered;
}

function detailOf(run: DashboardRun): string | null {
  switch (run.state) {
    case "waiting-for-input":
      if (run.input === null) return t("card.inputUnknown");
      if (run.input.kind === "unknown") return t("card.inputUnknown");
      if (inputHandled(run)) {
        return run.input.kind === "permission" ? t("card.denied") : t("card.answered");
      }
      return run.input.kind === "permission" ? run.input.detail : null;
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
    case "ended":
      return run.summary === "failed" ? t(`card.agentResult.${run.agentResult}`) : null;
    case "running":
    case "unknown":
      return null;
  }
}

function noteOf(run: DashboardRun): string | null {
  if (run.state === "disconnected") return t("card.disconnected");
  if (run.state === "waiting-for-input" && run.input?.kind === "permission" && !run.input.denied) {
    return t("card.allowOnRunner");
  }
  return null;
}

export type RunMenuAction = "open-ticket" | "open-pr" | "cancel" | "clear-todo" | "retry";

export function canClearTodo(run: DashboardRun): boolean {
  return run.state === "ended" && run.todoTag === "failed" && run.todoCleared !== undefined;
}

function isClearedFailed(run: DashboardRun): boolean {
  return run.state === "ended" && run.summary === "failed" && run.todoTag === null;
}

function runActionsOf(run: DashboardRun): RunMenuAction[] {
  if (canClearTodo(run)) return ["clear-todo"];
  if (isClearedFailed(run)) return ["retry"];
  return run.state === "ended" || run.cancelling ? [] : ["cancel"];
}

export function runMenuGroups(run: DashboardRun): RunMenuAction[][] {
  const links: RunMenuAction[] = ["open-ticket"];
  if (run.pullRequest !== null && isWebLink(run.pullRequest.url)) links.push("open-pr");
  return [links, runActionsOf(run)].filter((group) => group.length > 0);
}

function menuItemOf(run: DashboardRun, action: RunMenuAction, onSelect: () => void): MenuItem {
  switch (action) {
    case "open-ticket":
      return { key: action, label: t("actions.menu.openTicket"), icon: "external", onSelect };
    case "open-pr": {
      const pr = run.pullRequest?.displayId ?? "";
      return {
        key: action,
        label: t("actions.menu.openPr", { pr }),
        accessibilityLabel: t("runDetail.prLinkLabel", { pr }),
        icon: "external",
        onSelect,
      };
    }
    case "clear-todo":
      return { key: action, label: t("actions.menu.clearTodo"), icon: "check", onSelect };
    case "retry":
      return { key: action, label: t("card.retry"), icon: "retry", onSelect };
    case "cancel":
      return {
        key: action,
        label: t("actions.menu.cancel"),
        icon: "cancel",
        tone: "problem",
        onSelect,
      };
  }
}

function RunMenu({ run, onMenu }: { run: DashboardRun; onMenu: (action: RunMenuAction) => void }) {
  return (
    <PopoverMenu
      label={t("card.menu", { key: run.ticketKey })}
      closeLabel={t("card.menuClose")}
      groups={runMenuGroups(run).map((group) =>
        group.map((action) => menuItemOf(run, action, () => onMenu(action))),
      )}
    />
  );
}

export type RunCardAction = "answer" | "human-check" | "deny" | "resume" | "detail" | "retry";

function actionOf(
  run: DashboardRun,
): { action: RunCardAction; key: MessageKey; variant: ButtonVariant } | null {
  if (inputHandled(run)) return null;
  switch (run.todoTag) {
    case "question":
      return { action: "answer", key: "card.answer", variant: "answer" };
    case "human-check":
      return { action: "human-check", key: "card.check", variant: "check" };
    case "permission":
      return { action: "deny", key: "card.deny", variant: "danger" };
    case "failed":
    case "disconnected":
    case "unknown":
      return { action: "detail", key: "card.detail", variant: "secondary" };
    case "waiting-for-input":
    case null:
      if (run.state === "unknown") {
        return { action: "detail", key: "card.detail", variant: "secondary" };
      }
      return run.state === "paused" &&
        !run.cancelling &&
        (run.control === null || run.control.status === "failed")
        ? { action: "resume", key: "card.resume", variant: "secondary" }
        : null;
  }
}

function timeOf(run: DashboardRun): string | null {
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
    case "unknown":
      return null;
    case "ended":
      return formatAgo(run.endedAt, run.endedAgoMs);
  }
}

function controlNote({ control }: DashboardRun): string | null {
  if (control?.status !== "pending") return null;
  switch (control.control) {
    case "pause":
      return t("card.pausing");
    case "resume":
      return t("card.resuming");
    case "unknown":
      return null;
  }
}

function isStuck(run: DashboardRun): boolean {
  return run.state === "queued" && run.queuedReason.kind === "blockers-stuck";
}

export function RunCard({
  run,
  showWorkspace = false,
  actionsDisabled = false,
  confirming = false,
  onAction,
  onMenu,
}: {
  run: DashboardRun;
  showWorkspace?: boolean;
  actionsDisabled?: boolean;
  confirming?: boolean;
  onAction: (action: RunCardAction) => void;
  onMenu?: (action: RunMenuAction) => void;
}) {
  const pill = pillOf(run);
  const detail = detailOf(run);
  const note = noteOf(run);
  const action = actionOf(run);
  const time = timeOf(run);
  const stuck = isStuck(run);
  const showRetry = run.todoTag === "failed";
  const waitsOnBlockers =
    run.state === "queued" &&
    (run.queuedReason.kind === "blockers-waiting" || run.queuedReason.kind === "blockers-stuck");
  const meta = [
    waitsOnBlockers ? null : (run.runner?.name ?? t("card.noRunner")),
    waitsOnBlockers ? null : agentName(run.agent),
    showWorkspace ? run.workspace.name : null,
    run.cancelling ? t("card.cancelling") : null,
    controlNote(run),
    run.pullRequest === null ? null : t("card.pullRequest", { pr: run.pullRequest.displayId }),
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <Card emphasis={stuck ? "problem" : "none"}>
      <View style={styles.head}>
        <View style={styles.headMain}>
          {pill === null ? null : <StatusPill status={pill} label={t(`status.${pill}`)} />}
          <Text variant="title" numberOfLines={2}>
            <Text variant="meta">{run.ticketKey} </Text>
            {run.ticketTitle}
          </Text>
        </View>
        {onMenu === undefined ? null : <RunMenu run={run} onMenu={onMenu} />}
      </View>
      <BlockerChips run={run} />
      {detail === null ? null : (
        <Text variant="meta" tone={stuck ? "problem" : "secondary"} numberOfLines={2}>
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
      {action === null && !showRetry ? null : (
        <View testID="card-actions" style={styles.actions}>
          <View testID="card-action-row" style={styles.actionRow}>
            {action === null ? null : (
              <View style={styles.actionCell}>
                <Button
                  label={
                    confirming && action.action === "resume"
                      ? t("actions.confirming")
                      : t(action.key)
                  }
                  variant={action.variant}
                  disabled={action.action !== "detail" && actionsDisabled}
                  onPress={() => onAction(action.action)}
                />
              </View>
            )}
            {showRetry ? (
              <View style={styles.actionCell}>
                <Button
                  label={t("card.retry")}
                  disabled={actionsDisabled}
                  onPress={() => onAction("retry")}
                />
              </View>
            ) : null}
          </View>
        </View>
      )}
    </Card>
  );
}

function settledPrLabel(run: EndedRun): string | null {
  if (run.pullRequest === null) return null;
  const pr = run.pullRequest.displayId;
  switch (run.todoCleared === "pr-merged" ? "merged" : run.prState) {
    case "merged":
      return t("card.prMerged", { pr });
    case "closed":
      return t("card.prClosed", { pr });
    case "open":
      return t("card.pullRequest", { pr });
    case "unknown":
      return t("card.prUnread");
    case "none":
      return null;
  }
}

export function SettledRow({
  run,
  showWorkspace = false,
  onMenu,
}: {
  run: EndedRun;
  showWorkspace?: boolean;
  onMenu?: (action: RunMenuAction) => void;
}) {
  const status = run.summary;
  const trailing = [
    showWorkspace ? run.workspace.name : null,
    settledPrLabel(run),
    formatAgo(run.endedAt, run.endedAgoMs),
  ]
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
        <PrChips run={run} />
      </View>
      {onMenu === undefined ? null : <RunMenu run={run} onMenu={onMenu} />}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.s2 },
  headMain: { flex: 1, gap: space.s2 },
  footer: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  meta: { flex: 1 },
  actions: { marginTop: space.s1, gap: space.s2 },
  actionRow: { flexDirection: "row", gap: space.s2 },
  actionCell: { flex: 1 },
  settled: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    paddingVertical: space.s2,
  },
  settledTitle: { flex: 1 },
});
