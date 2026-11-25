import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getMobileAccess, turnOffMobile, turnOnMobile } from "../server/mobile-functions";
import { DEVICES_KEY } from "./devices-query";
import type { MobileActions } from "./mobile-page";

export const MOBILE_ACCESS_KEY = [...DEVICES_KEY, "mobile-access"] as const;

export const mobileAccessQuery = queryOptions({
  queryKey: MOBILE_ACCESS_KEY,
  queryFn: () => getMobileAccess(),
});

export function useMobileActions(): MobileActions {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const refresh = async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
      ]);
    };
    return {
      turnOn: async () => {
        const result = await turnOnMobile();
        await refresh();
        return result;
      },
      turnOff: async () => {
        const result = await turnOffMobile();
        await refresh();
        return result;
      },
      recheck: async () => {
        await queryClient.refetchQueries({ queryKey: MOBILE_ACCESS_KEY }, { throwOnError: true });
        return queryClient.getQueryData(MOBILE_ACCESS_KEY) ?? null;
      },
    };
  }, [queryClient]);
}
