import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { resolveWorkspace } from "@ganger/app/shell/model";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { loadCachedRouteQuery, loadRouteQuery } from "../../query/route-query";
import { DevicesSection } from "../../settings/devices-section";
import { devicesQuery, useDeviceActions } from "../../settings/devices-query";
import { LogSection } from "../../settings/log-section";
import { logSettingsQuery, useLogActions } from "../../settings/log-query";
import { settingsMessages } from "../../settings/messages";
import { SettingsScreen } from "../../settings/settings-page";
import { NavigationGuard } from "../../settings/navigation-guard";
import {
  boundProjectReadsQuery,
  settingsQuery,
  trackerProjectsQuery,
  useSettingsPage,
} from "../../settings/settings-query";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";
import { useOpenCreateWorkspace } from "../../shell/create-workspace";
import { useShell } from "../../shell/shell-query";
import { ScreenError } from "../../shell/screen-error";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export const Route = createFileRoute("/_app/settings")({
  errorComponent: ScreenError,
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: async (load) => {
    await Promise.all([
      loadRouteQuery(load, settingsQuery(load.deps.ws)),
      loadRouteQuery(load, logSettingsQuery),
      loadRouteQuery(load, devicesQuery),
      loadCachedRouteQuery(load, trackerProjectsQuery),
      loadCachedRouteQuery(load, boundProjectReadsQuery(load.context.queryClient, load.deps.ws)),
    ]);
  },
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { ws } = Route.useSearch();
  const page = useSettingsPage(ws);
  const shell = useShell();
  const actions = useSettingsActions(useSettingsQueryRefresh());
  const { data: logView } = useSuspenseQuery(logSettingsQuery);
  const logActions = useLogActions();
  const { data: devicesView } = useSuspenseQuery(devicesQuery);
  const deviceActions = useDeviceActions();
  const openCreateWorkspace = useOpenCreateWorkspace();
  return (
    <ScreenMessages messages={settingsMessages}>
      <SettingsScreen
        page={page}
        runnerIssues={shell.runnerIssues}
        workspaceView={resolveWorkspace(shell.workspaces, ws).kind}
        ws={ws}
        actions={actions}
        onCreateWorkspace={openCreateWorkspace}
        renderLink={routerSettingsLink}
        renderGuard={(guard) => <NavigationGuard {...guard} />}
        devices={<DevicesSection view={devicesView} actions={deviceActions} />}
        logs={<LogSection view={logView} actions={logActions} />}
      />
    </ScreenMessages>
  );
}
