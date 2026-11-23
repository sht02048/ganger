import {
  ACTIVE_RUN_STATES,
  EMPTY_WORKSPACE_BRIEF,
  canRunnerTake,
  composeAgentBrief,
  composeContinuationBrief,
  decideBlockerWait,
  decideStartFailure,
  ticketBriefText,
  MAX_START_RETRIES,
  planQueue,
  priorityRank,
} from "@ganger/core";
import type {
  AdapterRegistry,
  AgentRef,
  ContinuationPlace,
  MailboxRef,
  QueuedRun,
  Runner,
  RunnerChoice,
  RunId,
  RunnerId,
  StartedRun,
  TicketKey,
  WorktreeRef,
} from "@ganger/core";
import {
  changeRunState,
  fillRunTicketTitle,
  clearStartRequested,
  getMapping,
  getRun,
  getRunWithRecords,
  getWorkspaceBrief,
  hasPendingCancelRequest,
  inTransaction,
  listPendingCancelRequests,
  listQueuedBlockerStates,
  listRunPlacements,
  listRunnerSnapshots,
  listRuns,
  markCancelRequestProcessed,
  openDatabase,
  reclaimSourceWorktree,
  recordAgentCheck,
  recordContinuePlace,
  recordStartFailure,
  recordStartRequested,
  setQueuedRunRunner,
  setRunnerMailbox,
  isPinnedToRunner,
} from "@ganger/db";
import type { RunRecords, SecretBox, StoredRun } from "@ganger/db";
import { syncNotifications } from "@ganger/app/notifications/sync";
import { log, withLogContext } from "@ganger/log";
import { WorkerAdapters } from "./adapters.js";
import {
  describe,
  findRunner,
  mailboxFor,
  reportFailure,
  runnerErrorDetail,
  tryWrite,
} from "./context.js";
import type { QueuedStoredRun, TickContext, WorkerLogger, WorktreeSetupJob } from "./context.js";
import { processAfterRuns } from "./after-run.js";
import { messages } from "./messages.js";
import { assignAutomatically, createAutoAssignState } from "./auto-assign.js";
import { blockersClearToStart, createBlockerRefreshState, refreshBlockers } from "./blockers.js";
import { processAgentMessages } from "./agent-messages.js";
import { processRunControlRequests } from "./control.js";
import { createPushDelivery } from "./push.js";
import type { PushTransport } from "./push.js";
import { processWebRequests } from "./requests.js";
import { checkRunners } from "./runner-check.js";
import { startTickLoop } from "./tick-loop.js";
import { watchActiveRuns } from "./watch.js";

export type { WorkerLogger } from "./context.js";

export interface WorkerOptions {
  dbPath: string;
  registry: AdapterRegistry;
  secretBox: SecretBox;
  now?: () => Date;
  logger?: WorkerLogger;
  push?: Partial<PushTransport>;
}

export interface Worker {
  tick(): Promise<void>;
  health(): WorkerHealth;
  close(): Promise<void>;
}

export interface WorkerHealth {
  watched: number | null;
  lastTickMs: number | null;
}

export const ALIVE_INTERVAL_MS = 10 * 60_000;

const WATCHED_RUN_STATES = [...ACTIVE_RUN_STATES].filter((state) => state !== "queued");

export interface RunningWorker {
  wake(): void;
  stop(): Promise<void>;
}

export function startWorker(
  options: WorkerOptions & { pollIntervalMs: number; aliveIntervalMs?: number },
): RunningWorker {
  const worker = createWorker(options);
  const logger = options.logger ?? log();
  const loop = startTickLoop({
    tick: () => worker.tick(),
    pollIntervalMs: options.pollIntervalMs,
    logger,
  });
  const startedAt = performance.now();
  const alive = setInterval(() => {
    logger.info("process.alive", {
      ...worker.health(),
      uptimeS: Math.round((performance.now() - startedAt) / 1000),
    });
  }, options.aliveIntervalMs ?? ALIVE_INTERVAL_MS);
  alive.unref();

  return {
    wake: () => loop.wake(),
    stop: async () => {
      clearInterval(alive);
      loop.stop();
      await worker.close();
    },
  };
}

export function createWorker(options: WorkerOptions): Worker {
  const db = openDatabase(options.dbPath);
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? log();
  const adapters = new WorkerAdapters(options.registry, options.secretBox, now);
  const context: TickContext = {
    db,
    now,
    logger,
    adapters,
    pendingStarts: new Map(),
    worktreeSetups: new Map(),
    mailboxes: new Map(),
    unreachableUntil: new Map(),
    unmarkedAnswers: new Set(),
    unwokenHumanChecks: new Set(),
    unmarkedDenials: new Set(),
    pendingEndings: new Map(),
    prPolledAt: new Map(),
    prReadRetries: new Map(),
    agentCheckedAt: new Map(),
    unrecordedComments: new Map(),
    ticketsGone: new Set(),
    confirmedMerges: new Set(),
    unmarkedMerges: new Set(),
    autoAssign: createAutoAssignState(),
    blockerRefresh: createBlockerRefreshState(),
  };
  const pushes = createPushDelivery({ db, now, logger, transport: options.push ?? {} });
  let running: Promise<void> | null = null;
  let closed = false;
  let lastTickMs: number | null = null;
  const watched = (): number | null => {
    try {
      return listRuns(db, { states: WATCHED_RUN_STATES }).length;
    } catch {
      return null;
    }
  };

  const timedTick = async (): Promise<void> => {
    const startedAt = performance.now();
    try {
      try {
        await tick(context);
      } finally {
        await pushes.run();
      }
    } finally {
      lastTickMs = Math.round(performance.now() - startedAt);
      if (logger.enabled("debug"))
        logger.debug("worker.tick", { ms: lastTickMs, watched: watched() });
    }
  };

  return {
    tick: () => {
      if (closed) return Promise.reject(new Error("worker is closed"));
      running ??= timedTick().finally(() => {
        running = null;
      });
      return running;
    },
    health: () => ({ watched: closed ? null : watched(), lastTickMs }),
    close: async () => {
      if (closed) return;
      closed = true;
      if (running !== null) await running.catch(() => undefined);
      db.$client.close();
    },
  };
}

async function tick(context: TickContext): Promise<void> {
  context.mailboxes.clear();
  try {
    await processWebRequests(context, "runner-check");
    await checkRunners(context);
    await processRunControlRequests(context);
    await watchActiveRuns(context);
    await processAgentMessages(context);
    await cancelQueuedRuns(context);
    await assignAutomatically(context);
    await refreshBlockers(context);
    await processQueue(context);
    await processAfterRuns(context);
    await processWebRequests(context, "log-tail");
  } finally {
    syncNotificationEventsSafely(context);
  }
}

function syncNotificationEventsSafely(context: TickContext): void {
  try {
    syncNotifications(context.db, context.now());
  } catch (error) {
    context.logger.warn("notifications.sync_failed", { error });
  }
}

async function cancelQueuedRuns(context: TickContext): Promise<void> {
  const { db, logger } = context;
  for (const request of listPendingCancelRequests(db)) {
    const found = getRunWithRecords(db, request.runId);
    if (found?.run.state !== "queued") continue;
    const { run, records } = found;
    if (context.pendingStarts.has(run.id)) continue;
    if (records.startRequestedAt !== null && run.runnerId !== null) {
      const existing = await findStartedForCancel(context, run, run.runnerId);
      if (existing === "unknown") continue;
      if (existing !== null) {
        tryWrite(context, run.id, () => recordStart(context, run.id, existing));
        continue;
      }
    }
    const endedAt = context.now();
    tryWrite(context, run.id, () =>
      inTransaction(db, () => {
        const result = changeRunState(
          db,
          run.id,
          { to: "ended", agentResult: "canceled", prState: "none" },
          endedAt,
        );
        reportFailure(logger, run.id, result);
        if (result.ok) markCancelRequestProcessed(db, run.id, endedAt);
      }),
    );
  }
}

async function findStartedForCancel(
  context: TickContext,
  run: QueuedStoredRun,
  runnerId: RunnerId,
): Promise<StartedRun | null | "unknown"> {
  const storedRunner = findRunner(context.db, runnerId);
  if (storedRunner === undefined) {
    context.logger.warn("run.cancel_runner_missing", {
      runId: run.id,
      runnerId,
    });
    return null;
  }
  const runner = context.adapters.runner(storedRunner);
  try {
    const mailbox = await mailboxFor(context, storedRunner, runner);
    return await runner.findStartedRun({
      mailbox,
      worktreeName: run.worktreeName,
      ...continueInOf(context, run),
    });
  } catch (error) {
    context.logger.warn("run.cancel_lookup_failed", { runId: run.id, error });
    return "unknown";
  }
}

async function processQueue(context: TickContext): Promise<void> {
  const { db, pendingStarts, now } = context;
  recordPendingStarts(context);
  forgetSettledSetupsOfLeftRuns(context);

  const plan = inTransaction(db, () => {
    const queued = listRuns(db, { states: ["queued"] });
    if (queued.length === 0) return null;
    const runners = listRunnerSnapshots(db, now()).map((runner) =>
      (context.unreachableUntil.get(runner.id) ?? 0) > now().getTime()
        ? { ...runner, online: false }
        : runner,
    );
    const snapshots = new Map(runners.map((runner) => [runner.id, runner]));
    const bound = boundRunners(context, queued);
    const runs = listRunPlacements(db);
    for (const pending of pendingStarts.values()) {
      runs.push({ runnerId: pending.runnerId, state: "running" });
    }
    const settingUp = (runId: RunId): boolean =>
      context.worktreeSetups.get(runId)?.outcome === null;
    for (const run of queued) {
      if (settingUp(run.id)) runs.push({ runnerId: run.runnerId, state: "running" });
    }
    const blockerStates = listQueuedBlockerStates(db);
    const candidates = queued
      .filter((run) => !settingUp(run.id))
      .flatMap((run) => toQueuedRun(context, run))
      .map((run) => ({
        ...run,
        priorityRank: priorityRank(blockerStates.get(run.id)?.priority ?? "none"),
      }))
      .map((run) =>
        bound.has(run.id) ? { ...run, unstartable: false, startRequested: true } : run,
      )
      .filter((run) => {
        if (run.unstartable || bound.has(run.id)) return true;
        const state = blockerStates.get(run.id);
        return state === undefined || decideBlockerWait(state).kind === "none";
      })
      .filter((run) => !hasPendingCancelRequest(db, run.id))
      .filter((run) => {
        const runnerId = bound.get(run.id);
        if (runnerId === undefined) return true;
        const snapshot = snapshots.get(runnerId);
        return (
          !pendingStarts.has(run.id) &&
          snapshot !== undefined &&
          canRunnerTake(snapshot, run.project)
        );
      });

    const result = planQueue({ queued: candidates, runners, runs });
    for (const { runId } of result.cleared) setQueuedRunRunner(db, runId, null);
    for (const choice of result.assigned) setQueuedRunRunner(db, choice.runId, choice.runnerId);
    for (const runId of result.couldNotStart) {
      reportFailure(
        context.logger,
        runId,
        changeRunState(
          db,
          runId,
          { to: "ended", agentResult: "could-not-start", prState: "none" },
          now(),
        ),
      );
    }
    return result.start;
  });

  const blockedRunners = new Set<RunnerId>();
  for (const choice of plan ?? []) {
    if (blockedRunners.has(choice.runnerId)) continue;
    const outcome = await withLogContext({ runId: choice.runId, runnerId: choice.runnerId }, () =>
      startQueuedRun(context, choice),
    );
    if (outcome === "blocked") blockedRunners.add(choice.runnerId);
  }
}

function forgetSettledSetupsOfLeftRuns(context: TickContext): void {
  for (const [runId, job] of context.worktreeSetups) {
    if (job.outcome !== null && getRun(context.db, runId)?.state !== "queued") {
      context.worktreeSetups.delete(runId);
    }
  }
}

async function worktreeSetupGate(
  context: TickContext,
  run: QueuedStoredRun,
  runner: Runner,
  worktree: WorktreeRef,
): Promise<"ready" | "running" | { failed: string }> {
  const job = context.worktreeSetups.get(run.id);
  if (job !== undefined) {
    if (job.outcome === null) return "running";
    const { outcome } = job;
    context.worktreeSetups.delete(run.id);
    if (outcome.kind === "threw") throw outcome.error;
    if (outcome.kind === "failed") return { failed: outcome.reason };
  }
  const input = { project: run.runnerProject, worktree };
  if (!(await runner.worktreeSetupPending(input))) return "ready";
  const started: WorktreeSetupJob = { outcome: null };
  context.worktreeSetups.set(run.id, started);
  void runner.finishWorktreeSetup(input).then(
    (outcome) => {
      started.outcome = outcome;
    },
    (error: unknown) => {
      started.outcome = { kind: "threw", error };
    },
  );
  return "running";
}

function recordPendingStarts(context: TickContext): void {
  for (const [runId, pending] of context.pendingStarts) {
    const run = getRun(context.db, runId);
    if (run?.state !== "queued") {
      context.pendingStarts.delete(runId);
      continue;
    }
    if (
      tryWrite(context, run.id, () => recordStart(context, run.id, pending.started)) !== undefined
    ) {
      context.pendingStarts.delete(runId);
    }
  }
}

function boundRunners(
  context: TickContext,
  queued: ReadonlyArray<StoredRun>,
): Map<RunId, RunnerId> {
  const bound = new Map<RunId, RunnerId>();
  for (const run of queued) {
    const pending = context.pendingStarts.get(run.id);
    if (pending !== undefined) {
      bound.set(run.id, pending.runnerId);
      continue;
    }
    if (run.state !== "queued" || run.runnerId === null) continue;
    if ((getRunWithRecords(context.db, run.id)?.records.startRequestedAt ?? null) !== null) {
      bound.set(run.id, run.runnerId);
    }
  }
  return bound;
}

function toQueuedRun(context: TickContext, run: StoredRun): QueuedRun[] {
  if (run.state !== "queued") return [];
  const mapping = getMapping(context.db, run.ticket.connection, run.trackerProject);
  return [
    {
      id: run.id,
      assignedAt: run.assignedAt,
      project: run.runnerProject,
      agent: run.agent,
      runnerId: run.runnerId,
      unstartable: mapping === null,
      pinnedToRunner: isPinnedToRunner(run),
    },
  ];
}

async function startQueuedRun(
  context: TickContext,
  choice: RunnerChoice,
): Promise<"started" | "skipped" | "blocked"> {
  const { db, pendingStarts } = context;
  const found = getRunWithRecords(db, choice.runId);
  if (found?.run.state !== "queued") {
    pendingStarts.delete(choice.runId);
    return "skipped";
  }
  const { run, records } = found;
  const pending = pendingStarts.get(run.id);
  if (
    run.runnerId !== choice.runnerId ||
    (pending !== undefined && pending.runnerId !== choice.runnerId)
  ) {
    return "blocked";
  }

  let started = pending?.started ?? null;
  if (started === null) {
    if (!(await blockersClearToStart(context, run))) return "skipped";
    if (hasPendingCancelRequest(db, run.id)) return "skipped";
    const attempt = await startOnRunner(context, run, choice.runnerId, records);
    if (attempt.kind !== "started") return attempt.kind;
    started = attempt.started;
  }
  pendingStarts.set(run.id, { runnerId: choice.runnerId, started });

  const recorded = tryWrite(context, run.id, () => recordStart(context, run.id, started));
  if (recorded !== undefined) pendingStarts.delete(run.id);
  return recorded === true ? "started" : "blocked";
}

type StartAttempt = { kind: "started"; started: StartedRun } | { kind: "skipped" | "blocked" };

async function startOnRunner(
  context: TickContext,
  run: QueuedStoredRun,
  runnerId: RunnerId,
  records: RunRecords,
): Promise<StartAttempt> {
  const { db, logger, adapters } = context;
  const storedRunner = findRunner(db, runnerId);
  if (storedRunner === undefined) {
    logger.warn("run.runner_missing", { runId: run.id, runnerId });
    return { kind: "blocked" };
  }
  const runner = adapters.runner(storedRunner);
  let unverified = records.startRequestedAt !== null;
  let startSent = unverified;
  let mailbox: MailboxRef;
  try {
    mailbox = await mailboxFor(context, storedRunner, runner);
  } catch (error) {
    logger.warn("run.mailbox_failed", { runId: run.id, error });
    if (!isOfflineLike(error)) return { kind: "blocked" };
    markUnreachable(context, runnerId);
    if (!unverified) tryWrite(context, run.id, () => setQueuedRunRunner(db, run.id, null));
    return { kind: "skipped" };
  }
  try {
    if (unverified) {
      const existing = await findStarted(context, run, runner, mailbox);
      if (existing === "unreachable") {
        markUnreachable(context, runnerId);
        return { kind: "skipped" };
      }
      if (existing === "unknown") return { kind: "skipped" };
      if (existing !== null) return { kind: "started", started: existing };
      unverified = false;
      if (
        records.startFailures > MAX_START_RETRIES ||
        getMapping(db, run.ticket.connection, run.trackerProject) === null
      ) {
        return endCouldNotStart(context, run);
      }
      if (tryWrite(context, run.id, () => clearStartRequested(db, run.id)) === undefined) {
        return { kind: "blocked" };
      }
      startSent = false;
      if (!(await blockersClearToStart(context, run))) return { kind: "skipped" };
      if (hasPendingCancelRequest(db, run.id)) return { kind: "skipped" };
    }
    if (context.worktreeSetups.get(run.id)?.outcome === null) return { kind: "skipped" };
    const source = continuationSource(context, run);
    if (source === "missing") return endCouldNotStart(context, run);
    const place =
      source === null ? null : await continuationPlace(context, run, runner, source, records);
    if (place === "write-failed") return { kind: "blocked" };
    if (source !== null && place !== "previous-agent-alive" && place !== "from-scratch") {
      const setup = await worktreeSetupGate(context, run, runner, source.worktree);
      if (setup === "running") return { kind: "skipped" };
      if (setup !== "ready") {
        logger.warn("run.start_failed", { runId: run.id, reason: "worktree-setup" });
        tryWrite(context, run.id, () =>
          recordStartFailure(db, run.id, {
            failures: records.startFailures,
            error: `${messages.continuation.setupFailed}\n${setup.failed}`,
          }),
        );
        return endCouldNotStart(context, run);
      }
    }
    if (place === "previous-agent-alive") {
      const sourceRunId = run.continuedFromRunId;
      tryWrite(context, run.id, () =>
        inTransaction(db, () => {
          if (sourceRunId !== null) {
            recordAgentCheck(db, sourceRunId, "alive", { stopHandled: false });
          }
          recordStartFailure(db, run.id, {
            failures: records.startFailures,
            error: messages.continuation.previousAgentAlive,
          });
        }),
      );
      return endCouldNotStart(context, run);
    }
    const prompt =
      place === null || place === "from-scratch" ? await promptFor(context, run) : undefined;
    if (prompt === null) return { kind: "blocked" };
    if (prompt === "ticket-gone") {
      tryWrite(context, run.id, () =>
        recordStartFailure(db, run.id, {
          failures: records.startFailures,
          error: describe({ kind: "ticket-not-found", ticketKey: run.ticket.key }),
        }),
      );
      return endCouldNotStart(context, run);
    }
    const workspace = getWorkspaceBrief(db, run.workspaceId) ?? EMPTY_WORKSPACE_BRIEF;
    const ticket = prompt?.text ?? "";
    const brief =
      source === null
        ? composeAgentBrief({ workspace, ticket, protocol: runner.agentProtocol })
        : composeContinuationBrief({
            workspace,
            ticket,
            protocol: runner.agentProtocol,
            operatorMessage: records.continueMessage ?? "",
            previousReport: source.report,
          });
    if (
      tryWrite(context, run.id, () => recordStartRequested(db, run.id, context.now(), brief)) ===
      undefined
    ) {
      return { kind: "blocked" };
    }
    startSent = true;
    const started = await runner.startRun({
      mailbox,
      project: run.runnerProject,
      worktreeName: run.worktreeName,
      agent: run.agent,
      ...(run.model === null ? {} : { model: run.model }),
      brief,
      ...(prompt === undefined ? {} : { ticket: prompt.ticket }),
      ...(source === null || place === "from-scratch" ? {} : { continueIn: source.worktree }),
    });
    return { kind: "started", started };
  } catch (error) {
    logger.warn("run.start_failed", { runId: run.id, error });
    return handleStartFailure(
      context,
      run,
      { runnerId, unverified, startSent },
      records.startFailures,
      error,
    );
  }
}

async function findStarted(
  context: TickContext,
  run: QueuedStoredRun,
  runner: Runner,
  mailbox: MailboxRef,
): Promise<StartedRun | null | "unreachable" | "unknown"> {
  try {
    return await runner.findStartedRun({
      mailbox,
      worktreeName: run.worktreeName,
      ...continueInOf(context, run),
    });
  } catch (error) {
    context.logger.warn("run.lookup_failed", { runId: run.id, error });
    return isOfflineLike(error) ? "unreachable" : "unknown";
  }
}

interface ContinuationSource {
  worktree: WorktreeRef;
  branch: string;
  report: string | null;
  agentRef: AgentRef;
}

function continuationSource(
  context: TickContext,
  run: QueuedStoredRun,
): ContinuationSource | "missing" | null {
  if (run.continuedFromRunId === null) return null;
  const found = getRunWithRecords(context.db, run.continuedFromRunId);
  if (found?.run.state !== "ended" || found.run.startedAt === null) return "missing";
  return {
    worktree: found.run.worktree,
    branch: found.run.branch,
    report: found.records.reportBody,
    agentRef: found.run.agentRef,
  };
}

function continueInOf(
  context: TickContext,
  run: QueuedStoredRun,
): { continueIn: WorktreeRef; previousAgent: AgentRef } | Record<string, never> {
  const source = continuationSource(context, run);
  if (source === null || source === "missing") return {};
  const place = getRunWithRecords(context.db, run.id)?.records.continuePlace ?? null;
  return place === null || place === "from-scratch"
    ? {}
    : { continueIn: source.worktree, previousAgent: source.agentRef };
}

async function continuationPlace(
  context: TickContext,
  run: QueuedStoredRun,
  runner: Runner,
  source: ContinuationSource,
  records: RunRecords,
): Promise<ContinuationPlace | "write-failed" | "previous-agent-alive"> {
  const { worktree, agentRef } = source;
  if (await runner.isAgentAlive({ worktree, agentRef })) return "previous-agent-alive";
  if (records.continuePlace === "from-scratch") return "from-scratch";
  const prepared = await runner.prepareContinuation({
    project: run.runnerProject,
    worktree: source.worktree,
    branch: source.branch,
  });
  const place = prepared === "same-worktree" ? (records.continuePlace ?? prepared) : prepared;
  const written = tryWrite(context, run.id, () =>
    inTransaction(context.db, () => {
      recordContinuePlace(context.db, run.id, place);
      if (prepared !== "from-scratch" && run.continuedFromRunId !== null) {
        reclaimSourceWorktree(context.db, run.continuedFromRunId);
      }
      return true;
    }),
  );
  return written === undefined ? "write-failed" : place;
}

export const START_UNREACHABLE_RETRY_MS = 60_000;

function markUnreachable(context: TickContext, runnerId: RunnerId): void {
  context.unreachableUntil.set(runnerId, context.now().getTime() + START_UNREACHABLE_RETRY_MS);
}

function isOfflineLike(error: unknown): boolean {
  const detail = runnerErrorDetail(error);
  return detail !== null && decideStartFailure(detail, 0).action === "wait-like-offline";
}

function handleStartFailure(
  context: TickContext,
  run: QueuedStoredRun,
  target: { runnerId: RunnerId; unverified: boolean; startSent: boolean },
  previousFailures: number,
  error: unknown,
): StartAttempt {
  const detail = runnerErrorDetail(error);
  if (detail === null) return { kind: "blocked" };
  const { db } = context;
  const { runnerId, unverified } = target;
  const definite = detail.kind !== "malformed-output" || !target.startSent;
  const forget = (): void => {
    if (!unverified && definite) clearStartRequested(db, run.id);
  };
  const decision = decideStartFailure(detail, previousFailures);
  switch (decision.action) {
    case "wait-like-offline":
      markUnreachable(context, runnerId);
      if (!unverified) {
        tryWrite(context, run.id, () =>
          inTransaction(db, () => {
            forget();
            setQueuedRunRunner(db, run.id, null);
          }),
        );
      }
      return { kind: "skipped" };
    case "find-then-retry":
      return { kind: "blocked" };
    case "recreate-mailbox":
      context.mailboxes.delete(runnerId);
      tryWrite(context, run.id, () => setRunnerMailbox(db, runnerId, null));
      return { kind: "blocked" };
    case "retry":
      tryWrite(context, run.id, () =>
        inTransaction(db, () => {
          forget();
          recordStartFailure(db, run.id, { failures: decision.failures, error: describe(detail) });
        }),
      );
      return { kind: "blocked" };
    case "could-not-start": {
      const error = describe(detail);
      if (!definite) {
        tryWrite(context, run.id, () =>
          recordStartFailure(db, run.id, { failures: decision.failures, error }),
        );
        return { kind: "blocked" };
      }
      tryWrite(context, run.id, () =>
        recordStartFailure(db, run.id, { failures: decision.failures, error }),
      );
      return endCouldNotStart(context, run);
    }
  }
}

function endCouldNotStart(context: TickContext, run: QueuedStoredRun): StartAttempt {
  const ended = tryWrite(context, run.id, () =>
    changeRunState(
      context.db,
      run.id,
      { to: "ended", agentResult: "could-not-start", prState: "none" },
      context.now(),
    ),
  );
  if (ended !== undefined) reportFailure(context.logger, run.id, ended);
  return { kind: ended?.ok === true ? "skipped" : "blocked" };
}

async function promptFor(
  context: TickContext,
  run: QueuedStoredRun,
): Promise<{ text: string; ticket: { key: TicketKey; url: string } } | null | "ticket-gone"> {
  const tracker = context.adapters.tracker(context.db, run.ticket.connection);
  if (tracker === null) {
    context.logger.warn("run.tracker_connection_missing", { runId: run.id });
    return null;
  }
  const ticket = await tracker.getTicket(run.ticket.key);
  if (ticket === null) {
    context.logger.warn("run.ticket_missing", { runId: run.id });
    return "ticket-gone";
  }
  tryWrite(context, run.id, () => fillRunTicketTitle(context.db, run.id, ticket.title));
  return {
    text: ticketBriefText(ticket),
    ticket: { key: ticket.key, url: ticket.url },
  };
}

function recordStart(context: TickContext, runId: RunId, started: StartedRun): boolean {
  const { db, now, logger } = context;
  const result = changeRunState(db, runId, { to: "running", started }, now());
  reportFailure(logger, runId, result);
  return result.ok;
}
