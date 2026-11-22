import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";

import { Text } from "../design/text";
import { radius } from "../design/tokens";
import { t } from "../i18n";

export function QrScanner({ onRead }: { onRead: (text: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const read = useRef(false);
  useEffect(() => {
    if (permission?.granted === false && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);
  if (permission === null) return null;
  if (!permission.granted) {
    return (
      <Text variant="meta" tone="problem" accessibilityRole="alert">
        {t("connection.cameraDenied")}
      </Text>
    );
  }
  return (
    <View style={styles.frame}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (read.current) return;
          read.current = true;
          onRead(data);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 1, borderRadius: radius.card, overflow: "hidden" },
});
