import { createFileRoute } from "@tanstack/react-router";
import { useSettingsPage } from "../../settings/settings-query";
import {
  renderNavigationGuard,
  settingsPageHead,
  useSettingsNav,
  useWorkspaceView,
} from "../../settings/settings-route";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";
import { BriefScreen } from "../../settings/workspace-pages";
import { useOpenCreateWorkspace } from "../../shell/create-workspace";

export const Route = createFileRoute("/_app/settings/brief")({
  head: settingsPageHead("brief"),
  component: BriefRoute,
});

function BriefRoute() {
  const { ws } = Route.useSearch();
  return (
    <BriefScreen
      page={useSettingsPage(ws)}
      workspaceView={useWorkspaceView(ws)}
      actions={useSettingsActions(useSettingsQueryRefresh())}
      onCreateWorkspace={useOpenCreateWorkspace()}
      nav={useSettingsNav("brief", ws)}
      renderGuard={renderNavigationGuard}
    />
  );
}
