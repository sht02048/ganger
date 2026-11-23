import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AppDashboard } from "@ganger/api";
import { AccessibilityInfo, ScrollView, StyleSheet, View } from "react-native";

import { Button, RestingMascot, Segment, Sheet, SwitchRow } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { dashboardSummary } from "../format";
import { t } from "../i18n";
import { sheetKindFor } from "../notifications/push-data";
import { demoRunPort } from "../runs/run-port";
import type { RunPort } from "../runs/run-port";
import { RunSheets, outcomeMessage } from "../runs/run-sheets";
import type { OpenRunSheet } from "../runs/run-sheets";
import type { MobileSnapshot } from "../screen-model";
import {
  ALL_WORKSPACES,
  buildBoard,
  columnRestCount,
  columnTodoCount,
  firstColumn,
  hasNoRuns,
} from "./model";
import type { Board, ColumnKey, DashboardRun } from "./model";
import { RunCard, SettledRow } from "./run-card";
import type { RunCardAction } from "./run-card";

const COLUMNS: ReadonlyArray<ColumnKey> = ["queued", "running", "done"];

export interface DashboardView {
  workspaceId: string;
  column: ColumnKey | null;
  todoOnly: boolean;
}

export const INITIAL_DASHBOARD_VIEW: DashboardView = {
  workspaceId: ALL_WORKSPACES,
  column: null,
  todoOnly: false,
};

function countLine(board: Board, column: ColumnKey): string {
  const todo = columnTodoCount(board, column);
  const rest = t("dashboard.countRest", {
    column: t(`dashboard.column.${column}`),
    count: columnRestCount(board, column),
  });
  return todo === 0
    ? rest
    : [t("dashboard.countTodo", { count: todo }), rest].join(t("dashboard.countSeparator"));
}

function RunList({
  runs,
  showWorkspace,
  actionsDisabled,
  resumingRunIds,
  confirmingRunIds,
  onAction,
  onMenu,
}: {
  runs: DashboardRun[];
  showWorkspace: boolean;
  actionsDisabled: boolean;
  resumingRunIds: ReadonlySet<string>;
  confirmingRunIds: ReadonlySet<string>;
  onAction: (run: DashboardRun, action: RunCardAction) => void;
  onMenu: (run: DashboardRun) => void;
}) {
  return (
    <>
      {runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          showWorkspace={showWorkspace}
          actionsDisabled={actionsDisabled || resumingRunIds.has(run.id)}
          confirming={confirmingRunIds.has(run.id)}
          onAction={(action) => onAction(run, action)}
          onMenu={() => onMenu(run)}
        />
      ))}
    </>
  );
}

function ColumnBody({
  board,
  column,
  todoOnly,
  showWorkspace,
  actionsDisabled,
  resumingRunIds,
  confirmingRunIds,
  onAction,
  onMenu,
}: {
  board: Board;
  column: ColumnKey;
  todoOnly: boolean;
  showWorkspace: boolean;
  actionsDisabled: boolean;
  resumingRunIds: ReadonlySet<string>;
  confirmingRunIds: ReadonlySet<string>;
  onAction: (run: DashboardRun, action: RunCardAction) => void;
  onMenu: (run: DashboardRun) => void;
}) {
  const hasTodo = columnTodoCount(board, column) > 0;
  const hasRest = columnRestCount(board, column) > 0;
  if (todoOnly ? !hasTodo : !hasTodo && !hasRest) {
    return (
      <View style={styles.columnEmpty}>
        <Text variant="meta">
          {todoOnly ? t("dashboard.columnEmpty.todo") : t(`dashboard.columnEmpty.${column}`)}
        </Text>
      </View>
    );
  }
  const list = (runs: DashboardRun[]) => (
    <RunList
      runs={runs}
      showWorkspace={showWorkspace}
      actionsDisabled={actionsDisabled}
      resumingRunIds={resumingRunIds}
      confirmingRunIds={confirmingRunIds}
      onAction={onAction}
      onMenu={onMenu}
    />
  );
  switch (column) {
    case "queued":
      return todoOnly ? null : list(board.queued);
    case "running":
      return (
        <>
          {board.running.humanCheck.length === 0 ? null : (
            <Text variant="meta" tone="secondary" heading>
              {t("dashboard.humanCheckGroup")}
            </Text>
          )}
          {list(board.running.humanCheck)}
          {list(board.running.todo)}
          {todoOnly ? null : list(board.running.rest)}
        </>
      );
    case "done":
      return (
        <>
          {list(board.done.todo)}
          {todoOnly ? null : list(board.done.unknownState)}
          {todoOnly || board.done.settled.length === 0 ? null : (
            <View>
              <Text variant="meta" tone="secondary" heading>
                {t("dashboard.settledGroup")}
              </Text>
              {board.done.settled.map((run) => (
                <SettledRow key={run.id} run={run} showWorkspace={showWorkspace} />
              ))}
            </View>
          )}
        </>
      );
  }
}

function runsOf({ columns }: AppDashboard): DashboardRun[] {
  const { queued, running, done } = columns;
  return [...queued, ...running.todo, ...running.rest, ...done.todo, ...done.rest];
}

export function DashboardScreen({
  snapshot,
  view,
  onViewChange,
  onOpenRunners,
  onOpenSettings,
  band = null,
  actionsDisabled = false,
  port = demoRunPort,
  onRetry,
  openRun = null,
  openRunSettled = false,
  onOpenRunHandled,
}: {
  snapshot: MobileSnapshot;
  view: DashboardView;
  onViewChange: (next: DashboardView) => void;
  onOpenRunners: () => void;
  onOpenSettings: () => void;
  band?: ReactNode;
  actionsDisabled?: boolean;
  port?: RunPort;
  onRetry?: () => void;
  openRun?: { id: string; action: boolean } | null;
  openRunSettled?: boolean;
  onOpenRunHandled?: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [sheet, setSheet] = useState<OpenRunSheet | null>(null);
  const previewedRunId = useRef<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<OpenRunSheet | null>(null);
  const [resumingRunIds, setResumingRunIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmingRunIds, setConfirmingRunIds] = useState<ReadonlySet<string>>(new Set());
  const resume = async (run: DashboardRun) => {
    setResumingRunIds((current) => new Set(current).add(run.id));
    const outcome = await port.write(run, { action: "resume" }, () => {
      setConfirmingRunIds((current) => new Set(current).add(run.id));
      AccessibilityInfo.announceForAccessibility(t("actions.confirming"));
    });
    const without = (current: ReadonlySet<string>) =>
      new Set([...current].filter((id) => id !== run.id));
    setResumingRunIds(without);
    setConfirmingRunIds(without);
    const message = outcomeMessage("resume", outcome);
    if (message !== null) {
      const title =
        outcome.kind === "demo"
          ? t("settings.serverDemo")
          : outcome.kind === "unconfirmed"
            ? t("actions.unconfirmedTitle")
            : t("actions.resumeFailedTitle");
      setResumeNotice({ kind: "notice", title, message });
    }
  };
  const runAction = (run: DashboardRun, action: RunCardAction) => {
    if (action === "resume") void resume(run);
    else setSheet({ kind: action, run });
  };
  const { workspaceId, todoOnly } = view;
  const dashboard = useMemo(() => snapshot.dashboardFor(workspaceId), [snapshot, workspaceId]);
  const board = useMemo(() => (dashboard === null ? null : buildBoard(dashboard)), [dashboard]);
  const column = view.column ?? (board === null ? "running" : firstColumn(board));
  const issues = dashboard?.summary.runnerIssues ?? 0;
  const openingColumn =
    view.column === null && dashboard !== null && board !== null && !hasNoRuns(dashboard)
      ? firstColumn(board)
      : null;
  useEffect(() => {
    if (openingColumn !== null) onViewChange({ ...view, column: openingColumn });
  }, [openingColumn, onViewChange, view]);
  useEffect(() => {
    if (openRun === null || dashboard === null) return;
    const run = runsOf(dashboard).find((candidate) => candidate.id === openRun.id);
    if (!openRunSettled && run === undefined) return;
    if (!openRunSettled && openRun.action) {
      if (run === undefined || previewedRunId.current === openRun.id) return;
      if ((port.cachedDetail?.(run) ?? null) === null) return;
      previewedRunId.current = openRun.id;
      setSheet({ kind: "detail", run });
      return;
    }
    const previewed = previewedRunId.current === openRun.id;
    previewedRunId.current = null;
    if (run !== undefined) {
      const hasCachedDetail = (port.cachedDetail?.(run) ?? null) !== null;
      const kind =
        actionsDisabled && hasCachedDetail ? "detail" : sheetKindFor(run, openRun.action);
      setSheet((current) => {
        if (!previewed) return { kind, run };
        if (kind === "detail" || current === null || current.kind === "notice") return current;
        return current.run.id === run.id ? { kind, run } : current;
      });
    }
    onOpenRunHandled?.();
  }, [openRun, openRunSettled, dashboard, onOpenRunHandled, port, actionsDisabled]);
  const workspaceName =
    snapshot.workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    t("dashboard.allWorkspaces");
  const chooseWorkspace = (id: string) => {
    onViewChange({ ...view, workspaceId: id, column: id === workspaceId ? view.column : null });
    setPicking(false);
  };

  return (
    <View style={styles.root}>
      {band}
      <View style={styles.topBar}>
        <View style={styles.workspace}>
          <Button
            compact
            label={workspaceName}
            accessibilityLabel={t("dashboard.workspaceButton", { name: workspaceName })}
            onPress={() => setPicking(true)}
          />
        </View>
        <Button
          compact
          label={t("dashboard.runners")}
          accessibilityLabel={
            issues === 0
              ? t("dashboard.runners")
              : t("dashboard.runnersWithIssues", { count: issues })
          }
          issueCount={issues}
          onPress={onOpenRunners}
        />
        <Button compact label={t("dashboard.settings")} onPress={onOpenSettings} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text variant="page" heading>
            {t("dashboard.title")}
          </Text>
          <Text variant="meta" tone="secondary">
            {dashboard !== null
              ? dashboardSummary(dashboard)
              : onRetry === undefined
                ? t("common.loading")
                : t("connection.noWorkspaceData")}
          </Text>
        </View>
        {dashboard === null && onRetry !== undefined ? (
          <Button label={t("common.retry")} onPress={onRetry} />
        ) : null}
        {dashboard === null || board === null ? null : hasNoRuns(dashboard) ? (
          <View style={styles.empty}>
            <RestingMascot />
            <Text variant="body">{t("dashboard.empty")}</Text>
          </View>
        ) : (
          <>
            <Segment
              options={COLUMNS.map((value) => {
                const todoCount = columnTodoCount(board, value);
                const label = t(`dashboard.column.${value}`);
                return {
                  value,
                  label,
                  todoCount,
                  todoLabel: t("dashboard.todoCount", { count: todoCount }),
                  accessibilityLabel:
                    todoCount === 0
                      ? label
                      : t("dashboard.columnWithTodo", { column: label, count: todoCount }),
                };
              })}
              value={column}
              onChange={(next) => onViewChange({ ...view, column: next })}
            />
            <Text variant="small">{countLine(board, column)}</Text>
            <SwitchRow
              label={t("dashboard.todoOnly")}
              value={todoOnly}
              onChange={(next) => onViewChange({ ...view, todoOnly: next })}
            />
            <ColumnBody
              board={board}
              column={column}
              todoOnly={todoOnly}
              showWorkspace={workspaceId === ALL_WORKSPACES}
              actionsDisabled={actionsDisabled}
              resumingRunIds={resumingRunIds}
              confirmingRunIds={confirmingRunIds}
              onAction={runAction}
              onMenu={(run) => setSheet({ kind: "menu", run })}
            />
          </>
        )}
      </ScrollView>
      <Sheet
        visible={picking}
        title={t("dashboard.chooseWorkspace")}
        closeLabel={t("common.close")}
        onClose={() => setPicking(false)}
      >
        <Button
          label={t("dashboard.allWorkspaces")}
          onPress={() => chooseWorkspace(ALL_WORKSPACES)}
        />
        {snapshot.workspaces.map((workspace) => (
          <Button
            key={workspace.id}
            label={workspace.name}
            onPress={() => chooseWorkspace(workspace.id)}
          />
        ))}
      </Sheet>
      <RunSheets
        sheet={sheet ?? resumeNotice}
        port={port}
        disabled={actionsDisabled}
        onClose={() => (sheet === null ? setResumeNotice(null) : setSheet(null))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
  },
  workspace: { flex: 1, alignItems: "flex-start" },
  content: { padding: space.s4, gap: space.s3 },
  heading: { gap: space.s1 },
  columnEmpty: { paddingVertical: space.s8, alignItems: "center" },
  empty: { alignItems: "center", gap: space.s4, paddingVertical: space.s8 },
});
