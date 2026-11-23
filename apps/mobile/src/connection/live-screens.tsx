import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, StyleSheet, View } from "react-native";

import { DashboardScreen, INITIAL_DASHBOARD_VIEW } from "../dashboard/dashboard-screen";
import { Button, NoticeBand, Sheet } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { t } from "../i18n";
import { destinationOf, pushOpenOf } from "../notifications/push-data";
import type { PushDevicePort, PushMemory, PushResponse } from "../notifications/push-port";
import { useDeviceNotifications } from "../notifications/use-device-notifications";
import type { PushNotice } from "../notifications/use-device-notifications";
import { RunnersScreen } from "../runners/runners-screen";
import { createLiveRunPort } from "../runs/run-port";
import type { MobileSnapshot } from "../screen-model";
import { SettingsScreen } from "../settings/settings-screen";
import { openChangeStream } from "./change-stream";
import { createV1Client } from "./client";
import type { FetchLike } from "./client";
import { OfflineCache } from "./offline-cache";
import type { CacheFiles } from "./offline-cache";
import { LiveSession } from "./session";
import type { SessionState } from "./session";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const BAND_TICK_MS = 30_000;

function staleReasonText(reason: SessionState["staleReason"]): string {
  return reason === "server-error"
    ? t("connection.band.reasonServerError")
    : t("connection.band.reasonUnreachable");
}

export function staleBandText(
  fetchedAt: number,
  now: number,
  staleReason: SessionState["staleReason"],
): string {
  const reason = staleReasonText(staleReason);
  const ago = Math.max(0, now - fetchedAt);
  if (ago < MINUTE_MS) return t("connection.band.staleJustNow", { reason });
  if (ago < HOUR_MS) {
    return t("connection.band.stale", { reason, minutes: Math.floor(ago / MINUTE_MS) });
  }
  return t("connection.band.staleHours", { reason, hours: Math.floor(ago / HOUR_MS) });
}

function bandText(state: SessionState, workspaceId: string, now: number): string | null {
  switch (state.phase) {
    case "stale": {
      const fetchedAt = state.dashboards.get(workspaceId)?.fetchedAt;
      return fetchedAt === undefined
        ? staleReasonText(state.staleReason)
        : staleBandText(fetchedAt, now, state.staleReason);
    }
    case "host-blocked":
      return t("connection.band.hostBlocked");
    case "incompatible":
      return t(`connection.update.${state.neededUpdate}`);
    case "loading":
    case "live":
    case "rejected":
      return null;
  }
}

function statusText({ phase, staleReason, neededUpdate }: SessionState): string {
  switch (phase) {
    case "live":
      return t("settings.connectionLive");
    case "stale":
      return staleReason === "server-error"
        ? t("settings.connectionServerError")
        : t("settings.connectionStale");
    case "host-blocked":
      return t("settings.connectionHostBlocked");
    case "incompatible":
      return t(`connection.update.${neededUpdate}`);
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

function pushNoticeText(notice: PushNotice | null): string | null {
  switch (notice) {
    case "address-lost":
      return t("settings.pushAddressLost");
    case "permission-denied":
      return t("settings.pushPermissionDenied");
    case "address-failed":
      return t("settings.pushAddressFailed");
    case "save-failed":
      return t("settings.pushSaveFailed");
    case "load-failed":
      return t("settings.pushLoadFailed");
    case null:
      return null;
  }
}

export function LiveScreens({
  connection,
  fetcher,
  pushDevice,
  pushMemory,
  cacheFiles,
  onRejected,
  onDisconnected,
  onForgetLocal,
}: {
  connection: { server: string; token: string };
  fetcher: FetchLike;
  pushDevice: PushDevicePort;
  pushMemory: PushMemory;
  cacheFiles: CacheFiles;
  onRejected: () => void;
  onDisconnected: () => void;
  onForgetLocal: () => Promise<boolean>;
}) {
  const { server, token } = connection;
  const client = useMemo(
    () => createV1Client(fetcher, { server, token }),
    [fetcher, server, token],
  );
  const [cache] = useState(() => new OfflineCache(cacheFiles, server, () => Date.now()));
  const clearCache = useCallback(() => void cache.clear().catch(() => undefined), [cache]);
  const [session] = useState(
    () =>
      new LiveSession(
        {
          client,
          openStream: (handlers) => openChangeStream(fetcher, { server, token }, handlers),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          now: () => Date.now(),
          onRejected: () => {
            clearCache();
            onRejected();
          },
          onDashboardRead: (workspaceId, data, fetchedAt, workspaces) =>
            cache.saveDashboard(workspaceId, data, fetchedAt, workspaces),
        },
        INITIAL_DASHBOARD_VIEW.workspaceId,
      ),
  );
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const port = useMemo(
    () => createLiveRunPort(client, session, undefined, cache),
    [client, session, cache],
  );
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [view, setView] = useState(INITIAL_DASHBOARD_VIEW);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  const [forgetFailed, setForgetFailed] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState !== "background");
  const [openRun, setOpenRun] = useState<{
    id: string;
    action: boolean;
    requestedAt: number;
  } | null>(null);
  const now = useClock(BAND_TICK_MS);
  const notifications = useDeviceNotifications({
    client,
    device: pushDevice,
    memory: pushMemory,
    foreground,
  });
  const clearOpenRun = useCallback(() => setOpenRun(null), []);

  useEffect(() => {
    const open = async ({ data, actionIdentifier }: PushResponse) => {
      const target = pushOpenOf(data, actionIdentifier);
      if (target === null) return;
      const thisDevice = await client.thisDevice();
      if (!thisDevice.ok || thisDevice.data.id !== target.device) return;
      if (target.kind === "todo") {
        setView((current) => ({
          ...current,
          workspaceId: INITIAL_DASHBOARD_VIEW.workspaceId,
          column: null,
          todoOnly: true,
        }));
        setScreen("dashboard");
        return;
      }
      const reply = await client.notificationEvent(target.eventId);
      const destination = destinationOf(reply.ok ? reply.data : null, target.action);
      setScreen(destination.screen);
      if (destination.screen === "dashboard" && destination.run !== null) {
        setView((current) => ({
          ...current,
          workspaceId: INITIAL_DASHBOARD_VIEW.workspaceId,
          column: null,
        }));
        setOpenRun({ ...destination.run, requestedAt: Date.now() });
        session.setWorkspace(INITIAL_DASHBOARD_VIEW.workspaceId);
        void session.refresh();
      }
    };
    return pushDevice.subscribeResponses((response) => void open(response));
  }, [client, pushDevice, session]);

  useEffect(() => {
    let current = true;
    void cache.load().then((content) => {
      if (current) session.restore(content);
    });
    return () => {
      current = false;
    };
  }, [cache, session]);

  useEffect(() => {
    session.setForeground(AppState.currentState !== "background");
    const subscription = AppState.addEventListener("change", (next) => {
      session.setForeground(next === "active");
      setForeground(next === "active");
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
      dashboardFor: (workspaceId) => state.dashboards.get(workspaceId)?.data ?? null,
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
      clearCache();
      onDisconnected();
      return;
    }
    setDisconnectFailed(true);
  };
  const forgetLocal = async () => {
    setForgetFailed(false);
    if (await onForgetLocal()) {
      session.stop();
      clearCache();
    } else setForgetFailed(true);
  };

  const message = bandText(state, view.workspaceId, now);
  const band = message === null ? null : <NoticeBand message={message} />;
  const settings = (
    <SettingsScreen
      band={band}
      connection={{
        server,
        status: statusText(state),
        serverVersion: state.serverVersion,
        deviceName: state.device?.name ?? null,
        disconnectFailed,
        disconnecting,
        onDisconnect: () => void disconnect(),
        forgetFailed,
        onForgetLocal: () => void forgetLocal(),
      }}
      notifications={{
        preferences: notifications.preferences,
        disabled: notifications.busy || !notifications.supported,
        message: pushNoticeText(notifications.notice),
        hint: notifications.supported ? null : t("settings.pushUnsupported"),
        onChange: notifications.change,
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
  const askSheet = (
    <Sheet
      visible={notifications.asking}
      title={t("settings.pushAskTitle")}
      closeLabel={t("settings.pushAskDecline")}
      onClose={notifications.decline}
    >
      <Text variant="body">{t("settings.pushAskBody")}</Text>
      <Button
        label={t("settings.pushAskAccept")}
        variant="primary"
        onPress={notifications.accept}
      />
      <Button label={t("settings.pushAskDecline")} onPress={notifications.decline} />
    </Sheet>
  );
  switch (screen) {
    case "dashboard":
      return (
        <>
          <DashboardScreen
            openRun={openRun}
            openRunSettled={
              openRun !== null &&
              view.workspaceId === INITIAL_DASHBOARD_VIEW.workspaceId &&
              (state.phase === "stale" ||
                state.phase === "host-blocked" ||
                state.phase === "incompatible" ||
                (state.dashboards.get(view.workspaceId)?.fetchedAt ?? 0) >= openRun.requestedAt)
            }
            onOpenRunHandled={clearOpenRun}
            snapshot={snapshot}
            view={view}
            onViewChange={setView}
            onOpenRunners={() => setScreen("runners")}
            onOpenSettings={() => setScreen("settings")}
            band={band}
            actionsDisabled={state.phase !== "live" || !state.actionsReady}
            port={port}
            {...(state.phase === "loading" || state.phase === "live"
              ? {}
              : { onRetry: () => void session.refresh() })}
          />
          {askSheet}
        </>
      );
    case "runners":
      return (
        <RunnersScreen
          band={band}
          loading={state.phase === "loading"}
          runners={state.runners}
          onBack={() => setScreen("dashboard")}
        />
      );
    case "settings":
      return settings;
  }
}

const styles = StyleSheet.create({
  problem: { flex: 1, padding: space.s4, gap: space.s3, justifyContent: "center" },
});
