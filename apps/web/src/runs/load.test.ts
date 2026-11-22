import { assignRun, changeRunState, updateRunRecords } from "@ganger/db";
import type { Database } from "@ganger/db";
import {
  toAgentId,
  toPullRequestId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
} from "@ganger/core";
import { describe, expect, it, vi } from "vitest";
import {
  activeCases,
  connection,
  endedCases,
  labs,
  minutes,
  now,
  offlineQueuedKey,
  seedDatabase,
} from "../testing/seed";
import { loadStatsPage } from "@ganger/app/stats/load";
import { startOfCalendarDay, trackerProjectKey } from "@ganger/app/runs/conditions";
import { loadRunsPage } from "@ganger/app/runs/load";
import { ENDED_RUNS_PAGE_SIZE } from "@ganger/app/runs/model";
import type { RunView } from "@ganger/app/runs/model";

function addEndedRun(db: Database, key: string, at: Date): void {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject: toTrackerProjectId("tp-web"),
    runnerProject: toRunnerProjectId("github:acme/web"),
    agent: toAgentId("claude"),
    now: at,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  const ended = changeRunState(
    db,
    assigned.run.id,
    { to: "ended", agentResult: "canceled", prState: "none" },
    at,
  );
  if (!ended.ok) throw new Error(JSON.stringify(ended.error));
}

function countRunRowsRead(db: Database, read: () => void): number {
  const reads: Array<{ mock: { results: Array<{ type: string; value: unknown }> } }> = [];
  const prepare = db.$client.prepare.bind(db.$client);
  const spy = vi.spyOn(db.$client, "prepare").mockImplementation((source: string) => {
    const statement = prepare(source);
    if (/from "runs"/.test(source)) reads.push(vi.spyOn(statement, "all"));
    return statement;
  });
  try {
    read();
  } finally {
    spy.mockRestore();
  }
  return reads
    .flatMap((all) => all.mock.results)
    .reduce((rows, result) => rows + (Array.isArray(result.value) ? result.value.length : 0), 0);
}

function byKey(runs: ReadonlyArray<RunView>): Map<string, RunView> {
  return new Map(runs.map((run) => [run.ticketKey, run]));
}

describe("loadRunsPage", () => {
  it("Ended 런의 두 축과 core 로 계산한 요약 결과를 담는다", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const runs = byKey(page.runs);
    for (const c of endedCases) {
      expect({ key: c.key, ...runs.get(c.key) }).toMatchObject({
        key: c.key,
        state: "ended",
        agentResult: c.agentResult,
        prState: c.prState,
        summary: c.summary,
      });
    }
    const ended = page.runs.flatMap((run) => (run.state === "ended" ? [run] : []));
    expect(new Set(ended.map((run) => run.agentResult)).size).toBe(6);
    expect(new Set(ended.map((run) => run.prState)).size).toBe(4);
  });

  it("상태 다섯을 담고, Ended 가 아닌 런에는 두 축이 없다", () => {
    const { db } = seedDatabase();
    const runs = byKey(loadRunsPage(db, undefined, now).runs);
    for (const c of activeCases) {
      const run = runs.get(c.key);
      expect({ key: c.key, state: run?.state }).toEqual({ key: c.key, state: c.state });
      expect(run).not.toHaveProperty("agentResult");
      expect(run).not.toHaveProperty("summary");
    }
    expect(new Set([...runs.values()].map((run) => run.state)).size).toBe(5);
  });

  it("Queued 런에 시작하지 않은 이유를 담는다(Q65·Q68)", () => {
    const { db } = seedDatabase();
    const runs = byKey(loadRunsPage(db, undefined, now).runs);
    expect(runs.get("ACME-13")).toMatchObject({
      state: "queued",
      queuedReason: { kind: "starting" },
      runner: { name: "runner-a", online: true },
    });
    expect(runs.get(offlineQueuedKey)).toMatchObject({
      state: "queued",
      queuedReason: { kind: "runner-offline" },
      runner: null,
    });
  });

  it("경과 시간, 러너, PR 링크를 담는다", () => {
    const { db } = seedDatabase();
    const runs = byKey(loadRunsPage(db, undefined, now).runs);
    const ended = runs.get("ACME-2");
    expect(ended?.executionMs).toBe(29 * 60_000);
    expect(ended?.pullRequest).toMatchObject({
      displayId: "#2",
      url: "https://example.com/acme/web/pull/2",
      ci: "success",
      closedOnHost: false,
      signals: null,
    });
    expect(ended?.trackerProject).toBe("Web");
    expect(runs.get("ACME-4")?.pullRequest).toBeNull();
    const queued = runs.get("ACME-13");
    expect(queued?.executionMs).toBeNull();
    expect(queued?.waitMs).toBe(now.getTime() - minutes(11).getTime());
  });

  it("http(s)가 아닌 PR 주소는 링크로 걸지 않는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("seed");
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("pr-2"),
        displayId: "#2",
        url: "javascript:alert(1)",
        ci: "success",
        checkedAt: now,
      },
    });
    expect(byKey(loadRunsPage(db, undefined, now).runs).get("ACME-2")?.pullRequest).toBeNull();
  });

  it("새 것부터 둔다", () => {
    const { db } = seedDatabase();
    const keys = loadRunsPage(db, undefined, now).runs.map((run) => run.ticketKey);
    expect(keys[0]).toBe(offlineQueuedKey);
    expect(keys.at(-1)).toBe("ACME-1");
  });
});

describe("끝난 런 상한", () => {
  it("진행 중인 런은 모두, 끝난 런은 상한만큼 새 것부터 읽고 더 있는지 알린다", () => {
    const { db } = seedDatabase();
    const full = loadRunsPage(db, undefined, now);
    const endedKeys = full.runs.filter((run) => run.state === "ended").map((run) => run.ticketKey);
    const activeKeys = full.runs.filter((run) => run.state !== "ended").map((run) => run.ticketKey);
    expect(full.moreEnded).toBe(false);

    const limited = loadRunsPage(db, undefined, now, 3);
    expect(limited.moreEnded).toBe(true);
    const olderAttention = full.runs
      .filter((run) => run.state === "ended" && run.attention)
      .map((run) => run.ticketKey)
      .filter((key) => !endedKeys.slice(0, 3).includes(key));
    expect(limited.runs.filter((run) => run.state === "ended").map((run) => run.ticketKey)).toEqual(
      [...endedKeys.slice(0, 3), ...olderAttention],
    );
    expect(limited.runs.filter((run) => run.state !== "ended").map((run) => run.ticketKey)).toEqual(
      activeKeys,
    );
    expect(loadRunsPage(db, undefined, now, endedKeys.length).moreEnded).toBe(false);
  });

  it("상한 밖의 끝난 런도 To do면 담는다(Dashboard 와 같다)", () => {
    const { db } = seedDatabase();
    const attentionKeys = (runs: ReadonlyArray<RunView>) =>
      runs.filter((run) => run.attention).map((run) => run.ticketKey);
    const before = attentionKeys(loadRunsPage(db, undefined, now).runs);
    expect(before.length).toBeGreaterThan(0);
    for (let i = 0; i < ENDED_RUNS_PAGE_SIZE + 5; i += 1)
      addEndedRun(db, `BULK-${i}`, minutes(200 + i));

    const page = loadRunsPage(db, undefined, minutes(400));
    expect(attentionKeys(page.runs)).toEqual(before);
    expect(page.runs.filter((run) => run.state === "ended").length).toBeGreaterThan(
      ENDED_RUNS_PAGE_SIZE,
    );
  });

  it("끝난 런이 많아도 기본 상한만큼만 읽는다", () => {
    const { db } = seedDatabase();
    const before = loadRunsPage(db, undefined, now);
    const extra = ENDED_RUNS_PAGE_SIZE + 5;
    for (let i = 0; i < extra; i += 1) addEndedRun(db, `BULK-${i}`, minutes(200 + i));
    const page = loadRunsPage(db, undefined, minutes(400));
    const ended = page.runs.filter((run) => run.state === "ended");
    expect(ended.filter((run) => !run.attention)).toHaveLength(ENDED_RUNS_PAGE_SIZE);
    expect(ended[0]?.ticketKey).toBe(`BULK-${extra - 1}`);
    expect(page.moreEnded).toBe(true);
    const rowsRead = () => countRunRowsRead(db, () => loadRunsPage(db, undefined, minutes(400)));
    const before100More = rowsRead();
    for (let i = 0; i < 100; i += 1) addEndedRun(db, `MORE-${i}`, minutes(300 + i));
    expect(rowsRead()).toBe(before100More);
    expect(page.runs.filter((run) => run.state !== "ended")).toHaveLength(
      before.runs.filter((run) => run.state !== "ended").length,
    );
  });
});

describe("Workspace 범위(ADR 0006)", () => {
  it("Workspace 를 바꾸면 그 Workspace 의 런만 담는다", () => {
    const { db } = seedDatabase();
    const commercePage = loadRunsPage(db, "ws-commerce", now);
    const labsPage = loadRunsPage(db, labs, now);
    expect(labsPage.workspace).toEqual({
      kind: "one",
      workspace: { id: "ws-labs", name: "Acme Labs" },
    });
    expect(labsPage.runs.map((run) => run.ticketKey)).toEqual(["LAB-1"]);
    expect(commercePage.runs.map((run) => run.ticketKey)).not.toContain("LAB-1");
    expect(commercePage.runs).toHaveLength(endedCases.length + activeCases.length + 1);
  });

  it("ws 가 없거나 모르는 값이면 첫 Workspace 다", () => {
    const { db } = seedDatabase();
    expect(loadRunsPage(db, undefined, now).workspace).toMatchObject({
      workspace: { id: "ws-commerce" },
    });
    expect(loadRunsPage(db, "nope", now).workspace).toMatchObject({
      workspace: { id: "ws-commerce" },
    });
  });

  it("전체에서는 런을 담지 않는다", () => {
    const { db } = seedDatabase();
    expect(loadRunsPage(db, "all", now)).toEqual({
      workspace: { kind: "all" },
      runs: [],
      recentEnded: 0,
      moreEnded: false,
      conditions: [],
    });
  });
});

describe("조건으로 거르기(0075)", () => {
  const keysOf = (runs: ReadonlyArray<RunView>) => runs.map((run) => run.ticketKey).toSorted();

  it("러너 조건이면 그 러너의 런만, 빈 러너면 러너 없는 런만 담는다", () => {
    const { db } = seedDatabase();
    const all = loadRunsPage(db, undefined, now).runs;
    const onA = loadRunsPage(db, undefined, now, ENDED_RUNS_PAGE_SIZE, { runner: "runner-a" });
    expect(keysOf(onA.runs)).toEqual(keysOf(all.filter((run) => run.runner?.name === "runner-a")));
    expect(onA.runs.length).toBeGreaterThan(0);
    expect(onA.conditions).toEqual([{ key: "runner", name: "runner-a" }]);

    const none = loadRunsPage(db, undefined, now, ENDED_RUNS_PAGE_SIZE, { runner: "" });
    expect(keysOf(none.runs)).toEqual([offlineQueuedKey]);
    expect(none.conditions).toEqual([{ key: "runner", name: null }]);
  });

  it("Stats 나눠 보기의 트래커 프로젝트 키로 그 프로젝트의 런만 담는다", () => {
    const { db } = seedDatabase();
    const stats = loadStatsPage(db, undefined, now, "UTC", 14);
    if (!("groups" in stats)) throw new Error("stats");
    const web = stats.groups.trackerProject.find((group) => group.name === "Web");
    if (web === undefined) throw new Error("Web group");
    expect(web.key).toBe(trackerProjectKey(connection, "tp-web"));

    const page = loadRunsPage(db, undefined, now, ENDED_RUNS_PAGE_SIZE, { project: web.key });
    expect(page.runs).toHaveLength(endedCases.length + activeCases.length + 1);
    expect(page.conditions).toEqual([{ key: "project", name: "Web" }]);
    const other = trackerProjectKey(connection, "tp-other");
    expect(loadRunsPage(db, undefined, now, ENDED_RUNS_PAGE_SIZE, { project: other }).runs).toEqual(
      [],
    );
  });

  it("에이전트 조건이면 그 에이전트의 런만 담는다", () => {
    const { db } = seedDatabase();
    expect(
      loadRunsPage(db, undefined, now, ENDED_RUNS_PAGE_SIZE, { agent: "claude" }).runs,
    ).toHaveLength(endedCases.length + activeCases.length + 1);
    const codex = loadRunsPage(db, undefined, now, ENDED_RUNS_PAGE_SIZE, { agent: "codex" });
    expect(codex.runs).toEqual([]);
    expect(codex.conditions).toEqual([{ key: "agent", agent: "codex" }]);
  });

  it("기간 조건이면 Stats 와 같은 날짜 범위에 끝난 런만 담고 진행 중인 런은 뺀다", () => {
    const { db } = seedDatabase();
    addEndedRun(db, "OLD-1", new Date(now.getTime() - 8 * 24 * 60 * 60_000));
    const week = loadRunsPage(db, undefined, now, ENDED_RUNS_PAGE_SIZE, { days: 7 });
    expect(keysOf(week.runs)).toEqual(endedCases.map((c) => c.key).toSorted());
    expect(week.conditions).toEqual([{ key: "days", days: 7 }]);
    const twoWeeks = loadRunsPage(db, undefined, now, ENDED_RUNS_PAGE_SIZE, { days: 14 });
    expect(keysOf(twoWeeks.runs)).toContain("OLD-1");
  });

  it("끝난 런 상한은 조건 안에서 적용하고, 조건 밖 런은 담지 않는다", () => {
    const { db } = seedDatabase();
    for (let i = 0; i < 5; i += 1) addEndedRun(db, `BULK-${i}`, minutes(200 + i));
    const page = loadRunsPage(db, undefined, minutes(400), 3, { runner: "runner-a" });
    const ended = page.runs.filter((run) => run.state === "ended");
    expect(ended.slice(0, 3).map((run) => run.ticketKey)).toEqual(["BULK-4", "BULK-3", "BULK-2"]);
    expect(ended.slice(3).every((run) => run.attention)).toBe(true);
    expect(page.moreEnded).toBe(true);
    expect(page.runs.every((run) => run.runner?.name === "runner-a")).toBe(true);
    expect(page.runs.map((run) => run.ticketKey)).not.toContain(offlineQueuedKey);
  });

  it("조건으로 걸러도 To do는 그 티켓의 마지막 런에만 붙는다", () => {
    const { db } = seedDatabase();
    const failedKey = endedCases.find((c) => c.summary === "failed")?.key ?? "";
    const assigned = assignRun(db, {
      ticket: { connection, key: toTicketKey(failedKey) },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("codex"),
      now: minutes(300),
    });
    if (!assigned.ok) throw new Error(assigned.reason);
    const claude = loadRunsPage(db, undefined, minutes(400), ENDED_RUNS_PAGE_SIZE, {
      agent: "claude",
    });
    expect(claude.runs.find((run) => run.ticketKey === failedKey)?.attention).toBe(false);
  });
});

describe("startOfCalendarDay", () => {
  it("그 시간대에서 그날이 시작하는 순간을 돌려준다", () => {
    const day = Date.UTC(2026, 10, 17);
    expect(startOfCalendarDay(day, "UTC").toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(startOfCalendarDay(day, "Asia/Seoul").toISOString()).toBe("2026-11-16T15:00:00.000Z");
    expect(startOfCalendarDay(Date.UTC(2026, 2, 8), "America/New_York").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });
});
