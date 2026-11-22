import { useCallback, useEffect, useState } from "react";

import { AppScreens } from "../app-screens";
import type { MessageKey } from "../i18n";
import type { FetchLike } from "./client";
import { ConnectScreen } from "./connect-screen";
import { LiveScreens } from "./live-screens";
import type { ConnectionStore, StoredConnection } from "./stored-connection";

type Route =
  | { kind: "loading" }
  | { kind: "connect"; notice: MessageKey | null }
  | { kind: "demo" }
  | { kind: "live"; connection: { server: string; token: string }; persisted: boolean };

export function AppRoot({
  store,
  fetcher,
  devConnection,
  deviceName,
  allowPaste = __DEV__,
}: {
  store: ConnectionStore;
  fetcher: FetchLike;
  devConnection: { server: string; token: string } | null;
  deviceName: string;
  allowPaste?: boolean;
}) {
  const [route, setRoute] = useState<Route>({ kind: "loading" });

  useEffect(() => {
    if (devConnection !== null) {
      setRoute({ kind: "live", connection: devConnection, persisted: false });
      return;
    }
    let cancelled = false;
    store.load().then(
      (stored) => {
        if (cancelled) return;
        setRoute(
          stored === null
            ? { kind: "connect", notice: null }
            : { kind: "live", connection: stored, persisted: true },
        );
      },
      () => {
        if (!cancelled) setRoute({ kind: "connect", notice: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, devConnection]);

  const leave = useCallback(
    (notice: MessageKey) => {
      void store.clear().catch(() => undefined);
      setRoute({ kind: "connect", notice });
    },
    [store],
  );

  const connected = (connection: StoredConnection) => {
    store.save(connection).then(
      () => setRoute({ kind: "live", connection, persisted: true }),
      () => setRoute({ kind: "live", connection, persisted: false }),
    );
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
          onConnected={connected}
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
          onRejected={() => leave("connection.revoked")}
          onDisconnected={() => leave("connection.disconnected")}
        />
      );
  }
}
