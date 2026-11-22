import { toAgentId, toRunnerProjectId, toTicketKey, toTrackerProjectId } from "@ganger/core";
import { assignRun, changeRunState, requestRunCancel } from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { nextStepInputOfDetail, runNextStep } from "@ganger/app/run-next-step";
import { loadRunDetail } from "@ganger/app/run-detail/load";
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

  it("러너·프로젝트·에이전트 조건으로 들어오면 그 조건의 런을 모두 보이고 토글은 남긴다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now, { conditions: { agent: "claude" } });
    expect(page.endedView).toBe("all");
    expect(page.endedCounts.review).toBeGreaterThan(0);
    const review = loadRunsBoard(db, undefined, now, {
      conditions: { agent: "claude" },
      view: "review",
    });
    expect(review.endedView).toBe("review");
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

  it("처리할 일은 런 상세와 같은 함수로 정하고, 새 런이 있는 옛 런은 확인 필요에서 뺀다", () => {
    const { db, ids } = seedDatabase();
    const failed = endedCases.find((c) => c.summary === "failed");
    if (failed === undefined) throw new Error("seed");
    const failedId = ids.get(failed.key) ?? "";
    expect(loadBoardRun(db, undefined, failedId, now)?.nextStep).not.toBe("none");
    const again = assignRun(db, {
      ticket: { connection, key: toTicketKey(failed.key) },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(115),
    });
    expect(again.ok).toBe(true);
    expect(loadBoardRun(db, undefined, failedId, now)?.nextStep).toBe("none");
    const page = loadRunsBoard(db, undefined, now);
    expect(page.ended.some((run) => run.id === failedId)).toBe(false);
  });

  it("모든 런의 처리할 일이 런 상세와 같고, 취소 중인 Disconnected 도 같다", () => {
    const { db, ids } = seedDatabase();
    const disconnected = ids.get("ACME-12");
    if (disconnected === undefined) throw new Error("seed");
    expect(requestRunCancel(db, disconnected, minutes(110)).ok).toBe(true);
    for (const id of ids.values()) {
      const detail = loadRunDetail(db, id, now);
      if (detail.kind !== "found") throw new Error("detail");
      const workspace = detail.run.workspace.id;
      expect(loadBoardRun(db, workspace, id, now)?.nextStep).toBe(
        runNextStep(nextStepInputOfDetail(detail.run)),
      );
    }
    expect(loadBoardRun(db, undefined, disconnected, now)?.nextStep).toBe("disconnected");
  });

  it("이어서 맡길 수 있는지는 목록이 아니라 고른 런 하나를 읽을 때 정한다", () => {
    const { db, ids } = seedDatabase();
    const failed = endedCases.find((c) => c.summary === "failed");
    if (failed === undefined) throw new Error("seed");
    const id = ids.get(failed.key) ?? "";
    const row = loadRunsBoard(db, undefined, now, { view: "all" }).ended.find((r) => r.id === id);
    expect(row?.canContinue).toBe(false);
    expect(loadBoardRun(db, undefined, id, now)?.canContinue).toBe(true);
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
