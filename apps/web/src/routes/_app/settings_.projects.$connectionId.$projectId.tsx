import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createTranslator } from "use-intl";
import type { SettingsPage } from "@ganger/app/settings/model";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { loadCachedRouteQuery, loadRouteQuery } from "../../query/route-query";
import { settingsMessages } from "../../settings/messages";
import { ProjectDetailScreen, findBoundProject } from "../../settings/project-detail";
import type { ProjectDetailActions } from "../../settings/settings-screen";
import { NavigationGuard } from "../../settings/navigation-guard";
import {
  boundProjectReadsQuery,
  settingsQuery,
  trackerProjectsQuery,
  useSettingsPage,
} from "../../settings/settings-query";
import { useTitleFollowsQuery } from "../../settings/route-title";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";
import { ScreenError } from "../../shell/screen-error";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings_/projects/$connectionId/$projectId")({
  errorComponent: ScreenError,
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
            ? t("documentTitle")
            : t("project.documentTitle", { name: loaderData }),
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
    <ScreenMessages messages={settingsMessages}>
      <ProjectDetailScreen
        page={pageBeforeRemoval ?? page}
        connectionId={connectionId}
        projectId={projectId}
        ws={ws}
        actions={actions}
        renderLink={routerSettingsLink}
        renderGuard={(guard) => <NavigationGuard {...guard} />}
        onRemoved={() => {
          void navigate({ to: "/settings", ignoreBlocker: true });
        }}
      />
    </ScreenMessages>
  );
}
