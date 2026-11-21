import { useFormatter, useTranslations } from "use-intl";
import { DAY_MS } from "@ganger/app/time-zone";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export interface TimeFormat {
  duration: (ms: number) => string;
  elapsed: (ms: number) => string;
  ago: (at: Date | string, agoMs: number) => string;
  clock: (at: Date | string) => string;
  stamp: (at: Date | string, now: Date | string) => string;
  statsDay: (day: number) => { long: string; short: string };
}

export function useTime(): TimeFormat {
  const t = useTranslations("domain");
  const format = useFormatter();

  const duration = (ms: number): string => {
    if (ms >= DAY_MS) return t("duration.days", { days: Math.floor(ms / DAY_MS) });
    const totalMinutes = Math.max(0, Math.floor(ms / MINUTE_MS));
    if (totalMinutes === 0) return t("duration.underMinute");
    if (totalMinutes < 60) return t("duration.minutes", { minutes: totalMinutes });
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? t("duration.hours", { hours })
      : t("duration.hoursMinutes", { hours, minutes });
  };

  const clock = (at: Date | string): string =>
    format.dateTime(toDate(at), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = (at: Date | string): string =>
    format.dateTime(toDate(at), { year: "numeric", month: "numeric", day: "numeric" });

  return {
    duration,
    elapsed: duration,
    ago: (at, agoMs) => {
      if (agoMs < MINUTE_MS) return t("time.justNow");
      if (agoMs < HOUR_MS)
        return t("time.ago", {
          duration: t("duration.minutes", { minutes: Math.floor(agoMs / MINUTE_MS) }),
        });
      if (agoMs < DAY_MS)
        return t("time.ago", {
          duration: t("duration.hours", { hours: Math.floor(agoMs / HOUR_MS) }),
        });
      return format.dateTime(toDate(at), { month: "long", day: "numeric" });
    },
    clock,
    stamp: (at, now) =>
      day(at) === day(now)
        ? clock(at)
        : format.dateTime(toDate(at), {
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }),
    statsDay: (value) => {
      const date = new Date(value);
      const parts = { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
      return { long: t("time.date", parts), short: t("time.dayShort", parts) };
    },
  };
}

function toDate(at: Date | string): Date {
  return typeof at === "string" ? new Date(at) : at;
}
