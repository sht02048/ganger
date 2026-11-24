import { z } from "zod";
import type { NotificationRecord } from "@ganger/app/notifications/feed";
import { NOTIFICATION_PERMISSIONS } from "@ganger/app/notifications/desktop";
import type {
  DesktopNotificationSummary,
  NotificationPermission,
} from "@ganger/app/notifications/desktop";

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

export { NOTIFICATION_PERMISSIONS };
export type { NotificationPermission };

export const DEVICE_LINK_STATES = [
  "connected",
  "rejected",
  "reconnecting",
  "reconnected",
  "failed",
] as const;
export type DeviceLinkState = (typeof DEVICE_LINK_STATES)[number];

export const notificationSettingsViewSchema = notificationPrefsSchema.extend({
  permission: z.enum(NOTIFICATION_PERMISSIONS),
  deviceLink: z.enum(DEVICE_LINK_STATES),
});
export type NotificationSettingsView = z.infer<typeof notificationSettingsViewSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  groups: {
    question: true,
    permission: true,
    humanCheckRequest: true,
    failedDisconnected: true,
    runnerIssue: true,
  },
};

export type NotificationKind = NotificationRecord["kind"];

export function groupOf(kind: NotificationKind): NotificationGroup {
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

export function isTodoKind(kind: NotificationKind): boolean {
  return groupOf(kind) !== "runnerIssue";
}

export function remindsKind(kind: NotificationKind): boolean {
  return kind === "question" || kind === "permission" || kind === "human-check";
}

export function allows(prefs: NotificationPrefs, kind: NotificationKind): boolean {
  return prefs.enabled && prefs.groups[groupOf(kind)];
}

export function notificationSummary(
  prefs: NotificationPrefs,
  permission: NotificationPermission,
): DesktopNotificationSummary {
  return {
    permission,
    enabled: prefs.enabled,
    groupsOn: NOTIFICATION_GROUPS.filter((group) => prefs.groups[group]).length,
    groupsTotal: NOTIFICATION_GROUPS.length,
  };
}
