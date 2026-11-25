import { PageHeader, ScreenLayout, SettingsLayout, SettingsNav } from "@ganger/ui";
import type { SettingsNavGroup } from "@ganger/ui";
import type { ComponentType, ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { SettingsPage } from "@ganger/app/settings/model";
import type { UnsavedGuard } from "./navigation-guard";
import { EditorProvider } from "./row-state";
import {
  SETTINGS_NAV_GROUPS,
  type RenderSettingsLink,
  type SettingsNavGroupId,
  type SettingsPageId,
} from "./settings-page";

export interface SettingsNavState {
  workspaceName: string | null;
  desktop: boolean;
  problems: ReadonlySet<SettingsPageId>;
}

function unreadPrRuns(install: SettingsPage["install"]): number {
  return install.unreadPrRuns["no-access"] + install.unreadPrRuns.other;
}

export function pageProblems(page: SettingsPage): ReadonlySet<SettingsPageId> {
  const problems = new Set<SettingsPageId>();
  const workspace = page.workspace;
  if (
    workspace !== null &&
    (workspace.bound.length === 0 ||
      workspace.bound.some((b) => b.mapping === null) ||
      workspace.trackerProjects.some((group) => group.error !== null))
  ) {
    problems.add("projects");
  }
  const install = page.install;
  if (
    install.connections.length === 0 ||
    install.connections.some((connection) => connection.webhook.kind === "rejected") ||
    !install.githubConnected ||
    unreadPrRuns(install) > 0
  ) {
    problems.add("connections");
  }
  return problems;
}

export function settingsNavState(page: SettingsPage, desktop: boolean): SettingsNavState {
  return {
    workspaceName: page.workspace?.general.name ?? null,
    desktop,
    problems: pageProblems(page),
  };
}

export function visibleNavPages(
  group: SettingsNavGroupId,
  state: Pick<SettingsNavState, "workspaceName" | "desktop">,
): ReadonlyArray<SettingsPageId> {
  const pages = SETTINGS_NAV_GROUPS[group];
  switch (group) {
    case "workspace":
      return state.workspaceName === null ? ["general"] : pages;
    case "install":
      return pages;
    case "mac":
      return state.desktop ? pages : [];
  }
}

export function SettingsPagesNav({
  current,
  state,
  renderLink,
}: {
  current: SettingsPageId;
  state: SettingsNavState;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings");
  const groupLabel = (group: SettingsNavGroupId): string =>
    group === "workspace" && state.workspaceName !== null
      ? t("navGroups.workspaceNamed", { name: state.workspaceName })
      : t(`navGroups.${group}`);
  const groups: SettingsNavGroup[] = (["workspace", "install", "mac"] as const)
    .map((group) => ({
      id: group,
      label: groupLabel(group),
      items: visibleNavPages(group, state).map((page) => ({
        id: page,
        label: t(`pages.${page}`),
        problem: state.problems.has(page),
        render: (props: Parameters<RenderSettingsLink>[1]) =>
          renderLink({ kind: "page", page }, props),
      })),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <SettingsNav
      label={t("nav.label")}
      problemLabel={t("nav.problem")}
      current={current}
      groups={groups}
    />
  );
}

export interface SettingsFrameProps {
  title: ReactNode;
  titleId?: string;
  nav: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function withSettingsEditors<P extends { renderGuard?: (guard: UnsavedGuard) => ReactNode }>(
  Page: ComponentType<P>,
  blockedSelector?: string,
): ComponentType<P> {
  return function SettingsEditors(props: P) {
    return (
      <EditorProvider
        {...(props.renderGuard === undefined ? {} : { renderGuard: props.renderGuard })}
        {...(blockedSelector === undefined ? {} : { blockedSelector })}
      >
        <Page {...props} />
      </EditorProvider>
    );
  };
}

export function SettingsFrame({
  title,
  titleId,
  nav,
  subtitle,
  actions,
  children,
}: SettingsFrameProps) {
  return (
    <ScreenLayout
      header={
        <PageHeader
          title={title}
          {...(titleId === undefined ? {} : { titleId })}
          {...(subtitle === undefined ? {} : { subtitle })}
          {...(actions === undefined ? {} : { actions })}
        />
      }
    >
      <SettingsLayout nav={nav}>{children}</SettingsLayout>
    </ScreenLayout>
  );
}
