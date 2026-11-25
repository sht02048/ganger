import {
  V1_RUN_ACTIONS,
  V1_RUN_REFUSALS,
  answerBodySchema,
  continueBodySchema,
  denyBodySchema,
  humanCheckBodySchema,
  mergeBodySchema,
  runDetailSchema,
  runKeyBodySchema,
} from "@ganger/api";
import type {
  V1ContinueOffer,
  V1PrMerge,
  V1RetryOffer,
  V1RunAction,
  V1RunDetail,
  V1RunInput,
  V1RunRefusal,
} from "@ganger/api";
import { toRunId } from "@ganger/core";
import { getRunWithRecords, worktreeTakenOverBy } from "@ganger/db";
import type { Database } from "@ganger/db";
import { AnswerRejectedError } from "../home/actions.js";
import { mergeRunPullRequest } from "../home/merge-pr.js";
import type { MergePrContext } from "../home/merge-pr.js";
import { prProblemsOf } from "../home/model.js";
import { mergeViewOf } from "../pr-signals-view.js";
import type { ServerGitHub } from "../pr-read-diagnosis.js";
import { readQuestion } from "../question.js";
import {
  answerOnceInput,
  cancelRunOnce,
  clearTodoOnce,
  continueRunOnce,
  controlRunOnce,
  denyOnceInput,
  humanCheckOnceInput,
  submitAnswerOnce,
  submitHumanCheckOnce,
  denyPermissionOnce,
} from "../run-detail/actions.js";
import type { RunActionResult } from "../run-detail/actions.js";
import { loadRunDetail } from "../run-detail/load.js";
import type { PendingInput, RunDetail } from "../run-detail/model.js";
import { nextStepInputOfDetail, runNextStep } from "../run-next-step.js";
import { loadRunTicketLink } from "../run-ticket-link.js";
import type { RunTicketLink } from "../run-ticket-link.js";
import { mobileContinueBlock, retryOfferOf, retryRunOnce } from "./run-retry.js";

export type V1RunActionReply =
  | { status: 200 }
  | { status: 400; reason: "invalid-request" }
  | { status: 404 | 409 | 502; reason: V1RunRefusal; message?: string };

export type V1ImmediateRunAction = Exclude<V1RunAction, "merge">;

const INVALID: V1RunActionReply = { status: 400, reason: "invalid-request" };

export function parseV1RunAction(action: string): V1RunAction | null {
  return V1_RUN_ACTIONS.find((known) => known === action) ?? null;
}

function refusalOf(reason: string): V1RunRefusal {
  return V1_RUN_REFUSALS.find((known) => known === reason) ?? "state-changed";
}

function replyOf(result: RunActionResult): V1RunActionReply {
  if (result.ok) return { status: 200 };
  const reason = refusalOf(result.reason);
  return { status: reason === "not-found" ? 404 : 409, reason };
}

function answered(submit: () => void): V1RunActionReply {
  try {
    submit();
    return { status: 200 };
  } catch (error) {
    if (error instanceof AnswerRejectedError) return replyOf({ ok: false, reason: error.reason });
    throw error;
  }
}

export function handleV1RunAction(
  db: Database,
  runId: string,
  action: V1ImmediateRunAction,
  raw: unknown,
  now: Date,
): V1RunActionReply {
  switch (action) {
    case "answer": {
      const body = answerBodySchema.safeParse(raw);
      const input = body.success ? answerOnceInput.safeParse({ ...body.data, runId }) : null;
      if (input?.success !== true) return INVALID;
      return answered(() => submitAnswerOnce(db, input.data, now));
    }
    case "human-check": {
      const body = humanCheckBodySchema.safeParse(raw);
      const input = body.success ? humanCheckOnceInput.safeParse({ ...body.data, runId }) : null;
      if (input?.success !== true) return INVALID;
      return answered(() => submitHumanCheckOnce(db, input.data, now));
    }
    case "deny": {
      const body = denyBodySchema.safeParse(raw);
      const input = body.success ? denyOnceInput.safeParse({ ...body.data, runId }) : null;
      if (input?.success !== true) return INVALID;
      return replyOf(denyPermissionOnce(db, input.data, now));
    }
    case "resume": {
      const body = runKeyBodySchema.safeParse(raw);
      if (!body.success) return INVALID;
      return replyOf(controlRunOnce(db, { runId, ...body.data }, "resume", now));
    }
    case "cancel": {
      const body = runKeyBodySchema.safeParse(raw);
      if (!body.success) return INVALID;
      return replyOf(cancelRunOnce(db, { runId, ...body.data }, now));
    }
    case "retry": {
      const body = runKeyBodySchema.safeParse(raw);
      if (!body.success) return INVALID;
      return replyOf(retryRunOnce(db, { runId, ...body.data }, now));
    }
    case "clear-todo": {
      const body = runKeyBodySchema.safeParse(raw);
      if (!body.success) return INVALID;
      return replyOf(clearTodoOnce(db, { runId, ...body.data }, now));
    }
    case "continue": {
      const body = continueBodySchema.safeParse(raw);
      if (!body.success) return INVALID;
      const { requestId, message } = body.data;
      return replyOf(
        continueRunOnce(db, { runId, requestId }, message, now, () =>
          mobileContinueBlock(db, runId),
        ),
      );
    }
  }
}

const CODE_HOST_FAILURES: ReadonlySet<V1RunRefusal> = new Set([
  "unauthorized",
  "rate-limited",
  "network",
]);

export async function handleV1Merge(
  context: MergePrContext,
  runId: string,
  raw: unknown,
  now: () => Date,
): Promise<V1RunActionReply> {
  const body = mergeBodySchema.safeParse(raw);
  if (!body.success) return INVALID;
  const result = await mergeRunPullRequest(context, { runId, ...body.data }, now);
  if (result.ok) return { status: 200 };
  if (result.reason === "not-found" && getRunWithRecords(context.db, toRunId(runId)) === null) {
    return { status: 404, reason: "not-found" };
  }
  const reason = result.reason === "not-found" ? "pr-not-found" : refusalOf(result.reason);
  const status = CODE_HOST_FAILURES.has(reason) ? 502 : 409;
  return { status, reason, ...(result.message === null ? {} : { message: result.message }) };
}

function continueOfferOf(run: RunDetail): V1ContinueOffer {
  if (run.status.state !== "ended" || run.status.summary !== "failed") return "not-offered";
  if (run.continueOffer?.place !== "same-worktree") return "not-offered";
  return run.continueOffer.agent === "gone" ? "available" : "agent-running";
}

function toRunInput(input: PendingInput): V1RunInput | null {
  switch (input.kind) {
    case "question": {
      const { lead, choices, after } = readQuestion(input.body, input.choices);
      return {
        kind: "question",
        questionId: input.questionId,
        lead,
        choices: choices.map(({ text, answer }) => ({ text, answer })),
        after,
        answered: input.answered,
      };
    }
    case "human-check":
    case "permission":
      return input;
    case "unknown":
      return null;
  }
}

type V1PullRequest = NonNullable<V1RunDetail["pullRequest"]>;

function pullRequestStateOf(run: RunDetail): Pick<V1PullRequest, "state" | "stateSince"> {
  if (run.status.state !== "ended") return { state: "open", stateSince: null };
  const later = run.status.laterPrState;
  if (later !== null) {
    return {
      state: later.state,
      stateSince: {
        at: later.at,
        agoMs: Math.max(0, Date.parse(run.now) - Date.parse(later.at)),
      },
    };
  }
  const state = run.status.prState;
  return { state: state === "none" ? "open" : state, stateSince: null };
}

function summaryOf(run: RunDetail): V1RunDetail["summary"] {
  const ended = run.status.state === "ended" ? run.status : null;
  return {
    outcome: ended?.summary ?? null,
    agentResult: ended?.agentResult ?? null,
    report: run.report,
    startError: run.startError,
  };
}

export function toV1RunDetail(
  run: RunDetail,
  retry: V1RetryOffer = "not-offered",
  merge: V1PrMerge | null = null,
): V1RunDetail {
  return runDetailSchema.parse({
    id: run.id,
    ticketKey: run.ticketKey,
    ticketTitle: run.ticketTitle,
    workspace: run.workspace,
    runner: run.runner === null ? null : { name: run.runner.name, online: run.runner.online },
    agent: run.agent,
    state: run.status.state,
    nextStep: runNextStep(nextStepInputOfDetail(run)),
    cancelling: run.cancelPending,
    pausedSince: run.status.state === "paused" ? run.status.pausedSince : null,
    summary: summaryOf(run),
    pullRequest:
      run.pullRequest === null
        ? null
        : {
            displayId: run.pullRequest.displayId,
            url: run.pullRequest.url,
            ci: run.pullRequest.ci,
            problems: prProblemsOf(run.pullRequest.signals),
            ...pullRequestStateOf(run),
            merge,
          },
    prReadError: run.status.state === "ended" ? run.status.prReadError : null,
    prReadDiagnosis: run.status.state === "ended" ? (run.status.prReadDiagnosis ?? null) : null,
    input: run.status.state === "waiting-for-input" ? toRunInput(run.status.input) : null,
    nextActions: { retry, continue: continueOfferOf(run) },
  });
}

export function loadV1RunDetail(
  db: Database,
  runId: string,
  now: Date,
  serverGitHub: ServerGitHub | null = null,
): V1RunDetail | null {
  const page = loadRunDetail(db, runId, now, serverGitHub);
  if (page.kind !== "found") return null;
  const stored = getRunWithRecords(db, toRunId(runId));
  if (stored === null) return toV1RunDetail(page.run);
  const merge =
    worktreeTakenOverBy(db, stored.run.id) !== null
      ? null
      : mergeViewOf(stored.run, stored.records);
  return toV1RunDetail(page.run, retryOfferOf(db, stored.run, now), merge);
}

export type V1TicketLinkReply = RunTicketLink;

export const loadV1TicketLink = loadRunTicketLink;
