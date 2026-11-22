import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  CapacityCells,
  Card,
  MotionList,
  NoticeLayout,
  PageHeader,
  PanelList,
  PanelListRow,
  RemovableChip,
  RowTitle,
  ScreenLayout,
  Section,
  SegmentedTabs,
  Select,
  StatusDot,
  Table,
  TableCell,
  TableEmpty,
  TableFoldedOnly,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Text,
} from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useAgentName } from "../labels";
import { RunSheet } from "./run-panel";
import type { WorkspaceSummary } from "@ganger/app/shell/model";
import {
  ENDED_PERIOD_CHOICES,
  RUNNER_CARD_VISIBLE_RUNS,
  WAITING_CARD_VISIBLE_RUNS,
  foldRuns,
  prProblemOf,
  runWord,
  runnerCards,
  situationParts,
  waitingRuns,
} from "@ganger/app/runs/board";
import type {
  BoardRun,
  EndedView,
  RunBoardDays,
  RunWord,
  RunnerCard,
  RunsBoardPage,
  SituationPart,
} from "@ganger/app/runs/board";
import type { ConditionKey } from "@ganger/app/runs/conditions";
import { currentPrState, elapsedMs } from "@ganger/app/runs/model";
import type { RunCondition } from "@ganger/app/runs/model";

export type ClearableCondition = ConditionKey | "f";

const ALL_RUNNERS = "all";

const flexibleTitleColumn = "minmax(0, 1fr)";
const columns = [
  size.ticketKeyColumn,
  flexibleTitleColumn,
  size.runRunnerColumn,
  size.runResultColumn,
  size.timeColumn,
].join(" ");
const foldedColumns = {
  first: [size.ticketKeyColumn, flexibleTitleColumn, size.runResultColumn, size.timeColumn].join(
    " ",
  ),
  second: [flexibleTitleColumn, size.runResultColumn, size.timeColumn].join(" "),
};
const narrowColumns = "minmax(0, 1fr)";

export interface RunsScreenProps {
  page: RunsBoardPage;
  drawKey?: string;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  selectedId: string | undefined;
  outsideRun?: BoardRun | null;
  runnerId?: string | undefined;
  onSelect: (runId: string | undefined) => void;
  onOpen: (runId: string) => void;
  onPickWorkspace: (workspaceId: string) => void;
  onEndedViewChange?: (view: EndedView) => void;
  onPeriodChange?: (days: RunBoardDays) => void;
  onRunnerChange?: (runnerId: string | undefined) => void;
  onShowMoreEnded?: () => void;
  onClearConditions?: (keys: ReadonlyArray<ClearableCondition>) => void;
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
      return <RunsBoard {...props} />;
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

function useSituationText(): (part: SituationPart) => string {
  const t = useTranslations("runs.situation");
  return (part) => {
    switch (part.key) {
      case "runningAndWaiting":
        return t("runningAndWaiting", { running: part.running, waiting: part.waiting });
      case "none":
        return t("none");
      case "disconnected":
      case "running":
      case "waiting":
      case "queued":
        return t(part.key, { count: part.count });
    }
  };
}

function RunsBoard(props: RunsScreenProps) {
  const { page, selectedId, outsideRun, runnerId, onOpen, onClearConditions, runHref } = props;
  const t = useTranslations("runs");
  const opener = useRef<HTMLElement | null>(null);
  const onSelect = (id: string | undefined) => {
    if (id !== undefined && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
    props.onSelect(id);
  };
  const situationText = useSituationText();
  const filterBar = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const focusAfterClear = useRef(false);
  const cards = runnerCards(page.runners, page.active, page.conditions, runnerId);
  const queue = waitingRuns(page.active);
  const selected =
    [...page.active, ...page.ended].find((run) => run.id === selectedId) ??
    (outsideRun?.id === selectedId ? (outsideRun ?? undefined) : undefined);

  useEffect(() => {
    if (!focusAfterClear.current) return;
    focusAfterClear.current = false;
    (
      filterBar.current?.querySelector<HTMLElement>("[data-condition] button") ?? heading.current
    )?.focus();
  }, [page]);

  const hasChips = page.conditions.length > 0 || page.failedOnly;
  return (
    <ScreenLayout
      header={
        <PageHeader
          title={t("title")}
          subtitle={situationParts(page.active).map(situationText).join(" ")}
        />
      }
    >
      <div ref={heading} tabIndex={-1} {...stylex.props(styles.board)}>
        {hasChips ? (
          <div ref={filterBar}>
            <ConditionChips
              conditions={page.conditions}
              failedOnly={page.failedOnly}
              onClear={(keys) => {
                focusAfterClear.current = true;
                onClearConditions?.(keys);
              }}
            />
          </div>
        ) : null}
        <Section title={t("now.title")} titleRole="heading">
          <div {...stylex.props(styles.nowGrid)}>
            <div data-runner-cards {...stylex.props(styles.cards)}>
              {cards.length === 0 ? (
                <Text variant="meta">{t("now.noRunners")}</Text>
              ) : (
                cards.map((card) => (
                  <RunnerRunsCard key={card.id} card={card} onSelect={onSelect} />
                ))
              )}
            </div>
            <div data-waiting-card {...stylex.props(styles.queue)}>
              <Card padding="compact" surface="inset" label={t("now.queueTitle")}>
                <div {...stylex.props(styles.cardBody)}>
                  <span {...stylex.props(styles.cardHead)}>
                    <Text variant="title">{t("now.queueTitle")}</Text>
                    <Text variant="meta" numeric>
                      {queue.length}
                    </Text>
                  </span>
                  {queue.length === 0 ? (
                    <Text variant="meta">{t("now.queueEmpty")}</Text>
                  ) : (
                    <FoldedRuns
                      runs={queue}
                      limit={WAITING_CARD_VISIBLE_RUNS}
                      onSelect={onSelect}
                      trailing="wait"
                    />
                  )}
                </div>
              </Card>
            </div>
          </div>
        </Section>
        <EndedSection {...props} onSelect={onSelect} />
      </div>
      <RunSheet
        run={selected ?? null}
        returnFocus={() =>
          opener.current?.isConnected === true ? opener.current : heading.current
        }
        detailHref={selected === undefined ? "" : runHref(selected.id)}
        onOpenDetail={() => {
          if (selected !== undefined) onOpen(selected.id);
        }}
        onClose={() => onSelect(undefined)}
      />
    </ScreenLayout>
  );
}

function RunnerRunsCard({
  card,
  onSelect,
}: {
  card: RunnerCard;
  onSelect: (runId: string) => void;
}) {
  const t = useTranslations("runs.now");
  return (
    <div data-runner-card={card.id} data-dimmed={card.dimmed ? "" : undefined}>
      <Card padding="compact" label={t("runnerLabel", { name: card.name })}>
        <div {...stylex.props(styles.cardBody)}>
          <span {...stylex.props(styles.cardHead)}>
            <Text variant="title" truncate {...(card.dimmed ? { tone: "muted" as const } : {})}>
              {card.name}
            </Text>
            {card.online ? (
              <CapacityCells
                used={card.used}
                total={card.capacity}
                overflow="meter"
                label={t("seats", { used: card.used, total: card.capacity })}
              />
            ) : (
              <Text variant="meta">{t("offline")}</Text>
            )}
          </span>
          {card.runs.length === 0 ? (
            card.online ? (
              <Text variant="meta">{t("noRuns")}</Text>
            ) : null
          ) : (
            <FoldedRuns
              runs={card.runs}
              limit={RUNNER_CARD_VISIBLE_RUNS}
              onSelect={onSelect}
              trailing="word"
            />
          )}
        </div>
      </Card>
    </div>
  );
}

function FoldedRuns({
  runs,
  limit,
  onSelect,
  trailing,
}: {
  runs: ReadonlyArray<BoardRun>;
  limit: number;
  onSelect: (runId: string) => void;
  trailing: "word" | "wait";
}) {
  const t = useTranslations("runs.now");
  const word = useRunWordText();
  const { duration, elapsed } = useTime();
  const [expanded, setExpanded] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const focusAfterExpand = useRef(false);
  const { shown, hidden } = foldRuns(runs, limit, expanded);
  useEffect(() => {
    if (!focusAfterExpand.current) return;
    focusAfterExpand.current = false;
    list.current?.querySelectorAll<HTMLElement>("button")[limit]?.focus();
  }, [expanded, limit]);
  return (
    <div ref={list} {...stylex.props(styles.runLines)}>
      <PanelList>
        {shown.map((run) => (
          <PanelListRow
            key={run.id}
            marker={<StatusDot status={dotStatus(runWord(run))} />}
            {...(run.ticketTitle === null
              ? { title: run.ticketKey }
              : { ticketKey: run.ticketKey, title: run.ticketTitle })}
            trailing={
              trailing === "wait"
                ? duration(run.waitMs)
                : run.state === "running"
                  ? elapsed(elapsedMs(run))
                  : word(runWord(run))
            }
            onClick={() => onSelect(run.id)}
          />
        ))}
      </PanelList>
      {hidden === 0 ? null : (
        <Button
          variant="ghost"
          onClick={() => {
            focusAfterExpand.current = true;
            setExpanded(true);
          }}
        >
          {t("showMore", { count: hidden })}
        </Button>
      )}
    </div>
  );
}

function dotStatus(word: RunWord): PillStatus {
  switch (word) {
    case "done":
      return "succeeded";
    case "needs-review":
      return "failed";
    case "running":
    case "question":
    case "permission":
    case "human-check":
    case "paused":
    case "disconnected":
    case "queued":
    case "failed":
    case "canceled":
      return word;
  }
}

function useRunWordText(): (word: RunWord) => string {
  const t = useTranslations("runs.word");
  return (word) => t(word);
}

function EndedSection({
  page,
  drawKey = "",
  selectedId,
  runnerId,
  onSelect,
  onEndedViewChange,
  onPeriodChange,
  onRunnerChange,
  onShowMoreEnded,
}: RunsScreenProps) {
  const t = useTranslations("runs.endedRuns");
  const more = useRef<HTMLDivElement>(null);
  const filtered = page.conditions.some((condition) => condition.key !== "days") || page.failedOnly;
  const canLoadMore = page.moreEnded && onShowMoreEnded !== undefined;
  const loadMore = useRef(onShowMoreEnded);
  loadMore.current = onShowMoreEnded;
  const shownCount = page.ended.length;
  useEffect(() => {
    if (!canLoadMore || more.current === null || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      loadMore.current?.();
    });
    observer.observe(more.current);
    return () => observer.disconnect();
  }, [canLoadMore, shownCount]);
  const openRow = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const marker = event.target.closest('[role="option"]')?.querySelector("[data-run-row]");
    const id = marker?.getAttribute("data-run-row");
    if (id !== null && id !== undefined) onSelect(id);
  };
  const periodIsChoice = ENDED_PERIOD_CHOICES.some((days) => days === page.days);
  const runnerValue = runnerId === undefined ? ALL_RUNNERS : runnerId === "" ? null : runnerId;
  return (
    <Section title={t("title")} titleRole="heading" count={page.endedCounts.all}>
      <div {...stylex.props(styles.endedTools)}>
        {page.failedOnly || page.endedCounts.review === 0 ? null : (
          <SegmentedTabs<EndedView>
            value={page.endedView}
            onValueChange={(view) => onEndedViewChange?.(view)}
            label={t("viewLabel")}
            items={[
              {
                value: "review",
                label: t("review"),
                count: page.endedCounts.review,
                attention: true,
              },
              { value: "all", label: t("all"), count: page.endedCounts.all },
            ]}
          />
        )}
        <span {...stylex.props(styles.menus)}>
          <span {...stylex.props(styles.menu)}>
            <Select
              aria-label={t("periodLabel")}
              value={periodIsChoice ? String(page.days) : null}
              placeholder={t("periodOther", { days: page.days })}
              options={ENDED_PERIOD_CHOICES.map((days) => ({
                value: String(days),
                label: t("period", { days }),
              }))}
              onValueChange={(value) => {
                const days = ENDED_PERIOD_CHOICES.find((choice) => String(choice) === value);
                if (days !== undefined) onPeriodChange?.(days);
              }}
            />
          </span>
          <span {...stylex.props(styles.menu)}>
            <Select
              aria-label={t("runnerLabel")}
              value={runnerValue}
              placeholder={t("noRunner")}
              options={[
                { value: ALL_RUNNERS, label: t("allRunners") },
                ...page.runners.map((runner) => ({ value: runner.id, label: runner.name })),
              ]}
              onValueChange={(value) => onRunnerChange?.(value === ALL_RUNNERS ? undefined : value)}
            />
          </span>
        </span>
      </div>
      <Card padding="compact" label={t("listLabel")}>
        <div onClick={openRow}>
          <Table columns={columns} foldedColumns={foldedColumns} narrowColumns={narrowColumns}>
            <TableHead>
              <TableHeader hideWhen="second">{t("columns.key")}</TableHeader>
              <TableHeader>{t("columns.title")}</TableHeader>
              <TableHeader hideWhen="first">{t("columns.runner")}</TableHeader>
              <TableHeader>{t("columns.state")}</TableHeader>
              <TableHeader align="end">{t("columns.time")}</TableHeader>
            </TableHead>
            {page.ended.length === 0 ? (
              <TableEmpty>{filtered ? t("emptyWithConditions") : t("empty")}</TableEmpty>
            ) : null}
            <TableRows
              label={t("listLabel")}
              value={page.ended.some((run) => run.id === selectedId) ? (selectedId ?? null) : null}
              onValueChange={() => {}}
              motionItems
            >
              <MotionList
                key={drawKey}
                items={page.ended}
                getKey={(run) => run.id}
                itemGap="row"
                resetKey={JSON.stringify([page.endedView, page.days, page.conditions])}
              >
                {(run, { leaving }) => (
                  <EndedRow run={run} leaving={leaving} onOpen={() => onSelect(run.id)} />
                )}
              </MotionList>
            </TableRows>
          </Table>
        </div>
      </Card>
      {page.moreEnded ? (
        <div ref={more} {...stylex.props(styles.more)}>
          <Text variant="meta" as="p" role="status">
            {t("loaded", { count: page.ended.length })}
          </Text>
          {canLoadMore ? <Button onClick={onShowMoreEnded}>{t("loadMore")}</Button> : null}
        </div>
      ) : null}
    </Section>
  );
}

function ConditionChips({
  conditions,
  failedOnly,
  onClear,
}: {
  conditions: ReadonlyArray<RunCondition>;
  failedOnly: boolean;
  onClear: (keys: ReadonlyArray<ClearableCondition>) => void;
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
  const chips: Array<{ key: ClearableCondition; text: string }> = [
    ...conditions.map((condition) => ({ key: condition.key, text: text(condition) })),
    ...(failedOnly ? [{ key: "f" as const, text: t("failed") }] : []),
  ];
  return (
    <div role="group" aria-label={t("label")} {...stylex.props(styles.conditions)}>
      {chips.map((chip) => (
        <span key={chip.key} data-condition={chip.key}>
          <RemovableChip
            removeLabel={t("remove", { condition: chip.text })}
            onRemove={() => onClear([chip.key])}
          >
            {chip.text}
          </RemovableChip>
        </span>
      ))}
      {chips.length > 1 ? (
        <Button variant="ghost" onClick={() => onClear(chips.map((chip) => chip.key))}>
          {t("clearAll")}
        </Button>
      ) : null}
    </div>
  );
}

function EndedRow({
  run,
  leaving,
  onOpen,
}: {
  run: BoardRun;
  leaving: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("runs");
  const { ago } = useTime();
  const word = runWord(run);
  const reason = useEndedReason(run);
  const wordText = reason === null ? t(`word.${word}`) : `${t(`word.${word}`)} · ${reason}`;
  const runner = run.runner?.name ?? t("endedRuns.noRunner");
  return (
    <TableRow value={run.id} label={ticketName(run)} onOpen={onOpen} disabled={leaving}>
      <TableCell hideWhen="second">
        <span data-run-row={run.id}>
          {run.ticketTitle === null ? null : (
            <Text variant="meta" numeric>
              {run.ticketKey}
            </Text>
          )}
        </span>
      </TableCell>
      <TableCell>
        <span {...stylex.props(styles.rowText)}>
          {run.ticketTitle === null ? (
            <RowTitle>{run.ticketKey}</RowTitle>
          ) : (
            <RowTitle fullText={run.ticketTitle}>{run.ticketTitle}</RowTitle>
          )}
          <TableFoldedOnly when="first" block>
            <Text variant="meta">{runner}</Text>
          </TableFoldedOnly>
        </span>
      </TableCell>
      <TableCell hideWhen="first">
        <Text variant="meta">{runner}</Text>
      </TableCell>
      <TableCell>
        <Text
          variant="meta"
          {...(word === "failed" || word === "needs-review" ? { tone: "problem" as const } : {})}
        >
          {wordText}
        </Text>
      </TableCell>
      <TableCell align="end" numeric>
        {run.state === "ended" ? ago(run.endedAt, run.endedAgoMs) : null}
      </TableCell>
    </TableRow>
  );
}

function useEndedReason(run: BoardRun): string | null {
  const t = useTranslations("runs.reason");
  const problem = prProblemOf(run);
  if (problem !== null) return t(problem);
  return run.state === "ended" && currentPrState(run) === "merged" ? t("merged") : null;
}

function ticketName(run: BoardRun): string {
  return run.ticketTitle === null ? run.ticketKey : `${run.ticketKey} ${run.ticketTitle}`;
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  board: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    minWidth: 0,
    boxSizing: "border-box",
    containerType: "inline-size",
    outline: "none",
    height: "100%",
    minHeight: 0,
    overflowY: "auto",
    paddingTop: space.s6,
    paddingInline: { default: space.s8, [breakpoints.narrowScreen]: space.s4 },
    paddingBottom: `max(${space.s10}, var(--pinned-toast-space, 0px) + ${space.s10})`,
  },
  nowGrid: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${size.dashboardSideWidth}`,
      [breakpoints.kanbanStacked]: "minmax(0, 1fr)",
    },
    alignItems: "start",
    gap: space.s4,
  },
  cards: {
    order: 1,
    display: "grid",
    gridTemplateColumns: {
      default: `repeat(auto-fill, minmax(${size.todoTextMinWidth}, 1fr))`,
      [breakpoints.kanbanStacked]: "minmax(0, 1fr)",
    },
    alignItems: "start",
    gap: space.s3,
    minWidth: 0,
  },
  queue: {
    order: { default: 2, [breakpoints.kanbanStacked]: 0 },
    minWidth: 0,
  },
  cardBody: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  cardHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    minWidth: 0,
  },
  runLines: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.s1,
    minWidth: 0,
  },
  endedTools: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  menus: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  menu: { width: size.lastRunColumn, maxWidth: "100%" },
  conditions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  more: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
});
