import type { HomeRun, QueuedReason, RunnerView } from "./demo/contract";
import {
  endsWithFinalConsonant,
  limitedRunners,
  readyAgainInMs,
  todoGroupOf,
} from "./dashboard/model";
import type { Board, TodoGroupKind } from "./dashboard/model";
import { t } from "./i18n";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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

export function queuedLine(run: HomeRun & { state: "queued" }): string {
  const reason: QueuedReason = run.queuedReason;
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
        provider: reason.provider,
        duration: formatDuration(reason.resetsInMs),
      });
    case "blockers-waiting":
      return t("card.blockerLine.waiting");
    case "blockers-stuck":
      return reason.blocker === null && reason.blockers.length === 0
        ? t("card.blockerLine.unreadable")
        : t(`card.blockerLine.${reason.cause}`);
  }
}

const SUMMARY_ORDER: ReadonlyArray<TodoGroupKind> = ["check", "answer", "stopped"];

export function dashboardSummary(board: Board, runners: ReadonlyArray<RunnerView>): string {
  const todo = [...board.running.humanCheck, ...board.running.todo, ...board.done.todo];
  const inProgress = board.running.rest.length + board.queued.length;
  const work =
    todo.length === 0
      ? inProgress === 0
        ? t("dashboard.summary.idle")
        : t("dashboard.summary.inProgress", { count: inProgress })
      : t("dashboard.summary.sentence", {
          list: SUMMARY_ORDER.flatMap((kind) => {
            const count = todo.filter((run) => todoGroupOf(run) === kind).length;
            return count === 0 ? [] : [t(`dashboard.summary.${kind}`, { count })];
          }).join(t("dashboard.summary.separator")),
        });
  const limited = limitedRunners(runners);
  if (limited.length === 0) return work;
  const readyTimes = limited.flatMap((runner) => {
    const ms = readyAgainInMs(runner);
    return ms === null ? [] : [ms];
  });
  const limit =
    readyTimes.length === 0
      ? t("dashboard.summary.limitUnknown", { count: limited.length })
      : t("dashboard.summary.limit", {
          count: limited.length,
          duration: formatDuration(Math.min(...readyTimes)),
        });
  return t("dashboard.summary.withLimit", { work, limit });
}
