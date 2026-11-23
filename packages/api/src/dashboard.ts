import { z } from "zod";
import { v1ResponseSchema } from "./envelope.js";

const workspaceSchema = z.object({ id: z.string(), name: z.string() });

export const dashboardWorkspaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("one"), workspace: workspaceSchema }),
]);

export const blockerSchema = z.object({
  key: z.string(),
  title: z.string(),
  stateName: z.string(),
  stateCategory: z.string(),
});

export const queuedReasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("starting") }),
  z.object({ kind: z.literal("behind") }),
  z.object({ kind: z.literal("runner-offline") }),
  z.object({ kind: z.literal("project-missing") }),
  z.object({ kind: z.literal("assignment-blocked") }),
  z.object({ kind: z.literal("no-capacity"), runner: z.string() }),
  z.object({
    kind: z.literal("usage-limit"),
    provider: z.string(),
    resetsInMs: z.number(),
  }),
  z.object({
    kind: z.literal("blockers-waiting"),
    blockers: z.array(blockerSchema),
    finished: z.array(blockerSchema),
  }),
  z.object({
    kind: z.literal("blockers-stuck"),
    cause: z.enum(["canceled", "unreadable", "cycle"]),
    blocker: blockerSchema.nullable(),
    blockers: z.array(blockerSchema),
  }),
]);
export type V1QueuedReason = z.infer<typeof queuedReasonSchema>;

export const inputWaitSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("question"),
    questionId: z.string(),
    body: z.string(),
    summary: z.string(),
    choices: z.array(z.string()),
    answered: z.boolean(),
  }),
  z.object({
    kind: z.literal("permission"),
    promptId: z.string(),
    detail: z.string(),
    denied: z.boolean(),
  }),
  z.object({
    kind: z.literal("human-check"),
    questionId: z.string(),
    body: z.string(),
    answered: z.boolean(),
  }),
]);

export const prProblemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ci-failed") }),
  z.object({ kind: z.literal("conflict") }),
  z.object({ kind: z.literal("behind"), commits: z.number().int() }),
]);

export const TODO_TAGS = [
  "question",
  "permission",
  "human-check",
  "waiting-for-input",
  "disconnected",
  "failed",
] as const;

const runControlSchema = z.discriminatedUnion("status", [
  z.object({ control: z.enum(["pause", "resume"]), status: z.literal("pending") }),
  z.object({
    control: z.enum(["pause", "resume"]),
    status: z.literal("failed"),
    reason: z.enum([
      "runner-unreachable",
      "agent-not-running",
      "runner-error",
      "state-changed",
      "unknown",
    ]),
  }),
]);

export const runBaseSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  ticketKey: z.string(),
  ticketTitle: z.string().nullable(),
  trackerProject: z.string(),
  workspace: workspaceSchema,
  runner: z.object({ name: z.string(), online: z.boolean() }).nullable(),
  agent: z.string(),
  waitMs: z.number(),
  executionMs: z.number().nullable(),
  pullRequest: z
    .object({
      displayId: z.string(),
      url: z.string(),
      problems: z.array(prProblemSchema),
    })
    .nullable(),
  cancelling: z.boolean(),
  control: runControlSchema.nullable(),
  todoTag: z.enum(TODO_TAGS).nullable(),
});

export const dashboardRunSchema = z.discriminatedUnion("state", [
  runBaseSchema.extend({ state: z.literal("queued"), queuedReason: queuedReasonSchema }),
  runBaseSchema.extend({ state: z.literal("running") }),
  runBaseSchema.extend({
    state: z.literal("paused"),
    pausedMs: z.number().nullable(),
    pauseSource: z.enum(["operator", "runner", "unreported"]),
  }),
  runBaseSchema.extend({
    state: z.literal("waiting-for-input"),
    input: inputWaitSchema.nullable(),
    waitingMs: z.number().nullable(),
  }),
  runBaseSchema.extend({
    state: z.literal("disconnected"),
    unreachableMs: z.number().nullable(),
  }),
  runBaseSchema.extend({
    state: z.literal("ended"),
    summary: z.enum(["succeeded", "failed", "canceled"]),
    agentResult: z.enum([
      "reported-success",
      "reported-failure",
      "ended-without-report",
      "timed-out",
      "stopped-waiting-for-input",
      "runner-disconnected",
      "worktree-missing",
      "canceled",
      "could-not-start",
    ]),
    prState: z.enum(["none", "open", "merged", "closed", "unknown"]),
    prReadError: z.enum(["no-access", "other"]).nullable(),
    endedAt: z.iso.datetime(),
    endedAgoMs: z.number(),
  }),
]);
export type V1DashboardRun = z.infer<typeof dashboardRunSchema>;

export const dashboardSummarySchema = z.object({
  todo: z.object({
    check: z.number().int().nonnegative(),
    answer: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
  }),
  inProgress: z.number().int().nonnegative(),
  limitedRunners: z.number().int().nonnegative(),
  soonestLimitResetMs: z.number().nullable(),
  runnerIssues: z.number().int().nonnegative(),
});

const splitColumnSchema = z.object({
  todo: z.array(dashboardRunSchema),
  rest: z.array(dashboardRunSchema),
});

export const dashboardSchema = z.object({
  workspace: dashboardWorkspaceSchema,
  summary: dashboardSummarySchema,
  columns: z.object({
    queued: z.array(dashboardRunSchema),
    running: splitColumnSchema,
    done: splitColumnSchema,
  }),
});
export type V1Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardResponseSchema = v1ResponseSchema(dashboardSchema);
