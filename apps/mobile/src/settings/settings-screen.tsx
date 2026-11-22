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

export function SettingsScreen({
  emptyPreview,
  onEmptyPreviewChange,
  preferences,
  onPreferencesChange,
  onBack,
}: {
  emptyPreview: boolean;
  onEmptyPreviewChange: (next: boolean) => void;
  preferences: NotificationPreferences;
  onPreferencesChange: (next: NotificationPreferences) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.root}>
      <ScreenHeader title={t("settings.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <InfoRow label={t("settings.server")} value={t("settings.serverDemo")} />
          <InfoRow label={t("settings.connection")} value={t("settings.connectionDemo")} />
          <Button label={t("settings.disconnect")} variant="danger" disabled />
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
            value={emptyPreview}
            onChange={onEmptyPreviewChange}
          />
        </Card>
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
