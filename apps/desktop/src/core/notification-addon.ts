import { join } from "node:path";
import { z } from "zod";

export const NOTIFICATION_ADDON_FILE = "notification-permission.node";

export const NATIVE_AUTHORIZATIONS = [
  "authorized",
  "provisional",
  "denied",
  "not-determined",
  "unknown",
] as const;
export type NativeAuthorization = (typeof NATIVE_AUTHORIZATIONS)[number];

export const NATIVE_REQUEST_RESULTS = ["granted", "refused", "error", "unknown"] as const;
export type NativeRequestResult = (typeof NATIVE_REQUEST_RESULTS)[number];

export interface NotificationPermissionPort {
  status(): Promise<NativeAuthorization>;
  request(): Promise<NativeRequestResult>;
  teamSigned(): boolean;
  bundleId(): string | null;
}

const callable = z.custom<(...args: never[]) => unknown>((value) => typeof value === "function");

const addonSchema = z.object({
  status: callable,
  request: callable,
  teamSigned: callable,
  bundleId: callable,
});

const authorizationSchema = z.enum(NATIVE_AUTHORIZATIONS).catch("unknown");
const requestResultSchema = z.enum(NATIVE_REQUEST_RESULTS).catch("unknown");

export function notificationAddonPort(load: () => unknown): NotificationPermissionPort | null {
  let loaded: unknown;
  try {
    loaded = load();
  } catch {
    return null;
  }
  const parsed = addonSchema.safeParse(loaded);
  if (!parsed.success) return null;
  const addon = parsed.data;
  return {
    status: () =>
      Promise.resolve()
        .then(() => addon.status())
        .then(
          (value) => authorizationSchema.parse(value),
          (): NativeAuthorization => "unknown",
        ),
    request: () =>
      Promise.resolve()
        .then(() => addon.request())
        .then(
          (value) => requestResultSchema.parse(value),
          (): NativeRequestResult => "error",
        ),
    teamSigned: () => {
      try {
        return addon.teamSigned() === true;
      } catch {
        return false;
      }
    },
    bundleId: () => {
      try {
        const value = addon.bundleId();
        return typeof value === "string" && value.length > 0 ? value : null;
      } catch {
        return null;
      }
    },
  };
}

export function notificationAddonPath(paths: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  return paths.packaged
    ? join(paths.resourcesPath, NOTIFICATION_ADDON_FILE)
    : join(paths.appPath, "dist", "native", NOTIFICATION_ADDON_FILE);
}
