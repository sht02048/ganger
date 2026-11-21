import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  DetailPanel,
  MotionList,
  PageHeader,
  RowTitle,
  ScreenLayout,
  SplitView,
  StatusPill,
  Tab,
  Table,
  TableCell,
  TableEmpty,
  TableFoldedOnly,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Tabs,
  Text,
  NoticeLayout,
  RemovableChip,
  SegmentedTabs,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useAgentName } from "../labels";
import { runStatus, useStatusName } from "../status";
import { RunPanel } from "./run-panel";
import type { WorkspaceSummary } from "@ganger/app/shell/model";
import {
  ENDED_RUNS_PAGE_SIZE,
  RUN_GROUP_FILTERS,
  RUN_STATUS_FILTERS,
  currentPrState,
  elapsedMs,
  isGroupFilter,
  matchesFilter,
  needsAttention,
} from "@ganger/app/runs/model";
import type { ConditionKey } from "@ganger/app/runs/conditions";
import type {
  RunCondition,
  RunFilter,
  RunFilterKey,
  RunGroupFilter,
  RunView,
  RunsPage,
} from "@ganger/app/runs/model";

const titleColumn = `minmax(0, ${size.runTitleMaxColumn})`;
const flexibleTitleColumn = "minmax(0, 1fr)";
const resultColumn = `minmax(${size.runResultColumn}, 1fr)`;
const columns = [
  size.ticketKeyColumn,
  titleColumn,
  size.runRunnerColumn,
  resultColumn,
  size.runStatusColumn,
  size.timeColumn,
].join(" ");
const foldedColumns = {
  first: [
    size.ticketKeyColumn,
    flexibleTitleColumn,
    size.runRunnerColumn,
    size.runStatusColumn,
    size.timeColumn,
  ].join(" "),
  second: [size.ticketKeyColumn, flexibleTitleColumn, size.runStatusColumn, size.timeColumn].join(
    " ",
  ),
  third: [flexibleTitleColumn, size.runStatusColumn, size.timeColumn].join(" "),
};
const narrowColumns = "minmax(0, 1fr)";

export interface RunsScreenProps {
  page: RunsPage;
  drawKey?: string;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  filter: RunFilter;
  endedLimit?: number;
  selectedId: string | undefined;
  onFilterChange: (filter: RunFilter) => void;
  onSelect: (runId: string) => void;
  onOpen: (runId: string) => void;
  onPickWorkspace: (workspaceId: string) => void;
  onShowMoreEnded?: () => void;
  onClearConditions?: (keys: ReadonlyArray<ConditionKey>) => void;
  runHref: (runId: string) => string;
}

export function RunsScreen(props: RunsScreenProps) {
  const { page } = props;
  switch (page.workspace.kind) {
    case "none":
      return <Notice body={<NoWorkspace />} />;
    case "all":
      return (
        <Notice
          body={
            <AllWorkspaces workspaces={props.workspaces} onPickWorkspace={props.onPickWorkspace} />
          }
        />
      );
    case "one":
      return <RunsList {...props} />;
  }
}

function Notice({ body }: { body: ReactNode }) {
  const t = useTranslations("runs");
  return (
    <ScreenLayout header={<PageHeader title={t("title")} />}>
      <NoticeLayout>{body}</NoticeLayout>
    </ScreenLayout>
  );
}

function NoWorkspace() {
  const t = useTranslations("runs");
  return <Text variant="body">{t("noWorkspace")}</Text>;
}

function AllWorkspaces({
  workspaces,
  onPickWorkspace,
}: {
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onPickWorkspace: (workspaceId: string) => void;
}) {
  const t = useTranslations("runs.allWorkspaces");
  return (
    <div {...stylex.props(styles.stack)}>
      <Text variant="body">{t("body")}</Text>
      <Actions>
        {workspaces.map((w) => (
          <Button key={w.id} onClick={() => onPickWorkspace(w.id)}>
            {t("pick", { name: w.name })}
          </Button>
        ))}
      </Actions>
    </div>
  );
}

function RunsList({
  page,
  drawKey = "",
  filter,
  endedLimit,
  selectedId,
  onFilterChange,
  onSelect,
  onOpen,
  onShowMoreEnded,
  onClearConditions,
  runHref,
}: RunsScreenProps) {
  const t = useTranslations("runs");
  const statusName = useStatusName();
  const visible = page.runs.filter((run) => matchesFilter(run, filter));
  const selected = visible.find((run) => run.id === selectedId) ?? visible[0];
  const attention = page.runs.filter(needsAttention).length;
  const countOf = (key: RunFilter) => page.runs.filter((run) => matchesFilter(run, key)).length;
  const showMoreButton = useRef<HTMLButtonElement>(null);
  const endedStatus = useRef<HTMLParagraphElement>(null);
  const focusAfterMore = useRef(false);
  const filterBar = useRef<HTMLDivElement>(null);
  const focusAfterClear = useRef(false);
  const filtered = page.conditions.length > 0;
  const workspaceId = page.workspace.kind === "one" ? page.workspace.workspace.id : "";
  const listKey = JSON.stringify([workspaceId, filter, page.conditions, endedLimit ?? null]);
  useEffect(() => {
    if (focusAfterMore.current) {
      focusAfterMore.current = false;
      (showMoreButton.current ?? endedStatus.current)?.focus();
    }
    if (focusAfterClear.current) {
      focusAfterClear.current = false;
      const bar = filterBar.current;
      (
        bar?.querySelector<HTMLElement>("[data-condition] button") ??
        bar?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")
      )?.focus();
    }
  }, [page]);

  return (
    <ScreenLayout
      header={
        <PageHeader
          title={t("title")}
          subtitle={t(page.moreEnded ? "subtitleRecent" : "subtitle", {
            total: page.runs.length,
            attention,
          })}
        />
      }
    >
      <SplitView
        fill={false}
        list={
          <div {...stylex.props(styles.listColumn)}>
            <div ref={filterBar} {...stylex.props(styles.filterBar)}>
              <SegmentedTabs<RunGroupFilter>
                value={isGroupFilter(filter) ? filter : null}
                onValueChange={onFilterChange}
                label={t("filter.groupLabel")}
                items={RUN_GROUP_FILTERS.map((key) => ({
                  value: key,
                  label: t(`filter.${key}`),
                  count: countOf(key),
                  attention: key === "attention",
                }))}
              />
              <Tabs<RunFilterKey>
                value={isGroupFilter(filter) ? null : filter}
                onValueChange={onFilterChange}
                label={t("filter.statusLabel")}
                variant="chips"
              >
                {RUN_STATUS_FILTERS.map((key) => (
                  <Tab key={key} value={key} count={countOf(key)}>
                    {statusName(key)}
                  </Tab>
                ))}
              </Tabs>
              {page.conditions.length === 0 ? null : (
                <ConditionChips
                  conditions={page.conditions}
                  onClear={(keys) => {
                    focusAfterClear.current = true;
                    onClearConditions?.(keys);
                  }}
                />
              )}
            </div>
            <Card padding="compact" label={t("listLabel")}>
              <Table columns={columns} foldedColumns={foldedColumns} narrowColumns={narrowColumns}>
                <TableHead>
                  <TableHeader hideWhen="stacked">{t("columns.key")}</TableHeader>
                  <TableHeader>{t("columns.title")}</TableHeader>
                  <TableHeader hideWhen="second">{t("columns.runner")}</TableHeader>
                  <TableHeader hideWhen="first">{t("columns.result")}</TableHeader>
                  <TableHeader>{t("columns.status")}</TableHeader>
                  <TableHeader align="end">{t("columns.time")}</TableHeader>
                </TableHead>
                {visible.length === 0 ? (
                  <TableEmpty>
                    {page.runs.length > 0
                      ? t("empty")
                      : filtered
                        ? t("noRunsWithConditions")
                        : t("noRuns")}
                  </TableEmpty>
                ) : null}
                <TableRows
                  label={t("listLabel")}
                  value={selected?.id ?? null}
                  onValueChange={onSelect}
                  motionItems
                >
                  <MotionList
                    key={drawKey}
                    items={visible}
                    getKey={(run) => run.id}
                    itemGap="row"
                    resetKey={listKey}
                  >
                    {(run, { leaving }) => (
                      <RunRow run={run} leaving={leaving} onOpen={() => onOpen(run.id)} />
                    )}
                  </MotionList>
                </TableRows>
              </Table>
            </Card>
            {page.moreEnded || page.recentEnded > ENDED_RUNS_PAGE_SIZE ? (
              <div {...stylex.props(styles.more)}>
                <Text variant="meta" as="p" ref={endedStatus} role="status" tabIndex={-1}>
                  {page.moreEnded
                    ? t("ended.partial", { count: page.recentEnded })
                    : t("ended.all", { count: page.recentEnded })}
                </Text>
                {page.moreEnded && onShowMoreEnded !== undefined ? (
                  <Button
                    ref={showMoreButton}
                    onClick={() => {
                      focusAfterMore.current = true;
                      onShowMoreEnded();
                    }}
                  >
                    {t("ended.showMore")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        }
        panel={
          <section aria-label={t("panel.label")}>
            {selected === undefined ? (
              <DetailPanel>
                <Text variant="meta">
                  {page.runs.length > 0
                    ? t("panel.empty")
                    : filtered
                      ? t("panel.noRunsWithConditions")
                      : t("panel.noRuns")}
                </Text>
              </DetailPanel>
            ) : (
              <RunPanel
                run={selected}
                detailHref={runHref(selected.id)}
                onOpenDetail={() => onOpen(selected.id)}
              />
            )}
          </section>
        }
      />
    </ScreenLayout>
  );
}

function ConditionChips({
  conditions,
  onClear,
}: {
  conditions: ReadonlyArray<RunCondition>;
  onClear: (keys: ReadonlyArray<ConditionKey>) => void;
}) {
  const t = useTranslations("runs.conditions");
  const agentName = useAgentName();
  const text = (condition: RunCondition): string => {
    switch (condition.key) {
      case "runner":
        return condition.name === null ? t("noRunner") : t("runner", { name: condition.name });
      case "project":
        return t("project", { name: condition.name });
      case "agent":
        return t("agent", { name: agentName(condition.agent) });
      case "days":
        return t("days", { days: condition.days });
    }
  };
  return (
    <div role="group" aria-label={t("label")} {...stylex.props(styles.conditions)}>
      {conditions.map((condition) => (
        <span key={condition.key} data-condition={condition.key}>
          <RemovableChip
            removeLabel={t("remove", { condition: text(condition) })}
            onRemove={() => onClear([condition.key])}
          >
            {text(condition)}
          </RemovableChip>
        </span>
      ))}
      {conditions.length > 1 ? (
        <Button variant="ghost" onClick={() => onClear(conditions.map((c) => c.key))}>
          {t("clearAll")}
        </Button>
      ) : null}
    </div>
  );
}

function RunRow({ run, leaving, onOpen }: { run: RunView; leaving: boolean; onOpen: () => void }) {
  const t = useTranslations("runs");
  const { ago, elapsed } = useTime();
  const statusName = useStatusName();
  const status = runStatus(run);
  const runner = run.runner?.name ?? (run.state === "ended" ? t("noRunnerEnded") : t("noRunner"));
  const result = useRunResultText(run);

  return (
    <TableRow value={run.id} label={ticketName(run)} onOpen={onOpen} disabled={leaving}>
      <TableCell hideWhen="stacked">
        {run.ticketTitle === null ? null : (
          <Text variant="meta" numeric>
            {run.ticketKey}
          </Text>
        )}
      </TableCell>
      <TableCell>
        <span {...stylex.props(styles.rowText)}>
          {run.ticketTitle === null ? (
            <RowTitle>{run.ticketKey}</RowTitle>
          ) : (
            <RowTitle fullText={run.ticketTitle}>{run.ticketTitle}</RowTitle>
          )}
          <TableFoldedOnly when="first" block>
            <Text variant="meta">
              {run.ticketTitle === null ? null : (
                <TableFoldedOnly when="stacked">
                  <Text variant="meta" numeric>
                    {run.ticketKey}
                  </Text>
                  {t("metaSeparator")}
                </TableFoldedOnly>
              )}
              <TableFoldedOnly when="second">
                {runner}
                {t("metaSeparator")}
              </TableFoldedOnly>
              {result}
            </Text>
          </TableFoldedOnly>
          <PrMarks run={run} />
        </span>
      </TableCell>
      <TableCell hideWhen="second">
        <Text variant="meta">{runner}</Text>
      </TableCell>
      <TableCell hideWhen="first">
        <Text variant="meta">{result}</Text>
      </TableCell>
      <TableCell>
        <StatusPill status={status} changeMotion>
          {statusName(status)}
        </StatusPill>
      </TableCell>
      <TableCell align="end" numeric>
        {run.state === "ended"
          ? ago(run.endedAt, run.endedAgoMs)
          : run.state === "paused"
            ? t("pausedFor", { elapsed: elapsed(elapsedMs(run)) })
            : elapsed(elapsedMs(run))}
      </TableCell>
    </TableRow>
  );
}

function PrMarks({ run }: { run: RunView }) {
  const t = useTranslations("runs");
  const signals = run.pullRequest?.signals ?? null;
  if (signals === null) return null;
  const behindBy = signals.behindBy ?? 0;
  if (!signals.ciFailed && signals.conflict !== true && behindBy === 0) return null;
  return (
    <span data-pr-marks {...stylex.props(styles.prMarks)}>
      {signals.ciFailed ? (
        <Text variant="meta" tone="problem">
          {t("prMarks.ciFailed")}
        </Text>
      ) : null}
      {signals.conflict === true ? (
        <Text variant="meta" tone="problem">
          {t("prMarks.conflict")}
        </Text>
      ) : null}
      {behindBy > 0 ? <Text variant="meta">{t("prMarks.behind", { count: behindBy })}</Text> : null}
    </span>
  );
}

function useRunResultText(run: RunView): string {
  const t = useTranslations("runs");
  const domain = useTranslations("domain");
  const agentName = useAgentName();
  const parts: string[] = [];
  if (run.state === "ended") {
    parts.push(domain(`agentResult.${run.agentResult}`));
    if (run.prState === "unknown")
      parts.push(
        run.pullRequest === null
          ? t("prUnread")
          : t("prUnreadWithPr", { pr: run.pullRequest.displayId }),
      );
    else if (run.pullRequest !== null)
      parts.push(
        t("prWithState", {
          pr: run.pullRequest.displayId,
          state: domain(`prState.${currentPrState(run)}`),
        }),
      );
    else if (currentPrState(run) !== "none") parts.push(domain(`prState.${currentPrState(run)}`));
  } else {
    parts.push(agentName(run.agent));
    if (run.cancelling) parts.push(t("cancelling"));
  }
  return parts.join(t("metaSeparator"));
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  listColumn: { minWidth: 0 },
  filterBar: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s3,
    marginBottom: space.s4,
  },
  conditions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  more: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    marginTop: space.s4,
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  prMarks: { display: "flex", flexWrap: "wrap", columnGap: space.s2, minWidth: 0 },
});

function ticketName(run: RunView): string {
  return run.ticketTitle === null ? run.ticketKey : `${run.ticketKey} ${run.ticketTitle}`;
}
