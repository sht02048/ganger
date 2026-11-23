import { z } from "zod";
import { prProblemSchema } from "./dashboard.js";
import { v1ResponseSchema } from "./envelope.js";

export const V1_RUN_ACTIONS = [
  "answer",
  "human-check",
  "deny",
  "resume",
  "cancel",
  "retry",
  "continue",
] as const;
export type V1RunAction = (typeof V1_RUN_ACTIONS)[number];

export function v1RunPath(runId: string): string {
  return `/api/v1/runs/${encodeURIComponent(runId)}`;
}

export function v1RunActionPath(runId: string, action: V1RunAction): string {
  return `${v1RunPath(runId)}/${action}`;
}

export function v1RunTicketLinkPath(runId: string): string {
  return `${v1RunPath(runId)}/ticket-link`;
}

export const V1_TEXT_MAX_LENGTH = 10_000;

const requestIdSchema = z.string().min(16).max(64);
const idSchema = z.string().min(1);

export const answerBodySchema = z.strictObject({
  requestId: requestIdSchema,
  questionId: idSchema,
  answer: z.string(),
});
export type V1AnswerBody = z.infer<typeof answerBodySchema>;

export const V1_HUMAN_CHECK_DECISIONS = ["confirmed", "changes-requested"] as const;
export type V1HumanCheckDecision = (typeof V1_HUMAN_CHECK_DECISIONS)[number];

export const humanCheckBodySchema = z.strictObject({
  requestId: requestIdSchema,
  questionId: idSchema,
  decision: z.enum(V1_HUMAN_CHECK_DECISIONS),
  note: z.string(),
});
export type V1HumanCheckBody = z.infer<typeof humanCheckBodySchema>;

export const denyBodySchema = z.strictObject({
  requestId: requestIdSchema,
  promptId: idSchema,
  reason: z.string(),
});
export type V1DenyBody = z.infer<typeof denyBodySchema>;

export const runKeyBodySchema = z.strictObject({ requestId: requestIdSchema });
export type V1RunKeyBody = z.infer<typeof runKeyBodySchema>;

export const V1_CONTINUE_MESSAGE_MAX_LENGTH = 8_000;

export const continueBodySchema = z.strictObject({
  requestId: requestIdSchema,
  message: z
    .string()
    .trim()
    .min(1)
    .refine((text) => Array.from(text).length <= V1_CONTINUE_MESSAGE_MAX_LENGTH),
});
export type V1ContinueBody = z.infer<typeof continueBodySchema>;

export const V1_RETRY_OFFERS = ["available", "unavailable", "not-offered"] as const;
export type V1RetryOffer = (typeof V1_RETRY_OFFERS)[number];

export const V1_CONTINUE_OFFERS = ["available", "agent-running", "not-offered"] as const;
export type V1ContinueOffer = (typeof V1_CONTINUE_OFFERS)[number];

export const runActionResponseSchema = v1ResponseSchema(z.object({ accepted: z.literal(true) }));

export const ticketLinkResponseSchema = v1ResponseSchema(z.object({ url: z.url() }));

export const V1_NEXT_STEPS = [
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
export type V1NextStep = (typeof V1_NEXT_STEPS)[number];

export const runInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("question"),
    questionId: z.string(),
    lead: z.array(z.string()),
    choices: z.array(z.object({ text: z.string(), answer: z.string() })),
    after: z.array(z.string()),
    answered: z.boolean(),
  }),
  z.object({
    kind: z.literal("human-check"),
    questionId: z.string(),
    body: z.string(),
    answered: z.boolean(),
  }),
  z.object({
    kind: z.literal("permission"),
    promptId: z.string(),
    detail: z.string(),
    denied: z.boolean(),
  }),
]);
export type V1RunInput = z.infer<typeof runInputSchema>;

export const runDetailSchema = z.object({
  id: z.string(),
  ticketKey: z.string(),
  ticketTitle: z.string().nullable(),
  workspace: z.object({ id: z.string(), name: z.string() }),
  runner: z.object({ name: z.string(), online: z.boolean() }).nullable(),
  agent: z.string(),
  state: z.enum(["queued", "running", "paused", "waiting-for-input", "disconnected", "ended"]),
  nextStep: z.enum(V1_NEXT_STEPS),
  cancelling: z.boolean(),
  pausedSince: z.iso.datetime().nullable(),
  summary: z.object({
    outcome: z.enum(["succeeded", "failed", "canceled"]).nullable(),
    agentResult: z
      .enum([
        "reported-success",
        "reported-failure",
        "ended-without-report",
        "timed-out",
        "stopped-waiting-for-input",
        "runner-disconnected",
        "worktree-missing",
        "canceled",
        "could-not-start",
      ])
      .nullable(),
    report: z.string().nullable(),
    startError: z.string().nullable(),
  }),
  pullRequest: z
    .object({
      displayId: z.string(),
      url: z.string(),
      ci: z.enum(["success", "failure", "pending", "none", "unavailable", "unknown"]),
      problems: z.array(prProblemSchema),
    })
    .nullable(),
  input: runInputSchema.nullable(),
  nextActions: z
    .object({ retry: z.enum(V1_RETRY_OFFERS), continue: z.enum(V1_CONTINUE_OFFERS) })
    .default({ retry: "not-offered", continue: "not-offered" }),
});
export type V1RunDetail = z.infer<typeof runDetailSchema>;

export const runDetailResponseSchema = v1ResponseSchema(runDetailSchema);
