import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { SettingsPage } from "@ganger/app/settings/model";
import { loadCachedRouteQuery, loadRouteQuery } from "../../query/route-query";
import { ProjectDetailScreen, findBoundProject } from "../../settings/project-detail";
import { useTitleFollowsQuery } from "../../settings/route-title";
import { routerSettingsLink } from "../../settings/settings-link";
import {
  boundProjectReadsQuery,
  settingsQuery,
  trackerProjectsQuery,
  useSettingsPage,
} from "../../settings/settings-query";
import {
  renderNavigationGuard,
  settingsDocumentTitle,
  useSettingsNav,
} from "../../settings/settings-route";
import type { ProjectDetailActions } from "../../settings/settings-screen";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";

export const Route = createFileRoute("/_app/settings/projects/$connectionId/$projectId")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: async (load) => {
    const [page] = await Promise.all([
      loadRouteQuery(load, settingsQuery(load.deps.ws)),
      loadCachedRouteQuery(load, trackerProjectsQuery),
      loadCachedRouteQuery(load, boundProjectReadsQuery(load.context.queryClient, load.deps.ws)),
    ]);
    return (
      findBoundProject(page.workspace, load.params.connectionId, load.params.projectId)?.project
        .name ?? null
    );
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
  component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
  const { connectionId, projectId } = Route.useParams();
  const { ws } = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = useSettingsPage(ws);
  const [pageBeforeRemoval, setPageBeforeRemoval] = useState<SettingsPage | null>(null);
  const settingsActions = useSettingsActions(useSettingsQueryRefresh());
  const nav = useSettingsNav("projects", ws);
  useTitleFollowsQuery(
    Route.id,
    Route.useLoaderData(),
    findBoundProject((pageBeforeRemoval ?? page).workspace, connectionId, projectId)?.project
      .name ?? null,
  );
  const actions = useMemo(
    (): ProjectDetailActions => ({
      ...settingsActions,
      removeProject: async (data) => {
        setPageBeforeRemoval(page);
        const result = await settingsActions.removeProject(data).catch((error: unknown) => {
          setPageBeforeRemoval(null);
          throw error;
        });
        if (!result.ok) setPageBeforeRemoval(null);
        return result;
      },
    }),
    [settingsActions, page],
  );
  return (
    <ProjectDetailScreen
      page={pageBeforeRemoval ?? page}
      connectionId={connectionId}
      projectId={projectId}
      actions={actions}
      renderLink={routerSettingsLink}
      nav={nav}
      renderGuard={renderNavigationGuard}
      onRemoved={() => {
        void navigate({ to: "/settings/projects", ignoreBlocker: true });
      }}
    />
  );
}
