import * as stylex from "@stylexjs/stylex";
import {
  Button,
  buttonStyles,
  CapacityCells,
  Card,
  KanbanCards,
  KanbanColumn,
  KanbanSubheading,
  MotionList,
  MotionScope,
  PageHeader,
  ProblemCallout,
  Row,
  ScreenLayout,
  Section,
  SegmentedTabs,
  StatusDot,
  Text,
  showToast,
} from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import { USAGE_HIGH_PERCENT } from "@ganger/core";
import type { RunControl, RunId } from "@ganger/core";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useUsageNames } from "../labels";
import { useStatusName } from "../status";
import type { HumanCheckDecision } from "@ganger/app/home/actions";
import type { DashboardRunner, HomePage, HomeRun } from "@ganger/app/home/model";
import type { RunControlOutcome } from "@ganger/app/run-control-view";
import {
  dashboardBoard,
  freeCapacity,
  limitedRunners,
  loadHighRunners,
  readyAgainInMs,
  runnerIssues,
  todoGroupOf,
  todoGroups,
} from "@ganger/app/home/model";
import { cardTag, RunCard } from "./run-card";
import type { SheetMode } from "./run-card";
import { RunSheet } from "./run-sheet";
import type { SheetTarget } from "./run-sheet";
import { href } from "./run-text";

export { runHref } from "./run-text";

export interface AnswerInput {
  runId: string;
  questionId: string;
  answer: string;
}

export interface HumanCheckInput {
  runId: string;
  questionId: string;
  decision: HumanCheckDecision;
  note: string;
}

export interface DenyInput {
  runId: string;
  promptId: string;
  reason: string;
}

export interface ControlInput {
  runId: string;
  control: RunControl;
}

export const DASHBOARD_VIEWS = ["all", "todo"] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

export interface HomeScreenProps {
  page: HomePage;
  drawKey?: string;
  view?: DashboardView;
  onViewChange?: (view: DashboardView) => void;
  onAnswer: (input: AnswerInput) => Promise<void>;
  onHumanCheck: (input: HumanCheckInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
  onControl: (input: ControlInput) => Promise<RunControlOutcome>;
  openRunId?: RunId | undefined;
  onOpenRunShown?: () => void;
}

export const COLUMN_VISIBLE = 6;
export const DONE_TODO_VISIBLE = 4;
export const SETTLED_VISIBLE = 5;

interface CardHost {
  all: boolean;
  listKey: string;
  lastTags: ReadonlyMap<RunId, PillStatus | null>;
  selectedId: RunId | null;
  revealedId: RunId | null;
  sheetRunId: RunId | null;
  cardRef: (id: RunId) => (element: HTMLButtonElement | null) => void;
  focusCard: (id: RunId) => void;
  onOpen: (run: HomeRun, tagged: boolean, mode: SheetMode) => void;
  onControl: (run: HomeRun, control: RunControl, focusAfter?: () => void) => Promise<boolean>;
}

export function HomeScreen({
  page,
  drawKey = "",
  view = "all",
  onViewChange = () => {},
  onAnswer,
  onHumanCheck,
  onDeny,
  onControl,
  openRunId,
  onOpenRunShown = () => {},
}: HomeScreenProps) {
  const t = useTranslations("home");
  const cards = useRef(new Map<RunId, HTMLButtonElement>());
  const workspaceScope = `${workspaceScopeOf(page)}:${drawKey}`;
  const [tagMemory, setTagMemory] = useState(() => newTagMemory(workspaceScope));
  let lastTags = tagMemory.tags;
  if (tagMemory.scope !== workspaceScope) {
    const cleared = newTagMemory(workspaceScope);
    lastTags = cleared.tags;
    setTagMemory(cleared);
  }
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [revealedId, setRevealedId] = useState<RunId | null>(null);
  const shownRunId = useRef<RunId | undefined>(undefined);
  useControlFailureToasts(page);
  useEffect(() => {
    if (page.workspace.kind === "none") return;
    const { queued, running, done } = dashboardBoard(page);
    for (const run of [...running.todo, ...done.todo]) {
      lastTags.set(run.id, cardTag(run, true));
    }
    for (const run of [...queued, ...running.rest, ...done.rest]) {
      lastTags.set(run.id, cardTag(run, false));
    }
  }, [page, lastTags]);
  useEffect(() => {
    if (openRunId === undefined || shownRunId.current === openRunId) return;
    if (page.workspace.kind === "none") return;
    shownRunId.current = openRunId;
    const run = boardRuns(dashboardBoard(page)).find((candidate) => candidate.id === openRunId);
    onOpenRunShown();
    if (run === undefined) return;
    const tagged = page.attention.some((item) => item.run.id === run.id);
    setRevealedId(run.id);
    setTarget({ run, tagged, mode: opensAnswer(run) ? "answer" : "summary" });
    setOpen(true);
  }, [openRunId, page, onOpenRunShown]);
  if (page.workspace.kind === "none") {
    return (
      <ScreenLayout header={<PageHeader title={t("title")} subtitle={t("noWorkspace")} />}>
        {null}
      </ScreenLayout>
    );
  }
  const all = page.workspace.kind === "all";
  const board = dashboardBoard(page);
  const todoOnly = view === "todo";
  const fresh =
    target === null ? undefined : boardRuns(board).find((run) => run.id === target.run.id);
  const host: CardHost = {
    all,
    lastTags,
    listKey: `${workspaceScope}:${view}`,
    selectedId: open && target !== null ? target.run.id : null,
    revealedId,
    sheetRunId: target?.run.id ?? null,
    cardRef: (id) => (element) => {
      if (element === null) cards.current.delete(id);
      else cards.current.set(id, element);
    },
    focusCard: (id) => cards.current.get(id)?.focus(),
    onOpen: (run, tagged, mode) => {
      setTarget({ run, tagged, mode });
      setOpen(true);
    },
    onControl: (run, control, focusAfter) => {
      const key = run.ticketKey;
      return onControl({ runId: run.id, control }).then(
        (outcome) => {
          if (focusAfter === undefined) cards.current.get(run.id)?.focus();
          else focusAfter();
          showToast(
            outcome === "requested"
              ? t(`control.${control}Requested`, { key })
              : t("control.stateChanged", { key }),
          );
          return true;
        },
        () => {
          showToast(t(`control.${control}Rejected`, { key }));
          return false;
        },
      );
    },
  };
  const runningTodo = new Set(board.running.todo.map((run) => run.id));
  const humanChecks = board.running.todo.filter((run) => todoGroupOf(run) === "check");
  const otherTodo = board.running.todo.filter((run) => todoGroupOf(run) !== "check");
  const todoIds = new Set(page.attention.map(({ run }) => run.id));
  const doneCount = todoOnly
    ? board.done.todo.length
    : board.done.todo.length + board.done.rest.length;
  return (
    <ScreenLayout
      header={
        <PageHeader
          title={all ? `${t("title")} · ${t("allWorkspaces")}` : t("title")}
          subtitle={<DashboardSummary page={page} />}
          actions={
            <SegmentedTabs<DashboardView>
              value={view}
              onValueChange={onViewChange}
              label={t("view.label")}
              items={[
                { value: "all", label: t("view.all") },
                {
                  value: "todo",
                  label: t("view.todo"),
                  count: page.attention.length,
                  attention: true,
                },
              ]}
            />
          }
        />
      }
    >
      <div {...stylex.props(styles.page)}>
        <div {...stylex.props(styles.frame)}>
          <div {...stylex.props(styles.board)}>
            <MotionScope key={workspaceScope} move="card">
              <KanbanColumn title={t("column.queued")} count={todoOnly ? 0 : board.queued.length}>
                <CardList
                  runs={todoOnly ? [] : board.queued}
                  tagged={() => false}
                  limit={COLUMN_VISIBLE}
                  empty={todoOnly ? t("columnEmpty.todo") : t("columnEmpty.queued")}
                  host={host}
                />
              </KanbanColumn>
              <KanbanColumn
                title={t("column.running")}
                count={
                  todoOnly
                    ? board.running.todo.length
                    : board.running.todo.length + board.running.rest.length
                }
              >
                <div
                  data-todo-group={humanChecks.length === 0 ? undefined : "check"}
                  {...stylex.props(styles.settled)}
                >
                  {humanChecks.length === 0 ? null : (
                    <KanbanSubheading>{t("board.humanCheck")}</KanbanSubheading>
                  )}
                  <CardList
                    runs={humanChecks}
                    tagged={() => true}
                    limit={COLUMN_VISIBLE}
                    empty={null}
                    host={host}
                  />
                </div>
                <CardList
                  runs={todoOnly ? otherTodo : [...otherTodo, ...board.running.rest]}
                  tagged={(run) => runningTodo.has(run.id)}
                  limit={COLUMN_VISIBLE}
                  empty={
                    humanChecks.length > 0
                      ? null
                      : todoOnly
                        ? t("columnEmpty.todo")
                        : t("columnEmpty.running")
                  }
                  host={host}
                />
              </KanbanColumn>
              <KanbanColumn
                title={t("column.done")}
                count={doneCount}
                headLink={{
                  href: endedRunsHref(page),
                  label: t("board.doneLink", { column: t("column.done"), count: doneCount }),
                }}
              >
                <CardList
                  runs={board.done.todo}
                  tagged={() => true}
                  limit={DONE_TODO_VISIBLE}
                  empty={
                    todoOnly
                      ? t("columnEmpty.todo")
                      : board.done.rest.length === 0
                        ? t("columnEmpty.done")
                        : null
                  }
                  host={host}
                />
                <SettledCards runs={todoOnly ? [] : board.done.rest} host={host} />
              </KanbanColumn>
            </MotionScope>
            <div {...stylex.props(styles.runners)}>
              <RunnersSection runners={page.runners.list} runnersPath={runnersHref(page)} />
            </div>
          </div>
        </div>
        <RunSheet
          target={
            fresh === undefined || target === null
              ? target
              : { ...target, run: fresh, tagged: todoIds.has(fresh.id) }
          }
          open={open}
          onOpenChange={setOpen}
          finalFocus={() => (target === null ? null : (cards.current.get(target.run.id) ?? null))}
          all={all}
          onAnswer={onAnswer}
          onHumanCheck={onHumanCheck}
          onDeny={onDeny}
          onControl={host.onControl}
        />
      </div>
    </ScreenLayout>
  );
}

function workspaceScopeOf(page: HomePage): string {
  return page.workspace.kind === "one" ? `one:${page.workspace.workspace.id}` : page.workspace.kind;
}

function newTagMemory(scope: string) {
  return { scope, tags: new Map<RunId, PillStatus | null>() };
}

function boardRuns(board: ReturnType<typeof dashboardBoard>): HomeRun[] {
  return [
    ...board.queued,
    ...board.running.todo,
    ...board.running.rest,
    ...board.done.todo,
    ...board.done.rest,
  ];
}

function opensAnswer(run: HomeRun): boolean {
  return (
    run.state === "waiting-for-input" &&
    (run.input?.kind === "question" || run.input?.kind === "human-check") &&
    !run.input.answered
  );
}

function DashboardSummary({ page }: { page: HomePage }) {
  const t = useTranslations("home");
  const { duration } = useTime();
  const groups = todoGroups(page.attention);
  const total = page.attention.length;
  const inProgress = page.running.length + page.queued.length;
  const limited = limitedRunners(page.runners);
  const readyTimes = limited.flatMap((runner) => {
    const ms = readyAgainInMs(runner);
    return ms === null ? [] : [ms];
  });
  const limitSentence =
    limited.length === 0
      ? null
      : readyTimes.length === 0
        ? t("summary.limitUnknown", { count: limited.length })
        : t("summary.limit", {
            count: limited.length,
            duration: duration(Math.min(...readyTimes)),
          });
  const work =
    total === 0
      ? inProgress === 0
        ? t("summary.idle")
        : t("summary.inProgress", { count: inProgress })
      : t("summary.sentence", {
          list: groups
            .map((group) => t(`summary.${group.kind}`, { count: group.runs.length }))
            .join(t("summary.separator")),
        });
  return limitSentence === null ? work : t("summary.withLimit", { work, limit: limitSentence });
}

function CardList({
  runs,
  tagged,
  limit,
  empty,
  host,
}: {
  runs: HomeRun[];
  tagged: (run: HomeRun) => boolean;
  limit: number;
  empty: string | null;
  host: CardHost;
}) {
  const t = useTranslations("home.board");
  const [expanded, setExpanded] = useState(false);
  const focusAfterExpand = useRef<RunId | null>(null);
  useEffect(() => {
    const id = focusAfterExpand.current;
    if (!expanded || id === null) return;
    focusAfterExpand.current = null;
    host.focusCard(id);
  }, [expanded, host]);
  const revealed = runs.slice(limit).some((run) => run.id === host.revealedId);
  const showAll = expanded || revealed;
  const visible = showAll ? runs : runs.slice(0, limit);
  const hidden = runs.length - visible.length;
  return (
    <>
      {runs.length === 0 && empty !== null ? (
        <Text variant="meta" as="p">
          {empty}
        </Text>
      ) : null}
      <AnimatedCards
        runs={visible}
        tagged={tagged}
        resetKey={`${host.listKey}:${showAll ? "all" : "limited"}`}
        host={host}
      />
      {hidden > 0 ? (
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              focusAfterExpand.current = runs[limit]?.id ?? null;
              setExpanded(true);
            }}
          >
            {t("more", { count: hidden })}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function AnimatedCards({
  runs,
  tagged,
  resetKey,
  host,
}: {
  runs: HomeRun[];
  tagged: (run: HomeRun) => boolean;
  resetKey: string;
  host: CardHost;
}) {
  return (
    <KanbanCards motionItems>
      <MotionList
        as="li"
        items={runs}
        getKey={(run) => run.id}
        highlightRadius="card"
        itemGap="card"
        resetKey={resetKey}
        itemAttributes={(run, { leaving }) => ({
          "data-run": leaving ? undefined : run.id,
          "data-tag": leaving ? undefined : (cardTag(run, tagged(run)) ?? undefined),
        })}
      >
        {(run, { leaving }) => (
          <RunCard
            run={run}
            tagged={tagged(run)}
            all={host.all}
            selected={!leaving && host.selectedId === run.id}
            lastTags={host.lastTags}
            openRef={leaving ? null : host.cardRef(run.id)}
            onOpen={(mode) => host.onOpen(run, tagged(run), mode)}
            onControl={(control) => host.onControl(run, control)}
          />
        )}
      </MotionList>
    </KanbanCards>
  );
}

function SettledCards({ runs, host }: { runs: HomeRun[]; host: CardHost }) {
  const t = useTranslations("home.board");
  const first = runs.slice(0, SETTLED_VISIBLE);
  const revealed = runs.slice(SETTLED_VISIBLE).find((run) => run.id === host.sheetRunId);
  const visible = revealed === undefined ? first : [...first, revealed];
  return (
    <div data-settled={runs.length === 0 ? undefined : ""} {...stylex.props(styles.settled)}>
      {runs.length === 0 ? null : <KanbanSubheading>{t("settled")}</KanbanSubheading>}
      <AnimatedCards
        runs={visible}
        tagged={() => false}
        resetKey={`${host.listKey}:${revealed?.id ?? "first"}`}
        host={host}
      />
    </div>
  );
}

function RunnersSection({
  runners,
  runnersPath,
}: {
  runners: DashboardRunner[];
  runnersPath: (sel?: string) => string;
}) {
  const t = useTranslations("home");
  const { duration } = useTime();
  const issues = runnerIssues({ list: runners });
  const offline = issues
    .filter((runner) => runner.cause === "offline")
    .map((runner) =>
      runner.offlineMs === null
        ? runner.name
        : t("runners.offlineName", { name: runner.name, duration: duration(runner.offlineMs) }),
    );
  const auth = issues.filter((runner) => runner.cause === "auth").map((runner) => runner.name);
  const names = useUsageNames();
  const limited = limitedRunners({ list: runners });
  const limitLines = limited.flatMap((runner) =>
    runner.limits.map((limit) => {
      const values = {
        provider: names.provider(limit.provider),
        window: names.window(limit.window),
        name: runner.name,
      };
      return {
        key: `${runner.id}:${limit.provider}:${limit.window}`,
        text:
          limit.resetsInMs === null
            ? t("runners.limitUnknown", values)
            : t("runners.limit", { ...values, duration: duration(limit.resetsInMs) }),
      };
    }),
  );
  const problemCount = new Set([...issues, ...limited].map((runner) => runner.id)).size;
  const loadHigh = loadHighRunners({ list: runners });
  const loadOnly = problemCount === 0 && loadHigh.length > 0;
  const loadTitle = t("runners.loadTitle", { count: loadHigh.length });
  return (
    <Card surface="plain" label={t("section.runners")}>
      <Section
        title={t("section.runners")}
        titleRole="subheading"
        headingLevel="h2"
        count={runners.length}
        {...(runners.length === 0
          ? {}
          : { note: t("runners.free", { count: freeCapacity({ list: runners }) }) })}
      >
        {runners.length === 0 ? (
          <Text variant="meta" as="p">
            {t("empty.runners")}
          </Text>
        ) : (
          <div {...stylex.props(styles.sideBlock)}>
            <ul {...stylex.props(styles.rows)}>
              {runners.map((runner) => (
                <RunnerRow key={runner.id} runner={runner} href={runnersPath(runner.id)} />
              ))}
            </ul>
            {problemCount === 0 && loadHigh.length === 0 ? null : (
              <ProblemCallout
                title={loadOnly ? loadTitle : t("runners.problemTitle", { count: problemCount })}
                actions={
                  <a
                    href={runnersPath()}
                    data-variant="secondary"
                    {...stylex.props(...buttonStyles("secondary"))}
                  >
                    {loadOnly ? t("runners.loadView") : t("runners.fix")}
                  </a>
                }
              >
                {offline.length === 0 ? null : (
                  <p {...stylex.props(styles.reset)}>
                    {t("runners.offline", { names: offline.join(", ") })}
                  </p>
                )}
                {auth.length === 0 ? null : (
                  <p {...stylex.props(styles.reset)}>
                    {t("runners.auth", { names: auth.join(", ") })}
                  </p>
                )}
                {limitLines.map((line) => (
                  <p key={line.key} {...stylex.props(styles.reset)}>
                    {line.text}
                  </p>
                ))}
                {loadHigh.length === 0 || loadOnly ? null : (
                  <p {...stylex.props(styles.reset)}>{loadTitle}</p>
                )}
                {loadHigh.flatMap((runner) => loadLines(runner, t))}
                {loadHigh.length === 0 ? null : (
                  <p {...stylex.props(styles.reset)}>{t("runners.loadNote")}</p>
                )}
              </ProblemCallout>
            )}
          </div>
        )}
      </Section>
    </Card>
  );
}

function loadLines(runner: DashboardRunner, t: ReturnType<typeof useTranslations<"home">>) {
  const { cpuPercent, memoryPercent } = runner.loadHigh ?? {
    cpuPercent: null,
    memoryPercent: null,
  };
  return [
    ...(cpuPercent === null
      ? []
      : [
          <p key={`${runner.id}:cpu`} {...stylex.props(styles.reset)}>
            {t("runners.loadCpu", { name: runner.name, percent: Math.round(cpuPercent) })}
          </p>,
        ]),
    ...(memoryPercent === null
      ? []
      : [
          <p key={`${runner.id}:memory`} {...stylex.props(styles.reset)}>
            {t("runners.loadMemory", { name: runner.name, percent: Math.round(memoryPercent) })}
          </p>,
        ]),
  ];
}

function runnerStatus(runner: DashboardRunner): PillStatus {
  switch (runner.cause) {
    case null:
      return "online";
    case "offline":
      return "offline";
    case "auth":
      return "runner-issue";
  }
}

function RunnerRow({ runner, href: rowHref }: { runner: DashboardRunner; href: string }) {
  const t = useTranslations("home.runners");
  const statusName = useStatusName();
  const status = runnerStatus(runner);
  return (
    <li data-runner={runner.id}>
      <Row
        href={rowHref}
        leading={<StatusDot status={status}>{statusName(status)}</StatusDot>}
        trailing={
          <CapacityCells
            used={runner.used}
            total={runner.capacity}
            label={t("capacity", { used: runner.used, total: runner.capacity })}
            tone={runner.cause === null ? "progress" : "problem"}
          />
        }
      >
        <span {...stylex.props(styles.runnerText)}>
          <Text variant="title" truncate>
            {runner.name}
          </Text>
          <RunnerUsage runner={runner} />
        </span>
      </Row>
    </li>
  );
}

function RunnerUsage({ runner }: { runner: DashboardRunner }) {
  const t = useTranslations("home.runners");
  const names = useUsageNames();
  if (runner.loadHigh !== null) {
    const { cpuPercent, memoryPercent } = runner.loadHigh;
    return (
      <Text variant="meta" numeric tone="problem">
        {cpuPercent !== null
          ? t("rowLoadCpu", { percent: Math.round(cpuPercent) })
          : t("rowLoadMemory", { percent: Math.round(memoryPercent ?? 0) })}
      </Text>
    );
  }
  if (runner.usage === null) return null;
  const { provider, window, usedPercent } = runner.usage;
  return (
    <Text
      variant="meta"
      numeric
      {...(usedPercent >= USAGE_HIGH_PERCENT ? { tone: "problem" } : {})}
    >
      {t("usage", {
        provider: names.provider(provider),
        window: names.window(window),
        percent: Math.round(usedPercent),
      })}
    </Text>
  );
}

function runnersHref(page: HomePage): (sel?: string) => string {
  const ws = page.workspace.kind === "one" ? { ws: page.workspace.workspace.id } : {};
  return (sel) => href("/runners", { ...ws, ...(sel === undefined ? {} : { sel }) });
}

function endedRunsHref(page: HomePage): string {
  const ws = page.workspace.kind === "one" ? { ws: page.workspace.workspace.id } : {};
  return href("/runs", { ...ws, view: "all" });
}

const styles = stylex.create({
  page: {
    height: "100%",
    overflow: "auto",
    paddingTop: space.s8,
    paddingInline: { default: space.s8, [breakpoints.narrowScreen]: space.s4 },
    paddingBottom: space.s10,
  },
  frame: { containerType: "inline-size" },
  board: {
    display: "grid",
    gridTemplateColumns: {
      default: `repeat(3, minmax(0, 1fr)) ${size.dashboardSideWidth}`,
      [breakpoints.kanbanRunnersBelow]: "repeat(3, minmax(0, 1fr))",
      [breakpoints.kanbanStacked]: "minmax(0, 1fr)",
    },
    alignItems: "start",
    columnGap: space.s4,
    rowGap: { default: space.s4, [breakpoints.kanbanRunnersBelow]: space.s8 },
  },
  runners: {
    gridColumn: {
      default: "auto",
      [breakpoints.kanbanRunnersBelow]: "1 / -1",
      [breakpoints.kanbanStacked]: "1 / -1",
    },
    minWidth: 0,
    paddingInlineStart: {
      default: space.s4,
      [breakpoints.kanbanRunnersBelow]: 0,
      [breakpoints.kanbanStacked]: 0,
    },
    paddingTop: { default: space.s3, [breakpoints.kanbanStacked]: space.s4 },
  },
  settled: {
    display: { default: "flex", ":not(:has(li))": "none" },
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
  },
  sideBlock: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  runnerText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  rows: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  reset: { margin: 0 },
});

function useControlFailureToasts(page: HomePage): void {
  const t = useTranslations("home");
  const domain = useTranslations("domain");
  const pending = useRef(new Set<RunId>());
  useEffect(() => {
    const nowPending = new Set<RunId>();
    for (const run of page.running) {
      const control = run.control;
      if (control?.status === "pending") nowPending.add(run.id);
      if (control?.status === "failed" && pending.current.has(run.id)) {
        showToast(
          t(control.control === "pause" ? "control.pauseFailed" : "control.resumeFailed", {
            key: run.ticketKey,
            reason: domain(`runControlFailure.${control.reason}`),
          }),
        );
      }
    }
    pending.current = nowPending;
  }, [page, t, domain]);
}
