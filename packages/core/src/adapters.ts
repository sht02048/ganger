import type {
  FollowUpRef,
  AgentId,
  AgentRef,
  CodeHostKind,
  CommentId,
  DeliveryId,
  LabelId,
  MailboxRef,
  PermissionRequestId,
  PullRequestId,
  QuestionId,
  RepoRef,
  RunnerKind,
  RunnerProjectId,
  TicketKey,
  TrackerKind,
  TrackerProjectId,
  TrackerStateId,
  WorktreeRef,
} from "./ids.js";
import type { TicketPriority, TicketRelations } from "./blockers.js";
import type { ProviderUsageReading } from "./provider-usage.js";

export class AdapterError<D extends { kind: string }> extends Error {
  readonly detail: D;

  constructor(detail: D, options?: { cause?: unknown }) {
    super(`adapter error: ${detail.kind}`, options);
    this.name = "AdapterError";
    this.detail = detail;
  }
}

export type ConnectionCheck<E> = { ok: true } | { ok: false; error: E };

export interface Page {
  after?: string;
  first?: number;
}

export interface Paged<T> {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
}

export type TrackerStateCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | (string & {});

export interface TrackerState {
  id: TrackerStateId;
  name: string;
  category: TrackerStateCategory;
}

export interface TrackerLabel {
  id: LabelId;
  name: string;
}

export interface TrackerTicket {
  key: TicketKey;
  title: string;
  body: string;
  url: string;
  labels: ReadonlyArray<TrackerLabel>;
  project: { id: TrackerProjectId; name: string } | null;
  state: TrackerState;
  updatedAt: Date;
  priority?: TicketPriority;
  ancestors?: ReadonlyArray<TrackerTicketAncestor>;
}

export interface TrackerTicketAncestor {
  id: string;
  key: TicketKey;
  title: string;
  url: string;
  state: { name: string; category: TrackerStateCategory };
}

export interface TrackerComment {
  id: CommentId;
  body: string;
  createdAt: Date;
  author: string | null;
}

export interface TrackerProject {
  id: TrackerProjectId;
  name: string;
  url: string;
}

export interface TrackerEvent {
  deliveryId: DeliveryId;
  kind: "ticket.created" | "ticket.updated" | "ticket.removed" | "other";
  ticketKey: TicketKey | null;
  projectId: TrackerProjectId | null;
  labelIds: ReadonlyArray<LabelId> | null;
  previousLabelIds: ReadonlyArray<LabelId> | null;
  receivedAt: Date;
}

export function labelJustAttached(
  event: Pick<TrackerEvent, "labelIds" | "previousLabelIds">,
  labelId: LabelId,
): boolean {
  return (
    event.labelIds !== null &&
    event.previousLabelIds !== null &&
    event.labelIds.includes(labelId) &&
    !event.previousLabelIds.includes(labelId)
  );
}

export type WebhookVerifyError =
  | "bad-signature"
  | "stale-timestamp"
  | "body-too-large"
  | "malformed";

export type TrackerErrorDetail =
  | { kind: "unauthorized" }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "not-found" }
  | { kind: "network"; cause: unknown };

export type TrackerConnectionCheck =
  | { ok: true; organizationName: string | null; webhookSettingsUrl?: string }
  | { ok: false; error: TrackerErrorDetail };

export interface Tracker {
  readonly kind: TrackerKind;

  checkConnection(): Promise<TrackerConnectionCheck>;

  verifyWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string | undefined>>;
    now: Date;
  }): { ok: true; event: TrackerEvent } | { ok: false; error: WebhookVerifyError };

  getTicket(key: TicketKey): Promise<TrackerTicket | null>;
  getTicketRelations?(key: TicketKey): Promise<TicketRelations | null>;
  listProjectTickets(projectId: TrackerProjectId, page?: Page): Promise<Paged<TrackerTicket>>;
  listLabeledTickets(input: {
    labelId: LabelId;
    updatedSince: Date;
  }): Promise<ReadonlyArray<TrackerTicket>>;
  listComments(key: TicketKey, page?: Page): Promise<Paged<TrackerComment>>;
  listProjects(): Promise<ReadonlyArray<TrackerProject>>;
  listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>>;
  createLabel(input: { name: string; color: string }): Promise<TrackerLabel>;
  listStates(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerState>>;

  setState(key: TicketKey, stateId: TrackerStateId): Promise<void>;
  addComment(key: TicketKey, body: string): Promise<{ id: CommentId; url: string }>;
}

export type RunnerErrorDetail =
  | { kind: "unreachable"; detail: string }
  | { kind: "not-installed"; detail: string }
  | { kind: "not-ready"; detail: string }
  | { kind: "mailbox-missing"; detail: string }
  | { kind: "runner-error"; code: string; message: string }
  | { kind: "start-outcome-unknown"; detail: string }
  | { kind: "malformed-output"; raw: string };

export const PREREQUISITE_FAILURE_KINDS = ["auth", "network", "timeout", "other"] as const;

export type PrerequisiteFailureKind = (typeof PREREQUISITE_FAILURE_KINDS)[number];

export interface PrerequisiteFailure {
  kind: PrerequisiteFailureKind;
  reason: string | null;
}

export interface RunnerPrerequisite {
  id: string;
  name: string;
  satisfied: boolean | null;
  hint: string | null;
  blocksAssignment: boolean;
  project?: RunnerProjectId;
  failure?: PrerequisiteFailure;
}

export interface RunnerHealth {
  online: boolean;
  version: string | null;
  prerequisites: ReadonlyArray<RunnerPrerequisite>;
  checkedAt: Date;
  error: RunnerErrorDetail | null;
}

export function isAssignmentBlocked(health: Pick<RunnerHealth, "prerequisites">): boolean {
  return health.prerequisites.some(
    (p) => p.project === undefined && p.blocksAssignment && p.satisfied === false,
  );
}

export function blockedProjectsOf(
  prerequisites: ReadonlyArray<Pick<RunnerPrerequisite, "project" | "satisfied">>,
): RunnerProjectId[] {
  const blocked = new Set<RunnerProjectId>();
  for (const p of prerequisites) {
    if (p.project !== undefined && p.satisfied === false) blocked.add(p.project);
  }
  return [...blocked];
}

export interface RunnerProject {
  id: RunnerProjectId;
  displayName: string;
  setupState: "ready" | "not-set-up" | "setting-up" | "error" | (string & {});
}

export interface StartRunInput {
  mailbox: MailboxRef;
  project: RunnerProjectId;
  worktreeName: string;
  baseBranch?: string;
  agent: AgentId;
  model?: string;
  brief: string;
  ticket?: { key: TicketKey; url: string };
  continueIn?: WorktreeRef;
}

export const CONTINUATION_PLACES = ["same-worktree", "recreated", "from-scratch"] as const;
export type ContinuationPlace = (typeof CONTINUATION_PLACES)[number];

export const AGENT_CHECKS = ["gone", "alive", "unknown"] as const;
export type AgentCheck = (typeof AGENT_CHECKS)[number];

export interface PrepareContinuationInput {
  project: RunnerProjectId;
  worktree: WorktreeRef;
  branch: string;
}

export interface FinishWorktreeSetupInput {
  project: RunnerProjectId;
  worktree: WorktreeRef;
}

export type WorktreeSetupResult = { kind: "done" } | { kind: "failed"; reason: string };

export interface StartedRun {
  worktree: WorktreeRef;
  branch: string;
  agentRef: AgentRef;
}

export interface RunOnRunner {
  mailbox: MailboxRef;
  worktree: WorktreeRef;
  agentRef: AgentRef;
}

export interface ResumeAgentInput {
  agent: AgentId;
  model?: string;
  message: string;
  restartPrompt: string;
  startIfGone?: boolean;
  previousRunAgent?: AgentRef;
}

export interface ResumedAgent {
  agentRef: AgentRef;
  restarted: boolean;
}

export const QUESTION_KINDS = ["question", "human-check"] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];

export interface AgentQuestion {
  id: QuestionId;
  kind?: QuestionKind;
  body: string;
  options: ReadonlyArray<string>;
  askedAt: Date;
}

export interface PermissionWait {
  id: PermissionRequestId;
  detail: string;
  requestedAt: Date;
}

export interface CompletionReport {
  outcome: "succeeded" | "failed" | (string & {});
  body: string;
  reportedAt: Date | null;
}

export type AgentActivity =
  | { kind: "working" | "interrupted" | "turn-ended"; since: Date }
  | { kind: "unknown" };

export interface UnreportedStop {
  at: Date;
  lastOutput: ReadonlyArray<string>;
}

export type RunProgress =
  | {
      kind: "active";
      questions: ReadonlyArray<AgentQuestion>;
      permissionWaits: ReadonlyArray<PermissionWait>;
      activity?: AgentActivity;
      unreportedStop?: UnreportedStop | null;
    }
  | { kind: "reported"; report: CompletionReport }
  | { kind: "ended-without-report"; detail: string }
  | { kind: "worktree-gone" };

export type WorktreeWork =
  | { kind: "gone" }
  | { kind: "checked"; uncommittedChanges: boolean; unpushedCommits: boolean; headCommit: string };

export type AgentSendResult =
  | { kind: "delivered" }
  | { kind: "follow-up"; followUpRef: FollowUpRef };

export interface Runner {
  readonly kind: RunnerKind;
  readonly agentProtocol: string;

  checkHealth(): Promise<RunnerHealth>;
  listProjects(): Promise<ReadonlyArray<RunnerProject>>;
  readProviderUsage?(): Promise<ProviderUsageReading>;

  ensureMailbox(current: MailboxRef | null): Promise<MailboxRef>;

  startRun(input: StartRunInput): Promise<StartedRun>;
  findStartedRun(input: {
    mailbox: MailboxRef;
    worktreeName: string;
    continueIn?: WorktreeRef;
    previousAgent?: AgentRef;
  }): Promise<StartedRun | null>;
  prepareContinuation(input: PrepareContinuationInput): Promise<ContinuationPlace>;
  worktreeSetupPending(input: FinishWorktreeSetupInput): Promise<boolean>;
  finishWorktreeSetup(input: FinishWorktreeSetupInput): Promise<WorktreeSetupResult>;
  isAgentAlive(run: Pick<RunOnRunner, "worktree" | "agentRef">): Promise<boolean>;

  pollRun(run: RunOnRunner): Promise<RunProgress>;
  answerQuestion(
    run: RunOnRunner,
    input: { questionId: QuestionId; answer: string },
  ): Promise<void>;
  denyPermission(
    run: RunOnRunner,
    input: { permissionId: PermissionRequestId; reason: string },
  ): Promise<void>;

  sendToAgent(run: RunOnRunner, input: { body: string }): Promise<AgentSendResult>;
  stopFollowUp(followUpRef: FollowUpRef): Promise<void>;

  pauseAgent(run: RunOnRunner): Promise<void>;
  resumeAgent(run: RunOnRunner, input: ResumeAgentInput): Promise<ResumedAgent>;

  stopAgent(run: RunOnRunner): Promise<void>;
  closeAgent(run: RunOnRunner): Promise<void>;
  readLogTail(run: RunOnRunner, opts: { lines: number }): Promise<ReadonlyArray<string>>;
  worktreeExists(worktree: WorktreeRef): Promise<boolean>;
  checkWorktreeWork(worktree: WorktreeRef): Promise<WorktreeWork>;
  removeWorktree(worktree: WorktreeRef): Promise<void>;
}

export type CiState = "success" | "failure" | "pending" | "none" | "unavailable" | (string & {});

export interface PullRequestSignals {
  open: boolean;
  headCommit: string;
  ciFailed: boolean;
  checkTotal: number | null;
  failedCount: number;
  failedChecks: ReadonlyArray<string>;
  checksTruncated: boolean;
  conflict: boolean | null;
  behindBy: number | null;
}

export interface PullRequestSnapshot {
  id: PullRequestId;
  displayId: string;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed" | "merged" | (string & {});
  createdAt: Date;
  mergedAt: Date | null;
  closedAt?: Date;
  headBranch: string;
  sourceRepo: RepoRef | null;
  headCommit: string;
  baseBranch: string;
  ci: CiState;
  signals?: PullRequestSignals | null;
}

export type CodeHostErrorDetail =
  | { kind: "unauthorized" }
  | { kind: "rate-limited"; resetAt: Date | null }
  | { kind: "not-found" }
  | { kind: "network"; cause: unknown };

export interface CodeHost {
  readonly kind: CodeHostKind;

  checkConnection(): Promise<ConnectionCheck<CodeHostErrorDetail>>;
  repoOf(project: RunnerProjectId): RepoRef | null;
  findPullRequestsByBranch(
    repo: RepoRef,
    branch: string,
  ): Promise<ReadonlyArray<PullRequestSnapshot>>;
  findPullRequestsByTicketKey(
    repo: RepoRef,
    ticketKey: TicketKey,
    opts: { createdSince: Date },
  ): Promise<ReadonlyArray<PullRequestSnapshot>>;
  getPullRequest(repo: RepoRef, id: PullRequestId): Promise<PullRequestSnapshot | null>;
  rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date } | null>;
}
