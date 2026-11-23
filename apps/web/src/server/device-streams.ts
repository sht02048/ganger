import { DeviceStreams } from "@ganger/app/devices/streams";

let streams: DeviceStreams | undefined;

export function getDeviceStreams(): DeviceStreams {
  streams ??= new DeviceStreams();
  return streams;
}
