import { z } from "zod";
import { v1ResponseSchema } from "./envelope.js";

export const V1_PATHS = {
  connect: "/api/v1/devices/connect",
  thisDevice: "/api/v1/devices/me",
  thisDeviceNotifications: "/api/v1/devices/me/notifications",
  dashboard: "/api/v1/dashboard",
  runners: "/api/v1/runners",
  workspaces: "/api/v1/workspaces",
  changeStream: "/api/v1/change-events/stream",
} as const;

export const DEVICE_NAME_MAX_LENGTH = 100;
export const CONNECTION_CODE_MAX_LENGTH = 200;

const CONTROL_CHARACTER = /\p{Cc}/u;

export const deviceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DEVICE_NAME_MAX_LENGTH)
  .refine((name) => !CONTROL_CHARACTER.test(name));

export const connectRequestSchema = z.object({
  code: z.string().min(1).max(CONNECTION_CODE_MAX_LENGTH),
  name: deviceNameSchema,
});
export type ConnectRequest = z.infer<typeof connectRequestSchema>;

export const V1_DESKTOP_REGISTER_PATH = "/api/v1/devices/register";

export const registerDesktopRequestSchema = z.object({
  name: deviceNameSchema,
  requestId: z.string().min(16).max(64),
});
export type RegisterDesktopRequest = z.infer<typeof registerDesktopRequestSchema>;

export const connectResultSchema = z.object({
  deviceId: z.string().min(1),
  token: z.string().min(1),
});
export type ConnectResult = z.infer<typeof connectResultSchema>;
export const connectResponseSchema = v1ResponseSchema(connectResultSchema);

export const disconnectResponseSchema = v1ResponseSchema(
  z.object({ disconnected: z.literal(true) }),
);

export const deviceNotificationGroupsSchema = z.object({
  question: z.boolean(),
  permission: z.boolean(),
  humanCheckRequest: z.boolean(),
  failedDisconnected: z.boolean(),
  runnerIssue: z.boolean(),
});
export type V1DeviceNotificationGroups = z.infer<typeof deviceNotificationGroupsSchema>;

export const deviceNotificationsSchema = z.object({
  enabled: z.boolean(),
  groups: deviceNotificationGroupsSchema,
  hasPushAddress: z.boolean(),
});
export type V1DeviceNotifications = z.infer<typeof deviceNotificationsSchema>;
export const deviceNotificationsResponseSchema = v1ResponseSchema(deviceNotificationsSchema);

export const expoPushTokenSchema = z.string().regex(/^Expo(?:nent)?PushToken\[[^\]\s]{1,200}\]$/u);

export const saveDeviceNotificationsRequestSchema = z.object({
  requestId: z.string().min(16).max(64),
  enabled: z.boolean(),
  groups: deviceNotificationGroupsSchema,
  expoPushToken: expoPushTokenSchema.optional(),
});
export type V1SaveDeviceNotifications = z.infer<typeof saveDeviceNotificationsRequestSchema>;

const CONNECTION_QR_PREFIX = "ganger://connect";

export interface ConnectionQr {
  server: string;
  code: string;
}

const HTTPS_ADDRESS = /^https:\/\/[^\s/?#@\\]+(?:[/?#]\S*)?$/iu;

export function connectionQrText({ server, code }: ConnectionQr): string {
  return `${CONNECTION_QR_PREFIX}?server=${encodeURIComponent(server)}&code=${encodeURIComponent(code)}`;
}

export function isConnectableAddress(address: string | null): address is string {
  return address !== null && HTTPS_ADDRESS.test(address);
}

function decodedQrFields(query: string): Map<string, string> | null {
  const fields = new Map<string, string>();
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    if (separator < 0) return null;
    const key = pair.slice(0, separator);
    if (fields.has(key)) return null;
    try {
      fields.set(key, decodeURIComponent(pair.slice(separator + 1)));
    } catch {
      return null;
    }
  }
  return fields;
}

export function parseConnectionQr(text: string): ConnectionQr | null {
  if (!text.startsWith(`${CONNECTION_QR_PREFIX}?`)) return null;
  const fields = decodedQrFields(text.slice(CONNECTION_QR_PREFIX.length + 1));
  const server = fields?.get("server") ?? null;
  const code = fields?.get("code") ?? "";
  if (!isConnectableAddress(server)) return null;
  if (code === "" || code.length > CONNECTION_CODE_MAX_LENGTH) return null;
  return { server, code };
}
