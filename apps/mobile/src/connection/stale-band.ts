import { t } from "../i18n";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function staleBandText(fetchedAt: number, now: number, reason: string): string {
  const ago = Math.max(0, now - fetchedAt);
  if (ago < MINUTE_MS) return t("connection.band.staleJustNow", { reason });
  if (ago < HOUR_MS) {
    return t("connection.band.stale", { reason, minutes: Math.floor(ago / MINUTE_MS) });
  }
  if (ago < DAY_MS) {
    return t("connection.band.staleHours", { reason, hours: Math.floor(ago / HOUR_MS) });
  }
  return t("connection.band.staleDays", { reason, days: Math.floor(ago / DAY_MS) });
}
