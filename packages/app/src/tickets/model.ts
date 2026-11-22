import type {
  AgentResult,
  PrState,
  SummaryOutcome,
  TicketPriority,
  TrackerStateCategory,
} from "@ganger/core";
import type { BlockerReason, BlockerView } from "../runs/model.js";
import type { Remote } from "../settings/model.js";
import type { WorkspaceChoice } from "../shell/model.js";

export type TicketRunWait = "question" | "permission" | "human-check";

export type TicketRun =
  | {
      id: string;
      runnerName: string | null;
      state: "queued" | "running" | "waiting-for-input" | "paused" | "disconnected";
      elapsedMs: number;
      waitingOn: TicketRunWait | null;
    }
  | {
      id: string;
      runnerName: string | null;
      state: "ended";
      endedAt: string;
      endedAgoMs: number;
      agentResult: AgentResult;
      prState: PrState;
      laterPrState: "merged" | "closed" | null;
      pullRequest: TicketRunPullRequest | null;
      summary: SummaryOutcome;
    };

export interface TicketRunPullRequest {
  displayId: string;
  url: string | null;
}

export interface AssignRepo {
  id: string;
  name: string;
  isDefault: boolean;
  label: string | null;
}

export interface AssignDefaults {
  runnerProject: string;
  agent: string;
  repos: ReadonlyArray<AssignRepo>;
}

export type Assignability =
  | { kind: "ready"; defaults: AssignDefaults }
  | { kind: "active-run"; runId: string }
  | { kind: "no-mapping" };

export interface WaitingTicket {
  key: string;
  title: string | null;
}

export type TicketBlockersResult =
  | { ok: true; blockers: BlockerView[] }
  | { ok: false; reason: TrackerLoadError["reason"] };

export interface TicketIssueRef {
  key: string;
  title: string;
  url: string | null;
  state: { name: string; category: TrackerStateCategory };
}

export interface TicketView {
  id: string;
  connection: string;
  key: string;
  title: string;
  url: string | null;
  trackerProject: { id: string; name: string };
  trackerState: { name: string; category: TrackerStateCategory };
  priority: TicketPriority;
  ancestors: ReadonlyArray<TicketIssueRef>;
  isParentIssue: boolean;
  blockerWait: BlockerReason | null;
  waitingTickets: ReadonlyArray<WaitingTicket>;
  labels: ReadonlyArray<{ name: string; autoAssign: boolean }>;
  runs: ReadonlyArray<TicketRun>;
  mapping: AssignDefaults | null;
  assignability: Assignability;
}

export interface RunnerChoice {
  id: string;
  name: string;
  online: boolean;
  assignmentBlocked: boolean;
  projects: ReadonlyArray<string>;
  blockedProjects: ReadonlyArray<string>;
  usageLimits: ReadonlyArray<RunnerUsageLimit>;
}

export interface RunnerUsageLimit {
  provider: string;
  resetsInMs: number;
}

export interface TrackerLoadError {
  trackerProject: string;
  reason:
    | "unauthorized"
    | "rate-limited"
    | "not-found"
    | "network"
    | "unknown-connection"
    | "failed";
}

export interface TrackerTruncation {
  trackerProject: string;
  limit: number;
}

export interface TicketsPage {
  workspace: WorkspaceChoice;
  tickets: TicketView[];
  runners: RunnerChoice[];
  agents: string[];
  errors: TrackerLoadError[];
  truncated: TrackerTruncation[];
  trackerProjectCount: number;
}

export interface TicketMappingRepoFacts {
  project: string;
  isDefault: boolean;
  labelId: string | null;
}

export interface TicketMappingFacts {
  agent: string;
  defaultRepo: string;
  repos: ReadonlyArray<TicketMappingRepoFacts>;
}

export interface TicketProjectFacts {
  connection: string;
  projectId: string;
  name: string;
  mapping: TicketMappingFacts | null;
  autoAssignLabel: string | null;
}

export interface TicketRunFacts {
  runs: TicketRun[];
  activeRunId: string | null;
  retryRepo: string | null;
  blockerWait: BlockerReason | null;
}

export interface TicketRunsData {
  workspace: WorkspaceChoice;
  runners: RunnerChoice[];
  agents: string[];
  projects: TicketProjectFacts[];
  repoNames: Record<string, string>;
  runsByTicket: Record<string, TicketRunFacts>;
  waitingByBlocker: Record<string, WaitingTicket[]>;
}

export interface TrackerLabel {
  id: string;
  name: string;
}

export interface TrackerTicketView {
  connection: string;
  projectId: string;
  projectName: string;
  key: string;
  title: string;
  url: string | null;
  state: { name: string; category: TrackerStateCategory };
  priority: TicketPriority;
  labels: ReadonlyArray<TrackerLabel>;
  ancestors: ReadonlyArray<TicketIssueRef>;
}

export interface TrackerProjectLabels {
  connection: string;
  projectId: string;
  labels: Remote<TrackerLabel>;
}

export interface TrackerTicketsData {
  workspace: WorkspaceChoice;
  tickets: TrackerTicketView[];
  labels: TrackerProjectLabels[];
  errors: TrackerLoadError[];
  truncated: TrackerTruncation[];
}

export const ASSIGN_REJECT_REASONS = [
  "active-run",
  "no-mapping",
  "unknown-repo",
  "unknown-agent",
  "unknown-runner",
  "runner-assignment-blocked",
] as const;

export type AssignRejectReason = (typeof ASSIGN_REJECT_REASONS)[number];

export const TICKET_FILTERS = ["all", "assignable", "todo", "in-progress", "done"] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];

export function lastRun(ticket: TicketView): TicketRun | undefined {
  return ticket.runs[0];
}

export function isTodo(run: TicketRun): boolean {
  switch (run.state) {
    case "waiting-for-input":
    case "disconnected":
      return true;
    case "ended":
      return run.summary === "failed";
    case "queued":
    case "running":
    case "paused":
      return false;
  }
}

function isDone(run: TicketRun): boolean {
  if (run.state !== "ended") return false;
  switch (run.summary) {
    case "succeeded":
    case "canceled":
      return true;
    case "failed":
      return false;
  }
}

export function matchesFilter(ticket: TicketView, filter: TicketFilter): boolean {
  if (filter === "assignable" && ticket.isParentIssue) return false;
  return matchesRunFilter(ticket, filter);
}

export function matchesRunFilter(ticket: TicketView, filter: TicketFilter): boolean {
  const run = lastRun(ticket);
  switch (filter) {
    case "all":
      return true;
    case "assignable":
      return (
        run === undefined ||
        (run.state === "ended" && (run.summary === "failed" || run.summary === "canceled"))
      );
    case "todo":
      return run !== undefined && isTodo(run);
    case "in-progress":
      return run?.state === "queued" || run?.state === "running" || run?.state === "paused";
    case "done":
      return run !== undefined && isDone(run);
  }
}

export function matchesSearch(ticket: Pick<TicketView, "key" | "title">, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return (
    ticket.key.toLocaleLowerCase().includes(needle) ||
    ticket.title.toLocaleLowerCase().includes(needle)
  );
}

export function countByFilter(tickets: ReadonlyArray<TicketView>): Record<TicketFilter, number> {
  const counts: Record<TicketFilter, number> = {
    all: 0,
    assignable: 0,
    todo: 0,
    "in-progress": 0,
    done: 0,
  };
  for (const ticket of tickets) {
    for (const key of TICKET_FILTERS) if (matchesFilter(ticket, key)) counts[key] += 1;
  }
  return counts;
}

export function runnersFor(
  runners: ReadonlyArray<RunnerChoice>,
  runnerProject: string,
): RunnerChoice[] {
  return runners.filter((runner) => runner.projects.includes(runnerProject));
}

export interface RepoReach {
  runners: number;
  pushBlockedEverywhere: boolean;
}

export function repoReach(runners: ReadonlyArray<RunnerChoice>, runnerProject: string): RepoReach {
  const having = runnersFor(runners, runnerProject);
  return {
    runners: having.length,
    pushBlockedEverywhere:
      having.length > 0 && having.every((runner) => runner.blockedProjects.includes(runnerProject)),
  };
}

export function firstAssignableRepo(
  defaults: AssignDefaults,
  runners: ReadonlyArray<RunnerChoice>,
): string {
  const ordered = [
    defaults.runnerProject,
    ...defaults.repos.filter((repo) => repo.isDefault).map((repo) => repo.id),
    ...defaults.repos.map((repo) => repo.id),
  ];
  return (
    ordered.find((repo) => !repoReach(runners, repo).pushBlockedEverywhere) ??
    defaults.runnerProject
  );
}

export function agentsFor(agents: ReadonlyArray<string>, defaultAgent: string): string[] {
  return [defaultAgent, ...agents.filter((agent) => agent !== defaultAgent)];
}
