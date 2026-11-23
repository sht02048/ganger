import { StyleSheet, View } from "react-native";

import { BackButton } from "./design/components";
import { Text } from "./design/text";
import { space } from "./design/tokens";
import { t } from "./i18n";

export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <BackButton label={t("common.back")} onPress={onBack} />
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
});
