import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, StyleSheet, View } from "react-native";

import { DashboardScreen, INITIAL_DASHBOARD_VIEW } from "../dashboard/dashboard-screen";
import { Button, NoticeBand } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { t } from "../i18n";
import { RunnersScreen } from "../runners/runners-screen";
import type { MobileSnapshot } from "../screen-model";
import { SettingsScreen } from "../settings/settings-screen";
import { openChangeStream } from "./change-stream";
import { createV1Client } from "./client";
import type { FetchLike } from "./client";
import { LiveSession } from "./session";
import type { SessionPhase, SessionState } from "./session";
import { MINIMUM_SERVER_VERSION } from "./version";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const BAND_TICK_MS = 30_000;

export function staleBandText(fetchedAt: number, now: number): string {
  const ago = Math.max(0, now - fetchedAt);
  if (ago < MINUTE_MS) return t("connection.band.staleJustNow");
  if (ago < HOUR_MS) return t("connection.band.stale", { minutes: Math.floor(ago / MINUTE_MS) });
  return t("connection.band.staleHours", { hours: Math.floor(ago / HOUR_MS) });
}

function incompatibleText(serverVersion: string | null): string {
  return serverVersion === null
    ? t("connection.band.incompatible")
    : t("connection.band.incompatibleVersion", {
        version: serverVersion,
        minimum: MINIMUM_SERVER_VERSION,
      });
}

function bandText(state: SessionState, now: number): string | null {
  switch (state.phase) {
    case "stale":
      return state.fetchedAt === null
        ? t("connection.error.unreachable")
        : staleBandText(state.fetchedAt, now);
    case "host-blocked":
      return t("connection.band.hostBlocked");
    case "incompatible":
      return incompatibleText(state.serverVersion);
    case "loading":
    case "live":
    case "rejected":
      return null;
  }
}

function statusText(phase: SessionPhase): string {
  switch (phase) {
    case "live":
      return t("settings.connectionLive");
    case "stale":
      return t("settings.connectionStale");
    case "host-blocked":
      return t("settings.connectionHostBlocked");
    case "incompatible":
      return t("settings.connectionIncompatible");
    case "loading":
    case "rejected":
      return t("settings.connectionLoading");
  }
}

function useClock(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type Screen = "dashboard" | "runners" | "settings";

export function LiveScreens({
  connection,
  fetcher,
  onRejected,
  onDisconnected,
}: {
  connection: { server: string; token: string };
  fetcher: FetchLike;
  onRejected: () => void;
  onDisconnected: () => void;
}) {
  const { server, token } = connection;
  const client = useMemo(
    () => createV1Client(fetcher, { server, token }),
    [fetcher, server, token],
  );
  const [session] = useState(
    () =>
      new LiveSession(
        {
          client,
          openStream: (handlers) => openChangeStream(fetcher, { server, token }, handlers),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          now: () => Date.now(),
          onRejected,
        },
        INITIAL_DASHBOARD_VIEW.workspaceId,
      ),
  );
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [view, setView] = useState(INITIAL_DASHBOARD_VIEW);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  const now = useClock(BAND_TICK_MS);

  useEffect(() => {
    session.setForeground(AppState.currentState !== "background");
    const subscription = AppState.addEventListener("change", (next) => {
      session.setForeground(next === "active");
    });
    return () => {
      subscription.remove();
      session.stop();
    };
  }, [session]);

  useEffect(() => session.setWorkspace(view.workspaceId), [session, view.workspaceId]);

  const snapshot = useMemo<MobileSnapshot>(
    () => ({
      workspaces: state.workspaces,
      runners: state.runners,
      dashboardFor: (workspaceId) => state.dashboards.get(workspaceId) ?? null,
    }),
    [state.workspaces, state.runners, state.dashboards],
  );

  const disconnect = async () => {
    setDisconnecting(true);
    setDisconnectFailed(false);
    const reply = await client.disconnect();
    setDisconnecting(false);
    if (reply.ok || reply.failure.kind === "token-rejected") {
      session.stop();
      onDisconnected();
      return;
    }
    setDisconnectFailed(true);
  };
  const forgetLocal = () => {
    session.stop();
    onDisconnected();
  };

  const message = bandText(state, now);
  const band = message === null ? null : <NoticeBand message={message} />;
  const settings = (
    <SettingsScreen
      band={band}
      connection={{
        server,
        status: statusText(state.phase),
        serverVersion: state.serverVersion,
        deviceName: state.device?.name ?? null,
        disconnectFailed,
        disconnecting,
        onDisconnect: () => void disconnect(),
        onForgetLocal: forgetLocal,
      }}
      onBack={() => setScreen("dashboard")}
    />
  );

  if (state.fetchedAt === null && state.phase !== "loading" && screen !== "settings") {
    return (
      <View style={styles.problem}>
        {band}
        <Text variant="body">{t("connection.title")}</Text>
        <Button label={t("common.retry")} onPress={() => void session.refresh()} />
        <Button label={t("dashboard.settings")} onPress={() => setScreen("settings")} />
      </View>
    );
  }
  switch (screen) {
    case "dashboard":
      return (
        <DashboardScreen
          snapshot={snapshot}
          view={view}
          onViewChange={setView}
          onOpenRunners={() => setScreen("runners")}
          onOpenSettings={() => setScreen("settings")}
          band={band}
          actionsDisabled={state.phase !== "live"}
          actionNotice={{ title: t("common.liveActionTitle"), body: t("common.liveAction") }}
        />
      );
    case "runners":
      return (
        <RunnersScreen band={band} runners={state.runners} onBack={() => setScreen("dashboard")} />
      );
    case "settings":
      return settings;
  }
}

const styles = StyleSheet.create({
  problem: { flex: 1, padding: space.s4, gap: space.s3, justifyContent: "center" },
});
