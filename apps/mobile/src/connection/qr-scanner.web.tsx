import { Text } from "../design/text";
import { t } from "../i18n";

export function QrScanner(_props: { onRead: (text: string) => void }) {
  return (
    <Text variant="meta" tone="problem" accessibilityRole="alert">
      {t("connection.cameraDenied")}
    </Text>
  );
}
