import { createFileRoute } from "@tanstack/react-router";
import { ProjectsScreen } from "../../settings/projects-page";
import { routerSettingsLink } from "../../settings/settings-link";
import { useSettingsPage } from "../../settings/settings-query";
import {
  renderNavigationGuard,
  settingsPageHead,
  useSettingsNav,
  useWorkspaceView,
} from "../../settings/settings-route";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";
import { useOpenCreateWorkspace } from "../../shell/create-workspace";

export const Route = createFileRoute("/_app/settings/projects/")({
  head: settingsPageHead("projects"),
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { ws } = Route.useSearch();
  return (
    <ProjectsScreen
      page={useSettingsPage(ws)}
      workspaceView={useWorkspaceView(ws)}
      actions={useSettingsActions(useSettingsQueryRefresh())}
      onCreateWorkspace={useOpenCreateWorkspace()}
      renderLink={routerSettingsLink}
      nav={useSettingsNav("projects", ws)}
      renderGuard={renderNavigationGuard}
    />
  );
}
