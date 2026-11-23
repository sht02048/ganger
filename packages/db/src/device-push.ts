import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";
import type { DeviceNotificationGroup, DeviceNotifications } from "./devices.js";
import { DEVICE_NOTIFICATION_GROUPS, getDeviceNotifications } from "./devices.js";
import type { NotificationEventKind } from "./notification-events-model.js";
import { devicePushDeliveries, devices, notificationEvents } from "./schema.js";

export function deviceGroupOfKind(kind: NotificationEventKind): DeviceNotificationGroup {
  switch (kind) {
    case "question":
      return "question";
    case "permission":
      return "permission";
    case "human-check":
      return "humanCheckRequest";
    case "failed":
    case "disconnected":
      return "failedDisconnected";
    case "runner-offline":
    case "runner-auth":
    case "runner-usage-limit":
      return "runnerIssue";
  }
}

export interface DevicePushSettings extends DeviceNotifications {
  hasPushAddress: boolean;
}

export function getDevicePushSettings(db: Database, id: string): DevicePushSettings | null {
  const notifications = getDeviceNotifications(db, id);
  if (notifications === null) return null;
  const row = db
    .select({ token: devices.expoPushToken })
    .from(devices)
    .where(eq(devices.id, id))
    .get();
  return { ...notifications, hasPushAddress: (row?.token ?? null) !== null };
}

export type SaveDevicePushResult = "saved" | "not-found" | "no-push-address";

function allowedGroups(settings: DeviceNotifications): Set<DeviceNotificationGroup> {
  if (!settings.enabled) return new Set();
  return new Set(DEVICE_NOTIFICATION_GROUPS.filter((group) => settings.groups[group]));
}

function skipOpenEvents(
  db: Database,
  deviceId: string,
  before: Set<DeviceNotificationGroup>,
  after: Set<DeviceNotificationGroup>,
): void {
  const open = db
    .select({ id: notificationEvents.id, kind: notificationEvents.kind })
    .from(notificationEvents)
    .where(isNull(notificationEvents.resolvedAt))
    .all();
  const skipped = open.filter((event) => {
    const group = deviceGroupOfKind(event.kind);
    return after.has(group) && !before.has(group);
  });
  if (skipped.length === 0) return;
  db.insert(devicePushDeliveries)
    .values(skipped.map((event) => ({ deviceId, eventId: event.id })))
    .onConflictDoNothing()
    .run();
}

export function saveDevicePushSettings(
  db: Database,
  id: string,
  input: DeviceNotifications & { expoPushToken?: string | undefined },
): SaveDevicePushResult {
  return inTransaction(db, () => {
    const current = db
      .select({ token: devices.expoPushToken })
      .from(devices)
      .where(eq(devices.id, id))
      .get();
    const previous = getDeviceNotifications(db, id);
    if (current === undefined || previous === null) return "not-found";
    const token = input.expoPushToken ?? current.token;
    if (input.enabled && token === null) return "no-push-address";
    if (input.expoPushToken !== undefined) {
      db.update(devices)
        .set({ expoPushToken: null, notificationsEnabled: false })
        .where(and(eq(devices.expoPushToken, input.expoPushToken), ne(devices.id, id)))
        .run();
    }
    const addressChanged = token !== current.token;
    const before = addressChanged ? new Set<DeviceNotificationGroup>() : allowedGroups(previous);
    db.update(devices)
      .set({
        expoPushToken: token,
        notificationsEnabled: input.enabled,
        notifyQuestion: input.groups.question,
        notifyPermission: input.groups.permission,
        notifyHumanCheckRequest: input.groups.humanCheckRequest,
        notifyFailedDisconnected: input.groups.failedDisconnected,
        notifyRunnerIssue: input.groups.runnerIssue,
      })
      .where(eq(devices.id, id))
      .run();
    skipOpenEvents(db, id, before, allowedGroups(input));
    return "saved";
  });
}

export function forgetInvalidPushAddress(db: Database, deviceId: string, token: string): boolean {
  const changed = db
    .update(devices)
    .set({ expoPushToken: null, notificationsEnabled: false })
    .where(and(eq(devices.id, deviceId), eq(devices.expoPushToken, token)))
    .returning({ id: devices.id })
    .all();
  return changed.length > 0;
}

export interface PushDevice extends DeviceNotifications {
  id: string;
  token: string;
}

export function listPushDevices(db: Database): PushDevice[] {
  return db
    .select({
      id: devices.id,
      token: devices.expoPushToken,
      enabled: devices.notificationsEnabled,
      question: devices.notifyQuestion,
      permission: devices.notifyPermission,
      humanCheckRequest: devices.notifyHumanCheckRequest,
      failedDisconnected: devices.notifyFailedDisconnected,
      runnerIssue: devices.notifyRunnerIssue,
    })
    .from(devices)
    .where(isNotNull(devices.expoPushToken))
    .all()
    .flatMap(({ id, token, enabled, ...groups }) =>
      token === null ? [] : [{ id, token, enabled, groups }],
    );
}

export interface PushDelivery {
  deviceId: string;
  eventId: number;
  firstSentAt: Date | null;
  remindedAt: Date | null;
  clearedAt: Date | null;
  bundleId: string | null;
  kind: NotificationEventKind;
  createdAt: Date;
  resolvedAt: Date | null;
}

export function listPushDeliveries(db: Database): PushDelivery[] {
  return db
    .select({
      deviceId: devicePushDeliveries.deviceId,
      eventId: devicePushDeliveries.eventId,
      firstSentAt: devicePushDeliveries.firstSentAt,
      remindedAt: devicePushDeliveries.remindedAt,
      clearedAt: devicePushDeliveries.clearedAt,
      bundleId: devicePushDeliveries.bundleId,
      kind: notificationEvents.kind,
      createdAt: notificationEvents.createdAt,
      resolvedAt: notificationEvents.resolvedAt,
    })
    .from(devicePushDeliveries)
    .innerJoin(notificationEvents, eq(devicePushDeliveries.eventId, notificationEvents.id))
    .all();
}

export function recordPushSent(
  db: Database,
  deviceId: string,
  eventIds: ReadonlyArray<number>,
  bundleId: string | null,
  now: Date,
): void {
  if (eventIds.length === 0) return;
  inTransaction(db, () => {
    for (const eventId of eventIds) {
      db.insert(devicePushDeliveries)
        .values({ deviceId, eventId, firstSentAt: now, bundleId })
        .onConflictDoUpdate({
          target: [devicePushDeliveries.deviceId, devicePushDeliveries.eventId],
          set: { bundleId },
        })
        .run();
    }
  });
}

function markDeliveries(
  db: Database,
  deviceId: string,
  eventIds: ReadonlyArray<number>,
  values: { remindedAt: Date } | { clearedAt: Date },
): void {
  if (eventIds.length === 0) return;
  db.update(devicePushDeliveries)
    .set(values)
    .where(
      and(
        eq(devicePushDeliveries.deviceId, deviceId),
        inArray(devicePushDeliveries.eventId, [...eventIds]),
      ),
    )
    .run();
}

export function recordPushReminded(
  db: Database,
  deviceId: string,
  eventIds: ReadonlyArray<number>,
  now: Date,
): void {
  markDeliveries(db, deviceId, eventIds, { remindedAt: now });
}

export function recordPushCleared(
  db: Database,
  deviceId: string,
  eventIds: ReadonlyArray<number>,
  now: Date,
): void {
  markDeliveries(db, deviceId, eventIds, { clearedAt: now });
}

export function reopenClearedPushes(db: Database): void {
  const open = db
    .select({ id: notificationEvents.id })
    .from(notificationEvents)
    .where(isNull(notificationEvents.resolvedAt));
  db.update(devicePushDeliveries)
    .set({ clearedAt: null })
    .where(
      and(isNotNull(devicePushDeliveries.clearedAt), inArray(devicePushDeliveries.eventId, open)),
    )
    .run();
}
