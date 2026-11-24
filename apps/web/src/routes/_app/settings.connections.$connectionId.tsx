import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { loadRouteQuery } from "../../query/route-query";
import { ConnectionDetailScreen, findConnection } from "../../settings/connection-detail";
import { useTitleFollowsQuery } from "../../settings/route-title";
import { routerSettingsLink } from "../../settings/settings-link";
import { settingsQuery } from "../../settings/settings-query";
import {
  renderNavigationGuard,
  settingsDocumentTitle,
  useSettingsNav,
} from "../../settings/settings-route";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";

export const Route = createFileRoute("/_app/settings/connections/$connectionId")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: async (load) => {
    const page = await loadRouteQuery(load, settingsQuery(load.deps.ws));
    return findConnection(page, load.params.connectionId)?.name ?? null;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData === undefined || loaderData === null
            ? settingsDocumentTitle()
            : settingsDocumentTitle(loaderData),
      },
    ],
  }),
  component: ConnectionDetailRoute,
});

function ConnectionDetailRoute() {
  const { connectionId } = Route.useParams();
  const { ws } = Route.useSearch();
  const { data: page } = useSuspenseQuery(settingsQuery(ws));
  const actions = useSettingsActions(useSettingsQueryRefresh());
  useTitleFollowsQuery(
    Route.id,
    Route.useLoaderData(),
    findConnection(page, connectionId)?.name ?? null,
  );
  return (
    <ConnectionDetailScreen
      page={page}
      connectionId={connectionId}
      actions={actions}
      renderLink={routerSettingsLink}
      nav={useSettingsNav("connections", ws)}
      renderGuard={renderNavigationGuard}
    />
  );
}
