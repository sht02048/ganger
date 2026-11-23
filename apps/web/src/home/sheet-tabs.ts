import type { HomePullRequest, HomeRun } from "@ganger/app/home/model";
import type { StatusTone } from "@ganger/ui";
import type { SheetMode } from "./run-card";

export type SheetTab = "run" | "pr";

export type PrDotReason = "problem" | "ok" | "pending" | "behind" | "merged" | "closed";

export interface PrTabDot {
  tone: StatusTone;
  reason: PrDotReason;
}

export function showsPrTab(run: HomeRun): boolean {
  return run.state !== "queued";
}

export function prCiFailed(pr: HomePullRequest): boolean {
  return pr.signals?.ciFailed ?? false;
}

export function prHasProblem(pr: HomePullRequest | null): boolean {
  if (pr === null || pr.state !== "open") return false;
  return prCiFailed(pr) || pr.signals?.conflict === true;
}

function hasTodo(run: HomeRun): boolean {
  return run.state === "waiting-for-input" || run.state === "paused";
}

export function initialSheetTab(run: HomeRun, mode: SheetMode): SheetTab {
  if (mode === "answer" || hasTodo(run)) return "run";
  if (run.state === "ended" && prHasProblem(run.pullRequest)) return "pr";
  return "run";
}

export function prTabDot(pr: HomePullRequest): PrTabDot | null {
  switch (pr.state) {
    case "merged":
      return { tone: "merged", reason: "merged" };
    case "closed":
      return { tone: "idle", reason: "closed" };
    case "open":
      break;
  }
  if (prHasProblem(pr)) return { tone: "problem", reason: "problem" };
  if (pr.ci === "pending") return { tone: "idle", reason: "pending" };
  const behindBy = pr.signals?.behindBy ?? null;
  if (behindBy !== null && behindBy > 0) return { tone: "idle", reason: "behind" };
  const ciClear = pr.ci === "success" || pr.ci === "none";
  if (ciClear && pr.signals?.conflict === false && behindBy === 0)
    return { tone: "progress", reason: "ok" };
  return null;
}
