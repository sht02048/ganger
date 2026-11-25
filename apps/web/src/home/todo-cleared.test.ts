import {
  toAgentId,
  toAgentRef,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  assignRun,
  changeRunState,
  getRunWithRecords,
  listOpenNotificationEvents,
  updateRunRecords,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { toV1Dashboard } from "@ganger/app/devices/dashboard";
import { handleV1RunAction } from "@ganger/app/devices/run-actions";
import { loadHomePage } from "@ganger/app/home/load";
import type { HomePage, HomeRun } from "@ganger/app/home/model";
import { dashboardBoard, isOpenFailed } from "@ganger/app/home/model";
import { notificationCauses } from "@ganger/app/notifications/causes";
import { syncNotifications } from "@ganger/app/notifications/sync";
import { clearTodoOnce } from "@ganger/app/run-detail/actions";
import { loadRunDetail } from "@ganger/app/run-detail/load";
import { nextStepInputOfDetail, runNextStep } from "@ganger/app/run-next-step";
import { loadRunsPage } from "@ganger/app/runs/load";
import { loadShell } from "@ganger/app/shell/load";
import { resolveWorkspace, todoCountOf } from "@ganger/app/shell/model";
import { isTodo } from "@ganger/app/tickets/model";
import { connection, minutes, now, seedDatabase } from "../testing/seed";

const WS = "ws-commerce";

function page(db: Database): HomePage {
  return loadHomePage(db, WS, now, "UTC");
}

function todoKeys(db: Database): string[] {
  return page(db).attention.map((item) => item.run.ticketKey);
}

function seeded(): { db: Database; id: (key: string) => RunId } {
  const { db, ids } = seedDatabase();
  return {
    db,
    id: (key) => {
      const found = ids.get(key);
      if (found === undefined) throw new Error(`${key} missing`);
      return found;
    },
  };
}

function endedRun(db: Database, key: string): Extract<HomeRun, { state: "ended" }> {
  const found = page(db).endedRecently.find((run) => run.ticketKey === key);
  if (found?.state !== "ended") throw new Error(`${key} not ended`);
  return found;
}

function mergeLater(db: Database, runId: RunId): void {
  updateRunRecords(db, runId, { laterPrState: { state: "merged", at: minutes(115) } });
}

function failAgain(db: Database, key: string): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject: toTrackerProjectId("tp-web"),
    runnerProject: toRunnerProjectId("github:acme/web"),
    agent: toAgentId("claude"),
    now: minutes(100),
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  const { id } = assigned.run;
  const started = {
    worktree: toWorktreeRef(`wt-${key}-again`),
    branch: `acme/${key}-again`,
    agentRef: toAgentRef(`agent-${key}-again`),
  };
  for (const change of [
    changeRunState(db, id, { to: "running", started }, minutes(101)),
    changeRunState(
      db,
      id,
      { to: "ended", agentResult: "timed-out", prState: "none" },
      minutes(110),
    ),
  ]) {
    if (!change.ok) throw new Error(JSON.stringify(change));
  }
  return id;
}

function expectAllCountsAgree(db: Database): void {
  const shell = loadShell(db);
  for (const ws of [WS, "all"]) {
    const home = loadHomePage(db, ws, now, "UTC");
    const v1 = toV1Dashboard(home).summary.todo;
    const count = home.attention.length;
    expect(todoCountOf(shell.todo, resolveWorkspace(shell.workspaces, ws))).toBe(count);
    expect(v1.check + v1.answer + v1.stopped).toBe(count);
    expect(notificationCauses(home, [], now).length).toBeLessThanOrEqual(count);
  }
}

const key = (runId: RunId, requestId: string) => ({ runId, requestId });

describe("PR 이 머지된 Failed 런은 To do 에서 빠진다(0235)", () => {
  it("PR 이 Merged 가 되면 빠지고 결과는 Failed 그대로 Done 칸에 PR 머지됨으로 보인다", () => {
    const { db, id } = seeded();
    expect(todoKeys(db)).toContain("ACME-2");

    mergeLater(db, id("ACME-2"));

    expect(todoKeys(db)).not.toContain("ACME-2");
    const run = endedRun(db, "ACME-2");
    expect(run.summary).toBe("failed");
    expect(run.todoCleared).toBe("pr-merged");
    expect(run.pullRequest?.state).toBe("merged");
    const board = dashboardBoard(page(db));
    expect(board.done.rest.map((done) => done.ticketKey)).toContain("ACME-2");
    expect(board.done.todo.map((done) => done.ticketKey)).not.toContain("ACME-2");
    expectAllCountsAgree(db);
  });

  it("Succeeded 런은 PR 이 병합돼도 치운 까닭이 없다", () => {
    const { db } = seeded();
    expect(endedRun(db, "ACME-1").todoCleared).toBeNull();
  });

  it("PR 이 Open 이거나 닫힌 Failed 런은 To do 에 남는다", () => {
    const { db, id } = seeded();
    updateRunRecords(db, id("ACME-5"), { laterPrState: { state: "closed", at: minutes(115) } });
    expect(todoKeys(db)).toEqual(expect.arrayContaining(["ACME-2", "ACME-3", "ACME-5"]));
    expect(endedRun(db, "ACME-2").todoCleared).toBeNull();
  });

  it("Runs 목록과 Run 상세의 처리할 일도 Failed 에서 내린다", () => {
    const { db, id } = seeded();
    mergeLater(db, id("ACME-2"));
    const view = loadRunsPage(db, WS, now).runs.find((run) => run.ticketKey === "ACME-2");
    expect(view?.attention).toBe(false);
    const detail = loadRunDetail(db, id("ACME-2"), now);
    if (detail.kind !== "found") throw new Error("not found");
    expect(runNextStep(nextStepInputOfDetail(detail.run))).not.toBe("failed");
  });
});

describe("확인했어요로 Failed 런을 To do 에서 치운다(0235)", () => {
  it("치운 Failed 런은 To do 에서 빠지고 결과는 Failed 로 남으며 모든 수가 같다", () => {
    const { db, id } = seeded();
    const before = page(db).attention.length;

    expect(clearTodoOnce(db, key(id("ACME-4"), "request-id-0235-a"), now)).toEqual({ ok: true });

    expect(todoKeys(db)).not.toContain("ACME-4");
    expect(page(db).attention).toHaveLength(before - 1);
    const run = endedRun(db, "ACME-4");
    expect(run.summary).toBe("failed");
    expect(run.todoCleared).toBe("operator");
    expectAllCountsAgree(db);
  });

  it("같은 requestId 를 다시 보내면 같은 성공이고 치운 시각은 처음 것이다", () => {
    const { db, id } = seeded();
    const runId = id("ACME-4");
    expect(clearTodoOnce(db, key(runId, "request-id-0235-b"), minutes(100))).toEqual({ ok: true });
    let replayed = false;
    expect(
      clearTodoOnce(db, key(runId, "request-id-0235-b"), minutes(110), () => {
        replayed = true;
      }),
    ).toEqual({ ok: true });
    expect(replayed).toBe(true);
    expect(getRunWithRecords(db, runId)?.records.todoSettledAt).toEqual(minutes(100));
  });

  it("Failed 가 아닌 런은 치우지 않는다", () => {
    const { db, id } = seeded();
    expect(clearTodoOnce(db, key(id("ACME-1"), "request-id-0235-c"), now)).toEqual({
      ok: false,
      reason: "not-failed",
    });
    expect(clearTodoOnce(db, key(id("ACME-11"), "request-id-0235-d"), now)).toEqual({
      ok: false,
      reason: "not-failed",
    });
    expect(getRunWithRecords(db, id("ACME-1"))?.records.todoSettledAt).toBeNull();
  });

  it("치운 뒤 다시 맡긴 새 런이 실패하면 새 런은 To do 에 오른다", () => {
    const { db, id } = seeded();
    clearTodoOnce(db, key(id("ACME-4"), "request-id-0235-e"), now);
    const again = failAgain(db, "ACME-4");
    const run = page(db).attention.find((item) => item.run.ticketKey === "ACME-4")?.run;
    expect(run?.id).toBe(again);
    expect(run?.state === "ended" && isOpenFailed(run)).toBe(true);
    expectAllCountsAgree(db);
  });

  it("치운 런과 PR 이 머지된 런의 Failed 알림 사건은 다른 곳에서 처리된 것처럼 해결된다", () => {
    const { db, id } = seeded();
    syncNotifications(db, minutes(100));
    const openFailed = () =>
      listOpenNotificationEvents(db)
        .filter((event) => event.kind === "failed")
        .map((event) => event.subject);
    expect(openFailed()).toEqual(expect.arrayContaining(["ACME-2", "ACME-4"]));

    clearTodoOnce(db, key(id("ACME-4"), "request-id-0235-f"), now);
    mergeLater(db, id("ACME-2"));
    const synced = syncNotifications(db, now);

    expect(synced.resolved).toBe(2);
    expect(openFailed()).not.toContain("ACME-4");
    expect(openFailed()).not.toContain("ACME-2");
    expect(openFailed()).toContain("ACME-3");
  });

  it("Tickets 의 처리할 일 필터도 치운 Failed 런을 빼고 다시 맡길 수 있다", () => {
    const failed = {
      id: "run",
      runnerName: null,
      state: "ended" as const,
      endedAt: now.toISOString(),
      endedAgoMs: 0,
      agentResult: "timed-out" as const,
      prState: "none" as const,
      laterPrState: null,
      pullRequest: null,
      summary: "failed" as const,
    };
    expect(isTodo({ ...failed, todoCleared: null })).toBe(true);
    expect(isTodo({ ...failed, todoCleared: "operator" })).toBe(false);
    expect(isTodo({ ...failed, todoCleared: "pr-merged" })).toBe(false);
  });
});

describe("v1 확인했어요 쓰기(0235)", () => {
  it("requestId 를 다시 보내도 같은 성공이고 Dashboard 에 치운 까닭이 실린다", () => {
    const { db, id } = seeded();
    const runId = id("ACME-6");
    const body = { requestId: "request-id-0235-v1-a" };
    expect(handleV1RunAction(db, runId, "clear-todo", body, now)).toEqual({ status: 200 });
    expect(handleV1RunAction(db, runId, "clear-todo", body, now)).toEqual({ status: 200 });

    const v1 = toV1Dashboard(page(db));
    const done = v1.columns.done.rest.find((run) => run.ticketKey === "ACME-6");
    expect(done).toMatchObject({
      state: "ended",
      summary: "failed",
      todoCleared: "operator",
      todoTag: null,
    });
    expect(v1.columns.done.todo.map((run) => run.ticketKey)).not.toContain("ACME-6");
  });

  it("requestId 가 없으면 400, Failed 가 아니면 409 로 거절한다", () => {
    const { db, id } = seeded();
    expect(handleV1RunAction(db, id("ACME-6"), "clear-todo", {}, now)).toEqual({
      status: 400,
      reason: "invalid-request",
    });
    expect(
      handleV1RunAction(db, id("ACME-1"), "clear-todo", { requestId: "request-id-0235-v1-b" }, now),
    ).toEqual({ status: 409, reason: "state-changed" });
  });
});
