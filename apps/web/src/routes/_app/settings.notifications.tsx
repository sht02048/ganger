import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { NotificationsScreen, type NotificationsBridge } from "../../settings/notifications-page";
import { settingsPageHead, useSettingsNav } from "../../settings/settings-route";
import { desktopNotifications } from "../../shell/desktop-notifications";

export const Route = createFileRoute("/_app/settings/notifications")({
  head: settingsPageHead("notifications"),
  component: NotificationsRoute,
});

function NotificationsRoute() {
  const { ws } = Route.useSearch();
  const [bridge, setBridge] = useState<NotificationsBridge>(undefined);
  useEffect(() => {
    setBridge(desktopNotifications());
  }, []);
  return <NotificationsScreen bridge={bridge} nav={useSettingsNav("notifications", ws)} />;
}
