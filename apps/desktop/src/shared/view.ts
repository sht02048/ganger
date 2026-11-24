import type {
  NotificationPermission,
  NotificationPrefs,
  NotificationSettingsView,
} from "../core/notification-prefs.js";

import type {
  PermissionRequestResult,
  TestNotificationResult,
} from "../core/notification-access.js";
import type { EnrollmentPhase } from "./enrollment.js";

export type {
  NotificationPermission,
  NotificationPrefs,
  NotificationSettingsView,
  PermissionRequestResult,
  TestNotificationResult,
};

export type ConnectError = "invalid" | "unreachable" | "not-ours" | "host-not-allowed";

export interface FoundServerView {
  instanceId: string;
  name: string;
  url: string;
  version: string;
  versionDiffers: boolean;
  webAccess: "allowed" | "host-not-allowed";
}

export type FindResult =
  | { kind: "missing" | "stopped" | "unreadable" }
  | { kind: "found"; servers: FoundServerView[] };

export type ViewState =
  | { screen: "choose-mode" }
  | { screen: "local-starting" }
  | { screen: "local-updating"; from: string | null; to: string | null }
  | { screen: "local-stopped" }
  | { screen: "local-failed"; logFile: string }
  | { screen: "local-service" }
  | { screen: "find-servers"; port: number; searching: boolean; result: FindResult | null }
  | { screen: "enter-address"; checking: boolean; error: ConnectError | null }
  | { screen: "unreachable"; name: string; url: string; checking: boolean }
  | { screen: "host-blocked"; host: string; url: string; checking: boolean }
  | { screen: "runner-enrollment"; server: string; enrollment: EnrollmentPhase };

export interface DesktopApi {
  getView(): Promise<ViewState>;
  onView(listener: (view: ViewState) => void): () => void;
  chooseLocal(options: { openAtLogin: boolean }): Promise<void>;
  chooseRemote(): Promise<void>;
  findServers(port: number): Promise<void>;
  connectFound(instanceId: string): Promise<void>;
  showAddress(): Promise<void>;
  connectAddress(address: string): Promise<void>;
  startLocal(): Promise<void>;
  retry(): Promise<void>;
  chooseMode(): Promise<void>;
  openLog(): Promise<void>;
  acceptEnrollment(): Promise<void>;
  cancelEnrollment(): Promise<void>;
  closeEnrollment(): Promise<void>;
  openSharing(): Promise<void>;
}

export const IPC_PREFIX = "desktop:";
export const VIEW_CHANNEL = "desktop:view";
export const NAVIGATE_CHANNEL = "desktop:navigate";
export const NOTIFICATION_SETTINGS_CHANNEL = "desktop:notification-settings";
export const OPEN_PAGE_CHANNEL = "desktop:open-page";
export const UPDATE_CHANNEL = "desktop:update";
export const UPDATE_GET = "desktop:update-get";
export const UPDATE_ACT = "desktop:update-act";
export const LOGS_CAN_OPEN = "desktop:logs-can-open";
export const LOGS_OPEN = "desktop:logs-open";
