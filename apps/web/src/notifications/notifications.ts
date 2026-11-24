import {
  listNotificationChanges,
  listOpenNotificationEvents,
  notificationCursor,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { toNotificationRecord } from "@ganger/app/notifications/feed";
import type { NotificationFeed } from "@ganger/app/notifications/feed";

export { syncNotifications } from "@ganger/app/notifications/sync";

export const NOTIFICATION_SYNC_MIN_MS = 1_000;

export function throttledSync(
  sync: () => void,
  clock: () => number,
  minMs = NOTIFICATION_SYNC_MIN_MS,
): () => void {
  let last: number | null = null;
  return () => {
    const at = clock();
    if (last !== null && at - last < minMs) return;
    last = at;
    sync();
  };
}

export function readNotificationFeed(db: Database, requested: number | null): NotificationFeed {
  const cursor = notificationCursor(db);
  const after = requested !== null && requested > cursor ? null : requested;
  const events =
    after === null ? listOpenNotificationEvents(db) : listNotificationChanges(db, after);
  return {
    events: events.map(toNotificationRecord),
    cursor: Math.max(cursor, after ?? 0, ...events.map((event) => event.seq)),
    open: listOpenNotificationEvents(db).map((event) => event.id),
  };
}
