import { useMemo, useState } from "react";

import { DashboardScreen } from "./dashboard/dashboard-screen";
import { busySnapshot, emptySnapshot } from "./demo/data";
import { RunnersScreen } from "./runners/runners-screen";
import { SettingsScreen } from "./settings/settings-screen";

type Screen = "dashboard" | "runners" | "settings";

export function AppScreens({ now: fixedNow }: { now?: Date }) {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [emptyPreview, setEmptyPreview] = useState(false);
  const now = useMemo(() => fixedNow ?? new Date(), [fixedNow]);
  const snapshot = useMemo(
    () => (emptyPreview ? emptySnapshot() : busySnapshot(now)),
    [emptyPreview, now],
  );
  switch (screen) {
    case "dashboard":
      return (
        <DashboardScreen
          key={emptyPreview ? "empty" : "busy"}
          snapshot={snapshot}
          now={now}
          onOpenRunners={() => setScreen("runners")}
          onOpenSettings={() => setScreen("settings")}
        />
      );
    case "runners":
      return <RunnersScreen runners={snapshot.runners} onBack={() => setScreen("dashboard")} />;
    case "settings":
      return (
        <SettingsScreen
          emptyPreview={emptyPreview}
          onEmptyPreviewChange={setEmptyPreview}
          onBack={() => setScreen("dashboard")}
        />
      );
  }
}
