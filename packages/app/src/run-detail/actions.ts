import {
  AGENT_MESSAGE_MAX_LENGTH,
  toAgentMessageRequestId,
  toPermissionRequestId,
  toRunActionRequestId,
  toRunId,
} from "@ganger/core";
import type { RunControl, RunId } from "@ganger/core";
import {
  continueRun,
  denyPermissionWait,
  getRun,
  getRunControlRequest,
  getRunWithRecords,
  handleRunActionOnce,
  requestAgentMessage,
  requestPreviousAgentStop,
  requestRunCancel,
  requestWorktreeRemoval,
  settleRunTodo,
  skipBlockerWait,
} from "@ganger/db";
import type { ContinueRunBlock } from "@ganger/db";
import type { Database } from "@ganger/db";
import { z } from "zod";
import {
  AnswerRejectedError,
  answerInput,
  denyInput,
  humanCheckAnswerInput,
  submitAnswer,
  submitHumanCheckAnswer,
} from "../home/actions.js";
import { requestControl } from "../run-control.js";

export type RunActionResult = { ok: true } | { ok: false; reason: string };

export const REQUEST_REUSED = "request-reused";

export const runActionRequestId = z.string().min(16).max(64);

interface RunActionKey {
  runId: string;
  requestId: string;
}

export function onceForRun(
  db: Database,
  key: RunActionKey,
  action: string,
  payload: ReadonlyArray<string>,
  now: Date,
  act: () => RunActionResult,
  replayOptions: {
    replayIsStale?: () => boolean;
    onReplay?: () => void;
  } = {},
): RunActionResult {
  return handleRunActionOnce<RunActionResult>(
    db,
    {
      runId: toRunId(key.runId),
      requestId: toRunActionRequestId(key.requestId),
      action,
      payload,
    },
    now,
    {
      act,
      replay: () => {
        replayOptions.onReplay?.();
        return { ok: true };
      },
      reused: () => ({ ok: false, reason: REQUEST_REUSED }),
      ...(replayOptions.replayIsStale === undefined
        ? {}
        : { replayIsStale: replayOptions.replayIsStale }),
    },
  );
}

export function cancelRunRequest(db: Database, runId: string, now: Date): RunActionResult {
  const result = requestRunCancel(db, toRunId(runId), now);
  return result.ok ? { ok: true } : result;
}

export function removeWorktreeRequest(db: Database, runId: string, now: Date): RunActionResult {
  return requestWorktreeRemoval(db, toRunId(runId), now);
}

export type ContinueRunActionResult =
  | { ok: true; runId: RunId }
  | { ok: false; reason: ContinueRunBlock | typeof REQUEST_REUSED };

export function continueRunRequest(
  db: Database,
  runId: RunId,
  message: string,
  now: Date,
): ContinueRunActionResult {
  const result = continueRun(db, { from: runId, message, now });
  return result.ok ? { ok: true, runId: result.run.id } : result;
}

export function stopPreviousAgentRequest(db: Database, runId: RunId, now: Date): RunActionResult {
  return requestPreviousAgentStop(db, runId, now);
}

export const agentMessageInput = z.object({
  runId: z.string().min(1),
  requestId: z.string().min(16).max(64),
  body: z
    .string()
    .trim()
    .min(1)
    .max(AGENT_MESSAGE_MAX_LENGTH)
    .refine((body) => !body.includes("\0")),
});

export function clearTodoRequest(db: Database, runId: RunId, now: Date): RunActionResult {
  return settleRunTodo(db, runId, now);
}

export function clearTodoOnce(
  db: Database,
  key: RunActionKey,
  now: Date,
  onReplay?: () => void,
): RunActionResult {
  return onceForRun(
    db,
    key,
    "clear-todo",
    [],
    now,
    () => clearTodoRequest(db, toRunId(key.runId), now),
    onReplay === undefined ? {} : { onReplay },
  );
}

export function skipBlockerWaitRequest(db: Database, runId: string, now: Date): RunActionResult {
  return skipBlockerWait(db, toRunId(runId), now);
}

export function skipBlockerWaitOnce(
  db: Database,
  key: RunActionKey,
  now: Date,
  onReplay?: () => void,
): RunActionResult {
  return onceForRun(
    db,
    key,
    "skip-blocker-wait",
    [],
    now,
    () => skipBlockerWaitRequest(db, key.runId, now),
    onReplay === undefined ? {} : { onReplay },
  );
}

export function sendAgentMessageRequest(
  db: Database,
  input: z.infer<typeof agentMessageInput>,
  now: Date,
): RunActionResult {
  const result = requestAgentMessage(
    db,
    toRunId(input.runId),
    { requestId: toAgentMessageRequestId(input.requestId), body: input.body },
    now,
  );
  return result.ok ? { ok: true } : result;
}

export function cancelRunOnce(
  db: Database,
  key: RunActionKey,
  now: Date,
  onReplay?: () => void,
): RunActionResult {
  return onceForRun(
    db,
    key,
    "cancel",
    [],
    now,
    () => cancelRunRequest(db, key.runId, now),
    onReplay === undefined ? {} : { onReplay },
  );
}

export function removeWorktreeOnce(db: Database, key: RunActionKey, now: Date): RunActionResult {
  const removalFailed = (): boolean => {
    const records = getRunWithRecords(db, toRunId(key.runId))?.records;
    return (
      records !== undefined &&
      records.worktreeRemovedAt === null &&
      records.worktreeRemoveRequestedAt === null
    );
  };
  return onceForRun(
    db,
    key,
    "remove-worktree",
    [],
    now,
    () => removeWorktreeRequest(db, key.runId, now),
    { replayIsStale: removalFailed },
  );
}

export function stopPreviousAgentOnce(db: Database, key: RunActionKey, now: Date): RunActionResult {
  const runId = toRunId(key.runId);
  const stopFailed = (): boolean => {
    const records = getRunWithRecords(db, runId)?.records;
    return records?.agentCheck === "alive" && records.agentStopRequestedAt === null;
  };
  return onceForRun(
    db,
    key,
    "stop-previous-agent",
    [],
    now,
    () => stopPreviousAgentRequest(db, runId, now),
    { replayIsStale: stopFailed },
  );
}

export function controlRunOnce(
  db: Database,
  key: RunActionKey,
  control: RunControl,
  now: Date,
  onReplay?: () => void,
): RunActionResult {
  const controlFailed = (): boolean => {
    const request = getRunControlRequest(db, toRunId(key.runId));
    return request?.control === control && request.status === "failed";
  };
  return onceForRun(
    db,
    key,
    "control",
    [control],
    now,
    () => requestControl(db, key.runId, control, now),
    { replayIsStale: controlFailed, ...(onReplay === undefined ? {} : { onReplay }) },
  );
}

export function continueRunOnce(
  db: Database,
  key: RunActionKey,
  message: string,
  now: Date,
  extraBlock: () => ContinueRunBlock | null = () => null,
  onReplay?: () => void,
): ContinueRunActionResult {
  const from = toRunId(key.runId);
  return handleRunActionOnce<ContinueRunActionResult>(
    db,
    {
      runId: from,
      requestId: toRunActionRequestId(key.requestId),
      action: "continue",
      payload: [message],
    },
    now,
    {
      act: () => {
        const reason = extraBlock();
        return reason === null ? continueRunRequest(db, from, message, now) : { ok: false, reason };
      },
      replay: (resultRunId) => {
        if (resultRunId === null) return { ok: false, reason: REQUEST_REUSED };
        onReplay?.();
        return { ok: true, runId: resultRunId };
      },
      reused: () => ({ ok: false, reason: REQUEST_REUSED }),
      resultRunId: (result) => (result.ok ? result.runId : null),
      replayIsStale: (resultRunId) => {
        if (resultRunId === null) return false;
        const next = getRun(db, resultRunId);
        return next === null || (next.state === "ended" && next.startedAt === null);
      },
    },
  );
}

export const denyOnceInput = denyInput.extend({ requestId: runActionRequestId });

export function denyPermissionOnce(
  db: Database,
  { requestId, ...denial }: z.infer<typeof denyOnceInput>,
  now: Date,
): RunActionResult {
  return onceForRun(
    db,
    { runId: denial.runId, requestId },
    "deny",
    [denial.promptId, denial.reason],
    now,
    () =>
      denyPermissionWait(
        db,
        {
          runId: toRunId(denial.runId),
          permissionId: toPermissionRequestId(denial.promptId),
          reason: denial.reason,
        },
        now,
      ),
  );
}

export const MCP_ANSWER_ACTION = "mcp-answer";

export const answerOnceInput = answerInput.extend({ requestId: runActionRequestId });

export function submitAnswerOnce(
  db: Database,
  { requestId, ...answer }: z.infer<typeof answerOnceInput>,
  now: Date,
): void {
  const result = onceForRun(
    db,
    { runId: answer.runId, requestId },
    "answer",
    [answer.questionId, answer.answer],
    now,
    () => {
      submitAnswer(db, answer, now);
      return { ok: true };
    },
  );
  if (!result.ok) throw new AnswerRejectedError("already-answered");
}

export const humanCheckOnceInput = humanCheckAnswerInput.extend({
  requestId: runActionRequestId,
});

export function submitHumanCheckOnce(
  db: Database,
  { requestId, ...check }: z.infer<typeof humanCheckOnceInput>,
  now: Date,
): void {
  const result = onceForRun(
    db,
    { runId: check.runId, requestId },
    "human-check",
    [check.questionId, check.decision, check.note],
    now,
    () => {
      submitHumanCheckAnswer(db, check, now);
      return { ok: true };
    },
  );
  if (!result.ok) throw new AnswerRejectedError("already-answered");
}
