import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { recordSettingsChange } from "./change-events.js";
import type { Database } from "./database.js";
import type { DeviceKind } from "./device-kinds.js";
import { inTransaction } from "./database.js";
import { devices } from "./schema.js";

export const DEVICE_LAST_SEEN_INTERVAL_MS = 60_000;

export const DEVICE_NOTIFICATION_GROUPS = [
  "question",
  "permission",
  "humanCheckRequest",
  "failedDisconnected",
  "runnerIssue",
] as const;
export type DeviceNotificationGroup = (typeof DEVICE_NOTIFICATION_GROUPS)[number];

export interface DeviceNotifications {
  enabled: boolean;
  groups: Record<DeviceNotificationGroup, boolean>;
}

export { DEVICE_KINDS, type DeviceKind } from "./device-kinds.js";

export interface DeviceSummary {
  id: string;
  name: string;
  kind: DeviceKind;
  createdAt: Date;
  lastSeenAt: Date | null;
}

const summaryColumns = {
  id: devices.id,
  name: devices.name,
  kind: devices.kind,
  createdAt: devices.createdAt,
  lastSeenAt: devices.lastSeenAt,
};

export function addDevice(
  db: Database,
  input: { name: string; kind: DeviceKind; tokenHash: string },
  now: Date,
): DeviceSummary {
  const device: DeviceSummary = {
    id: randomUUID(),
    name: input.name,
    kind: input.kind,
    createdAt: now,
    lastSeenAt: null,
  };
  inTransaction(db, () => {
    db.insert(devices)
      .values({
        id: device.id,
        name: device.name,
        kind: device.kind,
        tokenHash: input.tokenHash,
        createdAt: now,
      })
      .run();
    recordSettingsChange(db, undefined, now);
  });
  return device;
}

export function listDevices(db: Database): DeviceSummary[] {
  return db.select(summaryColumns).from(devices).orderBy(desc(devices.createdAt)).all();
}

export function removeDevice(db: Database, id: string, now: Date): boolean {
  return inTransaction(db, () => {
    const removed = db
      .delete(devices)
      .where(eq(devices.id, id))
      .returning({ id: devices.id })
      .all();
    if (removed.length === 0) return false;
    recordSettingsChange(db, undefined, now);
    return true;
  });
}

export function replaceDeviceToken(db: Database, id: string, tokenHash: string): boolean {
  const replaced = db
    .update(devices)
    .set({ tokenHash })
    .where(eq(devices.id, id))
    .returning({ id: devices.id })
    .all();
  return replaced.length > 0;
}

export function seeDeviceByTokenHash(db: Database, tokenHash: string, now: Date): string | null {
  const device = db
    .select({ id: devices.id, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(eq(devices.tokenHash, tokenHash))
    .get();
  if (device === undefined) return null;
  const seenAt = device.lastSeenAt?.getTime() ?? null;
  if (seenAt === null || now.getTime() - seenAt >= DEVICE_LAST_SEEN_INTERVAL_MS) {
    db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id)).run();
  }
  return device.id;
}

export function getDeviceNotifications(db: Database, id: string): DeviceNotifications | null {
  const row = db
    .select({
      enabled: devices.notificationsEnabled,
      question: devices.notifyQuestion,
      permission: devices.notifyPermission,
      humanCheckRequest: devices.notifyHumanCheckRequest,
      failedDisconnected: devices.notifyFailedDisconnected,
      runnerIssue: devices.notifyRunnerIssue,
    })
    .from(devices)
    .where(eq(devices.id, id))
    .get();
  if (row === undefined) return null;
  const { enabled, ...groups } = row;
  return { enabled, groups };
}

export function saveDeviceNotifications(
  db: Database,
  id: string,
  { enabled, groups }: DeviceNotifications,
): boolean {
  const saved = db
    .update(devices)
    .set({
      notificationsEnabled: enabled,
      notifyQuestion: groups.question,
      notifyPermission: groups.permission,
      notifyHumanCheckRequest: groups.humanCheckRequest,
      notifyFailedDisconnected: groups.failedDisconnected,
      notifyRunnerIssue: groups.runnerIssue,
    })
    .where(eq(devices.id, id))
    .returning({ id: devices.id })
    .all();
  return saved.length > 0;
}
