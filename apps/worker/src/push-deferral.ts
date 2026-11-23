import { DESKTOP_ACTIVITY_REPORT_INTERVAL_MS } from "@ganger/api";
import { NOTIFICATION_REOPEN_WINDOW_MS } from "@ganger/db";
import type { StoredNotificationEvent } from "@ganger/db";
import { isTodo, todoWindows } from "./push-windows.js";

export const MAC_RECENT_USE_MS = 2 * 60_000;
export const PUSH_DEFER_MS = 5 * 60_000;
export const PUSH_FIRST_REPORT_WAIT_MS = DESKTOP_ACTIVITY_REPORT_INTERVAL_MS + 10_000;

const SEND_NOW = 0;

export interface PushDeferral {
  recordUse(deviceId: string, lastUsedAt: number): void;
  releasable(open: ReadonlyArray<StoredNotificationEvent>, now: Date): StoredNotificationEvent[];
}

export function createPushDeferral(options: { waitForReportUntil: number }): PushDeferral {
  const lastUsedAt = new Map<string, number>();
  const sendAt = new Map<number, number>();
  const closedAt = new Map<number, number>();

  const usedRecently = (at: number): boolean => {
    for (const [deviceId, usedAt] of lastUsedAt) {
      if (at - usedAt > MAC_RECENT_USE_MS) lastUsedAt.delete(deviceId);
    }
    return lastUsedAt.size > 0;
  };

  const decide = (open: ReadonlyArray<StoredNotificationEvent>, at: number): void => {
    const openIds = new Set(open.map((event) => event.id));
    for (const eventId of sendAt.keys()) {
      if (openIds.has(eventId)) continue;
      sendAt.delete(eventId);
      closedAt.set(eventId, at);
    }
    for (const [eventId, closed] of closedAt) {
      if (at - closed > NOTIFICATION_REOPEN_WINDOW_MS) closedAt.delete(eventId);
    }
    const recent = usedRecently(at);
    for (const event of open) {
      if (sendAt.has(event.id)) continue;
      if (recent) {
        const deferFrom = closedAt.has(event.id) ? at : event.createdAt.getTime();
        sendAt.set(event.id, deferFrom + PUSH_DEFER_MS);
        closedAt.delete(event.id);
      } else if (at >= options.waitForReportUntil) {
        sendAt.set(event.id, SEND_NOW);
        closedAt.delete(event.id);
      }
    }
  };

  const bundledSendAt = (open: ReadonlyArray<StoredNotificationEvent>): Map<number, number> => {
    const deferredTodos = open.flatMap((event) => {
      const due = sendAt.get(event.id);
      if (due === undefined || due === SEND_NOW || !isTodo(event.kind)) return [];
      return [{ eventId: event.id, createdAt: due }];
    });
    return new Map(
      todoWindows(deferredTodos).flatMap((window) => {
        const last = Math.max(...window.map((member) => member.createdAt));
        return window.map((member): [number, number] => [member.eventId, last]);
      }),
    );
  };

  return {
    recordUse: (deviceId, usedAt) => {
      lastUsedAt.set(deviceId, Math.max(usedAt, lastUsedAt.get(deviceId) ?? 0));
    },
    releasable: (open, now) => {
      const at = now.getTime();
      decide(open, at);
      const bundled = bundledSendAt(open);
      return open.filter((event) => {
        const due = bundled.get(event.id) ?? sendAt.get(event.id);
        return due !== undefined && due <= at;
      });
    },
  };
}
