export type SummaryOutcome = "succeeded" | "failed" | "canceled";
export type PauseSource = "operator" | "runner" | "unreported";
export type PrState = "none" | "open" | "merged" | "closed";
export type UsageWindowKind = "session" | "weekly" | "fableWeekly" | "monthly";
export type RunnerIssueCause = "offline" | "auth";

export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface BlockerView {
  key: string;
  title: string;
  stateName: string;
  stateCategory: string;
}

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

export type InputWait =
  | { kind: "question"; questionId: string; body: string; choices: string[]; answered: boolean }
  | { kind: "permission"; promptId: string; detail: string; denied: boolean }
  | { kind: "human-check"; questionId: string; body: string; answered: boolean };

export interface PrSignalsView {
  ciFailed: boolean;
  conflict: boolean | null;
  behindBy: number | null;
}

interface HomeRunBase {
  id: string;
  ticketId: string;
  ticketKey: string;
  ticketTitle: string | null;
  workspace: WorkspaceSummary;
  runner: { name: string; online: boolean } | null;
  agent: string;
  waitMs: number;
  executionMs: number | null;
  pullRequest: { displayId: string; url: string; signals: PrSignalsView | null } | null;
  cancelling: boolean;
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
  | (HomeRunBase & { state: "disconnected"; unreachableMs: number | null })
  | (HomeRunBase & {
      state: "ended";
      prState: PrState;
      summary: SummaryOutcome;
      endedAt: string;
      endedAgoMs: number;
    });

export interface UsageLine {
  provider: string;
  window: UsageWindowKind;
  usedPercent: number;
}

export interface UsageLimit {
  provider: string;
  window: UsageWindowKind;
  resetsInMs: number | null;
}

export interface RunnerView {
  id: string;
  name: string;
  cause: RunnerIssueCause | null;
  offlineMs: number | null;
  used: number;
  capacity: number;
  usage: UsageLine[];
  limits: UsageLimit[];
}

export interface MobileSnapshot {
  workspaces: WorkspaceSummary[];
  runs: HomeRun[];
  runners: RunnerView[];
}
