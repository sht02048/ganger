import type { UsageWindowKind } from "@ganger/core";
import type {
  AgentResult,
  PauseSource,
  PrReadError,
  PrState,
  RunId,
  SummaryOutcome,
  TicketKey,
} from "@ganger/core";
import type { PrSignalsView } from "../pr-signals-view.js";
import type { RunControlView } from "../run-control-view.js";
import type { RunnerLoadHigh } from "../runners/model.js";
import type { QueuedReason } from "../runs/model.js";
import type { RunnerIssueCause, WorkspaceChoice, WorkspaceSummary } from "../shell/model.js";

export type InputWait =
  | {
      kind: "question";
      questionId: string;
      body: string;
      choices: string[];
      answered: boolean;
    }
  | {
      kind: "permission";
      promptId: string;
      detail: string;
      denied: boolean;
    }
  | {
      kind: "human-check";
      questionId: string;
      body: string;
      answered: boolean;
    };

interface HomeRunBase {
  id: RunId;
  ticketId: string;
  ticketKey: TicketKey;
  ticketTitle: string | null;
  trackerProject: string;
  workspace: WorkspaceSummary;
  runner: { name: string; online: boolean } | null;
  agent: string;
  waitMs: number;
  executionMs: number | null;
  pullRequest: { displayId: string; url: string; signals: PrSignalsView | null } | null;
  cancelling: boolean;
  control: RunControlView | null;
}

export type HomeRun =
  | (HomeRunBase & { state: "queued"; queuedReason: QueuedReason })
  | (HomeRunBase & { state: "running" })
  | (HomeRunBase & { state: "paused"; pausedMs: number | null; pauseSource: PauseSource })
  | (HomeRunBase & {
      state: "waiting-for-input";
      input: InputWait | null;
      waitingMs: number | null;
    })
  | (HomeRunBase & {
      state: "disconnected";
      unreachableMs: number | null;
    })
  | (HomeRunBase & {
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      prReadError: PrReadError | null;
      summary: SummaryOutcome;
      endedAt: string;
      endedAgoMs: number;
    });

export const PR_CHIPS_VISIBLE = 2;

export type PrProblem =
  | { kind: "ci-failed" }
  | { kind: "conflict" }
  | { kind: "behind"; commits: number };

export function prProblemsOf(signals: PrSignalsView | null): PrProblem[] {
  if (signals === null) return [];
  const behindBy = signals.behindBy ?? 0;
  return [
    ...(signals.ciFailed ? [{ kind: "ci-failed" as const }] : []),
    ...(signals.conflict === true ? [{ kind: "conflict" as const }] : []),
    ...(behindBy > 0 ? [{ kind: "behind" as const, commits: behindBy }] : []),
  ];
}

export interface DashboardUsageLine {
  provider: string;
  window: UsageWindowKind;
  usedPercent: number;
}

export interface DashboardUsageLimit {
  provider: string;
  window: UsageWindowKind;
  resetsInMs: number | null;
}

export interface DashboardRunner {
  id: string;
  name: string;
  cause: RunnerIssueCause | null;
  offlineMs: number | null;
  used: number;
  capacity: number;
  usage: DashboardUsageLine | null;
  limits: DashboardUsageLimit[];
  loadHigh?: RunnerLoadHigh | null;
}

export function limitedRunners(runners: RunnersSummary): DashboardRunner[] {
  return runners.list.filter((runner) => runner.limits.length > 0);
}

export function loadHighRunners(runners: RunnersSummary): DashboardRunner[] {
  return runners.list.filter((runner) => (runner.loadHigh ?? null) !== null);
}

export function readyAgainInMs(runner: DashboardRunner): number | null {
  let latest = 0;
  for (const limit of runner.limits) {
    if (limit.resetsInMs === null) return null;
    latest = Math.max(latest, limit.resetsInMs);
  }
  return latest;
}

export interface RunnerIssue extends DashboardRunner {
  cause: RunnerIssueCause;
}

export interface AttentionItem {
  kind: "run";
  run: HomeRun;
}

export interface RunnersSummary {
  list: DashboardRunner[];
}

export function runnerIssues(runners: RunnersSummary): RunnerIssue[] {
  return runners.list.flatMap((runner) =>
    runner.cause === null ? [] : [{ ...runner, cause: runner.cause }],
  );
}

export function freeCapacity(runners: RunnersSummary): number {
  return runners.list.reduce(
    (sum, runner) =>
      runner.cause === null ? sum + Math.max(0, runner.capacity - runner.used) : sum,
    0,
  );
}

export interface DoneRun {
  id: RunId;
  ticketKey: TicketKey;
  ticketTitle: string | null;
  workspace: WorkspaceSummary;
  summary: SummaryOutcome;
  endedAt: string;
  endedAgoMs: number;
}

export interface DoneToday {
  recent: DoneRun[];
  total: number;
}

export interface HomePage {
  workspace: WorkspaceChoice;
  attention: AttentionItem[];
  running: HomeRun[];
  queued: HomeRun[];
  runners: RunnersSummary;
  doneToday: DoneToday;
  endedRecently: HomeRun[];
}

export const DONE_TODAY_LIMIT = 5;
export const DONE_COLUMN_DAYS = 7;

export const TODO_GROUPS = ["check", "answer", "stopped"] as const;

export type TodoGroupKind = (typeof TODO_GROUPS)[number];

export interface TodoGroup {
  kind: TodoGroupKind;
  runs: HomeRun[];
}

export function todoGroupOf(run: HomeRun): TodoGroupKind | null {
  switch (run.state) {
    case "waiting-for-input":
      return run.input?.kind === "human-check" ? "check" : "answer";
    case "disconnected":
      return "stopped";
    case "ended":
      return run.summary === "failed" ? "stopped" : null;
    case "queued":
    case "running":
    case "paused":
      return null;
  }
}

export function todoGroups(attention: ReadonlyArray<AttentionItem>): TodoGroup[] {
  return TODO_GROUPS.map((kind) => ({
    kind,
    runs: attention.flatMap(({ run }) => (todoGroupOf(run) === kind ? [run] : [])),
  })).filter((group) => group.runs.length > 0);
}

export function needsAttention(run: HomeRun): boolean {
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

const noRunners: RunnersSummary = { list: [] };
const nothingDone: DoneToday = { recent: [], total: 0 };

export function partitionHome(input: {
  workspace: WorkspaceChoice;
  runs: ReadonlyArray<{ ticket: string; run: HomeRun }>;
  runners: RunnersSummary;
  doneToday: ReadonlyArray<DoneRun>;
  endedRecently: ReadonlyArray<HomeRun>;
}): HomePage {
  const { workspace } = input;
  if (workspace.kind === "none")
    return {
      workspace,
      attention: [],
      running: [],
      queued: [],
      runners: noRunners,
      doneToday: nothingDone,
      endedRecently: [],
    };

  const latestByTicket = new Map<string, string>();
  for (const { ticket, run } of input.runs) latestByTicket.set(ticket, run.id);

  const attention = input.runs
    .flatMap(({ ticket, run }, index) =>
      needsAttention(run) && (run.state !== "ended" || latestByTicket.get(ticket) === run.id)
        ? [{ run, index }]
        : [],
    )
    .toSorted((a, b) => urgency(a.run) - urgency(b.run) || b.index - a.index)
    .map(({ run }): AttentionItem => ({ kind: "run", run }));

  const runs = input.runs.map(({ run }) => run);
  const done = input.doneToday.toSorted((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
  return {
    workspace,
    attention,
    running: runs.filter((run) => run.state === "running" || run.state === "paused"),
    queued: runs.filter((run) => run.state === "queued"),
    runners: input.runners,
    doneToday: {
      recent: done.slice(0, DONE_TODAY_LIMIT),
      total: done.length,
    },
    endedRecently: input.endedRecently.toSorted((a, b) => endedTime(b) - endedTime(a)),
  };
}

function groupRank(run: HomeRun): number {
  const kind = todoGroupOf(run);
  return kind === null ? TODO_GROUPS.length : TODO_GROUPS.indexOf(kind);
}

function endedTime(run: HomeRun): number {
  return run.state === "ended" ? Date.parse(run.endedAt) : 0;
}

export type TodoTag =
  | "question"
  | "permission"
  | "human-check"
  | "waiting-for-input"
  | "disconnected"
  | "failed";

export function todoTagOf(run: HomeRun): TodoTag | null {
  switch (run.state) {
    case "waiting-for-input":
      return run.input === null ? "waiting-for-input" : run.input.kind;
    case "disconnected":
      return "disconnected";
    case "ended":
      return run.summary === "failed" ? run.summary : null;
    case "queued":
    case "running":
    case "paused":
      return null;
  }
}

export interface DashboardBoard {
  queued: HomeRun[];
  running: { todo: HomeRun[]; rest: HomeRun[] };
  done: { todo: HomeRun[]; rest: HomeRun[] };
}

export function dashboardBoard(page: HomePage): DashboardBoard {
  const todo = page.attention.map(({ run }) => run);
  const tagged = new Set(todo.map((run) => run.id));
  return {
    queued: page.queued,
    running: {
      todo: todo.filter((run) => run.state !== "ended"),
      rest: page.running,
    },
    done: {
      todo: todo
        .filter((run) => run.state === "ended")
        .toSorted((a, b) => groupRank(a) - groupRank(b)),
      rest: page.endedRecently.filter((run) => !tagged.has(run.id)),
    },
  };
}

function urgency(run: HomeRun): number {
  switch (run.state) {
    case "waiting-for-input":
      return 0;
    case "disconnected":
      return 1;
    case "ended":
    case "queued":
    case "running":
    case "paused":
      return 2;
  }
}

export function hasPendingControl(page: Pick<HomePage, "running">): boolean {
  return page.running.some((run) => run.control?.status === "pending");
}
