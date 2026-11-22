import { toRunId } from "@ganger/core";
import {
  getRunWithRecords,
  listRunners,
  listRuns,
  listRunsWithRecords,
  listWorkspaces,
  toWorkspaceId,
} from "@ganger/db";
import type { Database, RunRecords, StoredRun } from "@ganger/db";
import { pendingInput } from "../home/load.js";
import { resolveWorkspace } from "../shell/model.js";
import { DAY_MS, DEFAULT_TIME_ZONE, calendarDay } from "../time-zone.js";
import { DEFAULT_ENDED_DAYS, needsReview } from "./board.js";
import type {
  BoardRun,
  EndedView,
  RunBoardConditions,
  RunBoardDays,
  RunnerSeats,
  RunsBoardPage,
} from "./board.js";
import { pickConditions, startOfCalendarDay, toRunsFilter } from "./conditions.js";
import {
  ACTIVE_STATES,
  UNRESOLVED_ENDED_AXES,
  describeConditions,
  isUnresolvedEndedRun,
  runViewBuilder,
} from "./load.js";
import { ENDED_RUNS_PAGE_SIZE } from "./model.js";

export interface RunsBoardOptions {
  endedLimit?: number;
  conditions?: RunBoardConditions;
  view?: EndedView;
  failedOnly?: boolean;
  timeZone?: string;
}

const OCCUPYING_STATES = ["running", "waiting-for-input", "paused", "disconnected"] as const;

export function loadRunsBoard(
  db: Database,
  ws: string | undefined,
  now: Date,
  options: RunsBoardOptions = {},
): RunsBoardPage {
  const {
    endedLimit = ENDED_RUNS_PAGE_SIZE,
    conditions = {},
    view,
    failedOnly = false,
    timeZone = DEFAULT_TIME_ZONE,
  } = options;
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  const days = conditions.days ?? DEFAULT_ENDED_DAYS;
  if (workspace.kind !== "one")
    return {
      workspace,
      active: [],
      ended: [],
      endedCounts: { review: 0, all: 0 },
      endedView: "all",
      failedOnly,
      days,
      moreEnded: false,
      runners: [],
      conditions: [],
    };

  const { runners, toView } = runViewBuilder(db, now);
  const scope = {
    workspaceId: toWorkspaceId(workspace.workspace.id),
    ...toRunsFilter(
      pickConditions({
        runner: conditions.runner,
        project: conditions.project,
        agent: conditions.agent,
      }),
      now,
      timeZone,
    ),
  };
  const endedScope = { ...scope, endedBetween: endedBounds(days, now, timeZone) };

  const toBoardRun = (entry: { run: StoredRun; records: RunRecords }, attention: boolean) =>
    ({
      ...toView(entry, attention),
      runnerId: entry.run.runnerId,
      waitingFor:
        entry.run.state === "waiting-for-input"
          ? (pendingInput(db, entry.run.id)?.kind ?? null)
          : null,
    }) satisfies BoardRun;

  const active = listRunsWithRecords(db, {
    ...scope,
    states: ACTIVE_STATES,
    order: "newest",
  }).map((entry) => toBoardRun(entry, false));

  const unresolvedLatest = new Set(
    listRunsWithRecords(db, {
      ...endedScope,
      latestPerTicket: true,
      endedAxes: UNRESOLVED_ENDED_AXES,
    }).map(({ run }) => run.id),
  );
  const endedRuns = listRunsWithRecords(db, { ...endedScope, states: ["ended"], order: "newest" })
    .map((entry) =>
      toBoardRun(entry, unresolvedLatest.has(entry.run.id) && isUnresolvedEndedRun(entry.run)),
    )
    .filter((run) => !failedOnly || (run.state === "ended" && run.summary === "failed"))
    .toSorted((a, b) => endedTime(b) - endedTime(a));
  const review = endedRuns.filter(needsReview);
  const endedView: EndedView = failedOnly || review.length === 0 ? "all" : (view ?? "review");
  const listed = endedView === "review" ? review : endedRuns;

  return {
    workspace,
    active,
    ended: listed.slice(0, endedLimit),
    endedCounts: { review: review.length, all: endedRuns.length },
    endedView,
    failedOnly,
    days,
    moreEnded: listed.length > endedLimit,
    runners: runnerSeats(db),
    conditions: describeConditions(db, conditions, runners),
  };
}

export function loadBoardRun(
  db: Database,
  ws: string | undefined,
  runId: string,
  now: Date,
): BoardRun | null {
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  if (workspace.kind !== "one") return null;
  const entry = getRunWithRecords(db, toRunId(runId));
  if (entry === null || entry.run.workspaceId !== workspace.workspace.id) return null;
  return {
    ...runViewBuilder(db, now).toView(entry, isUnresolvedEndedRun(entry.run)),
    runnerId: entry.run.runnerId,
    waitingFor:
      entry.run.state === "waiting-for-input"
        ? (pendingInput(db, entry.run.id)?.kind ?? null)
        : null,
  };
}

function runnerSeats(db: Database): RunnerSeats[] {
  const used = new Map<string, number>();
  for (const run of listRuns(db, { states: OCCUPYING_STATES })) {
    if (run.runnerId !== null) used.set(run.runnerId, (used.get(run.runnerId) ?? 0) + 1);
  }
  return listRunners(db).map((runner) => ({
    id: runner.id,
    name: runner.name,
    online: runner.online,
    capacity: runner.capacity,
    used: used.get(runner.id) ?? 0,
  }));
}

function endedBounds(days: RunBoardDays, now: Date, timeZone: string) {
  const lastDay = calendarDay(now, timeZone);
  return {
    from: startOfCalendarDay(lastDay - (days - 1) * DAY_MS, timeZone),
    before: startOfCalendarDay(lastDay + DAY_MS, timeZone),
  };
}

function endedTime(run: BoardRun): number {
  return run.state === "ended" ? Date.parse(run.endedAt) : 0;
}
