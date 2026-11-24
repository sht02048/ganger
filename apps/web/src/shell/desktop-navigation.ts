import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";
import {
  DESKTOP_NAVIGATION_GLOBAL,
  desktopPages,
  isDesktopPage,
  isNavScreen,
  navShortcutOf,
} from "@ganger/app/shell/nav-shortcuts";
import type { DesktopPage, NavScreen } from "@ganger/app/shell/nav-shortcuts";

export interface DesktopNavigation {
  onNavigate(listener: (screen: NavScreen) => void): () => void;
  onOpenPage(listener: (page: DesktopPage) => void): () => void;
}

const unsubscribeSchema = z.custom<() => unknown>((value) => typeof value === "function");

const listenerSchema = z.custom<(listener: (value: unknown) => void) => unknown>(
  (value) => typeof value === "function",
);

const bridgeSchema = z.object({
  onNavigate: listenerSchema,
  onOpenPage: listenerSchema.optional(),
});

export function desktopNavigation(scope: object = globalThis): DesktopNavigation | null {
  const parsed = bridgeSchema.safeParse(Reflect.get(scope, DESKTOP_NAVIGATION_GLOBAL));
  if (!parsed.success) return null;
  const bridge = parsed.data;
  return {
    onNavigate(listener) {
      const off = unsubscribeSchema.safeParse(
        bridge.onNavigate((screen) => {
          if (isNavScreen(screen)) listener(screen);
        }),
      );
      return () => {
        if (off.success) off.data();
      };
    },
    onOpenPage(listener) {
      const subscribe = bridge.onOpenPage;
      if (subscribe === undefined) return () => {};
      const off = unsubscribeSchema.safeParse(
        subscribe((page) => {
          if (isDesktopPage(page)) listener(page);
        }),
      );
      return () => {
        if (off.success) off.data();
      };
    },
  };
}

export function useDesktopNavigation(onNavigated: (screen: NavScreen) => void): {
  inDesktopApp: boolean;
} {
  const navigate = useNavigate();
  const [inDesktopApp, setInDesktopApp] = useState(false);
  const navigated = useEffectEvent(onNavigated);
  useEffect(() => {
    const bridge = desktopNavigation();
    if (bridge === null) return;
    setInDesktopApp(true);
    const offNavigate = bridge.onNavigate((screen) => {
      void navigate({ to: navShortcutOf(screen).path }).then(() => navigated(screen));
    });
    const offOpenPage = bridge.onOpenPage((page) => {
      void navigate({ to: desktopPages[page] });
    });
    return () => {
      offNavigate();
      offOpenPage();
    };
  }, [navigate]);
  return { inDesktopApp };
}
