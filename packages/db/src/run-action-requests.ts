import { createHash } from "node:crypto";
import type { RunActionRequestId, RunId } from "@ganger/core";
import { and, eq } from "drizzle-orm";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import { runActionRequests } from "./schema.js";

export interface RunActionRequest {
  runId: RunId;
  requestId: RunActionRequestId;
  action: string;
  payload: ReadonlyArray<string>;
}

export interface RunActionHandlers<Result extends { ok: boolean }> {
  act: () => Result;
  replay: (resultRunId: RunId | null) => Result;
  reused: () => Result;
  resultRunId?: (result: Result) => RunId | null;
  replayIsStale?: (resultRunId: RunId | null) => boolean;
}

function fingerprintOf(request: RunActionRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([request.action, ...request.payload]))
    .digest("hex");
}

export type RunActionRequestStatus = "new" | "handled" | "reused";

export function runActionRequestStatus(
  db: Database,
  request: RunActionRequest,
): RunActionRequestStatus {
  const handled = db
    .select({ fingerprint: runActionRequests.fingerprint })
    .from(runActionRequests)
    .where(
      and(
        eq(runActionRequests.runId, request.runId),
        eq(runActionRequests.requestId, request.requestId),
      ),
    )
    .get();
  if (handled === undefined) return "new";
  return handled.fingerprint === fingerprintOf(request) ? "handled" : "reused";
}

export function recordRunActionRequest(db: Database, request: RunActionRequest, now: Date): void {
  db.insert(runActionRequests)
    .values({
      runId: request.runId,
      requestId: request.requestId,
      fingerprint: fingerprintOf(request),
      resultRunId: null,
      handledAt: now,
    })
    .onConflictDoNothing()
    .run();
}

export function handleRunActionOnce<Result extends { ok: boolean }>(
  db: Database,
  request: RunActionRequest,
  now: Date,
  handlers: RunActionHandlers<Result>,
): Result {
  const fingerprint = fingerprintOf(request);
  return inTransaction(db, (): Result => {
    const handled = db
      .select({
        id: runActionRequests.id,
        fingerprint: runActionRequests.fingerprint,
        resultRunId: runActionRequests.resultRunId,
      })
      .from(runActionRequests)
      .where(
        and(
          eq(runActionRequests.runId, request.runId),
          eq(runActionRequests.requestId, request.requestId),
        ),
      )
      .get();
    if (handled !== undefined) {
      if (handled.fingerprint !== fingerprint) return handlers.reused();
      if (handlers.replayIsStale?.(handled.resultRunId) !== true) {
        return handlers.replay(handled.resultRunId);
      }
      db.delete(runActionRequests).where(eq(runActionRequests.id, handled.id)).run();
    }
    const result = handlers.act();
    if (result.ok) {
      db.insert(runActionRequests)
        .values({
          runId: request.runId,
          requestId: request.requestId,
          fingerprint,
          resultRunId: handlers.resultRunId?.(result) ?? null,
          handledAt: now,
        })
        .run();
    }
    return result;
  });
}
