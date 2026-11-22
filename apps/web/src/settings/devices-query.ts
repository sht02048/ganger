import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  cancelConnection,
  forgetDevice,
  getDevices,
  startConnection,
} from "../server/device-functions";
import type { DeviceActions } from "./devices-section";

export const DEVICES_KEY = ["devices"] as const;

export const devicesQuery = queryOptions({
  queryKey: DEVICES_KEY,
  queryFn: () => getDevices(),
});

export function useDeviceActions(): DeviceActions {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
    return {
      start: async (replacing) => {
        const result = await startConnection({
          data: replacing === undefined ? {} : { replacing },
        });
        if (!result.ok) await refresh();
        return result;
      },
      cancel: async (id) => {
        await cancelConnection({ data: { id } });
      },
      remove: async (id) => {
        const result = await forgetDevice({ data: { id } });
        await refresh();
        return result;
      },
    };
  }, [queryClient]);
}
