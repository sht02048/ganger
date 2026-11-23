import { z } from "zod";

import {
  TODO_TAGS,
  blockerSchema,
  dashboardSummarySchema,
  dashboardWorkspaceSchema,
  inputWaitSchema,
  runBaseSchema,
} from "./dashboard.js";
import { V1_ERROR_REASONS, v1MetaSchema, v1ResponseSchema } from "./envelope.js";
import type { V1RunRefusal } from "./envelope.js";
import { notificationRecordSchema } from "./notifications.js";
import { PROVIDER_USAGE_STATUSES, USAGE_WINDOW_KINDS, usageTimeFields } from "./runners.js";
import {
  V1_CONTINUE_OFFERS,
  V1_NEXT_STEPS,
  V1_RETRY_OFFERS,
  runDetailSchema,
  runInputSchema,
} from "./runs.js";

export const UNKNOWN_VALUE = "unknown";
export type UnknownValue = typeof UNKNOWN_VALUE;

function tolerantEnum<const Value extends string>(values: readonly Value[]) {
  const isKnown = (value: string): value is Value => values.some((known) => known === value);
  return z
    .string()
    .transform((value): Value | UnknownValue => (isKnown(value) ? value : UNKNOWN_VALUE));
}

function unknownTag(known: readonly string[]) {
  return z
    .string()
    .refine((value) => !known.includes(value))
    .transform((): UnknownValue => UNKNOWN_VALUE);
}

const AGENT_RESULTS = [
  "reported-success",
  "reported-failure",
  "ended-without-report",
  "timed-out",
  "stopped-waiting-for-input",
  "runner-disconnected",
  "worktree-missing",
  "canceled",
  "could-not-start",
] as const;
const RUN_OUTCOMES = ["succeeded", "failed", "canceled"] as const;
const RUN_STATES = ["queued", "running", "paused", "waiting-for-input", "disconnected", "ended"];

const appPrProblemSchema = z.union([
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ci-failed") }),
    z.object({ kind: z.literal("conflict") }),
    z.object({ kind: z.literal("behind"), commits: z.number().int() }),
  ]),
  z.object({ kind: unknownTag(["ci-failed", "conflict", "behind"]) }),
]);

const appQueuedReasonSchema = z.union([
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("starting") }),
    z.object({ kind: z.literal("behind") }),
    z.object({ kind: z.literal("runner-offline") }),
    z.object({ kind: z.literal("project-missing") }),
    z.object({ kind: z.literal("assignment-blocked") }),
    z.object({ kind: z.literal("no-capacity"), runner: z.string() }),
    z.object({ kind: z.literal("usage-limit"), provider: z.string(), resetsInMs: z.number() }),
    z.object({
      kind: z.literal("blockers-waiting"),
      blockers: z.array(blockerSchema),
      finished: z.array(blockerSchema),
    }),
    z.object({
      kind: z.literal("blockers-stuck"),
      cause: tolerantEnum(["canceled", "unreadable", "cycle"]),
      blocker: blockerSchema.nullable(),
      blockers: z.array(blockerSchema),
    }),
  ]),
  z.object({
    kind: unknownTag([
      "starting",
      "behind",
      "runner-offline",
      "project-missing",
      "assignment-blocked",
      "no-capacity",
      "usage-limit",
      "blockers-waiting",
      "blockers-stuck",
    ]),
  }),
]);

const appInputWaitSchema = z.union([
  inputWaitSchema,
  z.object({ kind: unknownTag(["question", "permission", "human-check"]) }),
]);

const appRunControlSchema = z
  .object({
    control: z.enum(["pause", "resume"]),
    status: tolerantEnum(["pending", "failed"]),
  })
  .nullable()
  .catch(null);

const appRunBaseSchema = runBaseSchema.extend({
  pullRequest: z
    .object({
      displayId: z.string(),
      url: z.string(),
      problems: z.array(appPrProblemSchema),
    })
    .nullable(),
  control: appRunControlSchema,
  todoTag: tolerantEnum(TODO_TAGS).nullable(),
});

export const appDashboardRunSchema = z.union([
  z.discriminatedUnion("state", [
    appRunBaseSchema.extend({ state: z.literal("queued"), queuedReason: appQueuedReasonSchema }),
    appRunBaseSchema.extend({ state: z.literal("running") }),
    appRunBaseSchema.extend({
      state: z.literal("paused"),
      pausedMs: z.number().nullable(),
      pauseSource: tolerantEnum(["operator", "runner", "unreported"]),
    }),
    appRunBaseSchema.extend({
      state: z.literal("waiting-for-input"),
      input: appInputWaitSchema.nullable(),
      waitingMs: z.number().nullable(),
    }),
    appRunBaseSchema.extend({
      state: z.literal("disconnected"),
      unreachableMs: z.number().nullable(),
    }),
    appRunBaseSchema.extend({
      state: z.literal("ended"),
      summary: tolerantEnum(RUN_OUTCOMES),
      agentResult: tolerantEnum(AGENT_RESULTS),
      prState: tolerantEnum(["none", "open", "merged", "closed", "unknown"]),
      prReadError: tolerantEnum(["no-access", "other"]).nullable(),
      endedAt: z.iso.datetime(),
      endedAgoMs: z.number(),
    }),
  ]),
  appRunBaseSchema.extend({ state: unknownTag(RUN_STATES) }),
]);
export type AppDashboardRun = z.infer<typeof appDashboardRunSchema>;
export type AppQueuedReason = z.infer<typeof appQueuedReasonSchema>;

const appSplitColumnSchema = z.object({
  todo: z.array(appDashboardRunSchema),
  rest: z.array(appDashboardRunSchema),
});

export const appDashboardSchema = z.object({
  workspace: z.union([
    dashboardWorkspaceSchema,
    z.object({ kind: unknownTag(["none", "all", "one"]) }),
  ]),
  summary: dashboardSummarySchema,
  columns: z.object({
    queued: z.array(appDashboardRunSchema),
    running: appSplitColumnSchema,
    done: appSplitColumnSchema,
  }),
});
export type AppDashboard = z.infer<typeof appDashboardSchema>;
export const appDashboardResponseSchema = v1ResponseSchema(appDashboardSchema);

const appRunInputSchema = z.union([
  runInputSchema,
  z.object({ kind: unknownTag(["question", "human-check", "permission"]) }),
]);
export type AppRunInput = z.infer<typeof appRunInputSchema>;

export const appRunDetailSchema = runDetailSchema.extend({
  state: tolerantEnum([
    "queued",
    "running",
    "paused",
    "waiting-for-input",
    "disconnected",
    "ended",
  ]),
  nextStep: tolerantEnum(V1_NEXT_STEPS),
  summary: z.object({
    outcome: tolerantEnum(RUN_OUTCOMES).nullable(),
    agentResult: tolerantEnum(AGENT_RESULTS).nullable(),
    report: z.string().nullable(),
    startError: z.string().nullable(),
  }),
  pullRequest: z
    .object({
      displayId: z.string(),
      url: z.string(),
      ci: tolerantEnum(["success", "failure", "pending", "none", "unavailable", "unknown"]),
      problems: z.array(appPrProblemSchema),
    })
    .nullable(),
  input: appRunInputSchema.nullable(),
  nextActions: z
    .object({
      retry: tolerantEnum(V1_RETRY_OFFERS),
      continue: tolerantEnum(V1_CONTINUE_OFFERS),
    })
    .default({ retry: "not-offered", continue: "not-offered" }),
});
export type AppRunDetail = z.infer<typeof appRunDetailSchema>;
export const appRunDetailResponseSchema = v1ResponseSchema(appRunDetailSchema);

const appUsageWindowSchema = z.object({
  kind: tolerantEnum(USAGE_WINDOW_KINDS),
  usedPercent: z.number(),
  resetsAt: z.iso.datetime().nullable(),
});
export type AppUsageWindow = z.infer<typeof appUsageWindowSchema>;

const appProviderUsageSchema = z.object({
  provider: z.string(),
  status: tolerantEnum(PROVIDER_USAGE_STATUSES),
  windows: z.array(appUsageWindowSchema),
});
export type AppProviderUsage = z.infer<typeof appProviderUsageSchema>;

const appRunnerUsageSchema = z.union([
  z.discriminatedUnion("kind", [
    z.object({
      ...usageTimeFields,
      kind: z.literal("read"),
      providers: z.array(appProviderUsageSchema),
      highest: z.object({ provider: z.string(), window: appUsageWindowSchema }).nullable(),
    }),
    z.object({ ...usageTimeFields, kind: z.literal("unreadable") }),
  ]),
  z.object({ kind: unknownTag(["read", "unreadable"]) }),
]);

const appUsageLimitSchema = z.object({
  provider: z.string(),
  window: tolerantEnum(USAGE_WINDOW_KINDS),
  resetsInMs: z.number().nullable(),
});
export type AppUsageLimit = z.infer<typeof appUsageLimitSchema>;

export const appRunnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  cause: tolerantEnum(["offline", "auth"]).nullable(),
  offlineMs: z.number().nullable(),
  used: z.number().int().nonnegative(),
  capacity: z.number().int().nonnegative(),
  usage: appRunnerUsageSchema.nullable(),
  limits: z.array(appUsageLimitSchema),
});
export type AppRunner = z.infer<typeof appRunnerSchema>;
export const appRunnersResponseSchema = v1ResponseSchema(
  z.object({ runners: z.array(appRunnerSchema) }),
);

export const appNotificationRecordSchema = notificationRecordSchema.extend({
  kind: z.string(),
  target: z.union([
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("run"),
        runId: z.string(),
        workspaceId: z.string(),
        ticketKey: z.string(),
      }),
      z.object({ kind: z.literal("runner"), runnerId: z.string() }),
    ]),
    z.object({ kind: unknownTag(["run", "runner"]) }),
  ]),
});
export type AppNotificationRecord = z.infer<typeof appNotificationRecordSchema>;
export const appNotificationEventResponseSchema = v1ResponseSchema(appNotificationRecordSchema);

export const appErrorSchema = z.object({
  meta: v1MetaSchema,
  error: z.object({ reason: tolerantEnum(V1_ERROR_REASONS) }),
});

export type AppRunRefusal = V1RunRefusal | UnknownValue;
