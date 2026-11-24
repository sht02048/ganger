import type {
  AgentMessageFailure,
  AgentResult,
  ContinuationPlace,
  PauseSource,
  PrReadError,
  PrState,
  RunId,
  RunnerId,
  RunState,
  SummaryOutcome,
} from "@ganger/core";
import type { McpActionOutcome } from "@ganger/db";
import type { InputWait } from "../home/model.js";
import type { PrSignalsView } from "../pr-signals-view.js";
import type { RunControlView } from "../run-control-view.js";
import type { QueuedReason } from "../runs/model.js";
import type { PrReadDiagnosis } from "../pr-read-diagnosis.js";

export type CiView = "success" | "failure" | "pending" | "none" | "unavailable" | "unknown";

export type TimelineEvent = { at: string } & (
  | { kind: "assigned" | "started" | "waiting-for-input" | "resumed" }
  | { kind: "paused" | "unpaused" }
  | { kind: "unreachable" | "disconnected" | "reconnected" }
  | { kind: "question" | "human-check" | "answer" | "permission"; body: string }
  | { kind: "denied"; body: string }
  | { kind: "cancel-requested" }
  | { kind: "operator-message"; body: string; delivery: AgentMessageDelivery }
  | { kind: "ended"; agentResult: AgentResult }
  | { kind: "later-pr"; state: "merged" | "closed" }
  | { kind: "continued-from" | "continued-by"; runNumber: number }
  | {
      kind: "mcp";
      client: string;
      tool: string;
      outcome: McpActionOutcome;
      reason: string | null;
    }
);

export type AgentMessageDelivery =
  | { status: "sending" | "after-resume" | "after-reconnect" | "stopping-follow-up" | "sent" }
  | { status: "failed"; reason: AgentMessageFailure | "unknown" };

export interface AgentMessageView {
  accepting: boolean;
  latest: AgentMessageDelivery | null;
}

export type PendingInput = InputWait | { kind: "unknown" };

export type LogTailView =
  | { kind: "none" }
  | { kind: "stored"; lines: string[] }
  | { kind: "pending" }
  | { kind: "done"; lines: string[]; at: string }
  | { kind: "failed"; error: string; at: string };

export type RunDetailStatus =
  | { state: "queued"; queuedReason: QueuedReason }
  | { state: "running" }
  | {
      state: "paused";
      pausedSince: string | null;
      pauseSource: PauseSource;
      lastOutput: string[] | null;
    }
  | {
      state: "waiting-for-input";
      input: PendingInput;
      inputSince: string | null;
    }
  | {
      state: "disconnected";
      unreachableSince: string | null;
      paused: boolean;
    }
  | {
      state: "ended";
      agentResult: AgentResult;
      prState: PrState;
      prReadError: PrReadError | null;
      prReadDiagnosis?: PrReadDiagnosis | null;
      summary: SummaryOutcome;
      keptWorktree: KeptWorktree | null;
      laterPrState: { state: "merged" | "closed"; at: string } | null;
    };

export const KEPT_WORKTREE_REASONS = [
  "no-pr",
  "uncommitted-changes",
  "unpushed-commits",
  "check-failed",
  "runner-disconnected",
  "runner-unreached",
] as const;
export type KeptWorktreeReason = (typeof KEPT_WORKTREE_REASONS)[number];

export interface KeptWorktree {
  reason: KeptWorktreeReason;
  removing: boolean;
}

export type OtherRun = { id: string; assignedAt: string } & (
  | { state: Exclude<RunState, "ended"> }
  | {
      state: "ended";
      summary: SummaryOutcome;
    }
);

export interface RunLink {
  id: RunId;
  number: number;
}

export interface ContinueOffer {
  sourceNumber: number;
  nextNumber: number;
  runnerName: string | null;
  place: "same-worktree" | "recreated";
  hasReport: boolean;
  hasWorkspaceBrief: boolean;
  agent: "gone" | "alive" | "unknown" | "checking";
  agentStopRequested: boolean;
}

export interface RunDetail {
  id: string;
  now: string;
  ticketKey: string;
  ticketTitle: string | null;
  trackerProject: string;
  workspace: { id: string; name: string };
  branch: string | null;
  worktree: string | null;
  runner: { id: RunnerId; name: string; online: boolean } | null;
  agent: string;
  model: string | null;
  assignedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  waitMs: number;
  executionMs: number | null;
  status: RunDetailStatus;
  pullRequest: {
    displayId: string;
    url: string;
    ci: CiView;
    signals: PrSignalsView | null;
  } | null;
  report: string | null;
  brief: string | null;
  startError: string | null;
  cancelPending: boolean;
  control: RunControlView | null;
  agentMessage: AgentMessageView;
  timeline: TimelineEvent[];
  log: LogTailView;
  otherRuns: OtherRun[];
  continuedFrom: RunLink | null;
  continuedBy: RunLink | null;
  prHandedOver: boolean;
  continuePlace: ContinuationPlace | null;
  continueOffer: ContinueOffer | null;
}

export type RunDetailPage = { kind: "found"; run: RunDetail } | { kind: "not-found" };

export function canCancel(run: RunDetail): boolean {
  return run.status.state !== "ended";
}
