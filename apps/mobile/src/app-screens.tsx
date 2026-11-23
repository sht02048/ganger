import { useMemo, useState } from "react";

import { DashboardScreen, INITIAL_DASHBOARD_VIEW } from "./dashboard/dashboard-screen";
import { busySnapshot, emptySnapshot } from "./demo/data";
import { RunnersScreen } from "./runners/runners-screen";
import { INITIAL_NOTIFICATION_PREFERENCES, SettingsScreen } from "./settings/settings-screen";

type Screen = "dashboard" | "runners" | "settings";

export function AppScreens({ now: fixedNow, onExit }: { now?: Date; onExit?: () => void }) {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [emptyPreview, setEmptyPreview] = useState(false);
  const [dashboardView, setDashboardView] = useState(INITIAL_DASHBOARD_VIEW);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATION_PREFERENCES);
  const now = useMemo(() => fixedNow ?? new Date(), [fixedNow]);
  const snapshot = useMemo(
    () => (emptyPreview ? emptySnapshot() : busySnapshot(now)),
    [emptyPreview, now],
  );
  switch (screen) {
    case "dashboard":
      return (
        <DashboardScreen
          snapshot={snapshot}
          view={dashboardView}
          onViewChange={setDashboardView}
          onOpenRunners={() => setScreen("runners")}
          onOpenSettings={() => setScreen("settings")}
        />
      );
    case "runners":
      return <RunnersScreen runners={snapshot.runners} onBack={() => setScreen("dashboard")} />;
    case "settings":
      return (
        <SettingsScreen
          demo={{
            emptyPreview,
            onEmptyPreviewChange: (next) => {
              setEmptyPreview(next);
              setDashboardView(INITIAL_DASHBOARD_VIEW);
            },
            preferences: notifications,
            onPreferencesChange: setNotifications,
            ...(onExit === undefined ? {} : { onExit }),
          }}
          onBack={() => setScreen("dashboard")}
        />
      );
  }
}
