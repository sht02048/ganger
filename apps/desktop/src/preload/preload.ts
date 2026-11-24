import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import {
  DESKTOP_NAVIGATION_GLOBAL,
  isDesktopPage,
  isNavScreen,
  navPathKeepingWorkspace,
} from "@ganger/app/shell/nav-shortcuts";
import type { DesktopPage, NavScreen } from "@ganger/app/shell/nav-shortcuts";
import { addDragHandleIfMissing } from "./drag-handle.js";
import { deliverDesktopPage } from "./page-delivery.js";
import { DESKTOP_NOTIFICATIONS_GLOBAL } from "@ganger/app/notifications/desktop";
import { DESKTOP_UPDATES_GLOBAL } from "@ganger/app/updates/view";
import { DESKTOP_LOGS_GLOBAL } from "@ganger/app/diagnostics/model";
import type { DesktopApi, ViewState } from "../shared/view.js";
import {
  IPC_PREFIX,
  LOGS_CAN_OPEN,
  LOGS_OPEN,
  NAVIGATE_CHANNEL,
  NOTIFICATION_SETTINGS_CHANNEL,
  OPEN_PAGE_CHANNEL,
  OPEN_PAGE_UNSUPPORTED,
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
}

if (window.location.protocol === "http:" || window.location.protocol === "https:") {
  window.addEventListener("DOMContentLoaded", () =>
    addDragHandleIfMissing<HTMLDivElement>(document),
  );
  const invoke = (action: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(`${IPC_PREFIX}${action}`, ...args);
  const listeners = new Set<(screen: NavScreen) => void>();
  ipcRenderer.on(NAVIGATE_CHANNEL, (_event: IpcRendererEvent, screen: unknown) => {
    if (!isNavScreen(screen)) return;
    if (listeners.size === 0) {
      window.location.assign(navPathKeepingWorkspace(screen, window.location.search));
      return;
    }
    for (const listener of listeners) listener(screen);
  });
  const pageListeners = new Set<(page: DesktopPage) => void>();
  ipcRenderer.on(OPEN_PAGE_CHANNEL, (_event: IpcRendererEvent, page: unknown) => {
    if (!isDesktopPage(page)) return;
    deliverDesktopPage(page, {
      listeners: () => pageListeners,
      unsupported: (missing) => ipcRenderer.send(OPEN_PAGE_UNSUPPORTED, missing),
      later: (run, ms) => {
        setTimeout(run, ms);
      },
    });
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
    getSettings: (): Promise<unknown> => invoke("get-notification-settings"),
    onSettings: (listener: (view: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, view: unknown) => listener(view);
      ipcRenderer.on(NOTIFICATION_SETTINGS_CHANNEL, handler);
      return () => {
        ipcRenderer.off(NOTIFICATION_SETTINGS_CHANNEL, handler);
      };
    },
    saveSettings: (prefs: unknown): Promise<unknown> => invoke("set-notification-settings", prefs),
    requestPermission: (): Promise<unknown> => invoke("request-notification-permission"),
    sendTest: (): Promise<unknown> => invoke("send-test-notification"),
    openSystemSettings: (): Promise<unknown> => invoke("open-system-notification-settings"),
    openFocusSettings: (): Promise<unknown> => invoke("open-focus-settings"),
    reconnectDevice: (): Promise<unknown> => invoke("reconnect-device"),
  });
  contextBridge.exposeInMainWorld(DESKTOP_NAVIGATION_GLOBAL, {
    onNavigate: (listener: (screen: NavScreen) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onOpenPage: (listener: (page: DesktopPage) => void) => {
      pageListeners.add(listener);
      return () => {
        pageListeners.delete(listener);
      };
    },
  });
}
