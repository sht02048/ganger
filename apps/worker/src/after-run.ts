import { withLogContext } from "@ganger/log";
import type { LogEvent } from "@ganger/log";
import { AdapterError, summarizeRunOutcome } from "@ganger/core";
import type { AgentCheck, PullRequestSnapshot, Tracker, WorktreeKeptReason } from "@ganger/core";
import {
  continueRunBlock,
  fillUnreadPrState,
  getRun,
  getRunWithRecords,
  getWorkspaceTrackerProject,
  listRunners,
  listRuns,
  inTransaction,
  markTrackerChanged,
  recordAgentCheck,
  recordPrReadError,
  updateRunRecords,
  worktreeTakenOverBy,
} from "@ganger/db";
import type { RunRecords, StoredRun, StoredRunner } from "@ganger/db";
import {
  decideRunPrState,
  isNewMerge,
  mailboxFor,
  prReadDue,
  pullRequestRecord,
  readRunPrState,
  rememberConfirmedMerge,
  rememberMergeAgainstStored,
  rememberPrReadFailure,
  runLogContext,
  runnerErrorDetail,
  tryWrite,
} from "./context.js";
import type { ActiveRun, StartedStoredRun, TickContext } from "./context.js";
import { messages } from "./messages.js";

export const PR_POLL_INTERVAL_MS = 60_000;
export const AGENT_CHECK_INTERVAL_MS = 30_000;

type EndedRun = Extract<StoredRun, { state: "ended" }>;
type StartedEndedRun = Extract<EndedRun, { startedAt: Date }>;

export async function processAfterRuns(context: TickContext): Promise<void> {
  const runnersById = new Map(listRunners(context.db).map((runner) => [runner.id, runner]));
  const runs = listRuns(context.db, {
    states: ["running", "waiting-for-input", "paused", "disconnected", "ended"],
  });
  for (const run of runs) {
    try {
      await withLogContext(runLogContext(run), () => afterRun(context, run, runnersById));
    } catch (error) {
      context.logger.warn("run.follow_up_failed", { ...runLogContext(run), error });
    }
  }
}

async function afterRun(
  context: TickContext,
  run: StoredRun,
  runnersById: ReadonlyMap<StoredRunner["id"], StoredRunner>,
): Promise<void> {
  if (run.state === "queued") return;
  const records = getRunWithRecords(context.db, run.id)?.records;
  if (records === undefined) return;
  if (run.state !== "ended") {
    await attempt(context, run, "run.tracker_update_failed", () =>
      markInProgress(context, run, records),
    );
    await attempt(context, run, "run.pr_poll_failed", () => pollActivePullRequest(context, run));
    await attempt(context, run, "run.tracker_update_failed", () => markMerged(context, run));
    return;
  }
  await attempt(context, run, "run.result_comment_failed", () =>
    commentResult(context, run, records),
  );
  if (run.startedAt !== null) {
    await attempt(context, run, "run.worktree_follow_up_failed", () =>
      followWorktree(context, run, records, runnersById),
    );
  } else {
    context.prPolledAt.delete(run.id);
  }
  await attempt(context, run, "run.tracker_update_failed", () => markMerged(context, run));
}

async function attempt(
  context: TickContext,
  run: StoredRun,
  event: LogEvent,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    context.logger.warn(event, { runId: run.id, error });
  }
}

async function markInProgress(
  context: TickContext,
  run: ActiveRun,
  records: RunRecords,
): Promise<void> {
  if (
    records.trackerStateSetAt !== null ||
    records.mergedStateSetAt !== null ||
    context.ticketsGone.has(run.id)
  ) {
    return;
  }
  const project = getWorkspaceTrackerProject(context.db, run.ticket.connection, run.trackerProject);
  const stateId = project?.inProgressStateId ?? null;
  if (stateId === null) return;
  const mergedStateChosen = (project?.mergedStateId ?? null) !== null;
  if (mergedStateChosen && context.confirmedMerges.has(run.id)) return;
  const tracker = trackerFor(context, run);
  if (tracker === null) return;
  try {
    await tracker.setState(run.ticket.key, stateId);
  } catch (error) {
    if (!isTicketGone(error)) throw error;
    forgetGoneTicket(context, run);
    return;
  }
  tryWrite(context, run.id, () =>
    inTransaction(context.db, () => {
      updateRunRecords(context.db, run.id, { trackerStateSetAt: context.now() });
      markTrackerChanged(context.db, run.ticket.connection);
    }),
  );
}

async function markMerged(context: TickContext, run: StoredRun): Promise<void> {
  if (!context.unmarkedMerges.has(run.id)) return;
  const records = getRunWithRecords(context.db, run.id)?.records;
  const stateId =
    getWorkspaceTrackerProject(context.db, run.ticket.connection, run.trackerProject)
      ?.mergedStateId ?? null;
  if (records === undefined || records.mergedStateSetAt !== null || stateId === null) {
    context.unmarkedMerges.delete(run.id);
    return;
  }
  const tracker = trackerFor(context, run);
  if (tracker === null) return;
  try {
    await tracker.setState(run.ticket.key, stateId);
  } catch (error) {
    if (!isTicketGone(error)) throw error;
    context.logger.warn("run.tracker_update_failed", { runId: run.id, error });
    context.unmarkedMerges.delete(run.id);
    return;
  }
  const recorded = tryWrite(context, run.id, () =>
    inTransaction(context.db, () => {
      updateRunRecords(context.db, run.id, { mergedStateSetAt: context.now() });
      markTrackerChanged(context.db, run.ticket.connection);
      return true;
    }),
  );
  if (recorded === true) context.unmarkedMerges.delete(run.id);
}

async function commentResult(
  context: TickContext,
  run: EndedRun,
  records: RunRecords,
): Promise<void> {
  if (records.trackerComment !== null || context.ticketsGone.has(run.id)) return;
  let comment = context.unrecordedComments.get(run.id);
  if (comment === undefined) {
    const tracker = trackerFor(context, run);
    if (tracker === null) return;
    try {
      comment =
        (await findResultComment(tracker, run)) ??
        (await addResultComment(context, tracker, run, records));
    } catch (error) {
      if (!isTicketGone(error)) throw error;
      forgetGoneTicket(context, run);
      return;
    }
    context.unrecordedComments.set(run.id, comment);
  }
  const recorded = tryWrite(context, run.id, () =>
    inTransaction(context.db, () => {
      updateRunRecords(context.db, run.id, { trackerComment: comment });
      markTrackerChanged(context.db, run.ticket.connection);
    }),
  );
  if (recorded !== undefined) context.unrecordedComments.delete(run.id);
}

async function addResultComment(
  context: TickContext,
  tracker: Tracker,
  run: EndedRun,
  records: RunRecords,
): Promise<{ id: NonNullable<RunRecords["trackerComment"]>["id"]; at: Date }> {
  const { id } = await tracker.addComment(run.ticket.key, resultCommentBody(run, records));
  return { id, at: context.now() };
}

async function findResultComment(
  tracker: Tracker,
  run: EndedRun,
): Promise<{ id: NonNullable<RunRecords["trackerComment"]>["id"]; at: Date } | null> {
  let after: string | null = null;
  do {
    const page = await tracker.listComments(run.ticket.key, after === null ? {} : { after });
    const found = page.items.find((comment) => comment.body.includes(run.id));
    if (found !== undefined) return { id: found.id, at: found.createdAt };
    after = page.nextCursor;
  } while (after !== null);
  return null;
}

export function resultCommentBody(run: EndedRun, records: RunRecords): string {
  const m = messages.resultComment;
  const { outcome } = summarizeRunOutcome(run);
  const pr = records.pullRequest;
  return [
    m.title,
    "",
    `- ${m.summary}: ${messages.summary[outcome]}`,
    `- ${m.agentResult}: ${messages.agentResult[run.agentResult]}`,
    `- ${m.prState}: ${messages.prState[run.prState]}`,
    `- ${m.pr}: ${pr === null ? m.noPr : `[${pr.displayId}](${pr.url})`}`,
    "",
    `${m.runId}: \`${run.id}\``,
  ].join("\n");
}

function trackerFor(context: TickContext, run: StoredRun): Tracker | null {
  const tracker = context.adapters.tracker(context.db, run.ticket.connection);
  if (tracker === null) {
    context.logger.warn("run.tracker_connection_missing", { runId: run.id });
  }
  return tracker;
}

function isTicketGone(error: unknown): boolean {
  if (!(error instanceof AdapterError)) return false;
  const detail: unknown = error.detail;
  return (
    typeof detail === "object" && detail !== null && "kind" in detail && detail.kind === "not-found"
  );
}

function forgetGoneTicket(context: TickContext, run: StoredRun): void {
  context.logger.warn("run.ticket_missing_skip_updates", {
    runId: run.id,
  });
  context.ticketsGone.add(run.id);
}

async function pollActivePullRequest(context: TickContext, run: ActiveRun): Promise<void> {
  if (!pollDue(context, run)) return;
  const decision = await decideRunPrState(context, run);
  rememberMergeAgainstStored(context, run.id, decision.pr);
  if (decision.pr === null) return;
  recordPullRequest(context, run, decision.pr);
}

function pollDue(context: TickContext, run: StoredRun): boolean {
  const now = context.now().getTime();
  const last = context.prPolledAt.get(run.id);
  if (last !== undefined && now - last < PR_POLL_INTERVAL_MS) return false;
  context.prPolledAt.set(run.id, now);
  return true;
}

function recordPullRequest(
  context: TickContext,
  run: StoredRun,
  pr: PullRequestSnapshot,
): boolean | undefined {
  return tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, {
      pullRequest: pullRequestRecord(pr, context.now()),
    }),
  );
}

async function followWorktree(
  context: TickContext,
  ended: StartedEndedRun,
  endedRecords: RunRecords,
  runnersById: ReadonlyMap<StoredRunner["id"], StoredRunner>,
): Promise<void> {
  await followPreviousAgent(context, ended, endedRecords, runnersById.get(ended.runnerId));
  if (endedRecords.worktreeRemovedAt === null && endedRecords.worktreeRemoveRequestedAt !== null) {
    await removeWorktree(context, ended, runnersById.get(ended.runnerId));
    return;
  }
  const read =
    ended.prState === "unknown"
      ? await readUnreadPullRequest(context, ended)
      : { run: ended, records: endedRecords };
  if (read === null) return;
  const { run, records } = read;
  const disposition = summarizeRunOutcome(run).worktree;
  if (records.worktreeRemovedAt !== null || disposition !== "keep-until-pr-settles") {
    context.prPolledAt.delete(run.id);
  }
  if (records.worktreeRemovedAt !== null || records.worktreeKept !== null) return;
  switch (disposition) {
    case "remove-now":
      await removeWorktreeWithoutWork(context, run, runnersById.get(run.runnerId));
      return;
    case "keep-until-pr-settles":
      if (prHandedOver(context, run, records)) {
        context.prPolledAt.delete(run.id);
        return;
      }
      if (
        records.laterPrState === null &&
        !(await recordSettledPullRequest(context, run, records))
      ) {
        return;
      }
      await removeWorktreeWithoutWork(context, run, runnersById.get(run.runnerId));
      return;
    case "operator-decides":
    case "nothing-to-remove":
      return;
  }
}

async function followPreviousAgent(
  context: TickContext,
  run: StartedEndedRun,
  records: RunRecords,
  stored: StoredRunner | undefined,
): Promise<void> {
  const stopRequested = records.agentStopRequestedAt !== null;
  if (!stopRequested && records.agentCheck === "gone") return;
  const now = context.now().getTime();
  const checkedAt = context.agentCheckedAt.get(run.id);
  if (!stopRequested && checkedAt !== undefined && now - checkedAt < AGENT_CHECK_INTERVAL_MS) {
    return;
  }
  context.agentCheckedAt.set(run.id, now);
  if (continueRunBlock(context.db, run.id) !== null) {
    if (stopRequested) writeAgentCheck(context, run, records.agentCheck ?? "unknown", true);
    return;
  }
  if (stored === undefined || !stored.online) {
    writeAgentCheck(context, run, "unknown", false);
    return;
  }
  const runner = context.adapters.runner(stored);
  const onRunner = { worktree: run.worktree, agentRef: run.agentRef };
  try {
    if (stopRequested) {
      const mailbox = await mailboxFor(context, stored, runner);
      await runner.stopAgent({ ...onRunner, mailbox }).catch((error: unknown) => {
        if (runnerErrorDetail(error)?.kind !== "runner-error") throw error;
        context.logger.warn("run.agent_check_failed", { runId: run.id, error });
      });
    }
    const alive = await runner.isAgentAlive(onRunner);
    writeAgentCheck(context, run, alive ? "alive" : "gone", true);
  } catch (error) {
    context.logger.warn("run.agent_check_failed", { runId: run.id, error });
    writeAgentCheck(context, run, "unknown", false);
  }
}

function writeAgentCheck(
  context: TickContext,
  run: StartedEndedRun,
  check: AgentCheck,
  stopHandled: boolean,
): void {
  tryWrite(context, run.id, () => {
    recordAgentCheck(context.db, run.id, check, { stopHandled });
    return true;
  });
}

async function readUnreadPullRequest(
  context: TickContext,
  run: StartedEndedRun,
): Promise<{ run: StartedEndedRun; records: RunRecords } | null> {
  if (!prReadDue(context, run.id)) return null;
  const prRead = await readRunPrState(context, run);
  if (prRead.kind === "failed") {
    tryWrite(context, run.id, () => recordPrReadError(context.db, run.id, prRead.error));
    rememberPrReadFailure(context, run.id);
    return null;
  }
  const { prState, pr } = prRead.decision;
  const filled = tryWrite(context, run.id, () =>
    inTransaction(context.db, () => {
      updateRunRecords(context.db, run.id, {
        pullRequest: pr === null ? null : pullRequestRecord(pr, context.now()),
      });
      return fillUnreadPrState(context.db, run.id, prState);
    }),
  );
  if (filled !== true) return null;
  context.prReadRetries.delete(run.id);
  const found = getRunWithRecords(context.db, run.id);
  if (found === null || found.run.state !== "ended" || found.run.startedAt === null) return null;
  return { run: found.run, records: found.records };
}

async function recordSettledPullRequest(
  context: TickContext,
  run: StartedEndedRun,
  records: RunRecords,
): Promise<boolean> {
  if (!pollDue(context, run)) return false;
  const pr = await currentPullRequest(context, run, records);
  if (pr === null) return false;
  const mergeIsNew = isNewMerge(records.pullRequest, pr);
  recordPullRequest(context, run, pr);
  const state = pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : null;
  if (state === null) return false;
  if (settledAfterNextRunStarted(context, run, pr)) return false;
  if (mergeIsNew) rememberConfirmedMerge(context, run.id, pr);
  const recorded = tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, { laterPrState: { state, at: context.now() } }),
  );
  return recorded === true;
}

function nextRunStartedAt(context: TickContext, run: StartedEndedRun): Date | null {
  const nextId = worktreeTakenOverBy(context.db, run.id);
  const next = nextId === null ? null : getRun(context.db, nextId);
  return next === null || next.state === "queued" ? null : next.startedAt;
}

function prHandedOver(context: TickContext, run: StartedEndedRun, records: RunRecords): boolean {
  const startedAt = nextRunStartedAt(context, run);
  if (startedAt === null) return false;
  const readAt = records.pullRequest?.checkedAt;
  return readAt !== undefined && readAt.getTime() >= startedAt.getTime();
}

function settledAfterNextRunStarted(
  context: TickContext,
  run: StartedEndedRun,
  pr: PullRequestSnapshot,
): boolean {
  const startedAt = nextRunStartedAt(context, run);
  const settledAt = pr.mergedAt ?? pr.closedAt ?? null;
  return startedAt !== null && settledAt !== null && settledAt.getTime() >= startedAt.getTime();
}

async function currentPullRequest(
  context: TickContext,
  run: StartedStoredRun,
  records: RunRecords,
): Promise<PullRequestSnapshot | null> {
  const linked = records.pullRequest;
  if (linked === null) return (await decideRunPrState(context, run)).pr;
  const codeHosts = context.adapters.allCodeHosts(context.db, (connectionId, error) => {
    context.logger.warn("run.code_host_adapter_failed", {
      codeHostConnectionId: connectionId,
      error,
    });
  });
  for (const codeHost of codeHosts) {
    const repo = codeHost.repoOf(run.runnerProject);
    if (repo === null) continue;
    return codeHost.getPullRequest(repo, linked.id);
  }
  return null;
}

async function removeWorktreeWithoutWork(
  context: TickContext,
  run: StartedEndedRun,
  stored: StoredRunner | undefined,
): Promise<void> {
  if (stored === undefined || !stored.online) return;
  if (worktreeTakenOverBy(context.db, run.id) !== null) return;
  const kept = await unsavedWorkIn(context, run, stored);
  if (kept === "unreachable") return;
  if (worktreeTakenOverBy(context.db, run.id) !== null) return;
  if (kept === null) {
    await removeWorktree(context, run, stored);
    return;
  }
  context.logger.info("run.worktree_kept", { runId: run.id, reason: kept });
  context.prPolledAt.delete(run.id);
  tryWrite(context, run.id, () => updateRunRecords(context.db, run.id, { worktreeKept: kept }));
}

async function unsavedWorkIn(
  context: TickContext,
  run: StartedEndedRun,
  stored: StoredRunner,
): Promise<WorktreeKeptReason | "unreachable" | null> {
  try {
    const work = await context.adapters.runner(stored).checkWorktreeWork(run.worktree);
    if (work.kind === "gone") return null;
    if (work.uncommittedChanges) return "uncommitted-changes";
    if (work.unpushedCommits && work.headCommit !== mergedPullRequestHead(context, run)) {
      return "unpushed-commits";
    }
    return null;
  } catch (error) {
    if (runnerErrorDetail(error)?.kind === "unreachable") {
      context.logger.debug("run.worktree_check_unreachable", { runId: run.id, error });
      return "unreachable";
    }
    context.logger.warn("run.worktree_check_failed", { runId: run.id, error });
    return "check-failed";
  }
}

function mergedPullRequestHead(context: TickContext, run: StartedEndedRun): string | null {
  const found = getRunWithRecords(context.db, run.id);
  if (found === null || found.run.state !== "ended") return null;
  const { prState } = found.run;
  const { laterPrState, pullRequest } = found.records;
  if (prState !== "merged" && laterPrState?.state !== "merged") return null;
  const signals = pullRequest?.signals;
  return signals === undefined || signals === null || signals.open ? null : signals.headCommit;
}

async function removeWorktree(
  context: TickContext,
  run: StartedEndedRun,
  stored: StoredRunner | undefined,
): Promise<void> {
  if (stored === undefined || !stored.online) return;
  const runner = context.adapters.runner(stored);
  try {
    await runner.removeWorktree(run.worktree);
  } catch (error) {
    const exists = await runner.worktreeExists(run.worktree).catch(() => true);
    if (exists) {
      context.logger.warn("run.worktree_remove_failed", { runId: run.id, error });
      return;
    }
  }
  context.prPolledAt.delete(run.id);
  tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, { worktreeRemovedAt: context.now() }),
  );
}
