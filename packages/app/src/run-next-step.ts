import type { PrState, SummaryOutcome } from "@ganger/core";
import type { RunDetail } from "./run-detail/model.js";
import { currentPrState } from "./runs/model.js";
import type { QueuedReason } from "./runs/model.js";

export const RUN_NEXT_STEP_KINDS = [
  "pr-ci-failed",
  "pr-conflict",
  "question",
  "permission",
  "human-check",
  "waiting-input",
  "paused",
  "disconnected",
  "blockers-stuck",
  "kept-worktree",
  "failed",
  "none",
] as const;
export type RunNextStep = (typeof RUN_NEXT_STEP_KINDS)[number];

export type NextStepInputWait =
  | { kind: "question" | "human-check"; answered: boolean }
  | { kind: "permission"; denied: boolean }
  | { kind: "unknown" };

interface NextStepBase {
  pullRequest: { signals: { ciFailed: boolean; conflict: boolean | null } | null } | null;
}

interface NextStepActive extends NextStepBase {
  cancelling: boolean;
}

export type RunNextStepInput =
  | (NextStepActive & { state: "queued"; queuedReason: Pick<QueuedReason, "kind"> })
  | (NextStepActive & { state: "running" | "paused" | "disconnected" })
  | (NextStepActive & { state: "waiting-for-input"; input: NextStepInputWait })
  | (NextStepBase & {
      state: "ended";
      summary: SummaryOutcome;
      prState: PrState;
      laterPrState: "merged" | "closed" | null;
      keptWorktree: { removing: boolean } | null;
      superseded: boolean;
    });

export function runNextStep(run: RunNextStepInput): RunNextStep {
  if (run.state === "ended") return endedNextStep(run);
  if (run.cancelling) return "none";
  if (run.state === "disconnected") return "disconnected";
  switch (run.state) {
    case "queued":
      return run.queuedReason.kind === "blockers-stuck" ? "blockers-stuck" : "none";
    case "running":
      return "none";
    case "paused":
      return "paused";
    case "waiting-for-input":
      return inputNextStep(run.input);
  }
}

function inputNextStep(input: NextStepInputWait): RunNextStep {
  switch (input.kind) {
    case "question":
    case "human-check":
      return input.answered ? "none" : input.kind;
    case "permission":
      return input.denied ? "none" : "permission";
    case "unknown":
      return "waiting-input";
  }
}

function endedNextStep(run: Extract<RunNextStepInput, { state: "ended" }>): RunNextStep {
  if (run.superseded) return "none";
  if (currentPrState(run) === "open") {
    if (run.pullRequest?.signals?.ciFailed === true) return "pr-ci-failed";
    if (run.pullRequest?.signals?.conflict === true) return "pr-conflict";
  }
  if (run.summary === "failed") return "failed";
  return run.keptWorktree !== null && !run.keptWorktree.removing ? "kept-worktree" : "none";
}

function hasNewerRun(run: RunNextStepDetail): boolean {
  const assignedAt = Date.parse(run.assignedAt);
  return run.otherRuns.some((other) => {
    const otherAssignedAt = Date.parse(other.assignedAt);
    return otherAssignedAt > assignedAt || (otherAssignedAt === assignedAt && other.id > run.id);
  });
}

export type RunNextStepDetail = Pick<
  RunDetail,
  "id" | "assignedAt" | "pullRequest" | "cancelPending" | "prHandedOver" | "status"
> & {
  continuedBy: { number: number } | null;
  otherRuns: ReadonlyArray<{ id: string; assignedAt: string }>;
};

export function nextStepInputOfDetail(run: RunNextStepDetail): RunNextStepInput {
  const base = { pullRequest: run.pullRequest };
  const active = { ...base, cancelling: run.cancelPending };
  const { status } = run;
  switch (status.state) {
    case "queued":
      return { ...active, state: "queued", queuedReason: status.queuedReason };
    case "running":
    case "paused":
    case "disconnected":
      return { ...active, state: status.state };
    case "waiting-for-input":
      return { ...active, state: "waiting-for-input", input: status.input };
    case "ended":
      return {
        ...base,
        state: "ended",
        summary: status.summary,
        prState: status.prState,
        laterPrState: status.laterPrState?.state ?? null,
        keptWorktree: status.keptWorktree,
        superseded: run.prHandedOver || run.continuedBy !== null || hasNewerRun(run),
      };
  }
}
