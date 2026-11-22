import {
  V1_RUN_ACTIONS,
  V1_RUN_REFUSALS,
  answerBodySchema,
  denyBodySchema,
  humanCheckBodySchema,
  runDetailSchema,
  runKeyBodySchema,
} from "@ganger/api";
import type { V1RunAction, V1RunDetail, V1RunInput, V1RunRefusal } from "@ganger/api";
import { toRunId } from "@ganger/core";
import type { AdapterRegistry } from "@ganger/core";
import { getRun, getTrackerConnection } from "@ganger/db";
import type { Database, SecretBox } from "@ganger/db";
import { isWebUrl } from "../format/url.js";
import { AnswerRejectedError } from "../home/actions.js";
import { prProblemsOf } from "../home/model.js";
import { readQuestion } from "../question.js";
import {
  answerOnceInput,
  cancelRunOnce,
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

export type V1RunActionReply =
  | { status: 200 }
  | { status: 400; reason: "invalid-request" }
  | { status: 404 | 409; reason: V1RunRefusal };

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
  action: V1RunAction,
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
  }
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

function summaryOf(run: RunDetail): V1RunDetail["summary"] {
  const ended = run.status.state === "ended" ? run.status : null;
  return {
    outcome: ended?.summary ?? null,
    agentResult: ended?.agentResult ?? null,
    report: run.report,
    startError: run.startError,
  };
}

export function toV1RunDetail(run: RunDetail): V1RunDetail {
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
          },
    input: run.status.state === "waiting-for-input" ? toRunInput(run.status.input) : null,
  });
}

export function loadV1RunDetail(db: Database, runId: string, now: Date): V1RunDetail | null {
  const page = loadRunDetail(db, runId, now);
  return page.kind === "found" ? toV1RunDetail(page.run) : null;
}

export type V1TicketLinkReply =
  | { status: 200; url: string }
  | { status: 404; reason: "not-found" }
  | { status: 503; reason: "tracker-unavailable" };

export async function loadV1TicketLink(
  context: { db: Database; secretBox: SecretBox; registry: AdapterRegistry },
  runId: string,
): Promise<V1TicketLinkReply> {
  const run = getRun(context.db, toRunId(runId));
  if (run === null) return { status: 404, reason: "not-found" };
  const stored = getTrackerConnection(context.db, context.secretBox, run.ticket.connection);
  if (stored === null) return { status: 503, reason: "tracker-unavailable" };
  try {
    const tracker = context.registry.createTracker(stored.kind, {
      config: stored.config,
      secrets: stored.secrets,
    });
    const ticket = await tracker.getTicket(run.ticket.key);
    if (ticket === null || !isWebUrl(ticket.url)) return { status: 404, reason: "not-found" };
    return { status: 200, url: ticket.url };
  } catch {
    return { status: 503, reason: "tracker-unavailable" };
  }
}
