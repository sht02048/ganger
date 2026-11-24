import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { McpScreen } from "../../settings/mcp-screen";
import { settingsQuery } from "../../settings/settings-query";
import { settingsPageHead, useSettingsNav } from "../../settings/settings-route";
import { useSettingsActions, useSettingsQueryRefresh } from "../../settings/use-settings-actions";

export const Route = createFileRoute("/_app/settings/mcp")({
  head: settingsPageHead("mcp"),
  component: McpRoute,
});

function McpRoute() {
  const { ws } = Route.useSearch();
  const { data: page } = useSuspenseQuery(settingsQuery(ws));
  return (
    <McpScreen
      mcp={page.install.mcp}
      actions={useSettingsActions(useSettingsQueryRefresh())}
      nav={useSettingsNav("mcp", ws)}
    />
  );
}
