import { z } from "zod";
import { v1ResponseSchema } from "./envelope.js";

export const V1_NOTIFICATION_PATHS = {
  feed: "/api/v1/notification-events",
  stream: "/api/v1/notification-events/stream",
} as const;

export function v1NotificationEventPath(id: number): string {
  return `${V1_NOTIFICATION_PATHS.feed}/${id}`;
}

export const NOTIFICATION_KINDS = [
  "question",
  "permission",
  "human-check",
  "failed",
  "disconnected",
  "runner-offline",
  "runner-auth",
  "runner-usage-limit",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationRecordSchema = z.object({
  id: z.number().int().positive(),
  seq: z.number().int().positive(),
  kind: z.enum(NOTIFICATION_KINDS),
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("run"),
      runId: z.string(),
      workspaceId: z.string(),
      ticketKey: z.string(),
    }),
    z.object({ kind: z.literal("runner"), runnerId: z.string() }),
  ]),
  subject: z.string(),
  detail: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

export const notificationReadySchema = z.object({
  cursor: z.number().int().nonnegative(),
  open: z.array(z.number().int().positive()),
});
export type NotificationReady = z.infer<typeof notificationReadySchema>;

export const notificationFeedSchema = notificationReadySchema.extend({
  events: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = notificationRecordSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
export type NotificationFeed = z.infer<typeof notificationFeedSchema>;

export const notificationFeedResponseSchema = v1ResponseSchema(notificationFeedSchema);
export const notificationEventResponseSchema = v1ResponseSchema(notificationRecordSchema);

export function eventPushId(eventId: number): string {
  return `event-${eventId}`;
}

export function bundlePushId(firstEventId: number): string {
  return `bundle-${firstEventId}`;
}

const pushIdSchema = z.string().regex(/^(?:event|bundle)-[1-9]\d*$/u);

export const pushDataSchema = z.union([
  z.strictObject({
    device: z.string().min(1),
    eventId: z.number().int().positive(),
    replaces: z.array(pushIdSchema).optional(),
  }),
  z.strictObject({
    device: z.string().min(1),
    bundleId: pushIdSchema,
    replaces: z.array(pushIdSchema).optional(),
  }),
  z.strictObject({ device: z.string().min(1), clear: z.array(pushIdSchema).min(1) }),
]);
export type PushData = z.infer<typeof pushDataSchema>;
