import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { loadRouteQuery } from "../../query/route-query";
import { devicesQuery, useDeviceActions } from "../../settings/devices-query";
import { MobileScreen } from "../../settings/mobile-page";
import { mobileAccessQuery, useMobileActions } from "../../settings/mobile-query";
import { settingsPageHead, useSettingsNav } from "../../settings/settings-route";

export const Route = createFileRoute("/_app/settings/mobile")({
  loader: async (load) => {
    await Promise.all([
      loadRouteQuery(load, devicesQuery),
      loadRouteQuery(load, mobileAccessQuery),
    ]);
  },
  head: settingsPageHead("mobile"),
  component: MobileRoute,
});

function MobileRoute() {
  const { ws } = Route.useSearch();
  const { data: access } = useSuspenseQuery(mobileAccessQuery);
  const { data: devices } = useSuspenseQuery(devicesQuery);
  return (
    <MobileScreen
      access={access}
      devices={devices}
      deviceActions={useDeviceActions()}
      actions={useMobileActions()}
      nav={useSettingsNav("mobile", ws)}
    />
  );
}
