import type { NotificationRecord } from "@ganger/api";
import type { StoredNotificationEvent } from "@ganger/db";
import { z } from "zod";

export {
  notificationFeedSchema,
  notificationReadySchema,
  notificationRecordSchema,
} from "@ganger/api";
export type { NotificationFeed, NotificationReady, NotificationRecord } from "@ganger/api";

export const NOTIFICATION_FEED_PATH = "/api/notification-events";
export const NOTIFICATION_STREAM_PATH = "/api/notification-events/stream";

export function toNotificationRecord(event: StoredNotificationEvent): NotificationRecord {
  return {
    id: event.id,
    seq: event.seq,
    kind: event.kind,
    target: event.target,
    subject: event.subject,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
    resolvedAt: event.resolvedAt === null ? null : event.resolvedAt.toISOString(),
  };
}

export function parseAfter(value: string | null): number | null {
  if (value === null) return null;
  const parsed = z.coerce.number().int().nonnegative().safeParse(value.trim());
  return value.trim().length > 0 && parsed.success ? parsed.data : null;
}
