export const WORKER_WAKE_ENV = "GANGER_WORKER_WAKE";
export const WORKER_WAKE_VIA_IPC = "ipc";

export interface WorkerWakeMessage {
  type: "wake";
}

export interface DeviceActivityMessage {
  type: "device-activity";
  deviceId: string;
  lastUsedAt: number;
}

export type WorkerMessage = WorkerWakeMessage | DeviceActivityMessage;

export const WORKER_WAKE_MESSAGE: WorkerWakeMessage = { type: "wake" };

export function isWorkerWakeEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[WORKER_WAKE_ENV] === WORKER_WAKE_VIA_IPC;
}
