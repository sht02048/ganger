import { DESKTOP_ACTIVITY_REPORT_INTERVAL_MS } from "@ganger/api";
import { PUSH_REMIND_AFTER_MS } from "@ganger/db";
import type { PushDelivery, StoredNotificationEvent } from "@ganger/db";
import { isTodo, todoWindows } from "./push-windows.js";

export const MAC_RECENT_USE_MS = 2 * 60_000;
export const PUSH_DEFER_MS = 5 * 60_000;
export const PUSH_FIRST_REPORT_WAIT_MS = DESKTOP_ACTIVITY_REPORT_INTERVAL_MS + 10_000;

const SEND_NOW = 0;

export interface PushDeferral {
  recordUse(deviceId: string, lastUsedAt: number): void;
  releasable(open: ReadonlyArray<StoredNotificationEvent>, now: Date): StoredNotificationEvent[];
  releasableReminders(due: ReadonlyArray<PushDelivery>, now: Date): PushDelivery[];
}

interface Pending<Key> {
  key: Key;
  dueAt: number;
}

function createHoldBook<Key>() {
  const sendAt = new Map<Key, number>();

  const forgetClosed = (pending: ReadonlyArray<Pending<Key>>): void => {
    const present = new Set(pending.map((item) => item.key));
    for (const key of sendAt.keys()) {
      if (!present.has(key)) sendAt.delete(key);
    }
  };

  return {
    sendAtOf: (key: Key) => sendAt.get(key),
    decide: (
      pending: ReadonlyArray<Pending<Key>>,
      at: number,
      usedRecently: boolean,
      waitingForReport: boolean,
    ): void => {
      forgetClosed(pending);
      for (const { key, dueAt } of pending) {
        if (sendAt.has(key)) continue;
        if (usedRecently) {
          sendAt.set(key, (waitingForReport ? dueAt : at) + PUSH_DEFER_MS);
        } else if (!waitingForReport) {
          sendAt.set(key, SEND_NOW);
        }
      }
    },
  };
}

function reminderKey(row: PushDelivery): string {
  return `${row.deviceId}:${row.eventId}`;
}

export function createPushDeferral(options: { waitForReportUntil: number }): PushDeferral {
  const lastUsedAt = new Map<string, number>();
  const events = createHoldBook<number>();
  const reminders = createHoldBook<string>();

  const usedRecently = (at: number): boolean => {
    for (const [deviceId, usedAt] of lastUsedAt) {
      if (at - usedAt > MAC_RECENT_USE_MS) lastUsedAt.delete(deviceId);
    }
    return lastUsedAt.size > 0;
  };

  const bundledSendAt = (open: ReadonlyArray<StoredNotificationEvent>): Map<number, number> => {
    const deferredTodos = open.flatMap((event) => {
      const due = events.sendAtOf(event.id);
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
      events.decide(
        open.map((event) => ({ key: event.id, dueAt: event.createdAt.getTime() })),
        at,
        usedRecently(at),
        at < options.waitForReportUntil,
      );
      const bundled = bundledSendAt(open);
      return open.filter((event) => {
        const due = bundled.get(event.id) ?? events.sendAtOf(event.id);
        return due !== undefined && due <= at;
      });
    },
    releasableReminders: (due, now) => {
      const at = now.getTime();
      reminders.decide(
        due.map((row) => ({
          key: reminderKey(row),
          dueAt: (row.firstSentAt?.getTime() ?? at) + PUSH_REMIND_AFTER_MS,
        })),
        at,
        usedRecently(at),
        at < options.waitForReportUntil,
      );
      return due.filter((row) => {
        const sendAt = reminders.sendAtOf(reminderKey(row));
        return sendAt !== undefined && sendAt <= at;
      });
    },
  };
}
