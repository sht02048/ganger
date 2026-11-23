import type { V1RetryOffer } from "@ganger/api";
import {
  checkAssignment,
  checkManualRunnerChoice,
  summarizeRunOutcome,
  toRunActionRequestId,
  toRunId,
} from "@ganger/core";
import { getRun, handleRunActionOnce, listRunnerSnapshots, listRuns } from "@ganger/db";
import type { Database, StoredRun } from "@ganger/db";
import { REQUEST_REUSED } from "../run-detail/actions.js";
import type { RunActionResult } from "../run-detail/actions.js";
import { assignInputRefusal, submitAssignment } from "../tickets/assign.js";
import type { AssignInput } from "../tickets/assign.js";

export function isFailedRun(run: StoredRun): boolean {
  return run.state === "ended" && summarizeRunOutcome(run).outcome === "failed";
}

function isLatestOfTicket(db: Database, run: StoredRun): boolean {
  return listRuns(db, { ticket: run.ticket }).at(-1)?.id === run.id;
}

function sameAssignmentOf(run: StoredRun): AssignInput | null {
  if (run.runnerId === null) return null;
  return {
    connection: run.ticket.connection,
    ticketKey: run.ticket.key,
    ticketTitle: run.ticketTitle ?? "",
    trackerProject: run.trackerProject,
    runnerProject: run.runnerProject,
    runnerId: run.runnerId,
    agent: run.agent,
  };
}

function canAssignAgain(db: Database, run: StoredRun, input: AssignInput, now: Date): boolean {
  if (assignInputRefusal(db, input) !== null) return false;
  const runner = listRunnerSnapshots(db, now).find((one) => one.id === run.runnerId);
  return runner !== undefined && checkManualRunnerChoice(runner, run.runnerProject).ok;
}

export function retryOfferOf(db: Database, run: StoredRun, now: Date): V1RetryOffer {
  if (!isFailedRun(run) || !isLatestOfTicket(db, run)) return "not-offered";
  const input = sameAssignmentOf(run);
  return input !== null && canAssignAgain(db, run, input, now) ? "available" : "unavailable";
}

function retryRefusal(db: Database, run: StoredRun): string {
  const ticketRuns = listRuns(db, { ticket: run.ticket });
  return checkAssignment({ ticket: run.ticket, runs: ticketRuns }).ok
    ? "state-changed"
    : "active-run";
}

type RetryResult = { ok: true; runId: string } | { ok: false; reason: string };

function retryRun(db: Database, runId: string, now: Date): RetryResult {
  const run = getRun(db, toRunId(runId));
  if (run === null) return { ok: false, reason: "not-found" };
  const offer = retryOfferOf(db, run, now);
  if (offer === "not-offered") return { ok: false, reason: retryRefusal(db, run) };
  const input = sameAssignmentOf(run);
  if (offer === "unavailable" || input === null) return { ok: false, reason: "cannot-assign" };
  const result = submitAssignment(db, input, now);
  if (result.ok) return result;
  return { ok: false, reason: result.reason === "active-run" ? "active-run" : "cannot-assign" };
}

export function retryRunOnce(
  db: Database,
  key: { runId: string; requestId: string },
  now: Date,
): RunActionResult {
  const result = handleRunActionOnce<RetryResult>(
    db,
    {
      runId: toRunId(key.runId),
      requestId: toRunActionRequestId(key.requestId),
      action: "retry",
      payload: [],
    },
    now,
    {
      act: () => retryRun(db, key.runId, now),
      replay: (resultRunId) =>
        resultRunId === null
          ? { ok: false, reason: REQUEST_REUSED }
          : { ok: true, runId: resultRunId },
      reused: () => ({ ok: false, reason: REQUEST_REUSED }),
      resultRunId: (done) => (done.ok ? toRunId(done.runId) : null),
    },
  );
  return result.ok ? { ok: true } : result;
}
