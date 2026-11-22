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

const LEGACY_KINDS = {
  question: "question",
  permission: "permission",
  "runner-offline": "runner-offline",
} as const;

export type LegacyAlert =
  | {
      kind: "question" | "permission";
      key: string;
      runId: string;
      ticketKey: string;
    }
  | { kind: "runner-offline"; key: string; runnerId: string; runnerName: string };

function legacyKey(kind: string, cause: string): string {
  return `${kind}:${cause.split(":").at(-1) ?? cause}`;
}

export function legacyAlerts(db: Database): LegacyAlert[] {
  return listOpenNotificationEvents(db).flatMap((event): LegacyAlert[] => {
    switch (event.kind) {
      case "question":
      case "permission":
        return event.target.kind === "run"
          ? [
              {
                kind: LEGACY_KINDS[event.kind],
                key: legacyKey(event.kind, event.cause),
                runId: event.target.runId,
                ticketKey: event.target.ticketKey,
              },
            ]
          : [];
      case "runner-offline":
        return event.target.kind === "runner"
          ? [
              {
                kind: "runner-offline",
                key: event.cause,
                runnerId: event.target.runnerId,
                runnerName: event.subject,
              },
            ]
          : [];
      case "human-check":
      case "failed":
      case "disconnected":
      case "runner-auth":
      case "runner-usage-limit":
        return [];
    }
  });
}
