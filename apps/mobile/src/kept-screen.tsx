import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ScreenShown } from "./design/components";

export function KeptScreen({
  shown,
  testID,
  children,
}: {
  shown: boolean;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <View
      {...(testID === undefined ? {} : { testID })}
      aria-hidden={!shown}
      style={shown ? styles.shown : styles.hidden}
    >
      <ScreenShown value={shown}>{children}</ScreenShown>
    </View>
  );
}

const styles = StyleSheet.create({
  shown: { flex: 1 },
  hidden: { display: "none" },
});
