import { createServerFn } from "@tanstack/react-start";
import {
  deviceIdInput,
  loadDevicesView,
  removeDeviceById,
  startConnectionInput,
  startDeviceConnection,
} from "@ganger/app/devices/connection";
import { getInstallSettings } from "@ganger/db";
import { getDatabase } from "./database";
import { getDeviceConnectionCodes } from "./device-connection-codes";
import { getDeviceStreams } from "./device-streams";

export const getDevices = createServerFn({ method: "GET" }).handler(() => {
  const db = getDatabase();
  return loadDevicesView(db, getInstallSettings(db).webAddress, new Date());
});

export const startConnection = createServerFn({ method: "POST" })
  .validator(startConnectionInput)
  .handler(({ data }) =>
    startDeviceConnection({
      codes: getDeviceConnectionCodes(),
      webAddress: getInstallSettings(getDatabase()).webAddress,
      replacing: data.replacing,
    }),
  );

export const cancelConnection = createServerFn({ method: "POST" })
  .validator(deviceIdInput)
  .handler(({ data }) => {
    getDeviceConnectionCodes().revoke(data.id);
    return { ok: true };
  });

export const forgetDevice = createServerFn({ method: "POST" })
  .validator(deviceIdInput)
  .handler(({ data }) =>
    removeDeviceById({ db: getDatabase(), streams: getDeviceStreams() }, data.id, new Date()),
  );
