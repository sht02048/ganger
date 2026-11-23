import { saveDeviceNotificationsRequestSchema } from "@ganger/api";
import type { V1DeviceNotifications, V1ErrorReason } from "@ganger/api";
import { getDevicePushSettings, saveDevicePushSettings } from "@ganger/db";
import type { Database } from "@ganger/db";

export function loadV1DeviceNotifications(
  db: Database,
  deviceId: string,
): V1DeviceNotifications | null {
  return getDevicePushSettings(db, deviceId);
}

export type SaveV1DeviceNotificationsReply =
  | { status: 200; settings: V1DeviceNotifications }
  | { status: 400 | 401; reason: V1ErrorReason };

export function saveV1DeviceNotifications(
  db: Database,
  deviceId: string,
  body: unknown,
): SaveV1DeviceNotificationsReply {
  const request = saveDeviceNotificationsRequestSchema.safeParse(body);
  if (!request.success) return { status: 400, reason: "invalid-request" };
  const { enabled, groups, expoPushToken } = request.data;
  const saved = saveDevicePushSettings(db, deviceId, { enabled, groups, expoPushToken });
  if (saved === "no-push-address") return { status: 400, reason: "invalid-request" };
  const settings = saved === "saved" ? getDevicePushSettings(db, deviceId) : null;
  return settings === null ? { status: 401, reason: "invalid-token" } : { status: 200, settings };
}
