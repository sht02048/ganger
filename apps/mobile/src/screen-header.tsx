import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "./design/text";
import { size, space } from "./design/tokens";
import { t } from "./i18n";

export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        onPress={onBack}
        style={styles.back}
      >
        <Text variant="panel" tone="secondary">
          ‹
        </Text>
      </Pressable>
      <Text variant="page" heading>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    paddingHorizontal: space.s2,
    paddingVertical: space.s2,
  },
  back: {
    width: size.touchTarget,
    height: size.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
});
