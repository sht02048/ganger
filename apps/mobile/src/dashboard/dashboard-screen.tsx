import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Button, RestingMascot, Segment, Sheet, SwitchRow } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { dashboardSummary } from "../format";
import { t } from "../i18n";
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
  resumingRunId,
  onAction,
  onMenu,
}: {
  runs: DashboardRun[];
  showWorkspace: boolean;
  actionsDisabled: boolean;
  resumingRunId: string | null;
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
          actionsDisabled={actionsDisabled || resumingRunId === run.id}
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
  resumingRunId,
  onAction,
  onMenu,
}: {
  board: Board;
  column: ColumnKey;
  todoOnly: boolean;
  showWorkspace: boolean;
  actionsDisabled: boolean;
  resumingRunId: string | null;
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
      resumingRunId={resumingRunId}
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
}) {
  const [picking, setPicking] = useState(false);
  const [sheet, setSheet] = useState<OpenRunSheet | null>(null);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const resume = async (run: DashboardRun) => {
    setResumingRunId(run.id);
    const outcome = await port.write(run, { action: "resume" });
    setResumingRunId(null);
    const message = outcomeMessage("resume", outcome);
    if (message !== null) {
      const title =
        outcome.kind === "demo" ? t("settings.serverDemo") : t("actions.resumeFailedTitle");
      setSheet({ kind: "notice", title, message });
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
              resumingRunId={resumingRunId}
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
        sheet={sheet}
        port={port}
        disabled={actionsDisabled}
        onOpen={setSheet}
        onClose={() => setSheet(null)}
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
