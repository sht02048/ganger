import type { ReactNode } from "react";
import { createTranslator } from "use-intl";
import { resolveWorkspace } from "@ganger/app/shell/model";
import { defaultLocale } from "../i18n";
import { useDesktopApp } from "../shell/desktop-notifications";
import { useShell } from "../shell/shell-query";
import { settingsMessages } from "./messages";
import { NavigationGuard, type UnsavedGuard } from "./navigation-guard";
import { SettingsPagesNav, settingsNavState } from "./settings-frame";
import { routerSettingsLink } from "./settings-link";
import type { SettingsPageId, WorkspaceView } from "./settings-page";
import { useSettingsPage } from "./settings-query";

const t = createTranslator({
  locale: defaultLocale,
  messages: settingsMessages,
  namespace: "settings",
});

export function settingsDocumentTitle(name?: string): string {
  return name === undefined ? t("documentTitle") : t("pageDocumentTitle", { name });
}

export function settingsPageHead(page: SettingsPageId) {
  return () => ({ meta: [{ title: settingsDocumentTitle(t(`pages.${page}`)) }] });
}

export function renderNavigationGuard(guard: UnsavedGuard): ReactNode {
  return <NavigationGuard {...guard} />;
}

export function useWorkspaceView(ws: string | undefined): WorkspaceView {
  return resolveWorkspace(useShell().workspaces, ws).kind;
}

export function useSettingsNav(current: SettingsPageId, ws: string | undefined): ReactNode {
  const page = useSettingsPage(ws);
  const desktop = useDesktopApp() === "desktop";
  return (
    <SettingsPagesNav
      current={current}
      state={settingsNavState(page, desktop)}
      renderLink={routerSettingsLink}
    />
  );
}
