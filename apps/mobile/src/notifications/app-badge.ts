import type { AppDashboard } from "@ganger/api";
import { useEffect } from "react";

import type { PushDevicePort } from "./push-port";

export function todoCountOf({ summary }: AppDashboard): number {
  const { check, answer, stopped } = summary.todo;
  return check + answer + stopped;
}

export function appBadgeCount({
  pushEnabled,
  allWorkspaces,
}: {
  pushEnabled: boolean | null;
  allWorkspaces: AppDashboard | null;
}): number | null {
  if (pushEnabled === false) return 0;
  if (pushEnabled === null || allWorkspaces === null) return null;
  return todoCountOf(allWorkspaces);
}

export function useAppBadge({
  device,
  pushEnabled,
  allWorkspaces,
}: {
  device: PushDevicePort;
  pushEnabled: boolean | null;
  allWorkspaces: AppDashboard | null;
}): void {
  const count = appBadgeCount({ pushEnabled, allWorkspaces });
  useEffect(() => {
    if (count !== null) void device.setBadgeCount(count);
  }, [device, count]);
}

export function useClearedAppBadge(device: PushDevicePort, clearingScreen: string | null): void {
  useEffect(() => {
    if (clearingScreen !== null) void device.setBadgeCount(0);
  }, [device, clearingScreen]);
}
