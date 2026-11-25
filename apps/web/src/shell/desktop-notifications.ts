import { useEffect, useState } from "react";
import { z } from "zod";
import {
  DESKTOP_NOTIFICATIONS_GLOBAL,
  PERMISSION_REQUEST_RESULTS,
  TEST_NOTIFICATION_RESULTS,
  notificationSettingsViewSchema,
} from "@ganger/app/notifications/desktop";
import type {
  NotificationPrefs,
  NotificationSettingsView,
  PermissionRequestResult,
  TestNotificationResult,
} from "@ganger/app/notifications/desktop";

export interface DesktopNotifications {
  current(): Promise<NotificationSettingsView | null>;
  subscribe(listener: (view: NotificationSettingsView) => void): () => void;
  save(prefs: NotificationPrefs): Promise<void>;
  requestPermission(): Promise<PermissionRequestResult>;
  sendTest(): Promise<TestNotificationResult>;
  openSystemSettings(): void;
  openFocusSettings(): void;
  reconnectDevice(): void;
}

const callable = z.custom<(...args: never[]) => unknown>((value) => typeof value === "function");

const bridgeSchema = z.object({
  getSettings: z.custom<() => unknown>((value) => typeof value === "function"),
  onSettings: z.custom<(listener: (view: unknown) => void) => unknown>(
    (value) => typeof value === "function",
  ),
  saveSettings: z.custom<(prefs: NotificationPrefs) => unknown>(
    (value) => typeof value === "function",
  ),
  requestPermission: callable,
  sendTest: callable,
  openSystemSettings: callable,
  openFocusSettings: callable,
  reconnectDevice: callable,
});

const permissionRequestResultSchema = z.enum(PERMISSION_REQUEST_RESULTS);
const testNotificationResultSchema = z.enum(TEST_NOTIFICATION_RESULTS);

function parseView(value: unknown): NotificationSettingsView | null {
  const parsed = notificationSettingsViewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function fireAndForget(run: () => unknown): void {
  void Promise.resolve()
    .then(run)
    .catch(() => undefined);
}

export function desktopNotifications(scope: object = globalThis): DesktopNotifications | null {
  const parsed = bridgeSchema.safeParse(Reflect.get(scope, DESKTOP_NOTIFICATIONS_GLOBAL));
  if (!parsed.success) return null;
  const bridge = parsed.data;
  return {
    current: () =>
      Promise.resolve()
        .then(() => bridge.getSettings())
        .then(parseView, () => null),
    subscribe(listener) {
      const off = callable.safeParse(
        bridge.onSettings((value) => {
          const view = parseView(value);
          if (view !== null) listener(view);
        }),
      );
      return () => {
        if (off.success) off.data();
      };
    },
    save: (prefs) =>
      Promise.resolve()
        .then(() => bridge.saveSettings(prefs))
        .then(() => undefined),
    requestPermission: () =>
      Promise.resolve()
        .then(() => bridge.requestPermission())
        .then((value) => permissionRequestResultSchema.parse(value)),
    sendTest: () =>
      Promise.resolve()
        .then(() => bridge.sendTest())
        .then((value) => testNotificationResultSchema.parse(value)),
    openSystemSettings: () => fireAndForget(() => bridge.openSystemSettings()),
    openFocusSettings: () => fireAndForget(() => bridge.openFocusSettings()),
    reconnectDevice: () => fireAndForget(() => bridge.reconnectDevice()),
  };
}

export type DesktopAppState = "unknown" | "browser" | "desktop";

export function useDesktopApp(): DesktopAppState {
  const [state, setState] = useState<DesktopAppState>("unknown");
  useEffect(() => {
    setState(desktopNotifications() === null ? "browser" : "desktop");
  }, []);
  return state;
}
