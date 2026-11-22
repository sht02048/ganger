import type { MenuItemConstructorOptions } from "electron";
import type { EnsureResult } from "../core/local-server.js";

export function viewMenu(options: {
  label: string;
  reloadLabel: string;
}): MenuItemConstructorOptions {
  return {
    id: "view",
    label: options.label,
    submenu: [
      { id: "view-reload", role: "reload", label: options.reloadLabel },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
}

export function screenOutlivedServerSwap(
  result: EnsureResult,
  shownServerUrl: string | undefined,
): boolean {
  return result.kind === "running" && result.replaced && result.status.url === shownServerUrl;
}
