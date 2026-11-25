import { z } from "zod";

export const v1MetaSchema = z.object({
  serverVersion: z.string().min(1),
  contractVersion: z.number().int().positive(),
  minClientContractVersion: z.number().int().positive().default(1),
});
export type V1Meta = z.infer<typeof v1MetaSchema>;

export const V1_MERGE_REFUSALS = [
  "no-write-access",
  "blocked",
  "head-changed",
  "method-not-allowed",
  "not-open",
  "no-pull-request",
  "no-code-host",
  "unauthorized",
  "rate-limited",
  "network",
  "superseded",
] as const;
export type V1MergeRefusal = (typeof V1_MERGE_REFUSALS)[number];

export const V1_RUN_REFUSALS = [
  "not-found",
  "already-answered",
  "already-denied",
  "resolved",
  "request-reused",
  "already-ended",
  "not-paused",
  "cancelling",
  "state-changed",
  "active-run",
  "previous-agent",
  "cannot-assign",
  ...V1_MERGE_REFUSALS,
] as const;
export type V1RunRefusal = (typeof V1_RUN_REFUSALS)[number];

export const V1_ERROR_REASONS = [
  "invalid-request",
  "invalid-token",
  "unknown-code",
  "expired-code",
  "used-code",
  "tracker-unavailable",
  ...V1_RUN_REFUSALS,
] as const;
export type V1ErrorReason = (typeof V1_ERROR_REASONS)[number];

export const v1ErrorSchema = z.object({
  meta: v1MetaSchema,
  error: z.object({ reason: z.enum(V1_ERROR_REASONS), message: z.string().optional() }),
});
export type V1Error = z.infer<typeof v1ErrorSchema>;

export function v1ResponseSchema<Data extends z.ZodType>(data: Data) {
  return z.object({ meta: v1MetaSchema, data });
}
