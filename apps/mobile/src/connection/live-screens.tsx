import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, StyleSheet, View } from "react-native";

import { DashboardScreen, INITIAL_DASHBOARD_VIEW } from "../dashboard/dashboard-screen";
import { Button, NoticeBand, Sheet } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { t } from "../i18n";
import { ALL_WORKSPACES } from "../dashboard/model";
import { useAppBadge } from "../notifications/app-badge";
import { destinationOf, pushOpenOf } from "../notifications/push-data";
import type { PushDevicePort, PushMemory, PushResponse } from "../notifications/push-port";
import { useDeviceNotifications } from "../notifications/use-device-notifications";
import type { PushNotice } from "../notifications/use-device-notifications";
import { RunnersScreen } from "../runners/runners-screen";
import { createLiveRunPort } from "../runs/run-port";
import type { MobileSnapshot } from "../screen-model";
import { SettingsScreen } from "../settings/settings-screen";
import { KeptScreen } from "../kept-screen";
import { useFirstPaint } from "../startup/first-paint";
import { followForeground, isForegroundAppState } from "./app-state";
import { openChangeStream } from "./change-stream";
import { createV1Client } from "./client";
import type { FetchLike } from "./client";
import { OfflineCache } from "./offline-cache";
import type { CacheFiles } from "./offline-cache";
import { LiveSession } from "./session";
import type { SessionState } from "./session";
import { nextStaleBandChangeIn, staleBandText } from "./stale-band";

function staleReasonText(reason: SessionState["staleReason"]): string {
  return reason === "server-error"
    ? t("connection.band.reasonServerError")
    : t("connection.band.reasonUnreachable");
}

function showsBand(phase: SessionState["phase"]): boolean {
  return phase === "stale" || phase === "host-blocked" || phase === "incompatible";
}

function bandText(state: SessionState, workspaceId: string, now: number): string | null {
  switch (state.phase) {
    case "stale": {
      const fetchedAt = state.dashboards.get(workspaceId)?.fetchedAt;
      return fetchedAt === undefined
        ? staleReasonText(state.staleReason)
        : staleBandText(fetchedAt, now, staleReasonText(state.staleReason));
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

function useStaleBandClock(fetchedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fetchedAt === null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      nextStaleBandChangeIn(fetchedAt, Date.now()),
    );
    return () => clearTimeout(timer);
  }, [fetchedAt, now]);
  return now;
}

function ConnectionBand({ state, workspaceId }: { state: SessionState; workspaceId: string }) {
  const fetchedAt = state.phase === "stale" ? state.dashboards.get(workspaceId)?.fetchedAt : null;
  const now = useStaleBandClock(fetchedAt ?? null);
  const message = bandText(state, workspaceId, now);
  return message === null ? null : <NoticeBand message={message} />;
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
          onDashboardConfirmed: (workspaceId, fetchedAt) =>
            cache.confirmDashboard(workspaceId, fetchedAt),
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
  const [foreground, setForeground] = useState(() => isForegroundAppState(AppState.currentState));
  const [openRun, setOpenRun] = useState<{
    id: string;
    action: boolean;
    requestedAt: number;
  } | null>(null);
  const notifications = useDeviceNotifications({
    client,
    device: pushDevice,
    memory: pushMemory,
    foreground,
  });
  const clearOpenRun = useCallback(() => setOpenRun(null), []);
  useAppBadge({
    device: pushDevice,
    pushEnabled: notifications.preferences?.enabled ?? null,
    allWorkspaces: state.dashboards.get(ALL_WORKSPACES)?.data ?? null,
    foreground,
  });

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

  const [cacheShown, setCacheShown] = useState(false);
  useFirstPaint(cacheShown || state.phase !== "loading");

  useEffect(() => {
    let current = true;
    void cache.load(INITIAL_DASHBOARD_VIEW.workspaceId).then((content) => {
      if (!current) return;
      session.restore(content);
      setCacheShown(true);
    });
    return () => {
      current = false;
    };
  }, [cache, session]);

  useEffect(() => {
    if (!cacheShown || session.getState().dashboards.has(view.workspaceId)) return;
    session.restore(cache.contentFor(view.workspaceId));
  }, [cache, session, cacheShown, view.workspaceId]);

  useEffect(() => {
    const unfollow = followForeground(AppState, (next) => {
      session.setForeground(next);
      setForeground(next);
      if (!next) void cache.flush().catch(() => undefined);
    });
    return () => {
      unfollow();
      session.stop();
      void cache.flush().catch(() => undefined);
    };
  }, [cache, session]);

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

  const band = showsBand(state.phase) ? (
    <ConnectionBand state={state} workspaceId={view.workspaceId} />
  ) : null;
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
  return (
    <>
      <KeptScreen testID="dashboard-screen" shown={screen === "dashboard"}>
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
          band={screen === "dashboard" ? band : null}
          actionsDisabled={state.phase !== "live" || !state.actionsReady}
          port={port}
          {...(state.phase === "loading" || state.phase === "live"
            ? {}
            : { onRetry: () => void session.refresh() })}
        />
      </KeptScreen>
      {screen === "dashboard" ? askSheet : null}
      {screen === "runners" ? (
        <RunnersScreen
          band={band}
          loading={state.phase === "loading"}
          unavailable={!state.runnersRead}
          runners={state.runners}
          onBack={() => setScreen("dashboard")}
        />
      ) : null}
      {screen === "settings" ? settings : null}
    </>
  );
}

const styles = StyleSheet.create({
  problem: { flex: 1, padding: space.s4, gap: space.s3, justifyContent: "center" },
});
