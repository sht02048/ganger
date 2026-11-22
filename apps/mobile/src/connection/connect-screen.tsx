import { deviceNameSchema, parseConnectionQr } from "@ganger/api";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Button, TextField } from "../design/components";
import { Text } from "../design/text";
import { space } from "../design/tokens";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { connectToServer } from "./client";
import type { ConnectFailure, FetchLike } from "./client";
import { QrScanner } from "./qr-scanner";
import type { StoredConnection } from "./stored-connection";

function failureMessage(failure: ConnectFailure): MessageKey {
  switch (failure.kind) {
    case "code-refused":
      return `connection.error.${failure.reason}`;
    case "invalid-request":
    case "unreachable":
    case "server-error":
    case "host-blocked":
    case "incompatible":
      return `connection.error.${failure.kind}`;
  }
}

export function usableDeviceName(name: string): string {
  const parsed = deviceNameSchema.safeParse(name);
  return parsed.success ? parsed.data : t("connection.defaultDeviceName");
}

export function ConnectScreen({
  fetcher,
  deviceName,
  notice,
  allowPaste,
  onConnected,
  onDemo,
}: {
  fetcher: FetchLike;
  deviceName: string;
  notice: MessageKey | null;
  allowPaste: boolean;
  onConnected: (connection: StoredConnection) => void;
  onDemo: () => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pasted, setPasted] = useState("");

  const connectWith = async (text: string) => {
    setScanning(false);
    setError(null);
    const qr = parseConnectionQr(text.trim());
    if (qr === null) {
      setError("connection.error.invalid-qr");
      return;
    }
    setConnecting(true);
    const reply = await connectToServer(fetcher, { ...qr, name: usableDeviceName(deviceName) });
    setConnecting(false);
    if (!reply.ok) {
      setError(failureMessage(reply.failure));
      return;
    }
    onConnected({ server: qr.server, token: reply.result.token, deviceId: reply.result.deviceId });
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text variant="page" heading>
          {t("connection.title")}
        </Text>
        <Text variant="body" tone="secondary">
          {t("connection.body")}
        </Text>
      </View>
      {notice === null ? null : (
        <Text variant="meta" tone="secondary" accessibilityRole="alert">
          {t(notice)}
        </Text>
      )}
      {error === null ? null : (
        <Text variant="meta" tone="problem" accessibilityRole="alert">
          {t(error)}
        </Text>
      )}
      {connecting ? <Text variant="meta">{t("connection.connecting")}</Text> : null}
      {scanning ? (
        <>
          <Text variant="meta">{t("connection.scanning")}</Text>
          <QrScanner onRead={(text) => void connectWith(text)} />
          <Button label={t("connection.stopScan")} onPress={() => setScanning(false)} />
        </>
      ) : (
        <Button
          label={t("connection.scan")}
          variant="primary"
          disabled={connecting}
          onPress={() => setScanning(true)}
        />
      )}
      {allowPaste ? (
        <>
          <TextField label={t("connection.pasteLabel")} value={pasted} onChangeText={setPasted} />
          <Button
            label={t("connection.pasteSubmit")}
            disabled={connecting || pasted.trim() === ""}
            onPress={() => void connectWith(pasted)}
          />
        </>
      ) : null}
      <Button label={t("connection.demo")} disabled={connecting} onPress={onDemo} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.s4, gap: space.s3 },
  heading: { gap: space.s1 },
});
