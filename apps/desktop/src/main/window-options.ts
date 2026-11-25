import type { BrowserWindowConstructorOptions, CookiesSetDetails, WebPreferences } from "electron";
import { HIDDEN_TITLE_BAR, TITLE_BAR_COOKIE } from "@ganger/app/shell/window-chrome";
import { windowFrame } from "@ganger/ui/window-frame";

export const TRAFFIC_LIGHTS = { width: 54, height: 16 } as const;

export function trafficLightPosition(): { x: number; y: number } {
  return {
    x: Math.round((windowFrame.railWidth - TRAFFIC_LIGHTS.width) / 2),
    y: Math.round((windowFrame.titleBarHeight - TRAFFIC_LIGHTS.height) / 2),
  };
}

function hiddenTitleBar(): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: "hidden",
    trafficLightPosition: trafficLightPosition(),
    backgroundColor: windowFrame.background,
  };
}

function webPreferences(preload: string): WebPreferences {
  return { preload, contextIsolation: true, sandbox: true, nodeIntegration: false };
}

export function mainWindowOptions(title: string, preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title,
    ...hiddenTitleBar(),
    webPreferences: webPreferences(preload),
  };
}

export function titleBarCookie(serverUrl: string): CookiesSetDetails {
  return {
    url: new URL(serverUrl).origin,
    path: "/",
    name: TITLE_BAR_COOKIE,
    value: HIDDEN_TITLE_BAR,
    sameSite: "lax",
  };
}
