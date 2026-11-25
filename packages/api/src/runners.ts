import { z } from "zod";
import { v1ResponseSchema } from "./envelope.js";

export const USAGE_WINDOW_KINDS = ["session", "weekly", "fableWeekly", "monthly"] as const;
export const PROVIDER_USAGE_STATUSES = ["ok", "signed-out", "unavailable", "error"] as const;

const usageWindowSchema = z.object({
  kind: z.enum(USAGE_WINDOW_KINDS),
  usedPercent: z.number(),
  resetsAt: z.iso.datetime().nullable(),
});
export type V1UsageWindow = z.infer<typeof usageWindowSchema>;

const providerUsageSchema = z.object({
  provider: z.string(),
  status: z.enum(PROVIDER_USAGE_STATUSES),
  windows: z.array(usageWindowSchema),
});
export type V1ProviderUsage = z.infer<typeof providerUsageSchema>;

export const usageTimeFields = {
  readAt: z.iso.datetime(),
  agoMs: z.number(),
  now: z.iso.datetime(),
};

const runnerUsageSchema = z.discriminatedUnion("kind", [
  z.object({
    ...usageTimeFields,
    kind: z.literal("read"),
    providers: z.array(providerUsageSchema),
    highest: z.object({ provider: z.string(), window: usageWindowSchema }).nullable(),
  }),
  z.object({ ...usageTimeFields, kind: z.literal("unreadable") }),
]);
export type V1RunnerUsage = z.infer<typeof runnerUsageSchema>;

const usageLimitSchema = z.object({
  provider: z.string(),
  window: z.enum(USAGE_WINDOW_KINDS),
  resetsInMs: z.number().nullable(),
});
export type V1UsageLimit = z.infer<typeof usageLimitSchema>;

export const GH_ACCOUNTS_KINDS = [
  "logged-in",
  "logged-out",
  "not-installed",
  "unreadable",
] as const;

export const ghAccountSchema = z.object({
  host: z.string(),
  login: z.string(),
  active: z.boolean(),
  expired: z.boolean(),
});
export type V1GhAccount = z.infer<typeof ghAccountSchema>;

export const ghReadTimeFields = { readAt: z.iso.datetime(), agoMs: z.number() };

const runnerGhAccountsSchema = z.discriminatedUnion("kind", [
  z.object({
    ...ghReadTimeFields,
    kind: z.literal("logged-in"),
    accounts: z.array(ghAccountSchema),
  }),
  z.object({ ...ghReadTimeFields, kind: z.literal("logged-out") }),
  z.object({ ...ghReadTimeFields, kind: z.literal("not-installed") }),
  z.object({ ...ghReadTimeFields, kind: z.literal("unreadable") }),
]);
export type V1RunnerGhAccounts = z.infer<typeof runnerGhAccountsSchema>;

export const runnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  cause: z.enum(["offline", "auth"]).nullable(),
  offlineMs: z.number().nullable(),
  used: z.number().int().nonnegative(),
  capacity: z.number().int().nonnegative(),
  usage: runnerUsageSchema.nullable(),
  limits: z.array(usageLimitSchema),
  ghAccounts: runnerGhAccountsSchema.nullable(),
});
export type V1Runner = z.infer<typeof runnerSchema>;

export const runnersSchema = z.object({ runners: z.array(runnerSchema) });
export const runnersResponseSchema = v1ResponseSchema(runnersSchema);

export const workspacesSchema = z.object({
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type V1Workspaces = z.infer<typeof workspacesSchema>;
export const workspacesResponseSchema = v1ResponseSchema(workspacesSchema);

export const thisDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type V1ThisDevice = z.infer<typeof thisDeviceSchema>;
export const thisDeviceResponseSchema = v1ResponseSchema(thisDeviceSchema);
