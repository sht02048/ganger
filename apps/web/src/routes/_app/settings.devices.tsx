import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { loadRouteQuery } from "../../query/route-query";
import { DevicesScreen } from "../../settings/devices-page";
import { devicesQuery, useDeviceActions } from "../../settings/devices-query";
import { settingsQuery } from "../../settings/settings-query";
import {
  renderNavigationGuard,
  settingsPageHead,
  useSettingsNav,
} from "../../settings/settings-route";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";

export const Route = createFileRoute("/_app/settings/devices")({
  loader: async (load) => {
    await loadRouteQuery(load, devicesQuery);
  },
  head: settingsPageHead("devices"),
  component: DevicesRoute,
});

function DevicesRoute() {
  const { ws } = Route.useSearch();
  const { data: page } = useSuspenseQuery(settingsQuery(ws));
  const { data: devices } = useSuspenseQuery(devicesQuery);
  return (
    <DevicesScreen
      page={page}
      devices={devices}
      deviceActions={useDeviceActions()}
      actions={useSettingsActions(useSettingsQueryRefresh())}
      nav={useSettingsNav("devices", ws)}
      renderGuard={renderNavigationGuard}
    />
  );
}
