import { summarizeRunOutcome } from "@ganger/core";
import type { RunRecords, StoredRun } from "@ganger/db";
import type { TodoClearedBy } from "./home/model.js";
import { isOpenFailed } from "./home/model.js";
import { settledPrStateOf } from "./pr-signals-view.js";

export interface LatestPrState {
  state: "open" | "merged" | "closed";
  at: Date | null;
}

export function latestPrStateOf(run: StoredRun, records: RunRecords): LatestPrState {
  const later = records.laterPrState;
  if (later !== null) return { state: later.state, at: later.at };
  if (run.state === "ended" && (run.prState === "merged" || run.prState === "closed")) {
    return { state: run.prState, at: null };
  }
  return settledPrStateOf(records) ?? { state: "open", at: null };
}

export function todoClearedOf(run: StoredRun, records: RunRecords): TodoClearedBy | null {
  if (run.state !== "ended" || summarizeRunOutcome(run).outcome !== "failed") return null;
  if (latestPrStateOf(run, records).state === "merged") return "pr-merged";
  return records.todoSettledAt === null ? null : "operator";
}

export function isOpenFailedRun(run: StoredRun, records: RunRecords): boolean {
  return (
    run.state === "ended" &&
    isOpenFailed({
      summary: summarizeRunOutcome(run).outcome,
      todoCleared: todoClearedOf(run, records),
    })
  );
}
