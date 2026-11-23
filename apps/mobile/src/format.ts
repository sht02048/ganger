import type { AppDashboard } from "@ganger/api";

import { endsWithFinalConsonant } from "./dashboard/model";
import type { QueuedRun } from "./dashboard/model";
import ko from "../messages/ko.json";
import { t } from "./i18n";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function nameIn(names: Readonly<Record<string, string>>, id: string): string {
  return Object.prototype.hasOwnProperty.call(names, id) ? (names[id] ?? id) : id;
}

export function agentName(id: string): string {
  return nameIn(ko.names.agent, id);
}

export function providerName(id: string): string {
  return nameIn(ko.names.provider, id);
}

export function formatDuration(ms: number): string {
  if (ms >= DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    return days === 1 ? t("time.day") : t("time.days", { days });
  }
  const totalMinutes = Math.max(0, Math.floor(ms / MINUTE_MS));
  if (totalMinutes === 0) return t("time.underMinute");
  if (totalMinutes < 60) return t("time.minutes", { minutes: totalMinutes });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? t("time.hours", { hours }) : t("time.hoursMinutes", { hours, minutes });
}

export function formatAgo(at: string, agoMs: number): string {
  if (agoMs < MINUTE_MS) return t("time.justNow");
  if (agoMs < HOUR_MS) {
    return t("time.ago", {
      duration: t("time.minutes", { minutes: Math.floor(agoMs / MINUTE_MS) }),
    });
  }
  if (agoMs < DAY_MS) {
    return t("time.ago", { duration: t("time.hours", { hours: Math.floor(agoMs / HOUR_MS) }) });
  }
  const date = new Date(at);
  return t("time.date", { month: date.getMonth() + 1, day: date.getDate() });
}

export function queuedLine(run: QueuedRun): string {
  const reason = run.queuedReason;
  switch (reason.kind) {
    case "behind":
    case "no-capacity":
      return t("card.queued.free");
    case "runner-offline":
      return run.runner === null
        ? t("card.queued.anyOffline")
        : t("card.queued.offline", {
            runner: run.runner.name,
            particle: endsWithFinalConsonant(run.runner.name)
              ? t("card.queued.particleConsonant")
              : t("card.queued.particleVowel"),
          });
    case "starting":
      return t("card.queued.starting");
    case "project-missing":
      return t("card.queued.projectMissing");
    case "assignment-blocked":
      return t("card.queued.assignmentBlocked");
    case "usage-limit":
      return t("card.queued.usageLimit", {
        provider: providerName(reason.provider),
        duration: formatDuration(reason.resetsInMs),
      });
    case "blockers-waiting":
      return t("card.blockerLine.waiting");
    case "blockers-stuck":
      return reason.blocker === null && reason.blockers.length === 0
        ? t("card.blockerLine.unreadable")
        : t(`card.blockerLine.${reason.cause}`);
    case "unknown":
      return t("card.queued.unknown");
  }
}

const SUMMARY_ORDER = ["check", "answer", "stopped"] as const;

export function dashboardSummary({ summary }: AppDashboard): string {
  const groups = SUMMARY_ORDER.flatMap((kind) => {
    const count = summary.todo[kind];
    return count === 0 ? [] : [t(`dashboard.summary.${kind}`, { count })];
  });
  const work =
    groups.length === 0
      ? summary.inProgress === 0
        ? t("dashboard.summary.idle")
        : t("dashboard.summary.inProgress", { count: summary.inProgress })
      : t("dashboard.summary.sentence", {
          list: groups.join(t("dashboard.summary.separator")),
        });
  if (summary.limitedRunners === 0) return work;
  const limit =
    summary.soonestLimitResetMs === null
      ? t("dashboard.summary.limitUnknown", { count: summary.limitedRunners })
      : t("dashboard.summary.limit", {
          count: summary.limitedRunners,
          duration: formatDuration(summary.soonestLimitResetMs),
        });
  return t("dashboard.summary.withLimit", { work, limit });
}
