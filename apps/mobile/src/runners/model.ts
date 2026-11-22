export type UsageWindowKind = "session" | "weekly" | "fableWeekly" | "monthly";
export type ProviderUsageStatus = "ok" | "signed-out" | "unavailable" | "error";
export type RunnerIssueCause = "offline" | "auth";

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

export interface UsageLimit {
  provider: string;
  window: UsageWindowKind;
  resetsInMs: number | null;
}

export interface MobileRunner {
  id: string;
  name: string;
  cause: RunnerIssueCause | null;
  offlineMs: number | null;
  used: number;
  capacity: number;
  usage: RunnerUsageView | null;
  limits: UsageLimit[];
}
