import { DeviceConnectionCodes } from "@ganger/app/devices/connection";

let codes: DeviceConnectionCodes | undefined;

export function getDeviceConnectionCodes(): DeviceConnectionCodes {
  codes ??= new DeviceConnectionCodes();
  return codes;
}
