import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ScreenMessages } from "../../i18n";
import { loadCachedRouteQuery, loadRouteQuery } from "../../query/route-query";
import { settingsMessages } from "../../settings/messages";
import {
  boundProjectReadsQuery,
  githubAuthQuery,
  settingsQuery,
  trackerProjectsQuery,
} from "../../settings/settings-query";
import { settingsDocumentTitle } from "../../settings/settings-route";
import { ScreenError } from "../../shell/screen-error";

export const Route = createFileRoute("/_app/settings")({
  errorComponent: ScreenError,
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: async (load) => {
    await Promise.all([
      loadRouteQuery(load, settingsQuery(load.deps.ws)),
      loadCachedRouteQuery(load, trackerProjectsQuery),
      loadCachedRouteQuery(load, githubAuthQuery),
      loadCachedRouteQuery(load, boundProjectReadsQuery(load.context.queryClient, load.deps.ws)),
    ]);
  },
  head: () => ({ meta: [{ title: settingsDocumentTitle() }] }),
  component: SettingsLayoutRoute,
});

function SettingsLayoutRoute() {
  return (
    <ScreenMessages messages={settingsMessages}>
      <Outlet />
    </ScreenMessages>
  );
}
