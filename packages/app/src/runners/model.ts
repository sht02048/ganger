import type {
  CpuLoad,
  GhAccountsReading,
  GpuLoad,
  MemoryLoad,
  ProviderUsageStatus,
  UsageWindowKind,
} from "@ganger/core";
import type { CheckFailure } from "../prerequisites.js";

export interface RunWorkspace {
  id: string;
  name: string;
}

export interface OccupyingRun {
  id: string;
  ticketKey: string;
  ticketTitle: string | null;
  workspace: RunWorkspace;
  state: "running" | "waiting-for-input" | "paused" | "disconnected";
  waitingFor: "question" | "permission" | "human-check" | null;
  executionMs: number;
}

export interface QueuedRunView {
  id: string;
  ticketKey: string;
  workspace: RunWorkspace;
  waitMs: number;
}

export interface LeftWorktree {
  id: string;
  ticketKey: string;
  workspace: RunWorkspace;
  worktree: "keep-until-pr-settles" | "operator-decides";
}

export interface RunnerCheckItem {
  id: string;
  name: string;
  project: string | null;
  satisfied: boolean | null;
  blocksAssignment: boolean;
  hint: string | null;
  failure: CheckFailure | null;
}

export interface UsageWindowView {
  kind: UsageWindowKind;
  usedPercent: number;
  resetsAt: string | null;
}

export interface ProviderUsageView {
  provider: string;
  status: ProviderUsageStatus;
  windows: UsageWindowView[];
}

export type RunnerUsageView = { readAt: string; agoMs: number; now: string } & (
  | {
      kind: "read";
      providers: ProviderUsageView[];
      highest: { provider: string; window: UsageWindowView } | null;
    }
  | { kind: "unreadable" }
);

export type RunnerLoadView = { readAt: string; agoMs: number } & (
  | {
      kind: "read";
      cpu: (CpuLoad & { high: boolean }) | null;
      memory: (MemoryLoad & { high: boolean }) | null;
      gpu: GpuLoad | null;
    }
  | { kind: "unreadable" }
);

export type RunnerGhAccountsView = { readAt: string; agoMs: number } & GhAccountsReading;

export interface RunnerLoadHigh {
  cpuPercent: number | null;
  memoryPercent: number | null;
}

export function runnerLoadHigh(load: RunnerLoadView | null): RunnerLoadHigh | null {
  if (load?.kind !== "read") return null;
  const cpuPercent = load.cpu?.high === true ? load.cpu.percent : null;
  const memoryPercent = load.memory?.high === true ? load.memory.percent : null;
  return cpuPercent === null && memoryPercent === null ? null : { cpuPercent, memoryPercent };
}

export interface RunnerView {
  id: string;
  name: string;
  online: boolean;
  offlineMs: number | null;
  assignmentBlocked: boolean;
  pushBlockedProjects: string[];
  checks: RunnerCheckItem[] | null;
  checked: { at: string; agoMs: number } | null;
  capacity: number;
  occupying: OccupyingRun[];
  queued: QueuedRunView[];
  leftWorktrees: LeftWorktree[];
  sshTarget: string | null;
  orcaPath: string | null;
  usage: RunnerUsageView | null;
  load?: RunnerLoadView | null;
  ghAccounts?: RunnerGhAccountsView | null;
}

export interface RunnersPage {
  runners: RunnerView[];
}

export function runnerRunsWorkspace(
  runner: Pick<RunnerView, "occupying" | "queued">,
  current: string | undefined,
): string | undefined {
  const workspaces = new Set(
    [...runner.occupying, ...runner.queued].map((run) => run.workspace.id),
  );
  const [only] = workspaces;
  return workspaces.size === 1 ? only : current;
}

export type RunnerRowStatus = "offline" | "runner-issue" | "online";

export function runnerRowStatus(runner: {
  online: boolean;
  assignmentBlocked: boolean;
}): RunnerRowStatus {
  if (!runner.online) return "offline";
  if (runner.assignmentBlocked) return "runner-issue";
  return "online";
}

export function problemRunnersFirst<T extends { online: boolean; assignmentBlocked: boolean }>(
  runners: ReadonlyArray<T>,
): T[] {
  const hasProblem = (runner: T) => runnerRowStatus(runner) !== "online";
  return [...runners.filter(hasProblem), ...runners.filter((runner) => !hasProblem(runner))];
}

export function failedChecksFirst<T extends { satisfied: boolean | null }>(
  checks: ReadonlyArray<T>,
): T[] {
  const rank = (check: T) => (check.satisfied === false ? 0 : check.satisfied === null ? 1 : 2);
  return checks.toSorted((a, b) => rank(a) - rank(b));
}
