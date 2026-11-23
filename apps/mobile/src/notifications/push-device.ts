import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { z } from "zod";

import { t } from "../i18n";
import {
  HUMAN_CHECK_CATEGORY,
  OPEN_SHEET_ACTION,
  QUESTION_CATEGORY,
  notificationsToDismiss,
  parseBackgroundPush,
} from "./push-data";
import type { PushDevicePort, PushPermission } from "./push-port";

const CLEAR_TASK = "ganger.clear-notifications";

const easConfigSchema = z.object({ eas: z.object({ projectId: z.string().min(1) }) });

function projectId(): string | null {
  const parsed = easConfigSchema.safeParse(Constants.expoConfig?.extra);
  return parsed.success ? parsed.data.eas.projectId : null;
}

function permissionOf(status: Notifications.PermissionStatus): PushPermission {
  if (status === Notifications.PermissionStatus.GRANTED) return "granted";
  return status === Notifications.PermissionStatus.DENIED ? "denied" : "undetermined";
}

async function dismiss(clear: ReadonlyArray<string>): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const identifiers = notificationsToDismiss(
    presented.map(({ request }) => ({
      identifier: request.identifier,
      data: request.content.data,
    })),
    clear,
  );
  await Promise.all(identifiers.map((id) => Notifications.dismissNotificationAsync(id)));
}

export function setUpPushHandling(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
  });
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(CLEAR_TASK, async ({ data }) => {
    const push = parseBackgroundPush(data);
    if (push !== null && "clear" in push) await dismiss(push.clear);
  });
  void Notifications.registerTaskAsync(CLEAR_TASK).catch(() => undefined);
  void Notifications.setNotificationCategoryAsync(QUESTION_CATEGORY, [
    {
      identifier: OPEN_SHEET_ACTION,
      buttonTitle: t("notifications.answerAction"),
      options: { opensAppToForeground: true },
    },
  ]).catch(() => undefined);
  void Notifications.setNotificationCategoryAsync(HUMAN_CHECK_CATEGORY, [
    {
      identifier: OPEN_SHEET_ACTION,
      buttonTitle: t("notifications.humanCheckAction"),
      options: { opensAppToForeground: true },
    },
  ]).catch(() => undefined);
}

export const pushDevice: PushDevicePort = {
  supported: true,
  permission: async () => permissionOf((await Notifications.getPermissionsAsync()).status),
  requestPermission: async () =>
    permissionOf((await Notifications.requestPermissionsAsync()).status),
  pushAddress: async () => {
    const id = projectId();
    if (id === null) return null;
    try {
      return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    } catch {
      return null;
    }
  },
  subscribeResponses: (handler) => {
    const deliver = (response: Notifications.NotificationResponse) => {
      handler({
        data: response.notification.request.content.data,
        actionIdentifier: response.actionIdentifier,
      });
      Notifications.clearLastNotificationResponse();
    };
    const last = Notifications.getLastNotificationResponse();
    if (last !== null) deliver(last);
    const subscription = Notifications.addNotificationResponseReceivedListener(deliver);
    return () => subscription.remove();
  },
};
