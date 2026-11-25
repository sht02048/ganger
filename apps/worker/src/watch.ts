import { withLogContext } from "@ganger/log";
import {
  decideConnection,
  decideRunnerStop,
  decideTimeout,
  resolveRunProgress,
} from "@ganger/core";
import type {
  AgentRef,
  AgentResult,
  CompletionReport,
  PermissionRequestId,
  QuestionId,
  RunOnRunner,
  RunProgress,
  Runner,
  RunnerId,
} from "@ganger/core";
import {
  DEFAULT_MAX_RUN_MS,
  LAST_LOG_LINES,
  changeRunState,
  getRunWithRecords,
  hasPendingCancelRequest,
  inTransaction,
  lastStateBeforeDisconnect,
  runningSince,
  listRunners,
  listRuns,
  listUnsentAnswers,
  listUnsentDenials,
  listWorkspaces,
  markAnswerSent,
  markDenialSent,
  markCancelRequestProcessed,
  recordPermissionWaits,
  recordRunQuestions,
  resolvePermissionWaits,
  sentDenialIds,
  sentQuestionIds,
  updateRunRecords,
} from "@ganger/db";
import type { RunRecords, StoredRunner } from "@ganger/db";
import {
  answerKey,
  denialKey,
  isUnreachable,
  mailboxFor,
  readRunPrState,
  rememberPrReadFailure,
  reportFailure,
  tryWrite,
  runLogContext,
  pullRequestRecord,
} from "./context.js";
import type { ActiveRun, PendingEnding, PrRead, TickContext } from "./context.js";

export async function watchActiveRuns(context: TickContext): Promise<void> {
  const { db, logger } = context;
  const runnersById = new Map(listRunners(db).map((runner) => [runner.id, runner]));
  const maxRunMs = new Map(listWorkspaces(db).map((ws) => [ws.id, ws.maxRunMs]));
  const runs = listRuns(db, {
    states: ["running", "waiting-for-input", "paused", "disconnected"],
  }).filter((run): run is ActiveRun => run.state !== "queued" && run.state !== "ended");
  const cycleRunners = beginPollCycles(context, runnersById, runs);
  try {
    for (const run of runs) {
      try {
        await withLogContext(runLogContext(run), () =>
          watchRun(context, run, runnersById.get(run.runnerId), {
            maxRunMs: maxRunMs.get(run.workspaceId) ?? DEFAULT_MAX_RUN_MS,
          }),
        );
      } catch (error) {
        logger.warn("run.watch_failed", { ...runLogContext(run), error });
      }
    }
  } finally {
    for (const runner of cycleRunners) runner.endPollCycle?.();
  }
}

function beginPollCycles(
  context: TickContext,
  runnersById: ReadonlyMap<RunnerId, StoredRunner>,
  runs: ReadonlyArray<ActiveRun>,
): Runner[] {
  const agentsByRunner = new Map<RunnerId, AgentRef[]>();
  for (const run of runs) {
    const agents = agentsByRunner.get(run.runnerId) ?? [];
    agents.push(run.agentRef);
    agentsByRunner.set(run.runnerId, agents);
  }
  return [...agentsByRunner].flatMap(([runnerId, agents]) => {
    const stored = runnersById.get(runnerId);
    if (stored === undefined) return [];
    try {
      const runner = context.adapters.runner(stored);
      runner.beginPollCycle?.(agents);
      return [runner];
    } catch {
      return [];
    }
  });
}

interface WatchSettings {
  maxRunMs: number;
  pausedMs: number;
  pausedSince: Date | null;
}

async function watchRun(
  context: TickContext,
  run: ActiveRun,
  storedRunner: StoredRunner | undefined,
  limits: { maxRunMs: number },
): Promise<void> {
  const { db, logger, adapters } = context;
  const records = getRunWithRecords(db, run.id)?.records;
  if (records === undefined) return;
  const settings: WatchSettings = {
    maxRunMs: limits.maxRunMs,
    pausedMs: records.pausedMs,
    pausedSince: records.pausedSince,
  };
  const cancelRequested = hasPendingCancelRequest(db, run.id);
  if (storedRunner === undefined) {
    logger.warn("run.runner_missing", { runId: run.id, runnerId: run.runnerId });
    await endIfTimedOut(context, run, { ...settings, cancelRequested, state: "disconnected" });
    return;
  }
  const runner = adapters.runner(storedRunner);

  let onRunner: RunOnRunner;
  let progress: RunProgress;
  try {
    const mailbox = await mailboxFor(context, storedRunner, runner);
    onRunner = { mailbox, worktree: run.worktree, agentRef: run.agentRef };
    progress = await runner.pollRun(onRunner);
  } catch (error) {
    if (!isUnreachable(error)) {
      if (records.unreachableSince !== null) {
        tryWrite(context, run.id, () => updateRunRecords(db, run.id, { unreachableSince: null }));
      }
      const ended = await endWithoutProgress(context, run, storedRunner, runner, {
        ...settings,
        cancelRequested,
      });
      if (ended) return;
      throw error;
    }
    await whileUnreachable(context, run, records, { ...settings, cancelRequested });
    return;
  }

  if (records.unreachableSince !== null) {
    tryWrite(context, run.id, () => updateRunRecords(db, run.id, { unreachableSince: null }));
  }
  if (progress.kind === "active") {
    tryWrite(context, run.id, () => recordRunQuestions(db, run.id, progress.questions));
    await sendAnswers(context, run, runner, onRunner, progress);
    tryWrite(context, run.id, () =>
      inTransaction(db, () => {
        recordPermissionWaits(db, run.id, progress.permissionWaits);
        resolvePermissionWaits(
          db,
          run.id,
          progress.permissionWaits.map((wait) => wait.id),
          context.now(),
        );
      }),
    );
    await sendDenials(
      context,
      run,
      runner,
      onRunner,
      new Set(progress.permissionWaits.map((wait) => wait.id)),
    );
  }

  const resolution = keepPausedRunPaused(
    context,
    run,
    resolveRunProgress(progress, {
      answered: answeredQuestions(context, run),
      denied: deniedPermissions(context, run),
    }),
  );
  const pending = context.pendingEndings.get(run.id);
  const ending =
    pending === undefined
      ? decideEnding(context, run, {
          progress,
          resolution,
          cancelRequested,
          maxRunMs: settings.maxRunMs,
          pausedMs: settings.pausedMs,
          pausedSince: settings.pausedSince,
        })
      : { agentResult: pending.agentResult, report: pending.report, agent: "none" as const };
  if (ending === null) {
    if (resolution.kind === "continue" && resolution.state !== run.state) {
      recordDeliveredWithState(context, run, resolution.state);
      return;
    }
    recordDelivered(context, run);
    await followRunnerStop(context, run, { progress, resolution, runner, onRunner });
    return;
  }

  const prRead = await readRunPrState(context, run);
  const lastLog =
    pending === undefined ? await readLastLog(context, run, runner, onRunner) : pending.lastLog;
  if (ending.agent === "stop") await runner.stopAgent(onRunner);
  if (ending.agent === "close") await runner.closeAgent(onRunner);
  context.pendingEndings.set(run.id, {
    agentResult: ending.agentResult,
    report: ending.report,
    lastLog,
  });
  const recorded = endRun(context, run, {
    agentResult: ending.agentResult,
    prRead,
    runnerUnreached: false,
    report: ending.report,
    lastLog,
  });
  if (recorded) context.pendingEndings.delete(run.id);
  recordDelivered(context, run);
}

async function followRunnerStop(
  context: TickContext,
  run: ActiveRun,
  input: {
    progress: RunProgress;
    resolution: WatchResolution;
    runner: Runner;
    onRunner: RunOnRunner;
  },
): Promise<boolean> {
  const { db, logger } = context;
  const { progress, resolution } = input;
  if (progress.kind !== "active" || resolution.kind !== "continue") return false;
  const state =
    run.state === "running" && resolution.state === "running"
      ? "running"
      : run.state === "paused" && resolution.state === "paused"
        ? "paused"
        : null;
  if (state === null) return false;
  const records = getRunWithRecords(db, run.id)?.records;
  if (records === undefined) return false;
  const decision = decideRunnerStop({
    state,
    activity: progress.activity ?? { kind: "unknown" },
    unreportedStop: progress.unreportedStop ?? null,
    runningSince: runningSince(db, run.id),
    pausedSince: records.pausedSince,
    now: context.now(),
  });
  if (decision === null) return false;
  if (decision.to === "running") {
    reportFailure(logger, run.id, changeRunState(db, run.id, { to: "running" }, context.now()));
    return true;
  }
  const lastOutput =
    decision.source !== "unreported"
      ? null
      : decision.lastOutput !== null && decision.lastOutput.length > 0
        ? decision.lastOutput
        : await readLastLog(context, run, input.runner, input.onRunner);
  inTransaction(db, () => {
    const result = changeRunState(
      db,
      run.id,
      { to: "paused", source: decision.source },
      context.now(),
    );
    if (!result.ok) {
      reportFailure(logger, run.id, result);
      return;
    }
    if (decision.source === "unreported") {
      updateRunRecords(db, run.id, { lastLog: lastOutput === null ? null : [...lastOutput] });
    }
  });
  return true;
}

async function endWithoutProgress(
  context: TickContext,
  run: ActiveRun,
  storedRunner: StoredRunner,
  runner: Runner,
  input: WatchSettings & { cancelRequested: boolean },
): Promise<boolean> {
  const timeout = decideTimeout({
    state: run.state,
    startedAt: run.startedAt,
    now: context.now(),
    maxRunMs: input.maxRunMs,
    pausedMs: input.pausedMs,
    pausedSince: input.pausedSince,
    cancelRequested: input.cancelRequested,
  });
  const ending =
    timeout ??
    (input.cancelRequested && run.state !== "disconnected"
      ? { agentResult: "canceled" as const, stopAgent: true, runnerUnreached: false }
      : null);
  if (ending === null) return false;
  const prRead = await readRunPrState(context, run);
  if (ending.stopAgent && !context.pendingEndings.has(run.id)) {
    const mailbox = context.mailboxes.get(storedRunner.id) ?? storedRunner.mailbox;
    if (mailbox === null) return false;
    const onRunner = { mailbox, worktree: run.worktree, agentRef: run.agentRef };
    const lastLog = await readLastLog(context, run, runner, onRunner);
    await runner.stopAgent(onRunner);
    context.pendingEndings.set(run.id, { agentResult: ending.agentResult, report: null, lastLog });
  }
  const recorded = endRun(context, run, {
    agentResult: ending.agentResult,
    prRead,
    runnerUnreached: ending.runnerUnreached,
    report: null,
    lastLog: context.pendingEndings.get(run.id)?.lastLog ?? null,
  });
  if (recorded) context.pendingEndings.delete(run.id);
  return recorded;
}

async function endIfTimedOut(
  context: TickContext,
  run: ActiveRun,
  input: WatchSettings & { cancelRequested: boolean; state: "disconnected" },
): Promise<void> {
  const timeout = decideTimeout({
    state: input.state,
    startedAt: run.startedAt,
    now: context.now(),
    maxRunMs: input.maxRunMs,
    pausedMs: input.pausedMs,
    pausedSince: input.pausedSince,
    cancelRequested: input.cancelRequested,
  });
  if (timeout === null) return;
  const prRead = await readRunPrState(context, run);
  endRun(context, run, {
    agentResult: timeout.agentResult,
    prRead,
    runnerUnreached: timeout.runnerUnreached,
    report: null,
    lastLog: null,
  });
}

async function readLastLog(
  context: TickContext,
  run: ActiveRun,
  runner: Runner,
  onRunner: RunOnRunner,
): Promise<ReadonlyArray<string> | null> {
  try {
    return await runner.readLogTail(onRunner, { lines: LAST_LOG_LINES });
  } catch (error) {
    context.logger.warn("run.last_log_failed", { runId: run.id, error });
    return null;
  }
}

type WatchResolution =
  | ReturnType<typeof resolveRunProgress>
  | { kind: "continue"; state: "paused" };

function keepPausedRunPaused(
  context: TickContext,
  run: ActiveRun,
  resolution: ReturnType<typeof resolveRunProgress>,
): WatchResolution {
  const paused =
    run.state === "paused" ||
    (run.state === "disconnected" && lastStateBeforeDisconnect(context.db, run.id) === "paused");
  if (!paused) return resolution;
  if (resolution.kind === "continue" || resolution.agentResult === "ended-without-report") {
    return { kind: "continue", state: "paused" };
  }
  return resolution;
}

interface Ending extends Omit<PendingEnding, "lastLog"> {
  agent: "stop" | "close" | "none";
}

function decideEnding(
  context: TickContext,
  run: ActiveRun,
  input: {
    progress: RunProgress;
    resolution: WatchResolution;
    cancelRequested: boolean;
    maxRunMs: number;
    pausedMs: number;
    pausedSince: Date | null;
  },
): Ending | null {
  const { progress, resolution } = input;
  if (input.cancelRequested) {
    return {
      agentResult: "canceled",
      agent: progress.kind === "active" ? "stop" : progress.kind === "reported" ? "close" : "none",
      report: progress.kind === "reported" ? progress.report : null,
    };
  }
  if (resolution.kind === "end") {
    return {
      agentResult: resolution.agentResult,
      agent: resolution.report === null ? "none" : "close",
      report: resolution.report,
    };
  }
  const timeout = decideTimeout({
    state: resolution.state,
    startedAt: run.startedAt,
    now: context.now(),
    maxRunMs: input.maxRunMs,
    pausedMs: input.pausedMs,
    pausedSince: input.pausedSince,
    cancelRequested: false,
  });
  if (timeout === null) return null;
  return { agentResult: timeout.agentResult, agent: "stop", report: null };
}

async function whileUnreachable(
  context: TickContext,
  run: ActiveRun,
  records: RunRecords,
  input: WatchSettings & { cancelRequested: boolean },
): Promise<void> {
  const { db, logger, now } = context;
  if (run.state === "disconnected") {
    await endIfTimedOut(context, run, { ...input, state: run.state });
    return;
  }

  const unreachableSince = records.unreachableSince ?? now();
  if (records.unreachableSince === null) {
    tryWrite(context, run.id, () => updateRunRecords(db, run.id, { unreachableSince }));
  }
  if (decideConnection({ state: run.state, unreachableSince, now: now() }) === "disconnect") {
    reportFailure(logger, run.id, changeRunState(db, run.id, { to: "disconnected" }, now()));
  }
}

function endRun(
  context: TickContext,
  run: ActiveRun,
  input: {
    agentResult: AgentResult;
    prRead: PrRead;
    runnerUnreached: boolean;
    report: CompletionReport | null;
    lastLog: ReadonlyArray<string> | null;
  },
): boolean {
  const { db, logger } = context;
  const endedAt = context.now();
  const { prRead } = input;
  const ended = inTransaction(db, () => {
    const result = changeRunState(
      db,
      run.id,
      {
        to: "ended",
        agentResult: input.agentResult,
        ...(prRead.kind === "read"
          ? { prState: prRead.decision.prState }
          : { prState: "unknown" as const, prReadError: prRead.error }),
        runnerUnreached: input.runnerUnreached,
        ...(input.report === null ? {} : { reportBody: input.report.body }),
      },
      endedAt,
    );
    if (!result.ok) {
      reportFailure(logger, run.id, result);
      return false;
    }
    if (input.agentResult === "canceled") markCancelRequestProcessed(db, run.id, endedAt);
    resolvePermissionWaits(db, run.id, [], endedAt);
    if (input.lastLog !== null) updateRunRecords(db, run.id, { lastLog: [...input.lastLog] });
    if (prRead.kind === "read") {
      const pr = prRead.decision.pr;
      updateRunRecords(db, run.id, {
        pullRequest: pr === null ? null : pullRequestRecord(pr, endedAt),
      });
    }
    return true;
  });
  if (ended && prRead.kind === "failed") rememberPrReadFailure(context, run.id);
  return ended;
}

async function sendAnswers(
  context: TickContext,
  run: ActiveRun,
  runner: Runner,
  onRunner: RunOnRunner,
  progress: Extract<RunProgress, { kind: "active" }>,
): Promise<void> {
  const { db, logger, unmarkedAnswers, unwokenHumanChecks } = context;
  const delivery = run.state === "paused" ? "hold" : humanCheckDelivery(progress);
  for (const answer of listUnsentAnswers(db)) {
    if (answer.runId !== run.id) continue;
    const key = answerKey(run.id, answer.questionId);
    if (!unmarkedAnswers.has(key)) {
      try {
        await runner.answerQuestion(onRunner, {
          questionId: answer.questionId,
          answer: answer.answer,
        });
      } catch (error) {
        logger.warn("run.answer_failed", {
          runId: run.id,
          questionId: answer.questionId,
          error,
        });
        continue;
      }
      unmarkedAnswers.add(key);
    }
    if (answer.kind === "human-check" && delivery === "hold") {
      unwokenHumanChecks.add(key);
      continue;
    }
    if (answer.kind === "human-check" && delivery === "wake") {
      const message = humanCheckWakeMessage(answer.questionId, answer.answer);
      try {
        const resumed = await runner.resumeAgent(onRunner, {
          agent: run.agent,
          message,
          restartPrompt: message,
          startIfGone: false,
        });
        if (resumed.restarted) throw new Error("the answer did not reach the run's agent");
      } catch (error) {
        logger.warn("run.answer_failed", {
          runId: run.id,
          questionId: answer.questionId,
          error,
        });
        unwokenHumanChecks.add(key);
        continue;
      }
    }
    unwokenHumanChecks.delete(key);
  }
}

function humanCheckDelivery(
  progress: Extract<RunProgress, { kind: "active" }>,
): "delivered" | "wake" | "hold" {
  if (progress.permissionWaits.length > 0) return "hold";
  switch (progress.activity?.kind) {
    case "working":
      return "delivered";
    case "turn-ended":
    case "interrupted":
      return "wake";
    case "unknown":
    case undefined:
      return "hold";
  }
}

function humanCheckWakeMessage(questionId: QuestionId, answer: string): string {
  return `운영자가 Human Check(${questionId})에 답했어요: ${answer.replace(/\s*\n\s*/g, " ")}`;
}

async function sendDenials(
  context: TickContext,
  run: ActiveRun,
  runner: Runner,
  onRunner: RunOnRunner,
  open: ReadonlySet<PermissionRequestId>,
): Promise<void> {
  const { db, logger, unmarkedDenials } = context;
  for (const denial of listUnsentDenials(db)) {
    if (denial.runId !== run.id || !open.has(denial.permissionId)) continue;
    const key = denialKey(run.id, denial.permissionId);
    if (!unmarkedDenials.has(key)) {
      try {
        await runner.denyPermission(onRunner, {
          permissionId: denial.permissionId,
          reason: denial.reason,
        });
      } catch (error) {
        logger.warn("run.denial_failed", {
          runId: run.id,
          permissionId: denial.permissionId,
          error,
        });
        continue;
      }
      unmarkedDenials.add(key);
    }
  }
}

interface DeliveredKeys {
  answers: string[];
  denials: string[];
}

function markDelivered(context: TickContext, run: ActiveRun): DeliveredKeys {
  const { db, unmarkedAnswers, unwokenHumanChecks, unmarkedDenials } = context;
  const delivered: DeliveredKeys = { answers: [], denials: [] };
  for (const answer of listUnsentAnswers(db)) {
    const key = answerKey(run.id, answer.questionId);
    if (answer.runId !== run.id || !unmarkedAnswers.has(key) || unwokenHumanChecks.has(key)) {
      continue;
    }
    markAnswerSent(db, { runId: run.id, questionId: answer.questionId }, context.now());
    delivered.answers.push(key);
  }
  for (const denial of listUnsentDenials(db)) {
    const key = denialKey(run.id, denial.permissionId);
    if (denial.runId !== run.id || !unmarkedDenials.has(key)) continue;
    markDenialSent(db, { runId: run.id, permissionId: denial.permissionId }, context.now());
    delivered.denials.push(key);
  }
  return delivered;
}

function forgetDelivered(context: TickContext, delivered: DeliveredKeys): void {
  for (const key of delivered.answers) context.unmarkedAnswers.delete(key);
  for (const key of delivered.denials) context.unmarkedDenials.delete(key);
}

function recordDelivered(context: TickContext, run: ActiveRun): void {
  const delivered = tryWrite(context, run.id, () =>
    inTransaction(context.db, () => markDelivered(context, run)),
  );
  if (delivered !== undefined) forgetDelivered(context, delivered);
}

function recordDeliveredWithState(
  context: TickContext,
  run: ActiveRun,
  to: "running" | "waiting-for-input" | "paused",
): void {
  const written = tryWrite(context, run.id, () =>
    inTransaction(context.db, () => ({
      delivered: markDelivered(context, run),
      result: changeRunState(context.db, run.id, { to }, context.now()),
    })),
  );
  if (written === undefined) return;
  forgetDelivered(context, written.delivered);
  reportFailure(context.logger, run.id, written.result);
}

function deniedPermissions(context: TickContext, run: ActiveRun): Set<PermissionRequestId> {
  const denied = sentDenialIds(context.db, run.id);
  for (const denial of listUnsentDenials(context.db)) {
    if (
      denial.runId === run.id &&
      context.unmarkedDenials.has(denialKey(run.id, denial.permissionId))
    ) {
      denied.add(denial.permissionId);
    }
  }
  return denied;
}

function answeredQuestions(context: TickContext, run: ActiveRun): Set<QuestionId> {
  const answered = sentQuestionIds(context.db, run.id);
  for (const answer of listUnsentAnswers(context.db)) {
    const key = answerKey(run.id, answer.questionId);
    if (
      answer.runId === run.id &&
      context.unmarkedAnswers.has(key) &&
      !context.unwokenHumanChecks.has(key)
    ) {
      answered.add(answer.questionId);
    }
  }
  return answered;
}
