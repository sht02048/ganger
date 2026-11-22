import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";

import { CameraFrame } from "../design/components";
import { Text } from "../design/text";
import { t } from "../i18n";

export function QrScanner({ onRead }: { onRead: (text: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const read = useRef(false);
  useEffect(() => {
    if (permission?.granted === false && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);
  if (permission === null) return null;
  if (!permission.granted) {
    if (permission.canAskAgain) return null;
    return (
      <Text variant="meta" tone="problem" accessibilityRole="alert">
        {t("connection.cameraDenied")}
      </Text>
    );
  }
  return (
    <CameraFrame>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (read.current) return;
          read.current = true;
          onRead(data);
        }}
      />
    </CameraFrame>
  );
}
