import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import {
  DESKTOP_NAVIGATION_GLOBAL,
  isNavScreen,
  navPathKeepingWorkspace,
} from "@ganger/app/shell/nav-shortcuts";
import type { NavScreen } from "@ganger/app/shell/nav-shortcuts";
import { addDragHandleIfMissing } from "./drag-handle.js";
import { notificationSettingsViewSchema } from "../core/notification-prefs.js";
import {
  PERMISSION_REQUEST_RESULTS,
  TEST_NOTIFICATION_RESULTS,
} from "../core/notification-access.js";
import { DESKTOP_NOTIFICATIONS_GLOBAL } from "@ganger/app/notifications/desktop";
import { z } from "zod";
import { DESKTOP_UPDATES_GLOBAL } from "@ganger/app/updates/view";
import { DESKTOP_LOGS_GLOBAL } from "@ganger/app/diagnostics/model";
import type { DesktopApi, NotificationSettingsApi, ViewState } from "../shared/view.js";
import {
  IPC_PREFIX,
  LOGS_CAN_OPEN,
  LOGS_OPEN,
  NAVIGATE_CHANNEL,
  NOTIFICATION_SETTINGS_CHANNEL,
  NOTIFICATION_SETTINGS_OPEN,
  NOTIFICATION_SUMMARY_CHANNEL,
  NOTIFICATION_SUMMARY_GET,
  UPDATE_ACT,
  UPDATE_CHANNEL,
  UPDATE_GET,
  VIEW_CHANNEL,
} from "../shared/view.js";

if (window.location.protocol === "file:") {
  const invoke = (action: string, ...args: unknown[]): Promise<void> =>
    ipcRenderer.invoke(`${IPC_PREFIX}${action}`, ...args).then(() => undefined);

  const api: DesktopApi = {
    getView: () =>
      new Promise<ViewState>((resolve) => {
        ipcRenderer.once(VIEW_CHANNEL, (_event: IpcRendererEvent, view: ViewState) =>
          resolve(view),
        );
        ipcRenderer.send(`${IPC_PREFIX}request-view`);
      }),
    onView: (listener) => {
      const handler = (_event: IpcRendererEvent, view: ViewState) => listener(view);
      ipcRenderer.on(VIEW_CHANNEL, handler);
      return () => ipcRenderer.off(VIEW_CHANNEL, handler);
    },
    chooseLocal: (options) => invoke("choose-local", options),
    chooseRemote: () => invoke("choose-remote"),
    findServers: (port) => invoke("find-servers", port),
    connectFound: (instanceId) => invoke("connect-found", instanceId),
    showAddress: () => invoke("show-address"),
    connectAddress: (address) => invoke("connect-address", address),
    startLocal: () => invoke("start-local"),
    retry: () => invoke("retry"),
    chooseMode: () => invoke("choose-mode"),
    openLog: () => invoke("open-log"),
    acceptEnrollment: () => invoke("enrollment-accept"),
    cancelEnrollment: () => invoke("enrollment-cancel"),
    closeEnrollment: () => invoke("enrollment-close"),
    openSharing: () => invoke("open-sharing"),
  };
  contextBridge.exposeInMainWorld("desktop", api);

  const notifications: NotificationSettingsApi = {
    getNotificationSettings: () =>
      ipcRenderer
        .invoke(`${IPC_PREFIX}get-notification-settings`)
        .then((value: unknown) => notificationSettingsViewSchema.parse(value)),
    onNotificationSettings: (listener) => {
      const handler = (_event: IpcRendererEvent, value: unknown) => {
        const parsed = notificationSettingsViewSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(NOTIFICATION_SETTINGS_CHANNEL, handler);
      return () => ipcRenderer.off(NOTIFICATION_SETTINGS_CHANNEL, handler);
    },
    setNotificationSettings: (settings) => invoke("set-notification-settings", settings),
    openSystemNotificationSettings: () => invoke("open-system-notification-settings"),
    openFocusSettings: () => invoke("open-focus-settings"),
    requestPermission: () =>
      ipcRenderer
        .invoke(`${IPC_PREFIX}request-notification-permission`)
        .then((value: unknown) => z.enum(PERMISSION_REQUEST_RESULTS).parse(value)),
    sendTestNotification: () =>
      ipcRenderer
        .invoke(`${IPC_PREFIX}send-test-notification`)
        .then((value: unknown) => z.enum(TEST_NOTIFICATION_RESULTS).parse(value)),
    reconnectDevice: () => invoke("reconnect-device"),
  };
  contextBridge.exposeInMainWorld("desktopNotifications", notifications);
}

if (window.location.protocol === "http:" || window.location.protocol === "https:") {
  window.addEventListener("DOMContentLoaded", () =>
    addDragHandleIfMissing<HTMLDivElement>(document),
  );
  const listeners = new Set<(screen: NavScreen) => void>();
  ipcRenderer.on(NAVIGATE_CHANNEL, (_event: IpcRendererEvent, screen: unknown) => {
    if (!isNavScreen(screen)) return;
    if (listeners.size === 0) {
      window.location.assign(navPathKeepingWorkspace(screen, window.location.search));
      return;
    }
    for (const listener of listeners) listener(screen);
  });
  contextBridge.exposeInMainWorld(DESKTOP_UPDATES_GLOBAL, {
    getUpdate: (): Promise<unknown> => ipcRenderer.invoke(UPDATE_GET),
    onUpdate: (listener: (view: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, view: unknown) => listener(view);
      ipcRenderer.on(UPDATE_CHANNEL, handler);
      return () => {
        ipcRenderer.off(UPDATE_CHANNEL, handler);
      };
    },
    act: (action: string): Promise<void> =>
      ipcRenderer.invoke(UPDATE_ACT, action).then(() => undefined),
  });
  contextBridge.exposeInMainWorld(DESKTOP_LOGS_GLOBAL, {
    canOpenFolder: (): Promise<unknown> => ipcRenderer.invoke(LOGS_CAN_OPEN),
    openFolder: (): Promise<unknown> => ipcRenderer.invoke(LOGS_OPEN),
  });
  contextBridge.exposeInMainWorld(DESKTOP_NOTIFICATIONS_GLOBAL, {
    getSummary: (): Promise<unknown> => ipcRenderer.invoke(NOTIFICATION_SUMMARY_GET),
    onSummary: (listener: (summary: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, summary: unknown) => listener(summary);
      ipcRenderer.on(NOTIFICATION_SUMMARY_CHANNEL, handler);
      return () => {
        ipcRenderer.off(NOTIFICATION_SUMMARY_CHANNEL, handler);
      };
    },
    openSettings: (): Promise<void> =>
      ipcRenderer.invoke(NOTIFICATION_SETTINGS_OPEN).then(() => undefined),
  });
  contextBridge.exposeInMainWorld(DESKTOP_NAVIGATION_GLOBAL, {
    onNavigate: (listener: (screen: NavScreen) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}
