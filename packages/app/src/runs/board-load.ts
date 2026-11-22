import { summarizeRunOutcome, toRunId } from "@ganger/core";
import {
  continueRunBlock,
  getRunWithRecords,
  listRunners,
  listRuns,
  listRunsWithRecords,
  listTakenOverRunIds,
  listWorkspaces,
  toWorkspaceId,
} from "@ganger/db";
import type { Database, RunRecords, StoredRun } from "@ganger/db";
import { pendingInput } from "../home/load.js";
import { keptWorktreeOf } from "../run-detail/load.js";
import { runNextStep } from "../run-next-step.js";
import type { NextStepInputWait, RunNextStep } from "../run-next-step.js";
import { resolveWorkspace } from "../shell/model.js";
import { DAY_MS, DEFAULT_TIME_ZONE, calendarDay } from "../time-zone.js";
import { DEFAULT_ENDED_DAYS, needsReview } from "./board.js";
import type {
  BoardRun,
  EndedView,
  HandledInput,
  OtherWorkspaceRuns,
  RunBoardConditions,
  RunBoardDays,
  RunnerSeats,
  RunsBoardPage,
} from "./board.js";
import { pickConditions, startOfCalendarDay, toRunsFilter } from "./conditions.js";
import { ACTIVE_STATES, describeConditions, runViewBuilder } from "./load.js";
import { ENDED_RUNS_PAGE_SIZE } from "./model.js";
import type { RunView } from "./model.js";

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

  const nextStepOf = nextStepReader(db, listRuns(db));
  const toBoardRun = (entry: RunEntry) => boardRun(db, toView(entry, false), entry, nextStepOf);

  const active = listRunsWithRecords(db, {
    ...scope,
    states: ACTIVE_STATES,
    order: "newest",
  }).map(toBoardRun);

  const endedRuns = listRunsWithRecords(db, { ...endedScope, states: ["ended"], order: "newest" })
    .map(toBoardRun)
    .filter((run) => !failedOnly || (run.state === "ended" && run.summary === "failed"))
    .toSorted((a, b) => endedTime(b) - endedTime(a));
  const review = endedRuns.filter(needsReview);
  const narrowed =
    conditions.runner !== undefined ||
    conditions.project !== undefined ||
    conditions.agent !== undefined;
  const endedView: EndedView =
    failedOnly || review.length === 0 ? "all" : (view ?? (narrowed ? "all" : "review"));
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
    runners: runnerSeats(db, workspace.workspace.id),
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
  return withContinue(
    db,
    boardRun(
      db,
      runViewBuilder(db, now).toView(entry, false),
      entry,
      nextStepReader(db, listRuns(db, { ticket: entry.run.ticket })),
    ),
  );
}

function withContinue(db: Database, run: BoardRun): BoardRun {
  return { ...run, canContinue: continueRunBlock(db, toRunId(run.id)) === null };
}

type RunEntry = { run: StoredRun; records: RunRecords };

function boardRun(
  db: Database,
  view: RunView,
  entry: RunEntry,
  nextStepOf: (view: RunView, entry: RunEntry, input: NextStepInputWait) => RunNextStep,
): BoardRun {
  const { run } = entry;
  const pending = run.state === "waiting-for-input" ? pendingInput(db, run.id) : null;
  return {
    ...view,
    runnerId: run.runnerId,
    waitingFor: pending?.kind ?? null,
    handledInput: pending === null ? null : handledInputOf(pending),
    nextStep: nextStepOf(view, entry, pending ?? { kind: "unknown" }),
    canContinue: false,
  };
}

function handledInputOf(input: NextStepInputWait): HandledInput | null {
  switch (input.kind) {
    case "question":
    case "human-check":
      return input.answered ? "answered" : null;
    case "permission":
      return input.denied ? "denied" : null;
    case "unknown":
      return null;
  }
}

function nextStepReader(db: Database, ticketRuns: ReadonlyArray<StoredRun>) {
  const takenOver = listTakenOverRunIds(db);
  const newest = new Map<string, StoredRun>();
  for (const run of ticketRuns) {
    const key = ticketKeyOf(run);
    const current = newest.get(key);
    if (current === undefined || isNewer(run, current)) newest.set(key, run);
  }
  return (view: RunView, { run, records }: RunEntry, input: NextStepInputWait): RunNextStep => {
    const pullRequest = view.pullRequest;
    switch (view.state) {
      case "queued":
        return runNextStep({
          pullRequest,
          cancelling: view.cancelling,
          state: "queued",
          queuedReason: view.queuedReason,
        });
      case "running":
      case "paused":
      case "disconnected":
        return runNextStep({ pullRequest, cancelling: view.cancelling, state: view.state });
      case "waiting-for-input":
        return runNextStep({
          pullRequest,
          cancelling: view.cancelling,
          state: "waiting-for-input",
          input,
        });
      case "ended": {
        if (run.state !== "ended") return "none";
        const taken = takenOver.has(run.id);
        return runNextStep({
          pullRequest,
          state: "ended",
          summary: view.summary,
          prState: view.prState,
          laterPrState: view.laterPrState,
          keptWorktree: taken
            ? null
            : keptWorktreeOf(run, records, summarizeRunOutcome(run).worktree),
          superseded: taken || newest.get(ticketKeyOf(run))?.id !== run.id,
        });
      }
    }
  };
}

function ticketKeyOf(run: StoredRun): string {
  return `${run.ticket.connection}\u0000${run.ticket.key}`;
}

function isNewer(run: StoredRun, than: StoredRun): boolean {
  const diff = run.assignedAt.getTime() - than.assignedAt.getTime();
  return diff > 0 || (diff === 0 && run.id > than.id);
}

function runnerSeats(db: Database, workspaceId: string): RunnerSeats[] {
  const used = new Map<string, number>();
  const elsewhere = new Map<string, string[]>();
  for (const run of listRuns(db, { states: OCCUPYING_STATES })) {
    if (run.runnerId === null) continue;
    used.set(run.runnerId, (used.get(run.runnerId) ?? 0) + 1);
    if (run.workspaceId !== workspaceId)
      elsewhere.set(run.runnerId, [...(elsewhere.get(run.runnerId) ?? []), run.workspaceId]);
  }
  return listRunners(db).map((runner) => ({
    id: runner.id,
    name: runner.name,
    online: runner.online,
    capacity: runner.capacity,
    used: used.get(runner.id) ?? 0,
    otherWorkspaces: otherWorkspaceRuns(elsewhere.get(runner.id) ?? []),
  }));
}

function otherWorkspaceRuns(workspaceIds: ReadonlyArray<string>): OtherWorkspaceRuns {
  const distinct = new Set(workspaceIds);
  const [only] = distinct;
  return {
    count: workspaceIds.length,
    onlyWorkspaceId: distinct.size === 1 && only !== undefined ? only : null,
  };
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
