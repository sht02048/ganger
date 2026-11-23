import { useCallback, useEffect, useState } from "react";

import { AppScreens } from "../app-screens";
import type { MessageKey } from "../i18n";
import { createV1Client } from "./client";
import type { FetchLike } from "./client";
import { ConnectScreen } from "./connect-screen";
import { LiveScreens } from "./live-screens";
import type { CacheFiles } from "./offline-cache";
import type { PushDevicePort, PushMemory } from "../notifications/push-port";
import type { ConnectionStore, StoredConnection } from "./stored-connection";

type Route =
  | { kind: "loading" }
  | { kind: "connect"; notice: MessageKey | null }
  | { kind: "demo" }
  | { kind: "live"; connection: { server: string; token: string } };

export function AppRoot({
  store,
  fetcher,
  devConnection,
  deviceName,
  pushDevice,
  pushMemory,
  cacheFiles,
  allowPaste = __DEV__,
}: {
  store: ConnectionStore;
  fetcher: FetchLike;
  devConnection: { server: string; token: string } | null;
  deviceName: string;
  pushDevice: PushDevicePort;
  pushMemory: PushMemory;
  cacheFiles: CacheFiles;
  allowPaste?: boolean;
}) {
  const [route, setRoute] = useState<Route>({ kind: "loading" });

  useEffect(() => {
    if (devConnection !== null) {
      setRoute({ kind: "live", connection: devConnection });
      return;
    }
    let cancelled = false;
    store.load().then(
      (stored) => {
        if (cancelled) return;
        if (stored === null) void cacheFiles.removeAll().catch(() => undefined);
        setRoute(
          stored === null
            ? { kind: "connect", notice: null }
            : { kind: "live", connection: stored },
        );
      },
      () => {
        if (!cancelled) setRoute({ kind: "connect", notice: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, devConnection, cacheFiles]);

  const leave = useCallback(
    (notice: MessageKey) => {
      void store.clear().catch(() => undefined);
      void pushMemory.clear().catch(() => undefined);
      setRoute({ kind: "connect", notice });
    },
    [store, pushMemory],
  );

  const forgetLocal = useCallback(async () => {
    try {
      await store.clear();
    } catch {
      return false;
    }
    void pushMemory.clear().catch(() => undefined);
    setRoute({ kind: "connect", notice: "connection.disconnected" });
    return true;
  }, [store, pushMemory]);

  const connected = async (connection: StoredConnection) => {
    try {
      await store.save(connection);
      await pushMemory.clear().catch(() => undefined);
      await cacheFiles.remove(connection.server).catch(() => undefined);
      setRoute({ kind: "live", connection });
    } catch {
      await createV1Client(fetcher, connection).disconnect();
      setRoute({ kind: "connect", notice: "connection.saveFailed" });
    }
  };

  switch (route.kind) {
    case "loading":
      return null;
    case "connect":
      return (
        <ConnectScreen
          fetcher={fetcher}
          deviceName={deviceName}
          notice={route.notice}
          allowPaste={allowPaste}
          onConnected={(connection) => void connected(connection)}
          onDemo={() => setRoute({ kind: "demo" })}
        />
      );
    case "demo":
      return <AppScreens onExit={() => setRoute({ kind: "connect", notice: null })} />;
    case "live":
      return (
        <LiveScreens
          key={`${route.connection.server}:${route.connection.token}`}
          connection={route.connection}
          fetcher={fetcher}
          pushDevice={pushDevice}
          pushMemory={pushMemory}
          cacheFiles={cacheFiles}
          onRejected={() => leave("connection.revoked")}
          onDisconnected={() => leave("connection.disconnected")}
          onForgetLocal={forgetLocal}
        />
      );
  }
}
