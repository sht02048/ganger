import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  documentStyles,
  focusStyles,
  Checkbox,
  InfoTip,
  NumberedList,
  ProblemCallout,
  Section,
  Text,
  TextLink,
  WindowChrome,
  WindowDragFrame,
  textStyles,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import screens from "../../messages/ko/screens.json" with { type: "json" };
import { NOTIFICATION_GROUPS } from "../core/notification-prefs";
import type { NotificationGroup } from "../core/notification-prefs";
import type {
  NotificationSettingsApi,
  NotificationSettingsView,
  PermissionRequestResult,
  TestNotificationResult,
} from "../shared/view";

declare global {
  interface Window {
    desktopNotifications?: NotificationSettingsApi;
  }
}

export function NotificationSettingsWindow() {
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  useEffect(() => {
    const api = window.desktopNotifications;
    if (api === undefined) return;
    const off = api.onNotificationSettings(setView);
    void api.getNotificationSettings().then(setView, () => undefined);
    return off;
  }, []);
  return (
    <IntlProvider locale="ko" messages={{ screens }}>
      <WindowChrome titleBarHidden>
        <div {...stylex.props(documentStyles.body, styles.canvas)}>
          <WindowDragFrame>
            {view === null ? null : <NotificationSettings view={view} onChange={setView} />}
          </WindowDragFrame>
        </div>
      </WindowChrome>
    </IntlProvider>
  );
}

export function NotificationSettings({
  view,
  onChange,
}: {
  view: NotificationSettingsView;
  onChange: (view: NotificationSettingsView) => void;
}) {
  const t = useTranslations("screens.notificationSettings");
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const reconnected = view.deviceLink === "reconnected";
  useEffect(() => {
    if (reconnected) titleRef.current?.focus();
  }, [reconnected]);
  const save = (next: NotificationSettingsView) => {
    onChange(next);
    window.desktopNotifications
      ?.setNotificationSettings({ enabled: next.enabled, groups: next.groups })
      .catch(() => onChange(view));
  };
  const setGroup = (group: NotificationGroup, checked: boolean) =>
    save({ ...view, groups: { ...view.groups, [group]: checked } });
  return (
    <main {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.column)}>
        <header {...stylex.props(styles.header)}>
          <h1 ref={titleRef} tabIndex={-1} {...stylex.props(...textStyles("page"), styles.title)}>
            {t("title")}
          </h1>
          <Text variant="body">{t("summary")}</Text>
        </header>
        <span role="status" {...stylex.props(styles.status)}>
          {reconnected ? <Text variant="meta">{t("deviceLink.done")}</Text> : null}
        </span>
        {view.deviceLink === "connected" || reconnected ? null : (
          <ProblemCallout
            title={
              view.deviceLink === "unsupported"
                ? t("deviceLink.unsupportedTitle")
                : t("deviceLink.title")
            }
            actions={
              <Button
                disabled={view.deviceLink === "reconnecting"}
                onClick={() => void window.desktopNotifications?.reconnectDevice()}
              >
                {view.deviceLink === "reconnecting"
                  ? t("deviceLink.reconnecting")
                  : t("deviceLink.action")}
              </Button>
            }
          >
            {view.deviceLink === "failed"
              ? t("deviceLink.failed")
              : view.deviceLink === "unsupported"
                ? t("deviceLink.unsupportedBody")
                : t("deviceLink.body")}
          </ProblemCallout>
        )}
        <PermissionCard permission={view.permission} />
        <Card padding="compact">
          <Checkbox
            label={t("enabled.label")}
            description={t("enabled.description")}
            checked={view.enabled}
            onCheckedChange={(enabled) => save({ ...view, enabled })}
          />
        </Card>
        <Section
          title={t("groupsLabel")}
          headingLevel="h2"
          {...(view.enabled ? {} : { note: t("groupsOff") })}
        >
          <Card padding="compact">
            <div {...stylex.props(styles.groups)}>
              {NOTIFICATION_GROUPS.map((group) => (
                <Checkbox
                  key={group}
                  label={t(`groups.${group}.label`)}
                  description={t(`groups.${group}.description`)}
                  checked={view.groups[group]}
                  disabled={!view.enabled}
                  onCheckedChange={(checked) => setGroup(group, checked)}
                />
              ))}
            </div>
          </Card>
          <Text variant="meta">{t("note")}</Text>
        </Section>
      </div>
    </main>
  );
}

type PermissionNotice = PermissionRequestResult | TestNotificationResult | null;

function openSystemSettings() {
  void window.desktopNotifications?.openSystemNotificationSettings();
}

export function PermissionCard({
  permission,
}: {
  permission: NotificationSettingsView["permission"];
}) {
  const t = useTranslations("screens.notificationSettings");
  const headingRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const key = permission === "not-asked" ? "notAsked" : permission;
  const [requesting, setRequesting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<PermissionNotice>(null);
  useEffect(() => {
    if (permission === "allowed") setNotice((shown) => (shown === "sent" ? shown : null));
  }, [permission]);
  const request = async () => {
    const api = window.desktopNotifications;
    if (api === undefined) return;
    setRequesting(true);
    setNotice(null);
    const result = await api
      .requestPermission()
      .catch((): PermissionRequestResult => "not-allowed");
    setRequesting(false);
    setNotice(result === "allowed" ? null : result);
    if (result === "allowed") headingRef.current?.focus();
    else statusRef.current?.focus();
  };
  const sendTest = async () => {
    const api = window.desktopNotifications;
    if (api === undefined) return;
    setTesting(true);
    setNotice(null);
    const result = await api.sendTestNotification().catch((): TestNotificationResult => "failed");
    setTesting(false);
    setNotice(result);
    if (result === "denied") statusRef.current?.focus();
  };
  const testButton = (
    <Button
      busy={{ active: testing, label: t("permission.testing") }}
      onClick={() => void sendTest()}
    >
      {t("permission.test")}
    </Button>
  );
  const settingsButton = (
    <Button onClick={openSystemSettings}>{t("permission.openSettings")}</Button>
  );
  return (
    <div {...stylex.props(styles.permission)}>
      {permission === "denied" ? (
        <ProblemCallout title={t("permissionOff.title")} actions={settingsButton}>
          {t("permissionOff.body")}
        </ProblemCallout>
      ) : (
        <Card label={t(`permission.${key}.title`)}>
          <div {...stylex.props(styles.cardBody)}>
            <div {...stylex.props(styles.cardHead)}>
              <Text as="h2" variant="subheading" ref={headingRef} tabIndex={-1}>
                {t(`permission.${key}.title`)}
              </Text>
              {permission === "allowed" ? (
                <InfoTip
                  label={t("permission.allowed.infoLabel")}
                  content={t("permission.allowed.info")}
                />
              ) : null}
            </div>
            {permission === "not-asked" ? (
              <Text variant="body">{t("permission.notAsked.body")}</Text>
            ) : permission === "unknown" ? (
              <Text variant="body">{t("permission.unknown.body")}</Text>
            ) : null}
            <Actions>
              {permission === "not-asked" ? (
                <Button
                  variant="primary"
                  busy={{ active: requesting, label: t("permission.notAsked.requesting") }}
                  onClick={() => void request()}
                >
                  {t("permission.notAsked.action")}
                </Button>
              ) : (
                <>
                  {testButton}
                  {settingsButton}
                </>
              )}
            </Actions>
          </div>
        </Card>
      )}
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        {...stylex.props(focusStyles.target, styles.notice)}
      >
        {notice === null ? null : <NoticeText notice={notice} />}
      </div>
    </div>
  );
}

function NoticeText({ notice }: { notice: Exclude<PermissionNotice, null> }) {
  const t = useTranslations("screens.notificationSettings");
  switch (notice) {
    case "sent":
      return (
        <div {...stylex.props(styles.sent)}>
          <Text variant="body">{t("testResult.sent")}</Text>
          <Text variant="meta">{t("testResult.checkTitle")}</Text>
          <NumberedList
            items={[
              <Text variant="meta">{t("testResult.checkStyle")}</Text>,
              <Text variant="meta">
                {t("testResult.checkFocus")}{" "}
                <TextLink
                  href="#focus-settings"
                  onClick={(event) => {
                    event.preventDefault();
                    void window.desktopNotifications?.openFocusSettings();
                  }}
                >
                  {t("testResult.focusLink")}
                </TextLink>
              </Text>,
              <Text variant="meta">{t("testResult.checkSound")}</Text>,
            ]}
          />
        </div>
      );
    case "unsigned":
      return (
        <Text variant="body" tone="problem">
          {t("testResult.unsigned")}
        </Text>
      );
    case "denied":
      return (
        <Text variant="body" tone="problem">
          {t("testResult.denied")}
        </Text>
      );
    case "failed":
      return (
        <Text variant="body" tone="problem">
          {t("testResult.failed")}
        </Text>
      );
    case "not-allowed":
      return <Text variant="meta">{t("permission.notAsked.notAllowed")}</Text>;
    case "allowed":
      return null;
  }
}

const styles = stylex.create({
  canvas: { minHeight: "100vh" },
  frame: {
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "center",
    minHeight: `calc(100vh - ${size.titleBar})`,
    paddingTop: space.s4,
    paddingBottom: space.s8,
    paddingInline: space.s6,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    width: "100%",
    maxWidth: size.formWidth,
    minWidth: 0,
  },
  header: { display: "flex", flexDirection: "column", gap: space.s2 },
  title: { outline: "none" },
  status: { display: "contents" },
  groups: { display: "flex", flexDirection: "column", gap: space.s1 },
  permission: { display: "flex", flexDirection: "column", gap: space.s3 },
  cardBody: { display: "flex", flexDirection: "column", gap: space.s3 },
  cardHead: { display: "flex", alignItems: "center", gap: space.s2 },
  notice: { display: "flex", flexDirection: "column" },
  sent: { display: "flex", flexDirection: "column", gap: space.s2 },
});
