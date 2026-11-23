import type { DeviceConnectionCodes } from "@ganger/app/devices/connection";

declare global {
  var __gangerTestDeviceCodes: DeviceConnectionCodes | undefined;
}

export function getDeviceConnectionCodes(): DeviceConnectionCodes {
  const codes = globalThis.__gangerTestDeviceCodes;
  if (codes === undefined) throw new Error("test device codes are not set");
  return codes;
}
