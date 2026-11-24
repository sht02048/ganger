import type { NotificationRecord } from "@ganger/app/notifications/feed";
import {
  DEVICE_LINK_STATES,
  NOTIFICATION_GROUPS,
  NOTIFICATION_PERMISSIONS,
  notificationPrefsSchema,
  notificationSettingsViewSchema,
} from "@ganger/app/notifications/desktop";
import type {
  DeviceLinkState,
  NotificationGroup,
  NotificationPermission,
  NotificationPrefs,
  NotificationSettingsView,
} from "@ganger/app/notifications/desktop";

export {
  DEVICE_LINK_STATES,
  NOTIFICATION_GROUPS,
  NOTIFICATION_PERMISSIONS,
  notificationPrefsSchema,
  notificationSettingsViewSchema,
};
export type {
  DeviceLinkState,
  NotificationGroup,
  NotificationPermission,
  NotificationPrefs,
  NotificationSettingsView,
};

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
