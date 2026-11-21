import type { PrSignalsView } from "../pr-signals-view.js";
import type { CiView } from "../run-detail/model.js";
import type { AgentResult, PrReadError, PrState, SummaryOutcome } from "@ganger/core";
import type { WorkspaceChoice } from "../shell/model.js";
import type { StatsPeriodDays } from "../stats/model.js";

export type QueuedReason =
  | {
      kind: "starting" | "behind" | "runner-offline" | "project-missing" | "assignment-blocked";
    }
  | { kind: "no-capacity"; runner: string }
  | { kind: "usage-limit"; provider: string; resetsInMs: number }
  | { kind: "blockers-waiting"; blockers: BlockerView[]; finished?: BlockerView[] }
  | {
      kind: "blockers-stuck";
      cause: "canceled" | "unreadable" | "cycle";
      blocker: BlockerView | null;
      blockers: BlockerView[];
    };

export interface BlockerView {
  key: string;
  title: string;
  stateName: string;
  stateCategory: string;
}

export type BlockerReason = Extract<QueuedReason, { kind: "blockers-waiting" | "blockers-stuck" }>;

export function blockerReasonOf(reason: QueuedReason): BlockerReason | null {
  return reason.kind === "blockers-waiting" || reason.kind === "blockers-stuck" ? reason : null;
}

export function allBlockersOf(reason: BlockerReason): BlockerView[] {
  return reason.kind === "blockers-waiting"
    ? [...reason.blockers, ...(reason.finished ?? [])]
    : reason.blockers;
}

interface RunViewBase {
  id: string;
  ticketKey: string;
  ticketTitle: string | null;
  trackerProject: string;
  branch: string | null;
  runner: { name: string; online: boolean } | null;
  agent: string;
  waitMs: number;
  executionMs: number | null;
  pullRequest: {
    displayId: string;
    url: string;
    ci: CiView;
    signals: PrSignalsView | null;
    signalsReadAgoMs: number | null;
  } | null;
  attention: boolean;
}

interface Cancellable {
  cancelling: boolean;
}

export type RunView =
  | (RunViewBase & Cancellable & { state: "queued"; queuedReason: QueuedReason })
  | (RunViewBase & Cancellable & { state: "running" | "waiting-for-input" })
  | (RunViewBase & Cancellable & { state: "disconnected"; paused: boolean })
  | (RunViewBase & Cancellable & { state: "paused"; pausedMs: number | null })
  | (RunViewBase & {
      state: "ended";
      endedAt: string;
      endedAgoMs: number;
      agentResult: AgentResult;
      prState: PrState;
      laterPrState: "merged" | "closed" | null;
      prReadError: PrReadError | null;
      summary: SummaryOutcome;
    });

export interface RunsPage {
  workspace: WorkspaceChoice;
  runs: RunView[];
  recentEnded: number;
  moreEnded: boolean;
  conditions: RunCondition[];
}

export type RunCondition =
  | { key: "runner"; name: string | null }
  | { key: "project"; name: string }
  | { key: "agent"; agent: string }
  | { key: "days"; days: StatsPeriodDays };

export const ENDED_RUNS_PAGE_SIZE = 50;
export const MAX_ENDED_RUNS = 5000;

export const RUN_GROUP_FILTERS = ["all", "attention", "in-progress", "done"] as const;
export type RunGroupFilter = (typeof RUN_GROUP_FILTERS)[number];

export const RUN_STATUS_FILTERS = [
  "running",
  "paused",
  "waiting-for-input",
  "disconnected",
  "queued",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type RunFilterKey = (typeof RUN_STATUS_FILTERS)[number];

export const RUN_FILTERS = [...RUN_GROUP_FILTERS, ...RUN_STATUS_FILTERS] as const;
export type RunFilter = (typeof RUN_FILTERS)[number];

export function isGroupFilter(filter: RunFilter): filter is RunGroupFilter {
  return RUN_GROUP_FILTERS.some((group) => group === filter);
}

export function filterKeyOf(run: RunView): RunFilterKey {
  return run.state === "ended" ? run.summary : run.state;
}

export function currentPrState(run: {
  prState: PrState;
  laterPrState: "merged" | "closed" | null;
}): PrState {
  return run.laterPrState ?? run.prState;
}

export function needsAttention(run: RunView): boolean {
  return run.attention;
}

export function isInProgress(run: RunView): boolean {
  return run.state === "queued" || run.state === "running" || run.state === "paused";
}

export function isDone(run: RunView): boolean {
  return run.state === "ended" && !run.attention;
}

export function matchesFilter(run: RunView, filter: RunFilter): boolean {
  return isGroupFilter(filter) ? matchesGroup(run, filter) : filterKeyOf(run) === filter;
}

function matchesGroup(run: RunView, group: RunGroupFilter): boolean {
  switch (group) {
    case "all":
      return true;
    case "attention":
      return needsAttention(run);
    case "in-progress":
      return isInProgress(run);
    case "done":
      return isDone(run);
  }
}

export function elapsedMs(run: RunView): number {
  if (run.state === "paused" && run.pausedMs !== null) return run.pausedMs;
  return run.executionMs ?? run.waitMs;
}
