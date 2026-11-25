import type { PushDevicePort } from "./push-port";

export const pushDevice: PushDevicePort = {
  supported: false,
  permission: () => Promise.resolve("denied"),
  requestPermission: () => Promise.resolve("denied"),
  pushAddress: () => Promise.resolve(null),
  subscribeResponses: () => () => undefined,
  setBadgeCount: () => Promise.resolve(),
};

export function setUpPushHandling(): void {
  return undefined;
}
