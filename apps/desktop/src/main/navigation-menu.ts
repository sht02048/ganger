import { navShortcuts } from "@ganger/app/shell/nav-shortcuts";
import type { NavScreen } from "@ganger/app/shell/nav-shortcuts";
import type { MenuItemConstructorOptions } from "electron";

export type HistoryDirection = "back" | "forward";

export function electronAccelerator(shortcut: string): string {
  return shortcut.replace(/^Mod\+/, "CommandOrControl+");
}

export interface WindowHistory {
  activeIndex: number;
  length: number;
  urlAt: (index: number) => string;
}

export function canStepHistory(
  history: WindowHistory,
  direction: HistoryDirection,
  serverUrl: string | undefined,
): boolean {
  if (serverUrl === undefined) return false;
  const index = history.activeIndex + (direction === "back" ? -1 : 1);
  if (index < 0 || index >= history.length) return false;
  return URL.parse(history.urlAt(index))?.origin === URL.parse(serverUrl)?.origin;
}

export function navigationMenu(options: {
  label: string;
  screenLabel: (screen: NavScreen) => string;
  backLabel: string;
  forwardLabel: string;
  enabled: boolean;
  onNavigate: (screen: NavScreen) => void;
  onHistory: (direction: HistoryDirection) => void;
}): MenuItemConstructorOptions {
  return {
    id: "navigate",
    label: options.label,
    submenu: [
      {
        id: "navigate-back",
        label: options.backLabel,
        accelerator: "CommandOrControl+[",
        enabled: options.enabled,
        click: () => options.onHistory("back"),
      },
      {
        id: "navigate-forward",
        label: options.forwardLabel,
        accelerator: "CommandOrControl+]",
        enabled: options.enabled,
        click: () => options.onHistory("forward"),
      },
      { type: "separator", enabled: options.enabled },
      ...navShortcuts.map((item) => ({
        id: `navigate-${item.screen}`,
        label: options.screenLabel(item.screen),
        accelerator: electronAccelerator(item.shortcut),
        enabled: options.enabled,
        click: () => options.onNavigate(item.screen),
      })),
    ],
  };
}
