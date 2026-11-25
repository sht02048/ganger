import {
  PERMISSION_REQUEST_RESULTS,
  TEST_NOTIFICATION_RESULTS,
} from "@ganger/app/notifications/desktop";
import type {
  NotificationPermission,
  PermissionRequestResult,
  TestNotificationResult,
} from "@ganger/app/notifications/desktop";
import type { NativeAuthorization, NotificationPermissionPort } from "./notification-addon.js";

export const SYSTEM_NOTIFICATION_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.Notifications-Settings.extension";
export const FOCUS_SETTINGS_URL = "x-apple.systempreferences:com.apple.Focus-Settings.extension";
export const TEST_NOTIFICATION_TIMEOUT_MS = 5_000;

export { PERMISSION_REQUEST_RESULTS, TEST_NOTIFICATION_RESULTS };
export type { PermissionRequestResult, TestNotificationResult };

export function permissionFromNative(status: NativeAuthorization): NotificationPermission {
  switch (status) {
    case "authorized":
    case "provisional":
      return "allowed";
    case "denied":
      return "denied";
    case "not-determined":
      return "not-asked";
    case "unknown":
      return "unknown";
  }
}

export function buildSigned(
  port: NotificationPermissionPort | null,
  packaged: boolean,
): boolean | null {
  if (port !== null) return port.teamSigned();
  return packaged ? null : false;
}

export function shouldRequestOnEnable(
  wasEnabled: boolean,
  nowEnabled: boolean,
  permission: NotificationPermission,
): boolean {
  return !wasEnabled && nowEnabled && permission === "not-asked";
}

export function notificationCenterReady(
  access: Pick<NotificationAccess, "mayUseNotificationCenter">,
  isSupported: () => boolean,
): boolean {
  return access.mayUseNotificationCenter() && isSupported();
}

export interface NotificationAccessOptions {
  port: NotificationPermissionPort | null;
  signed: boolean | null;
  onChange: (permission: NotificationPermission) => void;
}

export class NotificationAccess {
  private readonly options: NotificationAccessOptions;
  private current: NotificationPermission = "unknown";
  private read = false;

  constructor(options: NotificationAccessOptions) {
    this.options = options;
  }

  get permission(): NotificationPermission {
    return this.current;
  }

  mayUseNotificationCenter(): boolean {
    if (this.options.port === null) return true;
    if (!this.read) return false;
    return this.current !== "not-asked";
  }

  async refresh(): Promise<NotificationPermission> {
    const port = this.options.port;
    if (port === null) return this.current;
    const status = await port.status();
    this.read = true;
    this.set(permissionFromNative(status));
    return this.current;
  }

  async request(): Promise<PermissionRequestResult> {
    const port = this.options.port;
    if (port === null) return this.options.signed === false ? "unsigned" : "not-allowed";
    const result = await port.request();
    const permission = await this.refresh();
    if (permission === "allowed") return "allowed";
    if (result === "error" && this.options.signed === false) return "unsigned";
    return "not-allowed";
  }

  observe(outcome: "shown" | "failed"): void {
    if (this.options.port !== null) {
      void this.refresh();
      return;
    }
    if (outcome === "shown") this.set("allowed");
  }

  async sendTest(
    show: (handlers: { onShow: () => void; onFailed: () => void }) => void,
    timeoutMs: number = TEST_NOTIFICATION_TIMEOUT_MS,
  ): Promise<TestNotificationResult> {
    const outcome = await new Promise<"shown" | "failed" | "timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), timeoutMs);
      const settle = (value: "shown" | "failed") => {
        clearTimeout(timer);
        resolve(value);
      };
      try {
        show({ onShow: () => settle("shown"), onFailed: () => settle("failed") });
      } catch {
        settle("failed");
      }
    });
    if (outcome !== "failed") {
      if (outcome === "shown") this.observe("shown");
      return "sent";
    }
    if (this.options.signed === false) return "unsigned";
    const permission = await this.refresh();
    return permission === "denied" ? "denied" : "failed";
  }

  private set(permission: NotificationPermission): void {
    if (this.current === permission) return;
    this.current = permission;
    this.options.onChange(permission);
  }
}
