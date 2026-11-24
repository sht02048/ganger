import { loadHomePage } from "@ganger/app/home/load";
import type { HomeRun } from "@ganger/app/home/model";
import { describe, expect, it } from "vitest";
import { now, seedDatabase } from "../testing/seed";
import { LIMIT_LIFT_WATCH_MS, agedHomePage, soonestLimitLiftMs } from "./aged-page";

const MINUTE = 60_000;

function shownTime(run: HomeRun): number | null {
  switch (run.state) {
    case "queued":
      return run.waitMs;
    case "running":
      return run.executionMs;
    case "paused":
      return run.pausedMs;
    case "waiting-for-input":
      return run.waitingMs;
    case "disconnected":
      return run.unreachableMs;
    case "ended":
      return run.endedAgoMs;
  }
}

function later(ms: number | null): number | null {
  return ms === null ? null : ms + 2 * MINUTE;
}

describe("Dashboard 시간 글자는 다시 읽지 않아도 흐른다", () => {
  it("지난 시간은 늘고, 한도가 풀릴 때까지 남은 시간은 줄되 0 아래로 내려가지 않는다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const aged = agedHomePage(page, 2 * MINUTE);
    const runs = [...page.running, ...page.queued, ...page.endedRecently];
    const agedRuns = [...aged.running, ...aged.queued, ...aged.endedRecently];

    expect(agedRuns.map((run) => run.id)).toEqual(runs.map((run) => run.id));
    expect(agedRuns.map(shownTime)).toEqual(runs.map((run) => later(shownTime(run))));
    expect(aged.doneToday.recent.map((run) => run.endedAgoMs)).toEqual(
      page.doneToday.recent.map((run) => run.endedAgoMs + 2 * MINUTE),
    );
    expect(aged.attention.map((item) => item.run.id)).toEqual(
      page.attention.map((item) => item.run.id),
    );
  });

  it("Offline 시간은 늘고 한도가 풀릴 때까지 남은 시간은 줄어 0에서 멈춘다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const runner = page.runners.list[0];
    if (runner === undefined) throw new Error("no runner");
    const withTimes = {
      ...page,
      runners: {
        list: [
          {
            ...runner,
            offlineMs: 5 * MINUTE,
            limits: [{ provider: "claude", window: "session" as const, resetsInMs: 3 * MINUTE }],
          },
        ],
      },
    };

    const two = agedHomePage(withTimes, 2 * MINUTE).runners.list[0];
    const ten = agedHomePage(withTimes, 10 * MINUTE).runners.list[0];

    expect(two).toMatchObject({ offlineMs: 7 * MINUTE, limits: [{ resetsInMs: MINUTE }] });
    expect(ten).toMatchObject({ offlineMs: 15 * MINUTE, limits: [{ resetsInMs: 0 }] });
  });

  it("PR 의 마지막 커밋 시각도 흐른다(티켓 0206)", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const run = page.running[0];
    if (run === undefined) throw new Error("no running run");
    const withPr = {
      ...page,
      running: [
        {
          ...run,
          pullRequest: {
            displayId: "#42",
            url: "https://code.example.com/acme/web/pull/42",
            signals: null,
            ci: "success" as const,
            state: "open" as const,
            settledAt: null,
            settledAgoMs: null,
            branch: null,
            title: null,
            baseBranch: null,
            commitSummary: { count: 3, latestAt: now.toISOString(), latestAgoMs: 5 * MINUTE },
            merge: null,
          },
        },
      ],
    };

    const aged = agedHomePage(withPr, 2 * MINUTE).running[0];

    expect(aged?.pullRequest?.commitSummary).toEqual({
      count: 3,
      latestAt: now.toISOString(),
      latestAgoMs: 7 * MINUTE,
    });
  });

  it("방금 읽은 값은 그대로 돌려준다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(agedHomePage(page, 0)).toBe(page);
  });

  it("하루 안에 가장 먼저 풀리는 한도까지 남은 시간을 알려, 풀리면 다시 읽게 한다(한 달 한도처럼 먼 것은 타이머가 넘치므로 보지 않는다)", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const runner = page.runners.list[0];
    if (runner === undefined) throw new Error("no runner");
    const limit = (resetsInMs: number | null) => ({
      provider: "claude",
      window: "session" as const,
      resetsInMs,
    });
    const withLimits = (limits: ReturnType<typeof limit>[]) => ({
      ...page,
      runners: { list: [{ ...runner, limits }] },
    });

    expect(soonestLimitLiftMs(withLimits([]))).toBeNull();
    expect(soonestLimitLiftMs(withLimits([limit(null)]))).toBeNull();
    expect(soonestLimitLiftMs(withLimits([limit(5 * MINUTE), limit(2 * MINUTE)]))).toBe(2 * MINUTE);
    expect(soonestLimitLiftMs(withLimits([limit(30 * 24 * 60 * MINUTE)]))).toBeNull();
    expect(soonestLimitLiftMs(withLimits([limit(LIMIT_LIFT_WATCH_MS)]))).toBe(LIMIT_LIFT_WATCH_MS);
  });

  it("한도 때문에 기다리는 Queued 런도 한도가 풀릴 때까지 남은 시간이 줄고, 가장 먼저 풀리는 한도에 든다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const queued = page.queued[0];
    if (queued?.state !== "queued") throw new Error("no queued run");
    const waiting: HomeRun = {
      ...queued,
      queuedReason: { kind: "usage-limit", provider: "claude", resetsInMs: 3 * MINUTE },
    };
    const withLimit = { ...page, queued: [waiting], runners: { list: [] } };

    expect(agedHomePage(withLimit, 2 * MINUTE).queued[0]).toMatchObject({
      queuedReason: { kind: "usage-limit", resetsInMs: MINUTE },
    });
    expect(agedHomePage(withLimit, 5 * MINUTE).queued[0]).toMatchObject({
      queuedReason: { resetsInMs: 0 },
    });
    expect(soonestLimitLiftMs(withLimit)).toBe(3 * MINUTE);
    const alreadyLifted: HomeRun = {
      ...waiting,
      queuedReason: { kind: "usage-limit", provider: "claude", resetsInMs: 0 },
    };
    expect(soonestLimitLiftMs({ ...withLimit, queued: [alreadyLifted, waiting] })).toBe(3 * MINUTE);
  });
});
