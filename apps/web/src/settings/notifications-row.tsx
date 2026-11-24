import { Button, SettingsRow } from "@ganger/ui";
import type { DesktopNotificationSummary } from "@ganger/app/notifications/desktop";
import { useTranslations } from "use-intl";
import { useDesktopNotifications } from "../shell/desktop-notifications";

export function NotificationsRow() {
  const notifications = useDesktopNotifications();
  switch (notifications.kind) {
    case "unknown":
      return null;
    case "browser":
      return <BrowserNotificationsRow />;
    case "desktop":
      return <DesktopNotificationsRow summary={notifications.summary} open={notifications.open} />;
  }
}

export function BrowserNotificationsRow() {
  const t = useTranslations("settings.notifications");
  return <SettingsRow label={t("label")} detail={t("browser")} />;
}

export function DesktopNotificationsRow({
  summary,
  open,
}: {
  summary: DesktopNotificationSummary | null;
  open: () => void;
}) {
  const t = useTranslations("settings.notifications");
  return (
    <SettingsRow
      label={t("label")}
      {...(summary === null
        ? {}
        : {
            detail: <NotificationsDetail summary={summary} />,
            detailTone: summary.permission === "denied" ? "problem" : "default",
          })}
      control={<Button onClick={open}>{t("open")}</Button>}
    />
  );
}

function NotificationsDetail({ summary }: { summary: DesktopNotificationSummary }) {
  const t = useTranslations("settings.notifications");
  const permission = t(`permission.${summary.permission}`);
  if (summary.permission === "denied" || summary.permission === "not-asked") return permission;
  const receiving = summary.enabled
    ? t("receiving", { on: summary.groupsOn, total: summary.groupsTotal })
    : t("off");
  return t("detail", { permission, receiving });
}
