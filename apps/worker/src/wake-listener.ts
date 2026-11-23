import { isWorkerWakeEnabled } from "@ganger/core";
import { z } from "zod";

const wakeMessageSchema = z.object({ type: z.literal("wake") });
const deviceActivityMessageSchema = z.object({
  type: z.literal("device-activity"),
  deviceId: z.string().min(1),
  lastUsedAt: z.number().int().nonnegative(),
});

export interface WakeSource {
  env: Readonly<Record<string, string | undefined>>;
  connected: boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
}

export function listenForWake(source: WakeSource, wake: () => void): boolean {
  if (!isWorkerWakeEnabled(source.env) || !source.connected) return false;
  source.on("message", (message) => {
    if (wakeMessageSchema.safeParse(message).success) wake();
  });
  return true;
}

export function listenForDeviceActivity(
  source: WakeSource,
  record: (deviceId: string, lastUsedAt: number) => void,
): boolean {
  if (!isWorkerWakeEnabled(source.env) || !source.connected) return false;
  source.on("message", (message) => {
    const activity = deviceActivityMessageSchema.safeParse(message);
    if (activity.success) record(activity.data.deviceId, activity.data.lastUsedAt);
  });
  return true;
}
