import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { loadRouteQuery } from "../../query/route-query";
import { logSettingsQuery, useLogActions } from "../../settings/log-query";
import { ServerScreen } from "../../settings/server-page";
import { settingsQuery } from "../../settings/settings-query";
import {
  renderNavigationGuard,
  settingsPageHead,
  useSettingsNav,
} from "../../settings/settings-route";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";

export const Route = createFileRoute("/_app/settings/server")({
  loader: async (load) => {
    await loadRouteQuery(load, logSettingsQuery);
  },
  head: settingsPageHead("server"),
  component: ServerRoute,
});

function ServerRoute() {
  const { ws } = Route.useSearch();
  const { data: page } = useSuspenseQuery(settingsQuery(ws));
  const { data: logs } = useSuspenseQuery(logSettingsQuery);
  return (
    <ServerScreen
      page={page}
      logs={logs}
      logActions={useLogActions()}
      actions={useSettingsActions(useSettingsQueryRefresh())}
      nav={useSettingsNav("server", ws)}
      renderGuard={renderNavigationGuard}
    />
  );
}
