import { desktopPages } from "@ganger/app/shell/nav-shortcuts";
import type { DesktopPage } from "@ganger/app/shell/nav-shortcuts";
import type { MenuItemConstructorOptions } from "electron";

export type ServerPageState = "none" | "loading" | "ready";

export interface DesktopPagePort {
  show: () => void;
  serverPage: () => ServerPageState;
  send: (page: DesktopPage) => void;
  load: (path: string) => void;
}

export function openDesktopPage(page: DesktopPage, port: DesktopPagePort): void {
  port.show();
  switch (port.serverPage()) {
    case "none":
      return;
    case "loading":
      port.load(desktopPages[page]);
      return;
    case "ready":
      port.send(page);
  }
}

export function notificationSettingsMenuItem(
  id: string,
  label: string,
  port: DesktopPagePort,
): MenuItemConstructorOptions & { click: () => void } {
  return { id, label, click: () => openDesktopPage("notifications", port) };
}
