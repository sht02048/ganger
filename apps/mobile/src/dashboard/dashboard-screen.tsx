import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Button, RestingMascot, Segment, Sheet, SwitchRow } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { dashboardSummary } from "../format";
import { t } from "../i18n";
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
  onAction,
}: {
  runs: DashboardRun[];
  showWorkspace: boolean;
  onAction: () => void;
}) {
  return (
    <>
      {runs.map((run) => (
        <RunCard key={run.id} run={run} showWorkspace={showWorkspace} onAction={onAction} />
      ))}
    </>
  );
}

function ColumnBody({
  board,
  column,
  todoOnly,
  showWorkspace,
  onAction,
}: {
  board: Board;
  column: ColumnKey;
  todoOnly: boolean;
  showWorkspace: boolean;
  onAction: () => void;
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
    <RunList runs={runs} showWorkspace={showWorkspace} onAction={onAction} />
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
}: {
  snapshot: MobileSnapshot;
  view: DashboardView;
  onViewChange: (next: DashboardView) => void;
  onOpenRunners: () => void;
  onOpenSettings: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [demoNotice, setDemoNotice] = useState(false);
  const { workspaceId, todoOnly } = view;
  const dashboard = useMemo(() => snapshot.dashboardFor(workspaceId), [snapshot, workspaceId]);
  const board = useMemo(() => buildBoard(dashboard), [dashboard]);
  const column = view.column ?? firstColumn(board);
  const issues = dashboard.summary.runnerIssues;
  const workspaceName =
    snapshot.workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    t("dashboard.allWorkspaces");
  const openDemoNotice = () => setDemoNotice(true);
  const chooseWorkspace = (id: string) => {
    onViewChange({ ...view, workspaceId: id });
    setPicking(false);
  };

  return (
    <View style={styles.root}>
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
            {dashboardSummary(dashboard)}
          </Text>
        </View>
        {hasNoRuns(dashboard) ? (
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
              onAction={openDemoNotice}
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
      <Sheet
        visible={demoNotice}
        title={t("settings.serverDemo")}
        closeLabel={t("common.close")}
        onClose={() => setDemoNotice(false)}
      >
        <Text variant="body">{t("common.demoAction")}</Text>
        <Button label={t("common.close")} onPress={() => setDemoNotice(false)} />
      </Sheet>
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
