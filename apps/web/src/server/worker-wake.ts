import { WORKER_WAKE_MESSAGE, isWorkerWakeEnabled } from "@ganger/core";
import type { DeviceActivityMessage, WorkerMessage } from "@ganger/core";

export interface WakeChannel {
  env: Readonly<Record<string, string | undefined>>;
  connected: boolean;
  send?: (message: WorkerMessage, callback: (error: Error | null) => void) => boolean;
}

const ignoreSendFailure = (): void => undefined;

function sendToWorker(channel: WakeChannel, message: WorkerMessage): void {
  if (!isWorkerWakeEnabled(channel.env) || !channel.connected) return;
  channel.send?.(message, ignoreSendFailure);
}

export function wakeWorkerVia(channel: WakeChannel): void {
  sendToWorker(channel, WORKER_WAKE_MESSAGE);
}

export function wakeWorker(): void {
  wakeWorkerVia(process);
}

export function sendDeviceActivityVia(
  channel: WakeChannel,
  activity: Omit<DeviceActivityMessage, "type">,
): void {
  sendToWorker(channel, { type: "device-activity", ...activity });
}

export function sendDeviceActivity(activity: Omit<DeviceActivityMessage, "type">): void {
  sendDeviceActivityVia(process, activity);
}
