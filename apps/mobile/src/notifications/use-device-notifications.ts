import type { V1DeviceNotifications } from "@ganger/api";
import { useCallback, useEffect, useRef, useState } from "react";

import type { V1PushClient } from "../connection/client";
import type { NotificationPreferences } from "../settings/settings-screen";
import { toGroups, toPreferences } from "./push-data";
import { EMPTY_PUSH_MEMORY } from "./push-port";
import type { PushDevicePort, PushMemory, PushMemoryValue } from "./push-port";

export const PUSH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type PushNotice =
  | "address-lost"
  | "permission-denied"
  | "address-failed"
  | "save-failed"
  | "load-failed";

export interface DeviceNotificationsState {
  supported: boolean;
  preferences: NotificationPreferences | null;
  busy: boolean;
  notice: PushNotice | null;
  asking: boolean;
  change: (next: NotificationPreferences) => void;
  accept: () => void;
  decline: () => void;
}

function newRequestId(): string {
  let id = "";
  while (id.length < 32) id += Math.random().toString(16).slice(2);
  return id.slice(0, 32);
}

export function useDeviceNotifications({
  client,
  device,
  memory,
  foreground,
}: {
  client: V1PushClient;
  device: PushDevicePort;
  memory: PushMemory;
  foreground: boolean;
}): DeviceNotificationsState {
  const [settings, setSettings] = useState<V1DeviceNotifications | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PushNotice | null>(null);
  const [asking, setAsking] = useState(false);
  const remembered = useRef<PushMemoryValue>(EMPTY_PUSH_MEMORY);
  const writing = useRef(false);
  const writes = useRef(0);
  const checkedAt = useRef<number | null>(null);

  const remember = useCallback(
    async (value: PushMemoryValue) => {
      remembered.current = value;
      await memory.save(value).catch(() => undefined);
    },
    [memory],
  );

  const save = useCallback(
    async (next: NotificationPreferences, address?: string): Promise<boolean> => {
      const reply = await client.saveDeviceNotifications({
        requestId: newRequestId(),
        enabled: next.enabled,
        groups: toGroups(next),
        ...(address === undefined ? {} : { expoPushToken: address }),
      });
      if (!reply.ok) return false;
      setSettings(reply.data);
      return true;
    },
    [client],
  );

  useEffect(() => {
    if (!foreground) return;
    if (checkedAt.current !== null && Date.now() - checkedAt.current < PUSH_CHECK_INTERVAL_MS) {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const writesAtStart = writes.current;
      const stored = await memory.load().catch(() => EMPTY_PUSH_MEMORY);
      const reply = await client.deviceNotifications();
      if (cancelled || writing.current) return;
      remembered.current = stored;
      if (!reply.ok) {
        setNotice("load-failed");
        return;
      }
      checkedAt.current = Date.now();
      setSettings(reply.data);
      setNotice((current) => (current === "load-failed" ? null : current));
      if (!reply.data.hasPushAddress && stored.registered) setNotice("address-lost");
      if (device.supported && !stored.asked && !reply.data.enabled) setAsking(true);
      if (!device.supported || !reply.data.enabled || !reply.data.hasPushAddress) return;
      if ((await device.permission()) !== "granted") return;
      const address = await device.pushAddress();
      if (cancelled || writes.current !== writesAtStart || address === null) {
        checkedAt.current = null;
        return;
      }
      if (address === stored.address) return;
      if (await save(toPreferences(reply.data.enabled, reply.data.groups), address)) {
        await remember({ ...stored, address });
      } else {
        checkedAt.current = null;
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [client, device, foreground, memory, remember, save]);

  const run = useCallback(async (work: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true;
    writes.current += 1;
    setBusy(true);
    try {
      await work();
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }, []);

  const turnOn = useCallback(
    async (next: NotificationPreferences) => {
      const permission = await device.requestPermission();
      if (permission !== "granted") {
        await remember({ ...remembered.current, asked: true });
        setNotice("permission-denied");
        return;
      }
      const address = await device.pushAddress();
      if (address === null) {
        await remember({ ...remembered.current, asked: true });
        setNotice("address-failed");
        return;
      }
      if (!(await save({ ...next, enabled: true }, address))) {
        setNotice("save-failed");
        return;
      }
      await remember({ asked: true, registered: true, address });
      setNotice(null);
    },
    [device, remember, save],
  );

  const change = useCallback(
    (next: NotificationPreferences) => {
      void run(async () => {
        if (next.enabled && settings?.enabled !== true) {
          await turnOn(next);
          return;
        }
        if (await save(next)) setNotice(null);
        else setNotice("save-failed");
      });
    },
    [run, save, settings?.enabled, turnOn],
  );

  const accept = useCallback(() => {
    setAsking(false);
    if (settings === null) return;
    void run(() => turnOn({ ...toPreferences(true, settings.groups), enabled: true }));
  }, [run, settings, turnOn]);

  const decline = useCallback(() => {
    setAsking(false);
    void run(async () => {
      await remember({ ...remembered.current, asked: true });
      if (settings === null || (await device.permission()) !== "granted") return;
      const address = await device.pushAddress();
      if (address === null) return;
      if (await save(toPreferences(false, settings.groups), address)) {
        await remember({ ...remembered.current, address });
      }
    });
  }, [device, remember, run, save, settings]);

  return {
    supported: device.supported,
    preferences: settings === null ? null : toPreferences(settings.enabled, settings.groups),
    busy,
    notice,
    asking,
    change,
    accept,
    decline,
  };
}
