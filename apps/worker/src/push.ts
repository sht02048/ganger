import { bundlePushId, eventPushId } from "@ganger/api";
import type { PushData } from "@ganger/api";
import {
  deviceGroupOfKind,
  forgetInvalidPushAddress,
  listOpenNotificationEvents,
  listPushDeliveries,
  listPushDevices,
  recordPushCleared,
  recordPushReminded,
  recordPushSent,
  reopenClearedPushes,
} from "@ganger/db";
import type {
  Database,
  NotificationEventKind,
  PushDelivery,
  PushDevice,
  StoredNotificationEvent,
} from "@ganger/db";
import { z } from "zod";
import type { WorkerLogger } from "./context.js";
import { messages } from "./messages.js";

export const DEFAULT_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push";
export const PUSH_BUNDLE_WINDOW_MS = 5_000;
export const PUSH_BUNDLE_AFTER = 3;
export const PUSH_REMIND_AFTER_MS = 10 * 60_000;
export const PUSH_RECEIPT_DELAY_MS = 15 * 60_000;
export const PUSH_RECEIPT_GIVE_UP_MS = 60 * 60_000;
export const PUSH_FAILURE_BACKOFF_MS = 60_000;
const PUSH_REQUEST_TIMEOUT_MS = 5_000;
const PUSH_BATCH_SIZE = 100;
export const PUSH_CLEAR_EVENTS_PER_MESSAGE = 50;
const RECEIPT_BATCH_SIZE = 1_000;
const MAX_PENDING_RECEIPTS = 10_000;

export interface ExpoMessage {
  to: string;
  data: PushData;
  title?: string;
  body?: string;
  sound?: "default";
  mutableContent?: true;
  contentAvailable?: true;
  priority?: "normal";
}

export type PushEffect =
  | { kind: "sent"; eventIds: number[]; bundleId: string | null }
  | { kind: "reminded"; eventId: number }
  | { kind: "cleared"; eventIds: number[] };

export interface PlannedPush {
  device: PushDevice;
  message: ExpoMessage;
  effect: PushEffect;
}

function allows(device: PushDevice, kind: NotificationEventKind): boolean {
  return device.enabled && device.groups[deviceGroupOfKind(kind)];
}

function isTodo(kind: NotificationEventKind): boolean {
  return deviceGroupOfKind(kind) !== "runnerIssue";
}

function reminds(kind: NotificationEventKind): boolean {
  return kind === "question" || kind === "permission" || kind === "human-check";
}

function alert(device: PushDevice, body: string, data: PushData): ExpoMessage {
  return {
    to: device.token,
    title: messages.push.title,
    body,
    sound: "default",
    mutableContent: true,
    data,
  };
}

function planClears(device: PushDevice, rows: ReadonlyArray<PushDelivery>): PlannedPush[] {
  const resolved = rows.filter(
    (row) => row.firstSentAt !== null && row.clearedAt === null && row.resolvedAt !== null,
  );
  const bundled = new Set<string>();
  const entries = resolved.map((row) => {
    const ids = [eventPushId(row.eventId)];
    const { bundleId } = row;
    if (
      bundleId !== null &&
      !bundled.has(bundleId) &&
      rows
        .filter((other) => other.bundleId === bundleId)
        .every((other) => other.resolvedAt !== null)
    ) {
      bundled.add(bundleId);
      ids.push(bundleId);
    }
    return { eventId: row.eventId, ids };
  });
  const pushes: PlannedPush[] = [];
  for (let start = 0; start < entries.length; start += PUSH_CLEAR_EVENTS_PER_MESSAGE) {
    const chunk = entries.slice(start, start + PUSH_CLEAR_EVENTS_PER_MESSAGE);
    pushes.push({
      device,
      message: {
        to: device.token,
        contentAvailable: true,
        priority: "normal",
        data: { clear: chunk.flatMap((entry) => entry.ids) },
      },
      effect: { kind: "cleared", eventIds: chunk.map((entry) => entry.eventId) },
    });
  }
  return pushes;
}

interface WindowMember {
  eventId: number;
  createdAt: number;
  row: PushDelivery | null;
}

function todoWindows(members: ReadonlyArray<WindowMember>): WindowMember[][] {
  const sorted = members.toSorted((a, b) => a.createdAt - b.createdAt || a.eventId - b.eventId);
  const windows: WindowMember[][] = [];
  for (const member of sorted) {
    const current = windows.at(-1);
    const startedAt = current?.[0]?.createdAt;
    if (current !== undefined && startedAt !== undefined) {
      if (member.createdAt - startedAt <= PUSH_BUNDLE_WINDOW_MS) {
        current.push(member);
        continue;
      }
    }
    windows.push([member]);
  }
  return windows;
}

function planWindow(device: PushDevice, window: ReadonlyArray<WindowMember>): PlannedPush[] {
  const fresh = window.filter((member) => member.row === null);
  if (fresh.length === 0) return [];
  if (window.length <= PUSH_BUNDLE_AFTER) {
    return fresh.map((member) => planEvent(device, member.eventId));
  }
  const first = window[0];
  if (first === undefined) return [];
  const bundleId = bundlePushId(first.eventId);
  const replaces = new Set(
    window.flatMap(({ row, eventId }) => {
      if (row === null) return [];
      return row.bundleId === null ? [eventPushId(eventId)] : [row.bundleId];
    }),
  );
  return [
    {
      device,
      message: alert(device, messages.push.bundleBody(window.length), {
        bundleId,
        ...(replaces.size === 0 ? {} : { replaces: [...replaces] }),
      }),
      effect: { kind: "sent", eventIds: window.map((member) => member.eventId), bundleId },
    },
  ];
}

function planEvent(device: PushDevice, eventId: number): PlannedPush {
  return {
    device,
    message: alert(device, messages.push.body, { eventId }),
    effect: { kind: "sent", eventIds: [eventId], bundleId: null },
  };
}

function planFresh(
  device: PushDevice,
  rows: ReadonlyArray<PushDelivery>,
  open: ReadonlyArray<StoredNotificationEvent>,
): PlannedPush[] {
  const known = new Set(rows.map((row) => row.eventId));
  const fresh = open.filter((event) => !known.has(event.id) && allows(device, event.kind));
  const issues = fresh
    .filter((event) => !isTodo(event.kind))
    .map((event) => planEvent(device, event.id));
  const freshTodos = fresh.filter((event) => isTodo(event.kind));
  if (freshTodos.length === 0) return issues;
  const members: WindowMember[] = [
    ...freshTodos.map((event) => ({
      eventId: event.id,
      createdAt: event.createdAt.getTime(),
      row: null,
    })),
    ...rows
      .filter(
        (row) =>
          row.firstSentAt !== null &&
          row.resolvedAt === null &&
          isTodo(row.kind) &&
          allows(device, row.kind),
      )
      .map((row) => ({ eventId: row.eventId, createdAt: row.createdAt.getTime(), row })),
  ];
  return [...issues, ...todoWindows(members).flatMap((window) => planWindow(device, window))];
}

function planReminders(
  device: PushDevice,
  rows: ReadonlyArray<PushDelivery>,
  now: Date,
): PlannedPush[] {
  return rows
    .filter(
      (row) =>
        row.firstSentAt !== null &&
        row.remindedAt === null &&
        row.clearedAt === null &&
        row.resolvedAt === null &&
        reminds(row.kind) &&
        allows(device, row.kind) &&
        now.getTime() - row.firstSentAt.getTime() >= PUSH_REMIND_AFTER_MS,
    )
    .map((row) => ({
      device,
      message: alert(device, messages.push.body, {
        eventId: row.eventId,
        replaces: [eventPushId(row.eventId)],
      }),
      effect: { kind: "reminded", eventId: row.eventId },
    }));
}

export function planPushes(input: {
  devices: ReadonlyArray<PushDevice>;
  open: ReadonlyArray<StoredNotificationEvent>;
  deliveries: ReadonlyArray<PushDelivery>;
  now: Date;
}): PlannedPush[] {
  return input.devices.flatMap((device) => {
    const rows = input.deliveries.filter((row) => row.deviceId === device.id);
    return [
      ...planClears(device, rows),
      ...planFresh(device, rows, input.open),
      ...planReminders(device, rows, input.now),
    ];
  });
}

const ticketSchema = z.object({
  status: z.string(),
  id: z.string().min(1).optional(),
  details: z.object({ error: z.string().optional() }).optional(),
});
const sendResponseSchema = z.object({ data: z.array(ticketSchema) });
const receiptSchema = z.object({
  status: z.string(),
  details: z.object({ error: z.string().optional() }).optional(),
});
const receiptsResponseSchema = z.object({ data: z.record(z.string(), receiptSchema) });

export interface PushTransport {
  url: string;
  fetch: typeof fetch;
}

interface PendingReceipt {
  id: string;
  deviceId: string;
  token: string;
  sentAt: number;
}

export interface PushDeliveryRunner {
  run(): Promise<void>;
}

export function createPushDelivery(options: {
  db: Database;
  now: () => Date;
  logger: WorkerLogger;
  transport: Partial<PushTransport>;
}): PushDeliveryRunner {
  const { db, now, logger } = options;
  const url = (options.transport.url ?? DEFAULT_EXPO_PUSH_URL).replace(/\/+$/u, "");
  const send = options.transport.fetch ?? fetch;
  const receipts: PendingReceipt[] = [];
  const deviceRetryAt = new Map<string, number>();
  let retryAt = 0;

  const post = async (path: string, body: unknown): Promise<unknown> => {
    const response = await send(`${url}/${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PUSH_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`expo push responded ${response.status}`);
    const parsed: unknown = await response.json();
    return parsed;
  };

  const invalidate = (deviceId: string, token: string): void => {
    if (forgetInvalidPushAddress(db, deviceId, token)) {
      logger.warn("push.address_invalid");
    }
  };

  const apply = (push: PlannedPush, at: Date): void => {
    const { device, effect } = push;
    switch (effect.kind) {
      case "sent":
        recordPushSent(db, device.id, effect.eventIds, effect.bundleId, at);
        return;
      case "reminded":
        recordPushReminded(db, device.id, [effect.eventId], at);
        return;
      case "cleared":
        recordPushCleared(db, device.id, effect.eventIds, at);
        return;
    }
  };

  const sendBatch = async (batch: ReadonlyArray<PlannedPush>, at: Date): Promise<void> => {
    const { data: tickets } = sendResponseSchema.parse(
      await post(
        "send",
        batch.map((push) => push.message),
      ),
    );
    if (tickets.length !== batch.length) throw new Error("expo push ticket count mismatch");
    const invalid = new Set<string>();
    batch.forEach((push, index) => {
      const ticket = tickets[index];
      if (ticket === undefined || invalid.has(push.device.id)) return;
      if (ticket.status === "ok" && ticket.id !== undefined) {
        apply(push, at);
        if (receipts.length < MAX_PENDING_RECEIPTS) {
          receipts.push({
            id: ticket.id,
            deviceId: push.device.id,
            token: push.device.token,
            sentAt: at.getTime(),
          });
        }
        return;
      }
      if (ticket.details?.error === "DeviceNotRegistered") {
        invalid.add(push.device.id);
        invalidate(push.device.id, push.device.token);
        return;
      }
      deviceRetryAt.set(push.device.id, at.getTime() + PUSH_FAILURE_BACKOFF_MS);
      logger.warn("push.ticket_failed", { error: ticket.details?.error ?? "unknown" });
    });
  };

  const checkReceipts = async (at: number): Promise<void> => {
    const due = receipts
      .filter((receipt) => at - receipt.sentAt >= PUSH_RECEIPT_DELAY_MS)
      .slice(0, RECEIPT_BATCH_SIZE);
    if (due.length === 0) return;
    const { data } = receiptsResponseSchema.parse(
      await post("getReceipts", { ids: due.map((receipt) => receipt.id) }),
    );
    const settled = new Set<string>();
    for (const receipt of due) {
      const result = data[receipt.id];
      if (result === undefined) {
        if (at - receipt.sentAt >= PUSH_RECEIPT_GIVE_UP_MS) settled.add(receipt.id);
        continue;
      }
      settled.add(receipt.id);
      if (result.status === "error" && result.details?.error === "DeviceNotRegistered") {
        invalidate(receipt.deviceId, receipt.token);
      }
    }
    const remaining = receipts.filter((receipt) => !settled.has(receipt.id));
    receipts.splice(0, receipts.length, ...remaining);
  };

  return {
    run: async () => {
      const at = now();
      if (at.getTime() < retryAt) return;
      try {
        reopenClearedPushes(db);
        const planned = planPushes({
          devices: listPushDevices(db).filter(
            (device) => (deviceRetryAt.get(device.id) ?? 0) <= at.getTime(),
          ),
          open: listOpenNotificationEvents(db),
          deliveries: listPushDeliveries(db),
          now: at,
        });
        for (let start = 0; start < planned.length; start += PUSH_BATCH_SIZE) {
          await sendBatch(planned.slice(start, start + PUSH_BATCH_SIZE), at);
        }
        await checkReceipts(at.getTime());
      } catch (error) {
        retryAt = at.getTime() + PUSH_FAILURE_BACKOFF_MS;
        logger.warn("push.send_failed", {
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    },
  };
}
