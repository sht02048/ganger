import type { PushDevicePort } from "./push-port";

export const pushDevice: PushDevicePort = {
  supported: false,
  permission: () => Promise.resolve("denied"),
  requestPermission: () => Promise.resolve("denied"),
  pushAddress: () => Promise.resolve(null),
  subscribeResponses: () => () => undefined,
};

export function setUpPushHandling(): void {
  return undefined;
}
