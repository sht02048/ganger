import { randomUUID } from "node:crypto";
import {
  NOT_STARTED_AGENT_RESULTS,
  checkAssignment,
  checkManualRunnerChoice,
  pickRunner,
  summarizeRunOutcome,
  toRunId,
  transitionRun,
} from "@ganger/core";
import type {
  AgentId,
  AgentRef,
  AgentCheck,
  AgentResult,
  CiState,
  CommentId,
  ContinuationPlace,
  InvalidRunTransition,
  NotStartedAgentResult,
  PauseSource,
  PrReadError,
  PrState,
  PullRequestId,
  PullRequestSignals,
  ReadPrState,
  Run,
  RunId,
  RunPlacement,
  RunState,
  RunnerId,
  RunnerProjectId,
  TicketKey,
  TicketRef,
  TrackerConnectionId,
  WorktreeKeptReason,
  TrackerProjectId,
  WorktreeRef,
} from "@ganger/core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { recordChange, recordRunChange } from "./change-events.js";
import type { Database } from "./database.js";
import { inTransaction, onCommit } from "./database.js";
import { log } from "@ganger/log";
import type { WorkspaceId } from "./ids.js";
import { runStateChanges, runs } from "./schema.js";
import type { LATER_PR_STATES } from "./schema.js";
import { getWorkspaceTrackerProject, listRunnerSnapshots } from "./settings.js";

export type StoredRun = Run & {
  workspaceId: WorkspaceId;
  ticketTitle: string | null;
  continuedFromRunId: RunId | null;
  runnerChosen: boolean;
};

export function isPinnedToRunner(
  run: Pick<StoredRun, "continuedFromRunId" | "runnerChosen">,
): boolean {
  return run.continuedFromRunId !== null || run.runnerChosen;
}

export interface RunRecords {
  startRequestedAt: Date | null;
  startFailures: number;
  startError: string | null;
  reportBody: string | null;
  agentBrief: string | null;
  continueMessage: string | null;
  continuePlace: ContinuationPlace | null;
  agentCheck: AgentCheck | null;
  agentStopRequestedAt: Date | null;
  pullRequest: {
    id: PullRequestId;
    displayId: string;
    url: string;
    ci: CiState;
    checkedAt: Date;
    signals?: PullRequestSignals | null;
    signalsReadAt?: Date | null;
    headCommit?: string;
  } | null;
  laterPrState: { state: (typeof LATER_PR_STATES)[number]; at: Date } | null;
  prReadError: PrReadError | null;
  worktreeRemovedAt: Date | null;
  worktreeKept: WorktreeKeptReason | null;
  worktreeRemoveRequestedAt: Date | null;
  trackerStateSetAt: Date | null;
  mergedStateSetAt: Date | null;
  trackerComment: { id: CommentId; at: Date } | null;
  unreachableSince: Date | null;
  pausedSince: Date | null;
  pausedMs: number;
  pauseSource: PauseSource | null;
  lastLog: string[] | null;
}

export const LAST_LOG_LINES = 200;

type RunRow = typeof runs.$inferSelect;

export class RunRowError extends Error {
  constructor(runId: RunId, message: string) {
    super(`run ${runId}: ${message}`);
    this.name = "RunRowError";
  }
}

function toStoredRun(row: RunRow): StoredRun {
  const base = {
    id: row.id,
    workspaceId: row.workspaceId,
    ticket: { connection: row.trackerConnectionId, key: row.ticketKey },
    ticketTitle: row.ticketTitle,
    continuedFromRunId: row.continuedFromRunId,
    runnerChosen: row.runnerChosen,
    trackerProject: row.trackerProjectId,
    runnerProject: row.runnerProjectId,
    agent: row.agentId,
    model: row.model,
    worktreeName: row.worktreeName,
    assignedAt: row.assignedAt,
  };
  if (row.state === "queued") {
    return { ...base, state: row.state, runnerId: row.runnerId };
  }
  if (row.state === "ended" && row.startedAt === null) {
    const { endedAt, agentResult, prState } = row;
    if (endedAt === null || !isNotStartedResult(agentResult) || prState !== "none") {
      throw new RunRowError(row.id, "not-started ended run without end time or with started axes");
    }
    return {
      ...base,
      state: row.state,
      runnerId: row.runnerId,
      worktree: null,
      branch: null,
      agentRef: null,
      startedAt: null,
      endedAt,
      agentResult,
      prState,
      runnerUnreached: false,
    };
  }
  const { runnerId, worktreeRef: worktree, startedAt, branch, agentRef } = row;
  if (
    runnerId === null ||
    worktree === null ||
    startedAt === null ||
    branch === null ||
    agentRef === null
  ) {
    throw new RunRowError(
      row.id,
      `${row.state} run without runner, worktree, branch or start time`,
    );
  }
  const started = { runnerId, worktree, branch, agentRef, startedAt };
  if (row.state !== "ended") {
    return { ...base, ...started, state: row.state };
  }
  const { endedAt, agentResult, prState } = row;
  if (endedAt === null || agentResult === null || prState === null) {
    throw new RunRowError(row.id, "ended run without end time or the two axes");
  }
  return {
    ...base,
    ...started,
    state: row.state,
    endedAt,
    agentResult,
    prState,
    runnerUnreached: row.runnerUnreached,
  };
}

function isNotStartedResult(result: AgentResult | null): result is NotStartedAgentResult {
  return NOT_STARTED_AGENT_RESULTS.some((r) => r === result);
}

function toRunRecords(row: RunRow): RunRecords {
  return {
    startRequestedAt: row.startRequestedAt,
    startFailures: row.startFailures,
    startError: row.startError,
    reportBody: row.reportBody,
    agentBrief: row.agentBrief,
    continueMessage: row.continueMessage,
    continuePlace: row.continuePlace,
    agentCheck: row.agentCheck,
    agentStopRequestedAt: row.agentStopRequestedAt,
    pullRequest:
      row.prId === null || row.prCheckedAt === null
        ? null
        : {
            id: row.prId,
            displayId: row.prDisplayId ?? "",
            url: row.prUrl ?? "",
            ci: row.prCiState ?? "none",
            checkedAt: row.prCheckedAt,
            signals: row.prSignals,
            signalsReadAt: row.prSignalsReadAt,
          },
    laterPrState:
      row.laterPrState === null || row.laterPrStateAt === null
        ? null
        : { state: row.laterPrState, at: row.laterPrStateAt },
    prReadError: row.prReadError,
    worktreeRemovedAt: row.worktreeRemovedAt,
    worktreeKept: row.worktreeKept,
    worktreeRemoveRequestedAt: row.worktreeRemoveRequestedAt,
    trackerStateSetAt: row.trackerStateSetAt,
    mergedStateSetAt: row.mergedStateSetAt,
    trackerComment:
      row.trackerCommentId === null || row.trackerCommentedAt === null
        ? null
        : { id: row.trackerCommentId, at: row.trackerCommentedAt },
    unreachableSince: row.unreachableSince,
    pausedSince: row.pausedSince,
    pausedMs: row.pausedMs,
    pauseSource: row.pauseSource,
    lastLog: row.lastLog,
  };
}

function getRunRow(db: Database, id: RunId): RunRow | undefined {
  return db.select().from(runs).where(eq(runs.id, id)).get();
}

export function getRun(db: Database, id: RunId): StoredRun | null {
  const row = getRunRow(db, id);
  return row === undefined ? null : toStoredRun(row);
}

export function getRunWithRecords(
  db: Database,
  id: RunId,
): { run: StoredRun; records: RunRecords } | null {
  const row = getRunRow(db, id);
  return row === undefined ? null : { run: toStoredRun(row), records: toRunRecords(row) };
}

export interface ListRunsFilter {
  states?: ReadonlyArray<RunState>;
  ticket?: TicketRef;
  workspaceId?: WorkspaceId;
  order?: "oldest" | "newest";
  limit?: number;
  latestPerTicket?: boolean;
  endedAxes?: ReadonlyArray<EndedAxesFilter>;
  runnerId?: RunnerId | null;
  trackerProject?: { connection: TrackerConnectionId; project: TrackerProjectId };
  agent?: AgentId;
  endedBetween?: { from: Date; before: Date };
}

export interface EndedAxesFilter {
  agentResult: AgentResult;
  prState: PrState;
  laterPrState?: null;
}

export function listRuns(db: Database, filter: ListRunsFilter = {}): StoredRun[] {
  return selectRunRows(db, filter).map(toStoredRun);
}

export function listRunsWithRecords(
  db: Database,
  filter: ListRunsFilter = {},
): Array<{ run: StoredRun; records: RunRecords }> {
  return selectRunRows(db, filter).map((row) => ({
    run: toStoredRun(row),
    records: toRunRecords(row),
  }));
}

function selectRunRows(db: Database, filter: ListRunsFilter): RunRow[] {
  if (filter.states?.length === 0 || filter.limit === 0 || filter.endedAxes?.length === 0)
    return [];
  const conditions: SQL[] = [];
  if (filter.states !== undefined) conditions.push(inArray(runs.state, [...filter.states]));
  if (filter.ticket !== undefined) {
    conditions.push(eq(runs.trackerConnectionId, filter.ticket.connection));
    conditions.push(eq(runs.ticketKey, filter.ticket.key));
  }
  if (filter.workspaceId !== undefined) conditions.push(eq(runs.workspaceId, filter.workspaceId));
  if (filter.runnerId !== undefined)
    conditions.push(
      filter.runnerId === null ? isNull(runs.runnerId) : eq(runs.runnerId, filter.runnerId),
    );
  if (filter.trackerProject !== undefined) {
    conditions.push(eq(runs.trackerConnectionId, filter.trackerProject.connection));
    conditions.push(eq(runs.trackerProjectId, filter.trackerProject.project));
  }
  if (filter.agent !== undefined) conditions.push(eq(runs.agentId, filter.agent));
  if (filter.endedBetween !== undefined) {
    conditions.push(gte(runs.endedAt, filter.endedBetween.from));
    conditions.push(lt(runs.endedAt, filter.endedBetween.before));
  }
  if (filter.latestPerTicket === true) {
    const newer = alias(runs, "newer_run");
    conditions.push(
      notExists(
        db
          .select({ id: newer.id })
          .from(newer)
          .where(
            and(
              eq(newer.trackerConnectionId, runs.trackerConnectionId),
              eq(newer.ticketKey, runs.ticketKey),
              filter.workspaceId === undefined
                ? undefined
                : eq(newer.workspaceId, runs.workspaceId),
              or(
                gt(newer.assignedAt, runs.assignedAt),
                and(eq(newer.assignedAt, runs.assignedAt), gt(newer.id, runs.id)),
              ),
            ),
          ),
      ),
    );
  }
  if (filter.endedAxes !== undefined) {
    conditions.push(
      or(
        ...filter.endedAxes.map((axes) =>
          and(
            eq(runs.state, "ended"),
            eq(runs.agentResult, axes.agentResult),
            eq(runs.prState, axes.prState),
            axes.laterPrState === null ? isNull(runs.laterPrState) : undefined,
          ),
        ),
      ) ?? sql`0`,
    );
  }
  const order =
    filter.order === "newest"
      ? [desc(runs.assignedAt), desc(runs.id)]
      : [asc(runs.assignedAt), asc(runs.id)];
  const query = db
    .select()
    .from(runs)
    .where(and(...conditions))
    .orderBy(...order);
  return filter.limit === undefined ? query.all() : query.limit(filter.limit).all();
}

export function listRunPlacements(db: Database): RunPlacement[] {
  return db
    .select({ runnerId: runs.runnerId, state: runs.state })
    .from(runs)
    .where(ne(runs.state, "ended"))
    .all();
}

export interface AssignRunInput {
  ticket: TicketRef;
  ticketTitle?: string | null;
  trackerProject: TrackerProjectId;
  runnerProject: RunnerProjectId;
  agent: AgentId;
  model?: string | null;
  runnerId?: RunnerId;
  now?: Date;
}

export type AssignRunResult =
  | { ok: true; run: StoredRun }
  | {
      ok: false;
      reason:
        | "active-run"
        | "unknown-tracker-project"
        | "unknown-runner"
        | "runner-assignment-blocked";
    };

export function assignRun(db: Database, input: AssignRunInput): AssignRunResult {
  const now = input.now ?? new Date();
  return inTransaction(db, (): AssignRunResult => {
    const project = getWorkspaceTrackerProject(db, input.ticket.connection, input.trackerProject);
    if (project === null) return { ok: false, reason: "unknown-tracker-project" };

    const check = checkAssignment({
      ticket: input.ticket,
      runs: listRuns(db, { ticket: input.ticket }),
    });
    if (!check.ok) return { ok: false, reason: "active-run" };

    let runnerId: RunnerId | null;
    if (input.runnerId === undefined) {
      runnerId = pickRunner({
        project: input.runnerProject,
        agent: input.agent,
        runners: listRunnerSnapshots(db, now),
        runs: listRunPlacements(db),
      });
    } else {
      const chosen = listRunnerSnapshots(db, now).find((runner) => runner.id === input.runnerId);
      if (chosen === undefined) return { ok: false, reason: "unknown-runner" };
      if (!checkManualRunnerChoice(chosen, input.runnerProject).ok) {
        return { ok: false, reason: "runner-assignment-blocked" };
      }
      runnerId = input.runnerId;
    }

    const id = toRunId(randomUUID());
    db.insert(runs)
      .values({
        id,
        trackerConnectionId: input.ticket.connection,
        ticketKey: input.ticket.key,
        ticketTitle: storedTicketTitle(input.ticketTitle),
        workspaceId: project.workspaceId,
        trackerProjectId: input.trackerProject,
        runnerProjectId: input.runnerProject,
        agentId: input.agent,
        model: input.model ?? null,
        worktreeName: nextWorktreeName(db, input.ticket.key),
        state: "queued",
        runnerId,
        runnerChosen: input.runnerId !== undefined,
        assignedAt: now,
      })
      .run();
    recordStateChange(db, id, null, "queued", now);
    recordChange(db, { kind: "assignment", targetId: id, workspaceId: project.workspaceId }, now);
    onCommit(db, () =>
      log().info("run.assigned", {
        runId: id,
        ticketKey: input.ticket.key,
        trackerConnectionId: input.ticket.connection,
        workspaceId: project.workspaceId,
        runnerId,
        runnerProject: input.runnerProject,
        reason: input.runnerId === undefined ? "picked" : "chosen",
      }),
    );

    const run = getRun(db, id);
    if (run === null) throw new RunRowError(id, "missing right after insert");
    return { ok: true, run };
  });
}

function nextWorktreeName(db: Database, ticketKey: TicketKey): string {
  const sameKeyRuns =
    db.select({ n: count() }).from(runs).where(eq(runs.ticketKey, ticketKey)).get()?.n ?? 0;
  return `ganger-${ticketKey}-${sameKeyRuns + 1}`;
}

export type ContinueRunBlock =
  | "not-found"
  | "not-ended"
  | "not-started"
  | "superseded"
  | "worktree-removing"
  | "worktree-settled"
  | "active-run"
  | "previous-agent";

export type ContinueRunResult =
  | { ok: true; run: StoredRun }
  | { ok: false; reason: ContinueRunBlock };

export function continueRunBlock(db: Database, runId: RunId): ContinueRunBlock | null {
  const found = getRunWithRecords(db, runId);
  if (found === null) return "not-found";
  const { run, records } = found;
  if (run.state !== "ended") return "not-ended";
  if (run.startedAt === null) return "not-started";
  const ticketRuns = listRuns(db, { ticket: run.ticket });
  if (!checkAssignment({ ticket: run.ticket, runs: ticketRuns }).ok) return "active-run";
  const later = ticketRuns.slice(ticketRuns.findIndex((other) => other.id === run.id) + 1);
  if (later.some((other) => other.state !== "ended" || other.startedAt !== null)) {
    return "superseded";
  }
  if (records.worktreeRemovedAt === null) {
    return records.worktreeRemoveRequestedAt === null ? null : "worktree-removing";
  }
  const wasKept =
    records.worktreeKept !== null ||
    records.worktreeRemoveRequestedAt !== null ||
    summarizeRunOutcome(run).worktree === "operator-decides";
  return wasKept ? null : "worktree-settled";
}

export function continueRun(
  db: Database,
  input: { from: RunId; message: string; now: Date },
): ContinueRunResult {
  return inTransaction(db, (): ContinueRunResult => {
    const block = continueRunBlock(db, input.from);
    if (block !== null) return { ok: false, reason: block };
    if (getRunRow(db, input.from)?.agentCheck !== "gone") {
      return { ok: false, reason: "previous-agent" };
    }
    const source = getRun(db, input.from);
    if (source?.state !== "ended" || source.startedAt === null) {
      return { ok: false, reason: "not-found" };
    }
    const id = toRunId(randomUUID());
    db.insert(runs)
      .values({
        id,
        trackerConnectionId: source.ticket.connection,
        ticketKey: source.ticket.key,
        ticketTitle: source.ticketTitle,
        workspaceId: source.workspaceId,
        trackerProjectId: source.trackerProject,
        runnerProjectId: source.runnerProject,
        agentId: source.agent,
        model: source.model,
        worktreeName: nextWorktreeName(db, source.ticket.key),
        state: "queued",
        runnerId: source.runnerId,
        assignedAt: input.now,
        continuedFromRunId: source.id,
        continueMessage: input.message,
      })
      .run();
    recordStateChange(db, id, null, "queued", input.now);
    recordChange(
      db,
      { kind: "assignment", targetId: id, workspaceId: source.workspaceId },
      input.now,
    );
    recordRunChange(db, source.id, { now: input.now });
    onCommit(db, () =>
      log().info("run.continued", {
        runId: id,
        from: source.id,
        ticketKey: source.ticket.key,
        runnerId: source.runnerId,
      }),
    );
    const run = getRun(db, id);
    if (run === null) throw new RunRowError(id, "missing right after insert");
    return { ok: true, run };
  });
}

export function worktreeTakenOverBy(db: Database, runId: RunId): RunId | null {
  const row = db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.continuedFromRunId, runId),
        or(ne(runs.state, "ended"), isNotNull(runs.startedAt)),
      ),
    )
    .orderBy(desc(runs.assignedAt), desc(runs.id))
    .limit(1)
    .get();
  return row?.id ?? null;
}

export function recordContinuePlace(db: Database, runId: RunId, place: ContinuationPlace): void {
  inTransaction(db, () => {
    const changed = db
      .update(runs)
      .set({ continuePlace: place })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.state, "queued"),
          or(isNull(runs.continuePlace), ne(runs.continuePlace, place)),
        ),
      )
      .run().changes;
    if (changed > 0) recordRunChange(db, runId);
  });
}

export function listTakenOverRunIds(db: Database): Set<RunId> {
  const rows = db
    .selectDistinct({ id: runs.continuedFromRunId })
    .from(runs)
    .where(
      and(
        isNotNull(runs.continuedFromRunId),
        or(ne(runs.state, "ended"), isNotNull(runs.startedAt)),
      ),
    )
    .all();
  return new Set(rows.flatMap((row) => (row.id === null ? [] : [row.id])));
}

export function recordAgentCheck(
  db: Database,
  runId: RunId,
  check: AgentCheck,
  options: { stopHandled: boolean },
): void {
  inTransaction(db, () => {
    const before = getRunRow(db, runId);
    if (before === undefined) return;
    const stopRequestedAt = options.stopHandled ? null : before.agentStopRequestedAt;
    if (before.agentCheck === check && before.agentStopRequestedAt === stopRequestedAt) return;
    db.update(runs)
      .set({ agentCheck: check, agentStopRequestedAt: stopRequestedAt })
      .where(eq(runs.id, runId))
      .run();
    recordRunChange(db, runId);
  });
}

export type RequestAgentStopResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "not-ended" | "not-alive" };

export function requestPreviousAgentStop(
  db: Database,
  runId: RunId,
  now: Date,
): RequestAgentStopResult {
  return inTransaction(db, (): RequestAgentStopResult => {
    const row = getRunRow(db, runId);
    if (row === undefined) return { ok: false, reason: "not-found" };
    if (row.state !== "ended" || row.startedAt === null) return { ok: false, reason: "not-ended" };
    if (row.agentCheck !== "alive") return { ok: false, reason: "not-alive" };
    if (row.agentStopRequestedAt !== null) return { ok: true };
    db.update(runs).set({ agentStopRequestedAt: now }).where(eq(runs.id, runId)).run();
    recordRunChange(db, runId, { now });
    return { ok: true };
  });
}

export function reclaimSourceWorktree(db: Database, sourceRunId: RunId): void {
  inTransaction(db, () => {
    const found = getRunWithRecords(db, sourceRunId);
    if (found?.run.state !== "ended") return;
    const { run, records } = found;
    const unaccounted =
      records.worktreeKept === null && summarizeRunOutcome(run).worktree === "nothing-to-remove";
    if (records.worktreeRemovedAt === null && !unaccounted) return;
    db.update(runs)
      .set({
        worktreeRemovedAt: null,
        worktreeRemoveRequestedAt: null,
        ...(unaccounted ? { worktreeKept: "check-failed" as const } : {}),
      })
      .where(eq(runs.id, sourceRunId))
      .run();
    recordRunChange(db, sourceRunId);
  });
}

export const TICKET_TITLE_MAX_LENGTH = 500;

export function storedTicketTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim().slice(0, TICKET_TITLE_MAX_LENGTH) ?? "";
  return trimmed === "" ? null : trimmed;
}

export function fillRunTicketTitle(db: Database, id: RunId, title: string): void {
  const stored = storedTicketTitle(title);
  if (stored === null) return;
  inTransaction(db, () => {
    const filled = db
      .update(runs)
      .set({ ticketTitle: stored })
      .where(and(eq(runs.id, id), isNull(runs.ticketTitle)))
      .run().changes;
    if (filled > 0) recordRunChange(db, id);
  });
}

export type RunStateChange =
  | {
      to: "running";
      started?: { worktree: WorktreeRef; branch: string; agentRef: AgentRef };
      resumedAgentRef?: AgentRef;
    }
  | { to: "paused"; source?: PauseSource }
  | { to: "waiting-for-input" | "disconnected" }
  | {
      to: "ended";
      agentResult: AgentResult;
      prState: PrState;
      prReadError?: PrReadError;
      runnerUnreached?: boolean;
      reportBody?: string;
    };

export type ChangeRunStateResult =
  | { ok: true; run: StoredRun }
  | {
      ok: false;
      error:
        | InvalidRunTransition
        | { kind: "not-found" }
        | { kind: "no-runner" }
        | { kind: "no-worktree" }
        | { kind: "axes-mismatch" };
    };

export function changeRunState(
  db: Database,
  runId: RunId,
  change: RunStateChange,
  now: Date = new Date(),
): ChangeRunStateResult {
  return inTransaction(db, (): ChangeRunStateResult => {
    const current = getRun(db, runId);
    if (current === null) return { ok: false, error: { kind: "not-found" } };
    const transition = transitionRun(current.state, change.to);
    if (!transition.ok) return { ok: false, error: transition.error };

    const where = and(eq(runs.id, runId), eq(runs.state, current.state));
    const pauseClock = {
      ...pauseClockAfter(db, runId, change.to, now),
      ...pauseSourceAfter(db, runId, change),
    };
    if (change.to === "ended") {
      const notStarted = current.state === "queued";
      const runnerUnreached = change.runnerUnreached ?? false;
      const fits = notStarted
        ? isNotStartedResult(change.agentResult) && change.prState === "none" && !runnerUnreached
        : change.agentResult !== "could-not-start" &&
          (!runnerUnreached || change.agentResult === "canceled");
      if (!fits) return { ok: false, error: { kind: "axes-mismatch" } };
      db.update(runs)
        .set({
          state: "ended",
          endedAt: now,
          agentResult: change.agentResult,
          prState: change.prState,
          prReadError: change.prReadError ?? null,
          runnerUnreached,
          reportBody: change.reportBody ?? null,
          ...pauseClock,
        })
        .where(where)
        .run();
    } else if (current.state === "queued") {
      if (current.runnerId === null) return { ok: false, error: { kind: "no-runner" } };
      if (change.to !== "running" || change.started === undefined) {
        return { ok: false, error: { kind: "no-worktree" } };
      }
      const { worktree, branch, agentRef } = change.started;
      db.update(runs)
        .set({ state: "running", startedAt: now, worktreeRef: worktree, branch, agentRef })
        .where(where)
        .run();
    } else {
      const agentRef =
        change.to === "running" && (current.state === "paused" || current.state === "disconnected")
          ? change.resumedAgentRef
          : undefined;
      db.update(runs)
        .set({ state: change.to, ...pauseClock, ...(agentRef === undefined ? {} : { agentRef }) })
        .where(where)
        .run();
    }
    recordStateChange(db, runId, current.state, change.to, now);
    recordRunChange(db, runId, { now });
    onCommit(db, () =>
      log().info("run.state_changed", {
        runId,
        ticketKey: current.ticket.key,
        runnerId: current.runnerId,
        from: current.state,
        to: change.to,
        ...(change.to === "ended" ? { outcome: change.agentResult } : {}),
      }),
    );

    const run = getRun(db, runId);
    if (run === null) throw new RunRowError(runId, "missing right after update");
    return { ok: true, run };
  });
}

function pauseClockAfter(
  db: Database,
  runId: RunId,
  to: RunState,
  now: Date,
): { pausedSince: Date | null; pausedMs?: number } {
  const row = db
    .select({ pausedSince: runs.pausedSince, pausedMs: runs.pausedMs })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  const since = row?.pausedSince ?? null;
  if (to === "paused") return { pausedSince: since ?? now };
  if (to === "disconnected") return { pausedSince: since };
  const counted =
    since === null
      ? {}
      : { pausedMs: (row?.pausedMs ?? 0) + Math.max(0, now.getTime() - since.getTime()) };
  return { pausedSince: null, ...counted };
}

function pauseSourceAfter(
  db: Database,
  runId: RunId,
  change: RunStateChange,
): { pauseSource: PauseSource | null } | Record<string, never> {
  if (change.to === "disconnected") return {};
  if (change.to !== "paused") return { pauseSource: null };
  const kept = db
    .select({ pauseSource: runs.pauseSource })
    .from(runs)
    .where(eq(runs.id, runId))
    .get()?.pauseSource;
  return { pauseSource: change.source ?? kept ?? "operator" };
}

export function lastStateBeforeDisconnect(db: Database, runId: RunId): RunState | null {
  const change = db
    .select({ from: runStateChanges.fromState })
    .from(runStateChanges)
    .where(and(eq(runStateChanges.runId, runId), eq(runStateChanges.toState, "disconnected")))
    .orderBy(desc(runStateChanges.id))
    .limit(1)
    .get();
  return change?.from ?? null;
}

export function runningSince(db: Database, runId: RunId): Date | null {
  const changes = db
    .select({
      from: runStateChanges.fromState,
      to: runStateChanges.toState,
      at: runStateChanges.changedAt,
    })
    .from(runStateChanges)
    .where(eq(runStateChanges.runId, runId))
    .orderBy(desc(runStateChanges.id))
    .all();
  for (const [index, change] of changes.entries()) {
    if (change.to !== "running") continue;
    if (change.from !== "disconnected") return change.at;
    const intoDisconnect = changes
      .slice(index + 1)
      .find((earlier) => earlier.to === "disconnected");
    if (intoDisconnect?.from !== "running") return change.at;
  }
  return null;
}

export function recordStartRequested(
  db: Database,
  runId: RunId,
  now: Date,
  agentBrief: string,
): boolean {
  return inTransaction(db, () => {
    db.update(runs)
      .set({ agentBrief })
      .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
      .run();
    return (
      db
        .update(runs)
        .set({ startRequestedAt: now })
        .where(and(eq(runs.id, runId), eq(runs.state, "queued"), isNull(runs.startRequestedAt)))
        .run().changes > 0
    );
  });
}

export function clearStartRequested(db: Database, runId: RunId): boolean {
  return (
    db
      .update(runs)
      .set({ startRequestedAt: null })
      .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
      .run().changes > 0
  );
}

export function recordStartFailure(
  db: Database,
  runId: RunId,
  input: { failures: number; error: string },
): boolean {
  return inTransaction(db, () => {
    const before = db
      .select({ failures: runs.startFailures, error: runs.startError })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    const updated =
      db
        .update(runs)
        .set({ startFailures: input.failures, startError: input.error })
        .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
        .run().changes > 0;
    if (updated && (before?.failures !== input.failures || before.error !== input.error))
      recordRunChange(db, runId);
    return updated;
  });
}

export function setQueuedRunRunner(db: Database, runId: RunId, runnerId: RunnerId | null): boolean {
  return inTransaction(db, () => {
    const before = db
      .select({
        runnerId: runs.runnerId,
        continuedFromRunId: runs.continuedFromRunId,
        runnerChosen: runs.runnerChosen,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    if (before !== undefined && isPinnedToRunner(before) && before.runnerId !== runnerId) {
      return false;
    }
    const updated =
      db
        .update(runs)
        .set({ runnerId })
        .where(and(eq(runs.id, runId), eq(runs.state, "queued")))
        .run().changes > 0;
    if (updated && before?.runnerId !== runnerId) {
      recordRunChange(db, runId);
      onCommit(db, () => log().info("run.runner_chosen", { runId, runnerId }));
    }
    return updated;
  });
}

function recordStateChange(
  db: Database,
  runId: RunId,
  from: RunState | null,
  to: RunState,
  now: Date,
): void {
  db.insert(runStateChanges).values({ runId, fromState: from, toState: to, changedAt: now }).run();
}

export interface RunStateChangeRecord {
  from: RunState | null;
  to: RunState;
  at: Date;
}

export function listRunStateChanges(db: Database, runId: RunId): RunStateChangeRecord[] {
  return db
    .select({
      from: runStateChanges.fromState,
      to: runStateChanges.toState,
      at: runStateChanges.changedAt,
    })
    .from(runStateChanges)
    .where(eq(runStateChanges.runId, runId))
    .orderBy(asc(runStateChanges.id))
    .all();
}

export function updateRunRecords(
  db: Database,
  runId: RunId,
  patch: Partial<
    Omit<
      RunRecords,
      | "startRequestedAt"
      | "startFailures"
      | "startError"
      | "reportBody"
      | "agentBrief"
      | "continueMessage"
      | "continuePlace"
      | "agentCheck"
      | "agentStopRequestedAt"
      | "prReadError"
      | "worktreeRemoveRequestedAt"
    >
  >,
): boolean {
  const set: Partial<typeof runs.$inferInsert> = {};
  if (patch.pullRequest !== undefined) {
    const pr = patch.pullRequest;
    set.prId = pr?.id ?? null;
    set.prDisplayId = pr?.displayId ?? null;
    set.prUrl = pr?.url ?? null;
    set.prCiState = pr?.ci ?? null;
    set.prCheckedAt = pr?.checkedAt ?? null;
    if (pr === null || (pr.signals ?? null) !== null) {
      set.prSignals =
        pr?.signals == null ? null : withStoredCommits(getRunRow(db, runId), pr, pr.signals);
      set.prSignalsReadAt = pr === null ? null : pr.checkedAt;
    } else if (!sameCommitAsStored(getRunRow(db, runId), pr)) {
      set.prSignals = null;
      set.prSignalsReadAt = null;
    }
  }
  if (patch.laterPrState !== undefined) {
    set.laterPrState = patch.laterPrState?.state ?? null;
    set.laterPrStateAt = patch.laterPrState?.at ?? null;
  }
  if (patch.worktreeRemovedAt !== undefined) {
    set.worktreeRemovedAt = patch.worktreeRemovedAt;
    if (patch.worktreeRemovedAt !== null) set.worktreeRemoveRequestedAt = null;
  }
  if (patch.worktreeKept !== undefined) set.worktreeKept = patch.worktreeKept;
  if (patch.trackerStateSetAt !== undefined) set.trackerStateSetAt = patch.trackerStateSetAt;
  if (patch.mergedStateSetAt !== undefined) set.mergedStateSetAt = patch.mergedStateSetAt;
  if (patch.trackerComment !== undefined) {
    set.trackerCommentId = patch.trackerComment?.id ?? null;
    set.trackerCommentedAt = patch.trackerComment?.at ?? null;
  }
  if (patch.unreachableSince !== undefined) set.unreachableSince = patch.unreachableSince;
  if (patch.lastLog !== undefined) {
    set.lastLog = patch.lastLog === null ? null : patch.lastLog.slice(-LAST_LOG_LINES);
  }
  if (Object.keys(set).length === 0) return false;

  return inTransaction(db, () => {
    const before = getRunRow(db, runId);
    const updated = db.update(runs).set(set).where(eq(runs.id, runId)).run().changes > 0;
    const after = getRunRow(db, runId);
    if (
      updated &&
      before !== undefined &&
      after !== undefined &&
      visiblyChanged(set, before, after)
    )
      recordRunChange(db, runId);
    return updated;
  });
}

export function fillUnreadPrState(db: Database, runId: RunId, prState: ReadPrState): boolean {
  return inTransaction(db, () => {
    const filled =
      db
        .update(runs)
        .set({ prState, prReadError: null })
        .where(and(eq(runs.id, runId), eq(runs.state, "ended"), eq(runs.prState, "unknown")))
        .run().changes > 0;
    if (filled) recordRunChange(db, runId);
    return filled;
  });
}

export function recordPrReadError(db: Database, runId: RunId, error: PrReadError): boolean {
  return inTransaction(db, () => {
    const changed =
      db
        .update(runs)
        .set({ prReadError: error })
        .where(and(eq(runs.id, runId), eq(runs.prState, "unknown"), ne(runs.prReadError, error)))
        .run().changes > 0;
    if (changed) recordRunChange(db, runId);
    return changed;
  });
}

export type RequestWorktreeRemovalResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not-found" | "not-ended" | "nothing-to-remove" | "not-kept" | "taken-over";
    };

export function requestWorktreeRemoval(
  db: Database,
  runId: RunId,
  now: Date,
): RequestWorktreeRemovalResult {
  return inTransaction(db, (): RequestWorktreeRemovalResult => {
    const row = getRunRow(db, runId);
    if (row === undefined) return { ok: false, reason: "not-found" };
    if (row.state !== "ended") return { ok: false, reason: "not-ended" };
    if (row.worktreeRef === null || row.worktreeRemovedAt !== null) {
      return { ok: false, reason: "nothing-to-remove" };
    }
    if (worktreeTakenOverBy(db, runId) !== null) return { ok: false, reason: "taken-over" };
    const run = toStoredRun(row);
    if (
      run.state === "ended" &&
      row.worktreeKept === null &&
      summarizeRunOutcome(run).worktree !== "operator-decides"
    ) {
      return { ok: false, reason: "not-kept" };
    }
    if (row.worktreeRemoveRequestedAt !== null) return { ok: true };
    db.update(runs).set({ worktreeRemoveRequestedAt: now }).where(eq(runs.id, runId)).run();
    recordRunChange(db, runId, { now });
    return { ok: true };
  });
}

export function countUnreadPrRuns(db: Database): Record<PrReadError, number> {
  const counts: Record<PrReadError, number> = { "no-access": 0, other: 0 };
  const rows = db
    .select({ error: runs.prReadError, runs: count() })
    .from(runs)
    .where(eq(runs.prState, "unknown"))
    .groupBy(runs.prReadError)
    .all();
  for (const row of rows) {
    if (row.error !== null) counts[row.error] += row.runs;
  }
  return counts;
}

function withStoredCommits(
  row: RunRow | undefined,
  pr: { id: PullRequestId },
  signals: PullRequestSignals,
): PullRequestSignals {
  if (signals.commits !== undefined || row?.prId !== pr.id) return signals;
  const storedSignals = row.prSignals;
  const sameHead = storedSignals?.headCommit === signals.headCommit;
  const stored = signals.open && !sameHead ? undefined : storedSignals?.commits;
  return stored === undefined ? signals : { ...signals, commits: stored };
}

function sameCommitAsStored(
  row: RunRow | undefined,
  pr: { id: PullRequestId; headCommit?: string },
): boolean {
  return row?.prId === pr.id && row.prSignals?.headCommit === pr.headCommit;
}

const UNSEEN_RUN_COLUMNS: ReadonlySet<string> = new Set(["prCheckedAt", "prSignalsReadAt"]);

function visiblyChanged(set: Partial<typeof runs.$inferInsert>, before: RunRow, after: RunRow) {
  return Object.keys(set).some((column) => {
    if (UNSEEN_RUN_COLUMNS.has(column)) return false;
    const was: unknown = Reflect.get(before, column);
    const now: unknown = Reflect.get(after, column);
    return comparable(was) !== comparable(now);
  });
}

function comparable(value: unknown): string {
  if (value instanceof Date) return `date:${value.getTime()}`;
  return JSON.stringify(value) ?? "undefined";
}
