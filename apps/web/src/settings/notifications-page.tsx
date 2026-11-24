import * as stylex from "@stylexjs/stylex";
import {
  Button,
  InfoTip,
  NumberedList,
  ProblemCallout,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  TextLink,
  focusStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { NOTIFICATION_GROUPS } from "@ganger/app/notifications/desktop";
import type {
  NotificationGroup,
  NotificationSettingsView,
  PermissionRequestResult,
  TestNotificationResult,
} from "@ganger/app/notifications/desktop";
import type { DesktopNotifications } from "../shell/desktop-notifications";
import { SettingsFrame } from "./settings-frame";

export type NotificationsBridge = DesktopNotifications | null | undefined;

export interface NotificationsScreenProps {
  bridge: NotificationsBridge;
  nav: ReactNode;
}

export function NotificationsScreen({ bridge, nav }: NotificationsScreenProps) {
  const t = useTranslations("settings");
  return (
    <SettingsFrame title={t("pages.notifications")} nav={nav}>
      {bridge === undefined ? null : bridge === null ? (
        <SettingsGroup>
          <SettingsRow label={t("notifications.browser")} />
        </SettingsGroup>
      ) : (
        <DesktopNotificationSettings bridge={bridge} />
      )}
    </SettingsFrame>
  );
}

function DesktopNotificationSettings({ bridge }: { bridge: DesktopNotifications }) {
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  useEffect(() => {
    let live = true;
    const off = bridge.subscribe(setView);
    void bridge.current().then((first) => {
      if (live && first !== null) setView((shown) => shown ?? first);
    });
    return () => {
      live = false;
      off();
    };
  }, [bridge]);
  if (view === null) return null;
  return <NotificationSettings bridge={bridge} view={view} onChange={setView} />;
}

export function NotificationSettings({
  bridge,
  view,
  onChange,
}: {
  bridge: DesktopNotifications;
  view: NotificationSettingsView;
  onChange: (view: NotificationSettingsView) => void;
}) {
  const t = useTranslations("settings.notifications");
  const ts = useTranslations("settings");
  const enabledId = useId();
  const enabledSwitchId = useId();
  const deviceStatusRef = useRef<HTMLDivElement>(null);
  const reconnected = view.deviceLink === "reconnected";
  useEffect(() => {
    if (reconnected) deviceStatusRef.current?.focus();
  }, [reconnected]);
  const save = (next: NotificationSettingsView) => {
    onChange(next);
    bridge.save({ enabled: next.enabled, groups: next.groups }).catch(() => onChange(view));
  };
  const setGroup = (group: NotificationGroup, checked: boolean) =>
    save({ ...view, groups: { ...view.groups, [group]: checked } });
  return (
    <>
      <div ref={deviceStatusRef} tabIndex={-1} role="status" {...stylex.props(focusStyles.target)}>
        {reconnected ? <Text variant="meta">{t("deviceLink.done")}</Text> : null}
      </div>
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
              onClick={() => bridge.reconnectDevice()}
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
      <PermissionCard bridge={bridge} permission={view.permission} />
      <SettingsSection
        id="receive"
        title={t("receiveTitle")}
        info={<InfoTip label={ts("infoLabel", { label: t("receiveTitle") })} content={t("note")} />}
      >
        <SettingsGroup>
          <SettingsRow
            label={t("enabled.label")}
            labelId={enabledId}
            labelFor={enabledSwitchId}
            detail={t("enabled.description")}
            control={
              <Switch
                id={enabledSwitchId}
                aria-labelledby={enabledId}
                checked={view.enabled}
                onCheckedChange={(enabled) => save({ ...view, enabled })}
              />
            }
          />
          {NOTIFICATION_GROUPS.map((group) => (
            <GroupRow
              key={group}
              group={group}
              checked={view.groups[group]}
              disabled={!view.enabled}
              onChange={(checked) => setGroup(group, checked)}
            />
          ))}
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

function GroupRow({
  group,
  checked,
  disabled,
  onChange,
}: {
  group: NotificationGroup;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations("settings.notifications.groups");
  const labelId = useId();
  const switchId = useId();
  return (
    <SettingsRow
      label={t(`${group}.label`)}
      labelId={labelId}
      labelFor={switchId}
      detail={t(`${group}.description`)}
      disabled={disabled}
      inset
      control={
        <Switch
          id={switchId}
          aria-labelledby={labelId}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      }
    />
  );
}

type PermissionNotice = PermissionRequestResult | TestNotificationResult | null;

export function PermissionCard({
  bridge,
  permission,
}: {
  bridge: DesktopNotifications;
  permission: NotificationSettingsView["permission"];
}) {
  const t = useTranslations("settings.notifications");
  const cardRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const [requesting, setRequesting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<PermissionNotice>(null);
  useEffect(() => {
    if (permission === "allowed") setNotice((shown) => (shown === "sent" ? shown : null));
  }, [permission]);
  const request = async () => {
    setRequesting(true);
    setNotice(null);
    const result = await bridge
      .requestPermission()
      .catch((): PermissionRequestResult => "not-allowed");
    setRequesting(false);
    setNotice(result === "allowed" ? null : result);
    if (result === "allowed") cardRef.current?.focus();
    else statusRef.current?.focus();
  };
  const sendTest = async () => {
    setTesting(true);
    setNotice(null);
    const result = await bridge.sendTest().catch((): TestNotificationResult => "failed");
    setTesting(false);
    setNotice(result);
    if (result === "denied") statusRef.current?.focus();
  };
  const settingsButton = (
    <Button onClick={() => bridge.openSystemSettings()}>{t("permission.openSettings")}</Button>
  );
  return (
    <div {...stylex.props(styles.permission)}>
      {permission === "denied" ? (
        <ProblemCallout title={t("permissionOff.title")} actions={settingsButton}>
          {t("permissionOff.body")}
        </ProblemCallout>
      ) : (
        <div ref={cardRef} tabIndex={-1} {...stylex.props(focusStyles.target)}>
          <PermissionRow
            permission={permission}
            control={
              permission === "not-asked" ? (
                <Button
                  variant="primary"
                  busy={{ active: requesting, label: t("permission.notAsked.requesting") }}
                  onClick={() => void request()}
                >
                  {t("permission.notAsked.action")}
                </Button>
              ) : (
                <span {...stylex.props(styles.buttons)}>
                  <Button
                    busy={{ active: testing, label: t("permission.testing") }}
                    onClick={() => void sendTest()}
                  >
                    {t("permission.test")}
                  </Button>
                  {settingsButton}
                </span>
              )
            }
          />
        </div>
      )}
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        {...stylex.props(focusStyles.target, styles.notice)}
      >
        {notice === null ? null : <NoticeText bridge={bridge} notice={notice} />}
      </div>
    </div>
  );
}

function PermissionRow({
  permission,
  control,
}: {
  permission: Exclude<NotificationSettingsView["permission"], "denied">;
  control: ReactNode;
}) {
  const t = useTranslations("settings.notifications.permission");
  const ts = useTranslations("settings");
  const key = permission === "not-asked" ? "notAsked" : permission;
  const title = t(`${key}.title`);
  return (
    <SettingsGroup label={title}>
      <SettingsRow
        label={title}
        {...(key === "allowed"
          ? {
              info: (
                <InfoTip label={ts("infoLabel", { label: title })} content={t("allowed.info")} />
              ),
            }
          : { detail: t(`${key}.body`) })}
        control={control}
      />
    </SettingsGroup>
  );
}

function NoticeText({
  bridge,
  notice,
}: {
  bridge: DesktopNotifications;
  notice: Exclude<PermissionNotice, null>;
}) {
  const t = useTranslations("settings.notifications");
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
                    bridge.openFocusSettings();
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
  permission: { display: "flex", flexDirection: "column", gap: space.s3 },
  buttons: { display: "flex", flexWrap: "wrap", gap: space.s2, justifyContent: "flex-end" },
  notice: { display: "flex", flexDirection: "column" },
  sent: { display: "flex", flexDirection: "column", gap: space.s2 },
});
