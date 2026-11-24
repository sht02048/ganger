import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { loadRouteQuery } from "../../query/route-query";
import { ConnectionsScreen } from "../../settings/connections-page";
import { routerSettingsLink } from "../../settings/settings-link";
import { githubAuthQuery, settingsQuery, webhookSetupQuery } from "../../settings/settings-query";
import {
  renderNavigationGuard,
  settingsPageHead,
  useSettingsNav,
} from "../../settings/settings-route";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";

export const Route = createFileRoute("/_app/settings/connections/")({
  loader: async (load) => {
    await loadRouteQuery(load, webhookSetupQuery);
  },
  head: settingsPageHead("connections"),
  component: ConnectionsRoute,
});

function ConnectionsRoute() {
  const { ws } = Route.useSearch();
  const { data: page } = useSuspenseQuery(settingsQuery(ws));
  const { data: setup } = useSuspenseQuery(webhookSetupQuery);
  const { data: github } = useQuery(githubAuthQuery);
  return (
    <ConnectionsScreen
      page={page}
      setup={setup}
      github={github}
      actions={useSettingsActions(useSettingsQueryRefresh())}
      renderLink={routerSettingsLink}
      nav={useSettingsNav("connections", ws)}
      renderGuard={renderNavigationGuard}
    />
  );
}
