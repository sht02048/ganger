import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import appConfig from "../../app.json";
import { Button, Card, SwitchRow } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { t } from "../i18n";
import { ScreenHeader } from "../screen-header";

export const NOTIFICATION_KINDS = [
  "question",
  "permission",
  "humanCheck",
  "failedDisconnected",
  "runnerIssue",
] as const;

type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationPreferences {
  enabled: boolean;
  kinds: Record<NotificationKind, boolean>;
}

export const INITIAL_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  kinds: {
    question: true,
    permission: true,
    humanCheck: true,
    failedDisconnected: true,
    runnerIssue: true,
  },
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text variant="meta">{label}</Text>
      <Text variant="body" tone="primary">
        {value}
      </Text>
    </View>
  );
}

export interface SettingsConnection {
  server: string;
  status: string;
  serverVersion: string | null;
  deviceName: string | null;
  disconnectFailed: boolean;
  disconnecting: boolean;
  forgetFailed: boolean;
  onDisconnect: () => void;
  onForgetLocal: () => void;
}

export interface SettingsDemo {
  emptyPreview: boolean;
  onEmptyPreviewChange: (next: boolean) => void;
  preferences: NotificationPreferences;
  onPreferencesChange: (next: NotificationPreferences) => void;
  onExit?: () => void;
}

function ConnectionCard({ connection }: { connection: SettingsConnection }) {
  return (
    <Card>
      <InfoRow label={t("settings.server")} value={connection.server} />
      <InfoRow label={t("settings.connection")} value={connection.status} />
      {connection.deviceName === null ? null : (
        <InfoRow label={t("settings.deviceName")} value={connection.deviceName} />
      )}
      {connection.serverVersion === null ? null : (
        <InfoRow label={t("settings.serverVersion")} value={connection.serverVersion} />
      )}
      <Button
        label={t("settings.disconnect")}
        variant="danger"
        disabled={connection.disconnecting}
        onPress={connection.onDisconnect}
      />
      {connection.disconnectFailed ? (
        <>
          <Text variant="meta" tone="problem" accessibilityRole="alert">
            {t("settings.disconnectFailed")}
          </Text>
          <Button label={t("settings.forgetLocal")} onPress={connection.onForgetLocal} />
          {connection.forgetFailed ? (
            <Text variant="meta" tone="problem" accessibilityRole="alert">
              {t("settings.forgetFailed")}
            </Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function DemoSections({ demo }: { demo: SettingsDemo }) {
  const { preferences, onPreferencesChange } = demo;
  return (
    <>
      <Card>
        <InfoRow label={t("settings.server")} value={t("settings.serverDemo")} />
        <InfoRow label={t("settings.connection")} value={t("settings.connectionDemo")} />
        {demo.onExit === undefined ? (
          <Button label={t("settings.disconnect")} variant="danger" disabled />
        ) : (
          <Button label={t("settings.exitDemo")} onPress={demo.onExit} />
        )}
      </Card>
      <Text variant="meta" tone="secondary" heading>
        {t("settings.notifications")}
      </Text>
      <Card>
        <SwitchRow
          label={t("settings.notificationsOn")}
          value={preferences.enabled}
          onChange={(enabled) => onPreferencesChange({ ...preferences, enabled })}
        />
        <Text variant="meta">{t("settings.pushNotice")}</Text>
      </Card>
      <Text variant="meta" tone="secondary" heading>
        {t("settings.notificationKinds")}
      </Text>
      <Card>
        {NOTIFICATION_KINDS.map((kind) => (
          <SwitchRow
            key={kind}
            label={t(`settings.kind.${kind}`)}
            value={preferences.kinds[kind]}
            disabled={!preferences.enabled}
            onChange={(next) =>
              onPreferencesChange({
                ...preferences,
                kinds: { ...preferences.kinds, [kind]: next },
              })
            }
          />
        ))}
      </Card>
      <Text variant="meta" tone="secondary" heading>
        {t("settings.demo")}
      </Text>
      <Card>
        <SwitchRow
          label={t("settings.emptyPreview")}
          value={demo.emptyPreview}
          onChange={demo.onEmptyPreviewChange}
        />
      </Card>
    </>
  );
}

export function SettingsScreen({
  connection,
  demo,
  band = null,
  onBack,
}: {
  connection?: SettingsConnection;
  demo?: SettingsDemo;
  band?: ReactNode;
  onBack: () => void;
}) {
  return (
    <View style={styles.root}>
      {band}
      <ScreenHeader title={t("settings.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {connection === undefined ? null : <ConnectionCard connection={connection} />}
        {demo === undefined ? null : <DemoSections demo={demo} />}
        <InfoRow label={t("settings.version")} value={appConfig.expo.version} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space.s4, gap: space.s3 },
  infoRow: { gap: space.s1 },
});
