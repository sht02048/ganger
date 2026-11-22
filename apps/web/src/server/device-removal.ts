import { removeDeviceById } from "@ganger/app/devices/connection";
import { getDatabase } from "./database";
import { getDeviceStreams } from "./device-streams";

export function removeDeviceAndCloseStreams(id: string): { ok: boolean } {
  return removeDeviceById({ db: getDatabase(), streams: getDeviceStreams() }, id, new Date());
}
