import { toAgentId, toRunnerProjectId, toTicketKey, toTrackerProjectId } from "@ganger/core";
import { assignRun, changeRunState } from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { pickBoardConditions } from "@ganger/app/runs/board";
import { loadBoardRun, loadRunsBoard } from "@ganger/app/runs/board-load";
import { connection, endedCases, labs, minutes, now, seedDatabase } from "../testing/seed";

function addEnded(db: Database, key: string, at: Date, agentResult = "canceled" as const) {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject: toTrackerProjectId("tp-web"),
    runnerProject: toRunnerProjectId("github:acme/web"),
    agent: toAgentId("claude"),
    now: at,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  const result = changeRunState(
    db,
    assigned.run.id,
    { to: "ended", agentResult, prState: "none" },
    at,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return assigned.run.id;
}

const DAY = 24 * 60 * 60_000;

describe("Runs 보드 읽기(0173)", () => {
  it("확인 필요가 있으면 처음에 그것만, 토글로 모두를 본다", () => {
    const { db } = seedDatabase();
    const first = loadRunsBoard(db, undefined, now);
    expect(first.endedView).toBe("review");
    expect(first.ended.length).toBe(first.endedCounts.review);
    expect(first.endedCounts.review).toBeGreaterThan(0);
    expect(first.endedCounts.all).toBe(endedCases.length);
    expect(first.ended.every((run) => run.state === "ended" && run.summary === "failed")).toBe(
      true,
    );
    const all = loadRunsBoard(db, undefined, now, { view: "all" });
    expect(all.endedView).toBe("all");
    expect(all.ended.length).toBe(endedCases.length);
  });

  it("확인 필요가 없으면 처음부터 모두다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, labs, now, { view: "review" });
    expect(page.endedCounts.review).toBe(0);
    expect(page.endedView).toBe("all");
  });

  it("기간 기본은 7일이고 진행 중인 런은 기간과 상관없이 보인다", () => {
    const { db } = seedDatabase();
    const old = addEnded(db, "ACME-OLD", new Date(now.getTime() - 8 * DAY));
    const page = loadRunsBoard(db, undefined, now, { view: "all" });
    expect(page.days).toBe(7);
    expect(page.ended.some((run) => run.id === old)).toBe(false);
    expect(page.active.length).toBeGreaterThan(0);
    const month = loadRunsBoard(db, undefined, now, { view: "all", conditions: { days: 30 } });
    expect(month.ended.some((run) => run.id === old)).toBe(true);
    expect(month.active.length).toBe(page.active.length);
  });

  it("오늘은 운영자 시간대의 오늘 끝난 런만이다", () => {
    const { db } = seedDatabase();
    const yesterday = addEnded(db, "ACME-Y", new Date(now.getTime() - DAY));
    const today = addEnded(db, "ACME-T", minutes(119));
    const page = loadRunsBoard(db, undefined, now, {
      view: "all",
      conditions: { days: 1 },
      timeZone: "UTC",
    });
    const ids = page.ended.map((run) => run.id);
    expect(ids).toContain(today);
    expect(ids).not.toContain(yesterday);
  });

  it("끝난 런은 페이지 크기만큼 읽고 더 있는지 알린다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now, { view: "all", endedLimit: 2 });
    expect(page.ended).toHaveLength(2);
    expect(page.moreEnded).toBe(true);
    expect(page.endedCounts.all).toBe(endedCases.length);
  });

  it("Stats 의 Failed 링크는 Failed 런만 보이고 토글을 쓰지 않는다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now, { failedOnly: true });
    expect(page.endedView).toBe("all");
    expect(page.ended.map((run) => run.ticketKey).sort()).toEqual(
      endedCases
        .filter((c) => c.summary === "failed")
        .map((c) => c.key)
        .sort(),
    );
  });

  it("러너 자리는 다른 Workspace 의 런까지 세고, 조건이 걸려도 그대로다", () => {
    const { db } = seedDatabase();
    const all = loadRunsBoard(db, undefined, now);
    const filtered = loadRunsBoard(db, undefined, now, { conditions: { agent: "codex" } });
    expect(filtered.active).toHaveLength(0);
    expect(filtered.runners).toEqual(all.runners);
    expect(all.runners.find((r) => r.id === "runner-a")?.capacity).toBe(10);
  });

  it("조건은 URL 값 그대로 칩이 되고 오늘(1)도 받는다", () => {
    expect(
      pickBoardConditions({ runner: "r", project: undefined, agent: "claude", days: 1 }),
    ).toEqual({ runner: "r", agent: "claude", days: 1 });
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now, {
      conditions: { runner: "runner-a", days: 14 },
    });
    expect(page.conditions).toEqual([
      { key: "runner", name: "runner-a" },
      { key: "days", days: 14 },
    ]);
  });

  it("목록 밖의 런도 sel 로 읽고, 다른 Workspace 의 런은 읽지 않는다", () => {
    const { db } = seedDatabase();
    const old = addEnded(db, "ACME-OLD", new Date(now.getTime() - 40 * DAY));
    expect(loadBoardRun(db, undefined, old, now)?.ticketKey).toBe("ACME-OLD");
    expect(loadBoardRun(db, labs, old, now)).toBeNull();
    expect(loadBoardRun(db, undefined, "none", now)).toBeNull();
  });
});
