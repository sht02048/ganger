import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { Button, IssueBadge, RestingMascot, Segment, Sheet, SwitchRow } from "../design/components";
import { Text } from "../design/text";
import { colors, radius, size, space } from "../design/tokens";
import type { HomeRun, MobileSnapshot } from "../demo/contract";
import { dashboardSummary } from "../format";
import { t } from "../i18n";
import {
  buildBoard,
  columnRestCount,
  columnTodoCount,
  firstColumn,
  runnerIssueCount,
} from "./model";
import type { Board, ColumnKey } from "./model";
import { RunCard, SettledRow } from "./run-card";

const COLUMNS: ReadonlyArray<ColumnKey> = ["queued", "running", "done"];
const ALL_WORKSPACES = "all";

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

function RunList({ runs, onAction }: { runs: HomeRun[]; onAction: () => void }) {
  return (
    <>
      {runs.map((run) => (
        <RunCard key={run.id} run={run} onAction={onAction} />
      ))}
    </>
  );
}

function ColumnBody({
  board,
  column,
  todoOnly,
  onAction,
}: {
  board: Board;
  column: ColumnKey;
  todoOnly: boolean;
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
  switch (column) {
    case "queued":
      return <RunList runs={board.queued} onAction={onAction} />;
    case "running":
      return (
        <>
          {board.running.humanCheck.length === 0 ? null : (
            <Text variant="meta" tone="secondary" heading>
              {t("dashboard.humanCheckGroup")}
            </Text>
          )}
          <RunList runs={board.running.humanCheck} onAction={onAction} />
          <RunList runs={board.running.todo} onAction={onAction} />
          {todoOnly ? null : <RunList runs={board.running.rest} onAction={onAction} />}
        </>
      );
    case "done":
      return (
        <>
          <RunList runs={board.done.todo} onAction={onAction} />
          {todoOnly || board.done.settled.length === 0 ? null : (
            <View>
              <Text variant="meta" tone="secondary" heading>
                {t("dashboard.settledGroup")}
              </Text>
              {board.done.settled.flatMap((run) =>
                run.state === "ended" ? [<SettledRow key={run.id} run={run} />] : [],
              )}
            </View>
          )}
        </>
      );
  }
}

function HeaderButton({
  label,
  accessibilityLabel,
  badge = 0,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={styles.headerButton}
    >
      <Text variant="meta" tone="primary" numberOfLines={1}>
        {label}
      </Text>
      <IssueBadge count={badge} />
    </Pressable>
  );
}

export function DashboardScreen({
  snapshot,
  now,
  onOpenRunners,
  onOpenSettings,
}: {
  snapshot: MobileSnapshot;
  now: Date;
  onOpenRunners: () => void;
  onOpenSettings: () => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(ALL_WORKSPACES);
  const [picking, setPicking] = useState(false);
  const [demoNotice, setDemoNotice] = useState(false);
  const [todoOnly, setTodoOnly] = useState(false);
  const runs = useMemo(
    () =>
      workspaceId === ALL_WORKSPACES
        ? snapshot.runs
        : snapshot.runs.filter((run) => run.workspace.id === workspaceId),
    [snapshot.runs, workspaceId],
  );
  const board = useMemo(() => buildBoard(runs, now), [runs, now]);
  const [column, setColumn] = useState<ColumnKey>(() => firstColumn(board));
  const issues = runnerIssueCount(snapshot.runners);
  const workspaceName =
    snapshot.workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    t("dashboard.allWorkspaces");
  const openDemoNotice = () => setDemoNotice(true);
  const chooseWorkspace = (id: string) => {
    setWorkspaceId(id);
    setPicking(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <View style={styles.workspace}>
          <HeaderButton
            label={workspaceName}
            accessibilityLabel={`${t("dashboard.chooseWorkspace")}, ${workspaceName}`}
            onPress={() => setPicking(true)}
          />
        </View>
        <HeaderButton
          label={t("dashboard.runners")}
          accessibilityLabel={
            issues === 0
              ? t("dashboard.runners")
              : t("dashboard.runnersWithIssues", { count: issues })
          }
          badge={issues}
          onPress={onOpenRunners}
        />
        <HeaderButton label={t("dashboard.settings")} onPress={onOpenSettings} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text variant="page" heading>
            {t("dashboard.title")}
          </Text>
          <Text variant="meta" tone="secondary">
            {dashboardSummary(board, snapshot.runners)}
          </Text>
        </View>
        {snapshot.runs.length === 0 ? (
          <View style={styles.empty}>
            <RestingMascot />
            <Text variant="body">{t("dashboard.empty")}</Text>
          </View>
        ) : (
          <>
            <Segment
              options={COLUMNS.map((value) => {
                const todoCount = columnTodoCount(board, value);
                return {
                  value,
                  label: t(`dashboard.column.${value}`),
                  todoCount,
                  todoLabel: t("dashboard.todoCount", { count: todoCount }),
                };
              })}
              value={column}
              onChange={setColumn}
            />
            <Text variant="small">{countLine(board, column)}</Text>
            <SwitchRow label={t("dashboard.todoOnly")} value={todoOnly} onChange={setTodoOnly} />
            <ColumnBody
              board={board}
              column={column}
              todoOnly={todoOnly}
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
  headerButton: {
    minHeight: size.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    paddingHorizontal: space.s3,
    borderRadius: radius.button,
    backgroundColor: colors.bgControl,
  },
  content: { padding: space.s4, gap: space.s3 },
  heading: { gap: space.s1 },
  columnEmpty: { paddingVertical: space.s8, alignItems: "center" },
  empty: { alignItems: "center", gap: space.s4, paddingVertical: space.s8 },
});
