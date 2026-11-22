import { DeviceStreams } from "@ganger/app/devices/streams";

declare global {
  var __gangerTestDeviceStreams: DeviceStreams | undefined;
}

export function getDeviceStreams(): DeviceStreams {
  globalThis.__gangerTestDeviceStreams ??= new DeviceStreams();
  return globalThis.__gangerTestDeviceStreams;
}
