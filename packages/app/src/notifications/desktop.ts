import { z } from "zod";

export const DESKTOP_NOTIFICATIONS_GLOBAL = "gangerDesktopNotifications";

export const NOTIFICATION_PERMISSIONS = ["allowed", "not-asked", "denied", "unknown"] as const;
export type NotificationPermission = (typeof NOTIFICATION_PERMISSIONS)[number];

export const NOTIFICATION_GROUPS = [
  "question",
  "permission",
  "humanCheckRequest",
  "failedDisconnected",
  "runnerIssue",
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const notificationPrefsSchema = z.object({
  enabled: z.boolean(),
  groups: z.object({
    question: z.boolean(),
    permission: z.boolean(),
    humanCheckRequest: z.boolean().default(true),
    failedDisconnected: z.boolean(),
    runnerIssue: z.boolean(),
  }),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const DEVICE_LINK_STATES = [
  "connected",
  "rejected",
  "unsupported",
  "reconnecting",
  "reconnected",
  "failed",
] as const;
export type DeviceLinkState = (typeof DEVICE_LINK_STATES)[number];

export const notificationSettingsViewSchema = notificationPrefsSchema.extend({
  permission: z.enum(NOTIFICATION_PERMISSIONS).catch("unknown"),
  deviceLink: z.enum(DEVICE_LINK_STATES).catch("connected"),
});
export type NotificationSettingsView = z.infer<typeof notificationSettingsViewSchema>;

export const TEST_NOTIFICATION_RESULTS = ["sent", "unsigned", "denied", "failed"] as const;
export type TestNotificationResult = (typeof TEST_NOTIFICATION_RESULTS)[number];

export const PERMISSION_REQUEST_RESULTS = ["allowed", "not-allowed", "unsigned"] as const;
export type PermissionRequestResult = (typeof PERMISSION_REQUEST_RESULTS)[number];
