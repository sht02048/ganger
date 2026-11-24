export const navShortcuts = [
  { screen: "dashboard", path: "/", shortcut: "Mod+1" },
  { screen: "tickets", path: "/tickets", shortcut: "Mod+2" },
  { screen: "runs", path: "/runs", shortcut: "Mod+3" },
  { screen: "runners", path: "/runners", shortcut: "Mod+4" },
  { screen: "stats", path: "/stats", shortcut: "Mod+5" },
  { screen: "settings", path: "/settings", shortcut: "Mod+," },
] as const;

export type NavShortcut = (typeof navShortcuts)[number];
export type NavScreen = NavShortcut["screen"];

export const navScreens: ReadonlyArray<NavScreen> = navShortcuts.map((item) => item.screen);

export function navShortcutOf(screen: NavScreen): NavShortcut {
  const found = navShortcuts.find((item) => item.screen === screen);
  if (found === undefined) throw new Error(`unknown screen: ${screen}`);
  return found;
}

export function isNavScreen(value: unknown): value is NavScreen {
  return typeof value === "string" && navScreens.some((screen) => screen === value);
}

function pathKeepingWorkspace(path: string, currentSearch: string): string {
  const workspace = new URLSearchParams(currentSearch).get("ws");
  return workspace === null ? path : `${path}?${new URLSearchParams({ ws: workspace }).toString()}`;
}

export function navPathKeepingWorkspace(screen: NavScreen, currentSearch: string): string {
  return pathKeepingWorkspace(navShortcutOf(screen).path, currentSearch);
}

export const desktopPages = { notifications: "/settings/notifications" } as const;
export type DesktopPage = keyof typeof desktopPages;

export function isDesktopPage(value: unknown): value is DesktopPage {
  return typeof value === "string" && Object.hasOwn(desktopPages, value);
}

export const DESKTOP_NAVIGATION_GLOBAL = "gangerDesktopNavigation";
