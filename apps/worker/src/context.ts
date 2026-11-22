import { z } from "zod";
import { AdapterError, decidePrState } from "@ganger/core";
import type {
  AgentResult,
  CommentId,
  CompletionReport,
  MailboxRef,
  PermissionRequestId,
  PrReadError,
  PullRequestSignals,
  PullRequestSnapshot,
  PrStateDecision,
  QuestionId,
  RunId,
  Runner,
  RunnerErrorDetail,
  RunnerId,
  StartedRun,
} from "@ganger/core";
import {
  changeRunState,
  getRun,
  getRunWithRecords,
  listRunners,
  setRunnerMailbox,
  worktreeTakenOverBy,
} from "@ganger/db";
import type { WorktreeSetupResult } from "@ganger/core";
import type { Database, RunRecords, StoredRun, StoredRunner } from "@ganger/db";
import type { LogContext, Logger } from "@ganger/log";
import type { WorkerAdapters } from "./adapters.js";
import type { AutoAssignState } from "./auto-assign.js";
import type { BlockerRefreshState } from "./blockers.js";

export type WorkerLogger = Logger;

export interface TickContext {
  db: Database;
  now: () => Date;
  logger: WorkerLogger;
  adapters: WorkerAdapters;
  pendingStarts: Map<RunId, PendingStart>;
  worktreeSetups: Map<RunId, WorktreeSetupJob>;
  mailboxes: Map<RunnerId, MailboxRef>;
  unreachableUntil: Map<RunnerId, number>;
  unmarkedAnswers: Set<string>;
  unwokenHumanChecks: Set<string>;
  unmarkedDenials: Set<string>;
  pendingEndings: Map<RunId, PendingEnding>;
  prPolledAt: Map<RunId, number>;
  prReadRetries: Map<RunId, PrReadRetry>;
  agentCheckedAt: Map<RunId, number>;
  unrecordedComments: Map<RunId, { id: CommentId; at: Date }>;
  ticketsGone: Set<RunId>;
  confirmedMerges: Set<RunId>;
  unmarkedMerges: Set<RunId>;
  autoAssign: AutoAssignState;
  blockerRefresh: BlockerRefreshState;
}

export interface WorktreeSetupJob {
  outcome: WorktreeSetupResult | { kind: "threw"; error: unknown } | null;
}

export interface PendingEnding {
  agentResult: AgentResult;
  report: CompletionReport | null;
  lastLog: ReadonlyArray<string> | null;
}

export interface PrReadRetry {
  failures: number;
  nextAt: number;
  codeHosts: string;
}

export interface PendingStart {
  runnerId: RunnerId;
  started: StartedRun;
}

export function answerKey(runId: RunId, questionId: QuestionId): string {
  return `${runId}\n${questionId}`;
}

export function denialKey(runId: RunId, permissionId: PermissionRequestId): string {
  return `${runId}\n${permissionId}`;
}

export type ActiveRun = Exclude<StoredRun, { state: "queued" | "ended" }>;

export type StartedStoredRun = Extract<StoredRun, { startedAt: Date }>;

export type QueuedStoredRun = Extract<StoredRun, { state: "queued" }>;

export async function mailboxFor(
  context: TickContext,
  storedRunner: StoredRunner,
  runner: Runner,
): Promise<MailboxRef> {
  const cached = context.mailboxes.get(storedRunner.id);
  if (cached !== undefined) return cached;
  const mailbox = await runner.ensureMailbox(storedRunner.mailbox);
  if (mailbox !== storedRunner.mailbox) {
    setRunnerMailbox(context.db, storedRunner.id, mailbox);
  }
  context.mailboxes.set(storedRunner.id, mailbox);
  return mailbox;
}

function handedOverAtOf(
  context: TickContext,
  run: StartedStoredRun,
): { handedOverAt: Date } | Record<string, never> {
  const nextId = worktreeTakenOverBy(context.db, run.id);
  const next = nextId === null ? null : getRun(context.db, nextId);
  return next === null ? {} : { handedOverAt: next.assignedAt };
}

export async function decideRunPrState(
  context: TickContext,
  run: StartedStoredRun,
): Promise<PrStateDecision> {
  let unavailable = 0;
  const codeHosts = context.adapters.allCodeHosts(context.db, (connectionId, error) => {
    unavailable += 1;
    context.logger.warn("run.code_host_adapter_failed", {
      codeHostConnectionId: connectionId,
      error,
    });
  });
  for (const codeHost of codeHosts) {
    const repo = codeHost.repoOf(run.runnerProject);
    if (repo === null) continue;
    const [branchRead, keyRead] = await Promise.allSettled([
      codeHost.findPullRequestsByBranch(repo, run.branch),
      codeHost.findPullRequestsByTicketKey(repo, run.ticket.key, { createdSince: run.startedAt }),
    ]);
    if (branchRead.status === "rejected" || keyRead.status === "rejected") {
      throw firstNoAccessOrAny([branchRead, keyRead]);
    }
    const byBranch = branchRead.value;
    const byTicketKey = keyRead.value;
    return decidePrState({
      repo,
      ticketKey: run.ticket.key,
      runStartedAt: run.startedAt,
      continuesEarlierRun: run.continuedFromRunId !== null,
      ...handedOverAtOf(context, run),
      byBranch,
      byTicketKey,
    });
  }
  if (unavailable > 0) {
    throw new Error(
      "no code host reads the run's project while some code host adapters are unavailable",
    );
  }
  context.logger.warn("run.code_host_missing", {
    runId: run.id,
    runnerProject: run.runnerProject,
  });
  return { prState: "none", pr: null };
}

export function pullRequestRecord(pr: PullRequestSnapshot, checkedAt: Date) {
  const { id, displayId, url, ci, signals, headCommit } = pr;
  const read = signals ?? (isSettledPr(pr) ? settledSignals(headCommit) : null);
  return { id, displayId, url, ci, checkedAt, headCommit, signals: read };
}

function isSettledPr(pr: PullRequestSnapshot): boolean {
  return pr.state === "merged" || pr.state === "closed";
}

function settledSignals(headCommit: string): PullRequestSignals {
  return {
    open: false,
    headCommit,
    ciFailed: false,
    checkTotal: null,
    failedCount: 0,
    failedChecks: [],
    checksTruncated: false,
    conflict: null,
    behindBy: null,
  };
}

export type PrRead =
  | { kind: "read"; decision: PrStateDecision }
  | { kind: "failed"; error: PrReadError };

export function isNewMerge(
  stored: RunRecords["pullRequest"],
  pr: PullRequestSnapshot | null,
): boolean {
  if (pr?.state !== "merged") return false;
  return stored?.id !== pr.id || stored.signals?.open !== false;
}

export function rememberConfirmedMerge(
  context: TickContext,
  runId: RunId,
  pr: PullRequestSnapshot | null,
): void {
  if (pr?.state !== "merged" || context.confirmedMerges.has(runId)) return;
  context.confirmedMerges.add(runId);
  context.unmarkedMerges.add(runId);
}

export function rememberMergeAgainstStored(
  context: TickContext,
  runId: RunId,
  pr: PullRequestSnapshot | null,
): void {
  const stored = getRunWithRecords(context.db, runId)?.records.pullRequest ?? null;
  if (isNewMerge(stored, pr)) {
    rememberConfirmedMerge(context, runId, pr);
  } else if (pr?.state === "merged") {
    context.confirmedMerges.add(runId);
  }
}

export async function readRunPrState(context: TickContext, run: StartedStoredRun): Promise<PrRead> {
  try {
    const decision = await decideRunPrState(context, run);
    rememberMergeAgainstStored(context, run.id, decision.pr);
    return { kind: "read", decision };
  } catch (error) {
    const reason = prReadErrorOf(error);
    context.logger.warn("run.pr_read_failed", { runId: run.id, reason, error });
    return { kind: "failed", error: reason };
  }
}

function firstNoAccessOrAny(reads: ReadonlyArray<PromiseSettledResult<unknown>>): unknown {
  const reasons: unknown[] = [];
  for (const read of reads) {
    if (read.status === "rejected") reasons.push(read.reason);
  }
  return reasons.find((reason) => prReadErrorOf(reason) === "no-access") ?? reasons[0];
}

const noAccessDetail = z.object({ kind: z.enum(["unauthorized", "not-found"]) });

export function prReadErrorOf(error: unknown): PrReadError {
  return error instanceof AdapterError && noAccessDetail.safeParse(error.detail).success
    ? "no-access"
    : "other";
}

export const PR_READ_RETRY_FIRST_MS = 60_000;
export const PR_READ_RETRY_MAX_MS = 30 * 60_000;

export function prReadRetryDelayMs(failures: number): number {
  return Math.min(PR_READ_RETRY_FIRST_MS * 2 ** Math.max(failures - 1, 0), PR_READ_RETRY_MAX_MS);
}

export function rememberPrReadFailure(context: TickContext, runId: RunId): void {
  const failures = (context.prReadRetries.get(runId)?.failures ?? 0) + 1;
  context.prReadRetries.set(runId, {
    failures,
    nextAt: context.now().getTime() + prReadRetryDelayMs(failures),
    codeHosts: context.adapters.codeHostsKey(context.db),
  });
}

export function prReadDue(context: TickContext, runId: RunId): boolean {
  const retry = context.prReadRetries.get(runId);
  if (retry === undefined) return true;
  if (retry.codeHosts !== context.adapters.codeHostsKey(context.db)) return true;
  return context.now().getTime() >= retry.nextAt;
}

export function tryWrite<T>(context: TickContext, runId: RunId, write: () => T): T | undefined {
  try {
    return write();
  } catch (error) {
    context.logger.warn("run.write_failed", { runId, error });
    return undefined;
  }
}

export function findRunner(db: Database, id: RunnerId): StoredRunner | undefined {
  return listRunners(db).find((runner) => runner.id === id);
}

export function runnerErrorDetail(error: unknown): RunnerErrorDetail | null {
  if (!(error instanceof AdapterError)) return null;
  const detail: unknown = error.detail;
  if (typeof detail !== "object" || detail === null || !("kind" in detail)) return null;
  switch (detail.kind) {
    case "unreachable":
    case "not-installed":
    case "not-ready":
    case "mailbox-missing":
    case "start-outcome-unknown":
      return { kind: detail.kind, detail: describe(detail) };
    case "malformed-output":
      return { kind: "malformed-output", raw: describe(detail) };
    case "runner-error":
      return {
        kind: "runner-error",
        code: "code" in detail && typeof detail.code === "string" ? detail.code : "unknown",
        message: describe(detail),
      };
    default:
      return null;
  }
}

export function isUnreachable(error: unknown): boolean {
  return runnerErrorDetail(error)?.kind === "unreachable";
}

export function describe(detail: object): string {
  return JSON.stringify(detail);
}

export function reportFailure(
  logger: WorkerLogger,
  runId: RunId,
  result: ReturnType<typeof changeRunState>,
): void {
  if (!result.ok) logger.warn("run.state_change_failed", { runId, error: result.error });
}

export function runLogContext(
  run: Pick<StoredRun, "id" | "ticket" | "runnerId" | "workspaceId" | "worktreeName">,
): LogContext {
  return {
    runId: run.id,
    ticketKey: run.ticket.key,
    runnerId: run.runnerId,
    workspaceId: run.workspaceId,
    worktreeName: run.worktreeName,
  };
}
