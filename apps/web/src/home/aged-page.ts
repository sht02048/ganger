import { useEffect, useMemo, useState } from "react";
import type { DashboardRunner, DoneRun, HomePage, HomeRun } from "@ganger/app/home/model";
import type { QueuedReason } from "@ganger/app/runs/model";

export const TIME_TEXT_TICK_MS = 15_000;

function later(ms: number | null, by: number): number | null {
  return ms === null ? null : ms + by;
}

function sooner(ms: number, by: number): number {
  return Math.max(0, ms - by);
}

function ageQueuedReason(reason: QueuedReason, by: number): QueuedReason {
  return reason.kind === "usage-limit"
    ? { ...reason, resetsInMs: sooner(reason.resetsInMs, by) }
    : reason;
}

function ageRun(run: HomeRun, by: number): HomeRun {
  switch (run.state) {
    case "queued":
      return {
        ...run,
        waitMs: run.waitMs + by,
        queuedReason: ageQueuedReason(run.queuedReason, by),
      };
    case "running":
      return { ...run, executionMs: later(run.executionMs, by) };
    case "paused":
      return { ...run, pausedMs: later(run.pausedMs, by) };
    case "waiting-for-input":
      return { ...run, waitingMs: later(run.waitingMs, by) };
    case "disconnected":
      return { ...run, unreachableMs: later(run.unreachableMs, by) };
    case "ended":
      return { ...run, endedAgoMs: run.endedAgoMs + by };
  }
}

function ageRunner(runner: DashboardRunner, by: number): DashboardRunner {
  return {
    ...runner,
    offlineMs: later(runner.offlineMs, by),
    limits: runner.limits.map((limit) => ({
      ...limit,
      resetsInMs: limit.resetsInMs === null ? null : sooner(limit.resetsInMs, by),
    })),
  };
}

function ageDone(run: DoneRun, by: number): DoneRun {
  return { ...run, endedAgoMs: run.endedAgoMs + by };
}

export function agedHomePage(page: HomePage, by: number): HomePage {
  if (by <= 0) return page;
  return {
    ...page,
    attention: page.attention.map((item) => ({ ...item, run: ageRun(item.run, by) })),
    running: page.running.map((run) => ageRun(run, by)),
    queued: page.queued.map((run) => ageRun(run, by)),
    endedRecently: page.endedRecently.map((run) => ageRun(run, by)),
    doneToday: { ...page.doneToday, recent: page.doneToday.recent.map((run) => ageDone(run, by)) },
    runners: { list: page.runners.list.map((runner) => ageRunner(runner, by)) },
  };
}

export const LIMIT_LIFT_MARGIN_MS = 1_000;
export const LIMIT_LIFT_WATCH_MS = 24 * 60 * 60_000;

export function soonestLimitLiftMs(page: HomePage): number | null {
  const runnerLifts = page.runners.list.flatMap((runner) =>
    runner.limits.flatMap((limit) => (limit.resetsInMs === null ? [] : [limit.resetsInMs])),
  );
  const queuedLifts = page.queued.flatMap((run) =>
    run.state === "queued" && run.queuedReason.kind === "usage-limit"
      ? [run.queuedReason.resetsInMs]
      : [],
  );
  const lifts = [...runnerLifts, ...queuedLifts].filter(
    (ms) => ms > 0 && ms <= LIMIT_LIFT_WATCH_MS,
  );
  return lifts.length === 0 ? null : Math.min(...lifts);
}

export function useAgedHomePage(page: HomePage, onLimitLifted: () => void): HomePage {
  const [clock, setClock] = useState({ page, sinceReceived: 0 });
  useEffect(() => {
    const receivedAt = Date.now();
    const timer = setInterval(() => {
      setClock({ page, sinceReceived: Date.now() - receivedAt });
    }, TIME_TEXT_TICK_MS);
    return () => clearInterval(timer);
  }, [page]);
  useEffect(() => {
    const lift = soonestLimitLiftMs(page);
    if (lift === null) return undefined;
    const timer = setTimeout(onLimitLifted, lift + LIMIT_LIFT_MARGIN_MS);
    return () => clearTimeout(timer);
  }, [page, onLimitLifted]);
  const sinceReceived = clock.page === page ? clock.sinceReceived : 0;
  return useMemo(() => agedHomePage(page, sinceReceived), [page, sinceReceived]);
}
