import { prSignalsViewOf, toCiView } from "../pr-signals-view.js";

export { toCiView };
import {
  acceptsAgentMessage,
  isAgentMessageFailure,
  runDurations,
  summarizeRunOutcome,
  toRunId,
} from "@ganger/core";
import type { PrReadError, RunId, WorktreeDisposition } from "@ganger/core";
import {
  getLogTailRequest,
  getRun,
  getRunWithRecords,
  getWorkspaceBrief,
  getWorkspaceTrackerProject,
  getRunCancelRequest,
  continueRunBlock,
  listRunAgentMessages,
  listRunMcpActions,
  listRunPermissionWaits,
  listRunQuestions,
  listRunStateChanges,
  listRunners,
  listRuns,
  listWorkspaces,
  requestLogTail,
  worktreeTakenOverBy,
} from "@ganger/db";
import type {
  Database,
  RunRecords,
  RunStateChangeRecord,
  StoredAgentMessage,
  StoredMcpAction,
  StoredRun,
  StoredPermissionWait,
  StoredRunQuestion,
} from "@ganger/db";
import { pendingInput } from "../home/load.js";
import { runControlOf, withoutPauses } from "../run-control.js";
import { mcpActionView } from "../mcp/actions.js";
import type { QueuedReason } from "../runs/model.js";
import { diagnosePrRead } from "../pr-read-diagnosis.js";
import type { PrReadDiagnosis, ServerGitHub } from "../pr-read-diagnosis.js";
import { describeQueuedReason, loadQueueReasons } from "../runs/queue-reasons.js";
import type {
  AgentMessageDelivery,
  ContinueOffer,
  KeptWorktree,
  KeptWorktreeReason,
  LogTailView,
  OtherRun,
  PendingInput,
  RunDetail,
  RunDetailPage,
  RunDetailStatus,
  RunLink,
  TimelineEvent,
} from "./model.js";

export function loadRunDetail(
  db: Database,
  runId: string,
  now: Date,
  serverGitHub: ServerGitHub | null = null,
): RunDetailPage {
  const found = getRunWithRecords(db, toRunId(runId));
  if (found === null) return { kind: "not-found" };
  const { run, records } = found;

  const runners = new Map(listRunners(db).map((r) => [r.id, r]));
  const runner = run.runnerId === null ? undefined : runners.get(run.runnerId);
  const workspace = listWorkspaces(db).find((w) => w.id === run.workspaceId);
  const startedAt = run.state === "queued" ? null : run.startedAt;
  const endedAt = run.state === "ended" ? run.endedAt : null;
  const durations = runDurations({ assignedAt: run.assignedAt, startedAt, endedAt, now });
  const pr = records.pullRequest;
  const questions = listRunQuestions(db, run.id);
  const permissionWaits = listRunPermissionWaits(db, run.id);
  const cancelRequest = getRunCancelRequest(db, run.id);
  const ticketRuns = listRuns(db, { ticket: run.ticket });
  const linkTo = (id: RunId | null): RunLink | null => {
    if (id === null) return null;
    const index = ticketRuns.findIndex((other) => other.id === id);
    return index === -1 ? null : { id, number: index + 1 };
  };
  const continuedFrom = linkTo(run.continuedFromRunId);
  const continuedBy = linkTo(worktreeTakenOverBy(db, run.id));
  const nextRun = ticketRuns.find((other) => other.id === continuedBy?.id);
  const prHandedOver =
    run.state === "ended" &&
    run.prState === "open" &&
    records.laterPrState === null &&
    nextRun !== undefined &&
    nextRun.state !== "queued" &&
    nextRun.startedAt !== null;
  const cancelPending =
    run.state !== "ended" && cancelRequest !== null && cancelRequest.processedAt === null;
  const agentMessages = listRunAgentMessages(db, run.id).map((message) => ({
    message,
    delivery: deliveryOf(message, run, records),
  }));

  const detail: RunDetail = {
    id: run.id,
    now: now.toISOString(),
    ticketKey: run.ticket.key,
    ticketTitle: run.ticketTitle,
    trackerProject:
      getWorkspaceTrackerProject(db, run.ticket.connection, run.trackerProject)?.name ??
      run.trackerProject,
    workspace: { id: run.workspaceId, name: workspace?.name ?? run.workspaceId },
    branch: run.state === "queued" ? null : run.branch,
    worktree: run.state === "queued" ? null : run.worktree,
    runner:
      runner === undefined ? null : { id: runner.id, name: runner.name, online: runner.online },
    agent: run.agent,
    model: run.model,
    assignedAt: run.assignedAt.toISOString(),
    startedAt: startedAt?.toISOString() ?? null,
    endedAt: endedAt?.toISOString() ?? null,
    waitMs: durations.waitMs ?? 0,
    executionMs: withoutPauses(durations.executionMs, records, now),
    status: statusOf(db, run, records, now, continuedBy !== null, (error) =>
      diagnosePrRead(
        error,
        runner === undefined
          ? null
          : { name: runner.name, ghAccounts: runner.ghAccounts?.reading ?? null },
        serverGitHub,
      ),
    ),
    pullRequest:
      pr === null || !isWebUrl(pr.url)
        ? null
        : {
            displayId: pr.displayId,
            url: pr.url,
            ci: toCiView(pr.ci),
            signals: prHandedOver ? null : prSignalsViewOf(run, records),
          },
    report: records.reportBody,
    brief:
      run.state === "queued" || (run.state === "ended" && run.startedAt === null)
        ? null
        : records.agentBrief,
    startError:
      run.state === "ended" && run.agentResult === "could-not-start" ? records.startError : null,
    cancelPending,
    control: run.state === "running" || run.state === "paused" ? runControlOf(db, run, now) : null,
    agentMessage: {
      accepting: acceptsAgentMessage(run.state) && !cancelPending,
      latest: agentMessages.at(-1)?.delivery ?? null,
    },
    timeline: timelineOf(
      run,
      records,
      listRunStateChanges(db, run.id),
      questions,
      permissionWaits,
      cancelRequest?.requestedAt ?? null,
      listRunMcpActions(db, run.id),
      agentMessages,
      continuationEvents(run, continuedFrom, continuedBy, ticketRuns),
    ),
    log: logOf(db, run, records),
    otherRuns: otherRunsOf(db, run),
    continuedFrom,
    continuedBy,
    prHandedOver,
    continuePlace: records.continuePlace,
    continueOffer: continueOfferOf(db, run, records, ticketRuns, runner?.name ?? null),
  };
  return { kind: "found", run: detail };
}

export function requestRunLogTail(db: Database, runId: string, now: Date): boolean {
  const run = getRun(db, toRunId(runId));
  if (run === null || run.state === "queued" || run.state === "ended") return false;
  requestLogTail(db, run.id, now);
  return true;
}

export function worktreeRemains(
  run: StoredRun,
  records: Pick<RunRecords, "worktreeRemovedAt">,
): boolean {
  return (
    records.worktreeRemovedAt === null &&
    !(run.state === "ended" && run.agentResult === "worktree-missing")
  );
}

function continueOfferOf(
  db: Database,
  run: StoredRun,
  records: RunRecords,
  ticketRuns: ReadonlyArray<StoredRun>,
  runnerName: string | null,
): ContinueOffer | null {
  if (continueRunBlock(db, run.id) !== null) return null;
  const brief = getWorkspaceBrief(db, run.workspaceId);
  return {
    sourceNumber: ticketRuns.findIndex((other) => other.id === run.id) + 1,
    nextNumber: ticketRuns.length + 1,
    runnerName,
    place: worktreeRemains(run, records) ? "same-worktree" : "recreated",
    hasReport: (records.reportBody?.trim() ?? "") !== "",
    hasWorkspaceBrief: brief !== null && (brief.before.trim() !== "" || brief.after.trim() !== ""),
    agent: records.agentCheck ?? "checking",
    agentStopRequested: records.agentStopRequestedAt !== null,
  };
}

function continuationEvents(
  run: StoredRun,
  continuedFrom: RunLink | null,
  continuedBy: RunLink | null,
  ticketRuns: ReadonlyArray<StoredRun>,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (continuedFrom !== null) {
    events.push({
      kind: "continued-from",
      runNumber: continuedFrom.number,
      at: run.assignedAt.toISOString(),
    });
  }
  if (continuedBy !== null) {
    const next = ticketRuns.find((other) => other.id === continuedBy.id);
    if (next !== undefined) {
      events.push({
        kind: "continued-by",
        runNumber: continuedBy.number,
        at: next.assignedAt.toISOString(),
      });
    }
  }
  return events;
}

function statusOf(
  db: Database,
  run: StoredRun,
  records: RunRecords,
  now: Date,
  takenOver: boolean,
  diagnose: (error: PrReadError | null) => PrReadDiagnosis | null,
): RunDetailStatus {
  switch (run.state) {
    case "queued":
      return { state: "queued", queuedReason: queuedReasonOf(db, run.id, now) };
    case "running":
      return { state: "running" };
    case "paused": {
      const pauseSource = records.pauseSource ?? "operator";
      return {
        state: "paused",
        pausedSince: records.pausedSince?.toISOString() ?? null,
        pauseSource,
        lastOutput: pauseSource === "unreported" ? (records.lastLog ?? []) : null,
      };
    }
    case "waiting-for-input": {
      const input = pendingInput(db, run.id) ?? { kind: "unknown" };
      return { state: "waiting-for-input", input, inputSince: inputSinceOf(db, run.id, input) };
    }
    case "disconnected":
      return {
        state: "disconnected",
        unreachableSince: records.unreachableSince?.toISOString() ?? null,
        paused: records.pausedSince !== null,
      };
    case "ended": {
      const outcome = summarizeRunOutcome(run);
      return {
        state: "ended",
        agentResult: run.agentResult,
        prState: run.prState,
        prReadError: records.prReadError,
        prReadDiagnosis: diagnose(records.prReadError),
        summary: outcome.outcome,
        keptWorktree: takenOver ? null : keptWorktreeOf(run, records, outcome.worktree),
        laterPrState:
          records.laterPrState === null
            ? null
            : { state: records.laterPrState.state, at: records.laterPrState.at.toISOString() },
      };
    }
  }
}

export function keptWorktreeOf(
  run: Extract<StoredRun, { state: "ended" }>,
  records: RunRecords,
  disposition: WorktreeDisposition,
): KeptWorktree | null {
  if (run.startedAt === null || records.worktreeRemovedAt !== null) return null;
  const reason = keptWorktreeReason(run, records, disposition);
  return reason === null ? null : { reason, removing: records.worktreeRemoveRequestedAt !== null };
}

function keptWorktreeReason(
  run: Extract<StoredRun, { state: "ended" }>,
  records: RunRecords,
  disposition: WorktreeDisposition,
): KeptWorktreeReason | null {
  if (records.worktreeKept !== null) return records.worktreeKept;
  if (disposition !== "operator-decides") return null;
  if (run.agentResult === "runner-disconnected") return "runner-disconnected";
  if (run.agentResult === "canceled") return "runner-unreached";
  return "no-pr";
}

function inputSinceOf(db: Database, runId: RunId, input: PendingInput): string | null {
  switch (input.kind) {
    case "question":
    case "human-check":
      return (
        listRunQuestions(db, runId)
          .find((q) => q.id === input.questionId)
          ?.askedAt.toISOString() ?? null
      );
    case "permission":
      return (
        listRunPermissionWaits(db, runId)
          .find((w) => w.id === input.promptId)
          ?.requestedAt.toISOString() ?? null
      );
    case "unknown":
      return null;
  }
}

function queuedReasonOf(db: Database, runId: RunId, now: Date): QueuedReason {
  const reasons = loadQueueReasons(db, now);
  return describeQueuedReason(
    reasons.get(runId) ?? { kind: "behind" },
    (runnerId) => listRunners(db).find((r) => r.id === runnerId)?.name ?? runnerId,
    now,
  );
}

function timelineOf(
  run: StoredRun,
  records: RunRecords,
  changes: ReadonlyArray<RunStateChangeRecord>,
  questions: ReadonlyArray<StoredRunQuestion>,
  permissionWaits: ReadonlyArray<StoredPermissionWait>,
  cancelRequestedAt: Date | null,
  mcpActions: ReadonlyArray<StoredMcpAction>,
  agentMessages: ReadonlyArray<{ message: StoredAgentMessage; delivery: AgentMessageDelivery }>,
  continuation: ReadonlyArray<TimelineEvent>,
): TimelineEvent[] {
  const events: TimelineEvent[] = [...continuation];
  for (const { message, delivery } of agentMessages) {
    events.push({
      kind: "operator-message",
      body: message.body,
      delivery,
      at: message.requestedAt.toISOString(),
    });
  }
  for (const action of mcpActions) {
    const view = mcpActionView(action);
    events.push({
      kind: "mcp",
      client: view.client,
      tool: view.tool,
      outcome: view.outcome,
      reason: view.reason,
      at: view.at,
    });
  }
  for (const change of changes) {
    const event = changeEvent(run, change);
    if (event !== null) events.push(event);
  }
  for (const question of questions) {
    events.push({
      kind: question.kind,
      body: question.body,
      at: question.askedAt.toISOString(),
    });
    if (question.answer !== null) {
      events.push({
        kind: "answer",
        body: question.answer.text,
        at: question.answer.answeredAt.toISOString(),
      });
    }
  }
  for (const wait of permissionWaits) {
    events.push({ kind: "permission", body: wait.detail, at: wait.requestedAt.toISOString() });
    if (wait.denial !== null) {
      events.push({
        kind: "denied",
        body: wait.denial.reason,
        at: wait.denial.deniedAt.toISOString(),
      });
    }
  }
  if (cancelRequestedAt !== null) {
    events.push({ kind: "cancel-requested", at: cancelRequestedAt.toISOString() });
  }
  if (records.unreachableSince !== null) {
    events.push({ kind: "unreachable", at: records.unreachableSince.toISOString() });
  }
  if (records.laterPrState !== null) {
    events.push({
      kind: "later-pr",
      state: records.laterPrState.state,
      at: records.laterPrState.at.toISOString(),
    });
  }
  return events.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function deliveryOf(
  message: StoredAgentMessage,
  run: StoredRun,
  records: RunRecords,
): AgentMessageDelivery {
  if (message.completedAt !== null) {
    if (message.error === null) return { status: "sent" };
    return {
      status: "failed",
      reason: isAgentMessageFailure(message.error) ? message.error : "unknown",
    };
  }
  if (message.followUpRef !== null) return { status: "stopping-follow-up" };
  if (message.sendStartedAt !== null) return { status: "sending" };
  if (run.state === "paused") return { status: "after-resume" };
  if (run.state === "disconnected") {
    return { status: records.pausedSince === null ? "after-reconnect" : "after-resume" };
  }
  return { status: "sending" };
}

function changeEvent(run: StoredRun, change: RunStateChangeRecord): TimelineEvent | null {
  const at = change.at.toISOString();
  if (change.from === null) return { kind: "assigned", at };
  switch (change.to) {
    case "queued":
      return null;
    case "running":
      if (change.from === "disconnected") return { kind: "reconnected", at };
      if (change.from === "waiting-for-input") return { kind: "resumed", at };
      if (change.from === "paused") return { kind: "unpaused", at };
      return { kind: "started", at };
    case "paused":
      return change.from === "disconnected" ? { kind: "reconnected", at } : { kind: "paused", at };
    case "waiting-for-input":
      return change.from === "disconnected"
        ? { kind: "reconnected", at }
        : { kind: "waiting-for-input", at };
    case "disconnected":
      return { kind: "disconnected", at };
    case "ended":
      return run.state === "ended" ? { kind: "ended", agentResult: run.agentResult, at } : null;
  }
}

function logOf(db: Database, run: StoredRun, records: RunRecords): LogTailView {
  if (run.state === "queued") return { kind: "none" };
  if (run.state === "ended") return { kind: "stored", lines: records.lastLog ?? [] };
  const request = getLogTailRequest(db, run.id);
  if (request === null) return { kind: "pending" };
  switch (request.status) {
    case "pending":
      return { kind: "pending" };
    case "done":
      return { kind: "done", lines: request.result, at: request.completedAt.toISOString() };
    case "failed":
      return { kind: "failed", error: request.error, at: request.completedAt.toISOString() };
  }
}

function otherRunsOf(db: Database, run: StoredRun): OtherRun[] {
  return listRuns(db, { ticket: run.ticket })
    .filter((other) => other.id !== run.id)
    .toReversed()
    .map((other): OtherRun => {
      const assignedAt = other.assignedAt.toISOString();
      return other.state === "ended"
        ? {
            id: other.id,
            assignedAt,
            state: "ended",
            summary: summarizeRunOutcome(other).outcome,
          }
        : { id: other.id, assignedAt, state: other.state };
    });
}

function isWebUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "https:" || protocol === "http:";
}
