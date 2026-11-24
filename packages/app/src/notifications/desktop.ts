import { z } from "zod";

export const DESKTOP_NOTIFICATIONS_GLOBAL = "gangerDesktopNotifications";

export const NOTIFICATION_PERMISSIONS = ["allowed", "not-asked", "denied", "unknown"] as const;
export type NotificationPermission = (typeof NOTIFICATION_PERMISSIONS)[number];

export const desktopNotificationSummarySchema = z.object({
  permission: z.enum(NOTIFICATION_PERMISSIONS).catch("unknown"),
  enabled: z.boolean(),
  groupsOn: z.number().int().nonnegative(),
  groupsTotal: z.number().int().positive(),
});
export type DesktopNotificationSummary = z.infer<typeof desktopNotificationSummarySchema>;
