import { useEffect, useState } from "react";
import { z } from "zod";
import {
  DESKTOP_NOTIFICATIONS_GLOBAL,
  desktopNotificationSummarySchema,
} from "@ganger/app/notifications/desktop";
import type { DesktopNotificationSummary } from "@ganger/app/notifications/desktop";

export interface DesktopNotifications {
  current(): Promise<DesktopNotificationSummary | null>;
  subscribe(listener: (summary: DesktopNotificationSummary) => void): () => void;
  openSettings(): void;
}

const callable = z.custom<(...args: never[]) => unknown>((value) => typeof value === "function");

const bridgeSchema = z.object({
  getSummary: z.custom<() => unknown>((value) => typeof value === "function"),
  onSummary: z.custom<(listener: (summary: unknown) => void) => unknown>(
    (value) => typeof value === "function",
  ),
  openSettings: z.custom<() => unknown>((value) => typeof value === "function"),
});

function parseSummary(value: unknown): DesktopNotificationSummary | null {
  const parsed = desktopNotificationSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function desktopNotifications(scope: object = globalThis): DesktopNotifications | null {
  const parsed = bridgeSchema.safeParse(Reflect.get(scope, DESKTOP_NOTIFICATIONS_GLOBAL));
  if (!parsed.success) return null;
  const bridge = parsed.data;
  return {
    current: () =>
      Promise.resolve()
        .then(() => bridge.getSummary())
        .then(
          (value) => parseSummary(value),
          () => null,
        ),
    subscribe(listener) {
      const off = callable.safeParse(
        bridge.onSummary((value) => {
          const summary = parseSummary(value);
          if (summary !== null) listener(summary);
        }),
      );
      return () => {
        if (off.success) off.data();
      };
    },
    openSettings() {
      void Promise.resolve()
        .then(() => bridge.openSettings())
        .catch(() => undefined);
    },
  };
}

export type DesktopNotificationsState =
  | { kind: "unknown" }
  | { kind: "browser" }
  | { kind: "desktop"; summary: DesktopNotificationSummary | null; open: () => void };

export function useDesktopNotifications(): DesktopNotificationsState {
  const [state, setState] = useState<DesktopNotificationsState>({ kind: "unknown" });
  useEffect(() => {
    const bridge = desktopNotifications();
    if (bridge === null) {
      setState({ kind: "browser" });
      return undefined;
    }
    const open = () => bridge.openSettings();
    let live = true;
    setState({ kind: "desktop", summary: null, open });
    const off = bridge.subscribe((summary) => setState({ kind: "desktop", summary, open }));
    void bridge.current().then((summary) => {
      if (live && summary !== null) {
        setState((previous) =>
          previous.kind === "desktop" && previous.summary !== null
            ? previous
            : { kind: "desktop", summary, open },
        );
      }
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}
