import { createFileRoute } from "@tanstack/react-router";
import { useSettingsPage } from "../../settings/settings-query";
import {
  renderNavigationGuard,
  settingsPageHead,
  useSettingsNav,
  useWorkspaceView,
} from "../../settings/settings-route";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";
import { GeneralScreen } from "../../settings/workspace-pages";
import { useOpenCreateWorkspace } from "../../shell/create-workspace";

export const Route = createFileRoute("/_app/settings/general")({
  head: settingsPageHead("general"),
  component: GeneralRoute,
});

function GeneralRoute() {
  const { ws } = Route.useSearch();
  return (
    <GeneralScreen
      page={useSettingsPage(ws)}
      workspaceView={useWorkspaceView(ws)}
      actions={useSettingsActions(useSettingsQueryRefresh())}
      onCreateWorkspace={useOpenCreateWorkspace()}
      nav={useSettingsNav("general", ws)}
      renderGuard={renderNavigationGuard}
    />
  );
}
