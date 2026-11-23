import {
  toAgentId,
  toAgentRef,
  toPermissionRequestId,
  toPullRequestId,
  toQuestionId,
  toRunnerId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  answerRunQuestion,
  denyPermissionWait,
  assignRun,
  changeRunState,
  recordPermissionWaits,
  recordRunQuestions,
  resolvePermissionWaits,
  recordProviderUsage,
  recordRunnerCheck,
  requestRunCancel,
  updateRunRecords,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import {
  breakGitHubAuth,
  connection,
  endedCases,
  labs,
  minutes,
  now,
  offlineQueuedKey,
  seedDatabase,
} from "../testing/seed";
import { loadShell } from "@ganger/app/shell/load";
import { loadHomePage } from "@ganger/app/home/load";
import type { AttentionItem, HomeRun } from "@ganger/app/home/model";
import { dashboardBoard, runnerIssues } from "@ganger/app/home/model";
import { ticketId } from "@ganger/app/tickets/load";

const keys = (runs: ReadonlyArray<HomeRun>) => runs.map((run) => run.ticketKey);
const attentionKeys = (items: ReadonlyArray<AttentionItem>) =>
  items.map((item) => item.run.ticketKey);

function addEndedRun(
  db: Database,
  input: {
    key: string;
    trackerProject: string;
    agentResult: "timed-out" | "canceled" | "reported-success";
    prState?: "open" | "unknown";
    prReadError?: "no-access";
    endedAt?: Date;
  },
): RunId {
  const endedAt = input.endedAt ?? minutes(90);
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(input.key) },
    trackerProject: toTrackerProjectId(input.trackerProject),
    runnerProject: toRunnerProjectId("github:acme/web"),
    agent: toAgentId("claude"),
    now: new Date(endedAt.getTime() - 30 * 60_000),
  });
  if (!result.ok) throw new Error(result.reason);
  const { id } = result.run;
  const started = {
    worktree: toWorktreeRef(`wt-${input.key}`),
    branch: `acme/${input.key}`,
    agentRef: toAgentRef(`agent-${input.key}`),
  };
  for (const change of [
    changeRunState(db, id, { to: "running", started }, new Date(endedAt.getTime() - 29 * 60_000)),
    changeRunState(
      db,
      id,
      input.prState === "unknown"
        ? {
            to: "ended",
            agentResult: input.agentResult,
            prState: "unknown",
            prReadError: input.prReadError ?? "other",
          }
        : { to: "ended", agentResult: input.agentResult, prState: "open" },
      endedAt,
    ),
  ]) {
    if (!change.ok) throw new Error(JSON.stringify(change));
  }
  return id;
}

function addLabsFailedRun(db: Database): void {
  addEndedRun(db, { key: "LAB-2", trackerProject: "tp-lab", agentResult: "timed-out" });
}

function runOf(items: ReadonlyArray<AttentionItem>, key: string): HomeRun | undefined {
  for (const item of items) if (item.kind === "run" && item.run.ticketKey === key) return item.run;
  return undefined;
}

describe("loadHomePage", () => {
  it("런을 To do, 실행 중, Queued 로 나눈다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");

    const attention = attentionKeys(page.attention);
    expect(attention.slice(0, 2)).toEqual(["ACME-11", "ACME-12"]);
    expect(attention.slice(2).toSorted()).toEqual(
      endedCases
        .filter((c) => c.summary === "failed")
        .map((c) => c.key)
        .toSorted(),
    );
    expect(attention.slice(2)).toEqual(attention.slice(2).toSorted().toReversed());
    expect(attention).not.toContain("ACME-1");

    expect(keys(page.running)).toEqual(["ACME-10"]);
    expect(keys(page.queued)).toEqual(["ACME-13", offlineQueuedKey]);
  });

  it("Queued 는 들어온 순서로 보이고, 순서에서 빠진 런에는 이유를 담는다(Q68)", () => {
    const { db } = seedDatabase();
    const early = assignRun(db, {
      ticket: { connection, key: toTicketKey("ACME-20") },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(0.5),
    });
    if (!early.ok) throw new Error(early.reason);

    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(keys(page.queued)).toEqual(["ACME-20", "ACME-13", offlineQueuedKey]);
    const offline = page.queued.find((run) => run.ticketKey === offlineQueuedKey);
    expect(offline).toMatchObject({ queuedReason: { kind: "runner-offline" }, runner: null });
  });

  it("입력 기다림과 연결 끊김 런을 상태 그대로 To do에 담는다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const runs = page.attention.flatMap((item) => (item.kind === "run" ? [item.run] : []));
    expect(runs.find((run) => run.ticketKey === "ACME-11")?.state).toBe("waiting-for-input");
    expect(runs.find((run) => run.ticketKey === "ACME-12")?.state).toBe("disconnected");
  });

  it("To do의 Ended 런은 에이전트 결과와 PR 상태를 따로 담는다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const run = page.attention.find(
      (item) => item.kind === "run" && item.run.ticketKey === "ACME-2",
    );
    expect(run).toMatchObject({
      kind: "run",
      run: {
        state: "ended",
        agentResult: "reported-failure",
        prState: "open",
        summary: "failed",
      },
    });
  });

  it("같은 티켓에 새 런이 있으면 지난 Ended 런은 To do에서 빠진다", () => {
    const { db } = seedDatabase();
    const again = assignRun(db, {
      ticket: { connection, key: toTicketKey("ACME-3") },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(100),
    });
    if (!again.ok) throw new Error(again.reason);
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(attentionKeys(page.attention)).not.toContain("ACME-3");
    expect(keys(page.queued)).toContain("ACME-3");
  });

  it("Succeeded 런은 PR 이 열려 있거나 없어도 To do에 없고, Failed 런은 이후 PR 상태와 상관없이 To do에 남는다 (0145)", () => {
    const { db, ids } = seedDatabase();
    addEndedRun(db, {
      key: "ACME-31",
      trackerProject: "tp-web",
      agentResult: "reported-success",
      prState: "open",
    });
    addEndedRun(db, {
      key: "ACME-32",
      trackerProject: "tp-web",
      agentResult: "reported-success",
      prState: "unknown",
      prReadError: "no-access",
    });
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(attentionKeys(page.attention)).not.toContain("ACME-31");
    expect(attentionKeys(page.attention)).not.toContain("ACME-32");
    expect(attentionKeys(page.attention)).not.toContain("ACME-7");
    const failedId = ids.get("ACME-5");
    if (failedId === undefined) throw new Error("ACME-5 missing");
    updateRunRecords(db, failedId, { laterPrState: { state: "closed", at: minutes(110) } });
    expect(attentionKeys(loadHomePage(db, "ws-commerce", now, "UTC").attention)).toContain(
      "ACME-5",
    );
  });

  it("Canceled 런은 PR 이 열려 있어도 To do에 없다(Q82.9)", () => {
    const { db } = seedDatabase();
    addEndedRun(db, { key: "ACME-30", trackerProject: "tp-web", agentResult: "canceled" });
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(attentionKeys(page.attention)).not.toContain("ACME-30");
    expect(keys(page.running)).not.toContain("ACME-30");
    expect(attentionKeys(loadHomePage(db, "all", now, "UTC").attention)).not.toContain("ACME-30");
  });

  it("질문으로 기다리는 런에 worker 가 쓴 질문과 선택지를 담고, 답을 남기면 answered 가 된다", () => {
    const { db, ids } = seedDatabase();
    const runId = ids.get("ACME-11");
    if (runId === undefined) throw new Error("ACME-11 missing");
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      state: "waiting-for-input",
      input: null,
    });

    recordRunQuestions(db, runId, [
      {
        id: toQuestionId("q-1"),
        body: "어느 쪽으로 할까요?",
        options: ["A", "B"],
        askedAt: minutes(100),
      },
    ]);
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: {
        kind: "question",
        questionId: "q-1",
        body: "어느 쪽으로 할까요?",
        choices: ["A", "B"],
        answered: false,
      },
    });

    answerRunQuestion(db, { runId, questionId: toQuestionId("q-1"), answer: "A" }, minutes(101));
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: { kind: "question", answered: true },
    });
  });

  it("권한 대기 런에 worker 가 쓴 대기를 담고, 거절을 남기면 denied, 닫히면 빠진다", () => {
    const { db, ids } = seedDatabase();
    const runId = ids.get("ACME-11");
    if (runId === undefined) throw new Error("ACME-11 missing");
    const permissionId = toPermissionRequestId("apr-1");
    recordPermissionWaits(db, runId, [
      { id: permissionId, detail: "Bash(touch notes.txt)", requestedAt: minutes(100) },
    ]);
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: {
        kind: "permission",
        promptId: "apr-1",
        detail: "Bash(touch notes.txt)",
        denied: false,
      },
    });

    denyPermissionWait(db, { runId, permissionId, reason: "" }, minutes(101));
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: { kind: "permission", denied: true },
    });

    resolvePermissionWaits(db, runId, [], minutes(102));
    expect(runOf(loadHomePage(db, "ws-commerce", now, "UTC").attention, "ACME-11")).toMatchObject({
      input: null,
    });
  });

  it("처리되지 않은 취소 요청이 있는 런은 취소 중이다(Q82.21)", () => {
    const { db, ids } = seedDatabase();
    const runId = ids.get("ACME-10");
    if (runId === undefined) throw new Error("ACME-10 missing");
    expect(requestRunCancel(db, runId, minutes(110)).ok).toBe(true);
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(page.running.find((run) => run.ticketKey === "ACME-10")?.cancelling).toBe(true);
    expect(page.queued.every((run) => !run.cancelling)).toBe(true);
  });

  it("러너는 문제 있는 러너부터 쓰는 칸과 capacity 를 담고, 러너 문제는 To do 에 없다(티켓 0060·0069)", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(page.attention.every((item) => item.kind === "run")).toBe(true);
    expect(page.runners.list).toEqual([
      {
        id: "runner-b",
        name: "runner-b",
        cause: "offline",
        offlineMs: now.getTime() - minutes(0).getTime(),
        used: 0,
        capacity: 1,
        usage: null,
        limits: [],
        loadHigh: null,
      },
      {
        id: "runner-a",
        name: "runner-a",
        cause: null,
        offlineMs: null,
        used: 4,
        capacity: 10,
        usage: null,
        limits: [],
        loadHigh: null,
      },
    ]);
    expect(loadShell(db).runnerIssues).toBe(1);

    breakGitHubAuth(db);
    expect(loadShell(db).runnerIssues).toBe(2);
    const broken = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(
      runnerIssues(broken.runners)
        .map((r) => r.id)
        .toSorted(),
    ).toEqual(["runner-a", "runner-b"]);
    expect(attentionKeys(broken.attention)).toEqual(attentionKeys(page.attention));
  });

  it("GitHub 인증이 깨진 러너는 auth 까닭으로 담고, 그 러너로 정한 Queued 런은 이유를 담는다(Q82.14·Q87)", () => {
    const { db } = seedDatabase();
    recordRunnerCheck(db, {
      runnerId: toRunnerId("runner-a"),
      online: true,
      checkedAt: minutes(115),
      error: null,
      assignmentBlocked: true,
      projects: null,
    });
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(runnerIssues(page.runners)).toContainEqual(
      expect.objectContaining({ id: "runner-a", name: "runner-a", cause: "auth" }),
    );
    expect(page.queued.find((run) => run.ticketKey === "ACME-13")).toMatchObject({
      queuedReason: { kind: "assignment-blocked" },
    });
    for (const ws of [labs, "all"])
      expect(runnerIssues(loadHomePage(db, ws, now, "UTC").runners).map((r) => r.id)).toContain(
        "runner-a",
      );
  });

  it("전체에서는 모든 Workspace 의 To do·진행 중·오늘 끝난 런을 Workspace 와 함께 담는다(ADR 0006, 티켓 0069)", () => {
    const { db } = seedDatabase();
    addLabsFailedRun(db);
    const page = loadHomePage(db, "all", now, "UTC");
    expect(page.workspace.kind).toBe("all");
    expect(keys(page.running)).toEqual(expect.arrayContaining(["ACME-10", "LAB-1"]));
    expect(keys(page.queued)).toContain("ACME-13");
    expect(page.doneToday.recent.map((run) => run.workspace.id)).toContain("ws-commerce");
    const attention = attentionKeys(page.attention);
    expect(attention).toContain("LAB-2");
    expect(attention).toContain("ACME-11");
    expect(attention).not.toContain("LAB-1");
    const lab = page.attention.find(
      (item) => item.kind === "run" && item.run.ticketKey === "LAB-2",
    );
    expect(lab).toMatchObject({ run: { workspace: { id: labs, name: "Acme Labs" } } });
  });

  it("Workspace 하나에서는 그 Workspace 의 런만 담는다", () => {
    const { db } = seedDatabase();
    addLabsFailedRun(db);
    const page = loadHomePage(db, labs, now, "UTC");
    expect(attentionKeys(page.attention)).toEqual(["LAB-2"]);
    expect(keys(page.running)).toEqual(["LAB-1"]);
    expect(page.queued).toEqual([]);
  });

  it("doneToday 는 운영자 시간대의 오늘 끝난 런을 새 것부터 5개까지 담고 전체 수를 센다(티켓 0060)", () => {
    const { db } = seedDatabase();
    const { doneToday } = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(doneToday.recent.map((run) => run.ticketKey)).toEqual([
      "ACME-7",
      "ACME-6",
      "ACME-5",
      "ACME-4",
      "ACME-3",
    ]);
    expect(doneToday.recent[0]).toMatchObject({
      summary: "succeeded",
      workspace: { id: "ws-commerce" },
      endedAgoMs: 83 * 60_000,
    });
    expect(doneToday.total).toBe(7);

    const kiritimati = loadHomePage(db, "ws-commerce", now, "Pacific/Kiritimati").doneToday;
    expect(kiritimati).toEqual({ recent: [], total: 0 });

    addEndedRun(db, { key: "ACME-30", trackerProject: "tp-web", agentResult: "canceled" });
    const withCanceled = loadHomePage(db, "ws-commerce", now, "UTC").doneToday;
    expect(withCanceled.total).toBe(8);
    expect(withCanceled.recent.map((run) => run.summary)).toContain("canceled");
    expect(loadHomePage(db, "all", now, "UTC").doneToday.total).toBeGreaterThanOrEqual(8);
  });

  it("endedRecently 는 끝난 런을 모두 새 것부터 HomeRun 으로 담는다(티켓 0100·0163)", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    expect(keys(page.endedRecently)).toEqual([
      "ACME-7",
      "ACME-6",
      "ACME-5",
      "ACME-4",
      "ACME-3",
      "ACME-2",
      "ACME-1",
    ]);
    expect(page.endedRecently.every((run) => run.state === "ended")).toBe(true);
    const ended = page.endedRecently.map((run) =>
      run.state === "ended" ? Date.parse(run.endedAt) : 0,
    );
    expect(ended).toEqual(ended.toSorted((a, b) => b - a));
  });

  describe("Done 칸은 운영자 시간대로 오늘과 앞선 6일에 끝난 런을 담는다(티켓 0163)", () => {
    const at = new Date("2030-03-20T03:00:00.000Z");
    const daysBefore = (days: number) => new Date(at.getTime() - days * 24 * 60 * 60_000);
    const added = (runs: ReadonlyArray<HomeRun>) =>
      keys(runs).filter((key) => key.startsWith("DONE-"));
    const addSucceeded = (db: Database, key: string, endedAt: Date) =>
      addEndedRun(db, {
        key,
        trackerProject: "tp-web",
        agentResult: "reported-success",
        endedAt,
      });

    it("오늘과 6일 전은 넣고 7일 전은 넣지 않는다", () => {
      const { db } = seedDatabase();
      addSucceeded(db, "DONE-TODAY", daysBefore(0));
      addSucceeded(db, "DONE-SIX", daysBefore(6));
      addSucceeded(db, "DONE-SEVEN", daysBefore(7));
      const page = loadHomePage(db, "ws-commerce", at, "UTC");
      expect(added(page.endedRecently)).toEqual(["DONE-TODAY", "DONE-SIX"]);
      const board = dashboardBoard(page);
      expect(keys(board.done.rest)).toEqual(["DONE-TODAY", "DONE-SIX"]);
    });

    it("첫 날의 시작은 운영자 시간대의 자정이다", () => {
      const { db } = seedDatabase();
      addSucceeded(db, "DONE-AFTER", new Date("2030-03-13T15:00:00.000Z"));
      addSucceeded(db, "DONE-BEFORE", new Date("2030-03-13T14:59:59.999Z"));
      expect(added(loadHomePage(db, "ws-commerce", at, "Asia/Seoul").endedRecently)).toEqual([
        "DONE-AFTER",
      ]);
      expect(added(loadHomePage(db, "ws-commerce", at, "UTC").endedRecently)).toEqual([]);
    });

    it("서머타임이 낀 주에도 7개 날짜를 센다", () => {
      const { db } = seedDatabase();
      const afterChange = new Date("2030-03-15T12:00:00.000Z");
      addSucceeded(db, "DONE-FIRST", new Date("2030-03-09T05:00:00.000Z"));
      addSucceeded(db, "DONE-EARLIER", new Date("2030-03-09T04:59:59.999Z"));
      expect(
        added(loadHomePage(db, "ws-commerce", afterChange, "America/New_York").endedRecently),
      ).toEqual(["DONE-FIRST"]);
    });

    it("7일보다 오래된 To do 꼬리표 런은 칸 맨 위에 남고 7일 목록에는 들지 않는다", () => {
      const { db } = seedDatabase();
      addEndedRun(db, {
        key: "DONE-OLD-FAILED",
        trackerProject: "tp-web",
        agentResult: "timed-out",
        endedAt: daysBefore(30),
      });
      const page = loadHomePage(db, "ws-commerce", at, "UTC");
      expect(added(dashboardBoard(page).done.todo)).toEqual(["DONE-OLD-FAILED"]);
      expect(added(page.endedRecently)).toEqual([]);
    });

    it("MCP 가 읽는 doneToday 는 오늘 끝난 런만 담는다", () => {
      const { db } = seedDatabase();
      addSucceeded(db, "DONE-TODAY", daysBefore(0));
      addSucceeded(db, "DONE-YESTERDAY", daysBefore(1));
      const { doneToday } = loadHomePage(db, "ws-commerce", at, "UTC");
      expect(doneToday.recent.map((run) => run.ticketKey)).toEqual(["DONE-TODAY"]);
      expect(doneToday.total).toBe(1);
    });
  });

  it("런마다 Tickets 가 고르는 티켓 ID 를 담는다(티켓 0100)", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const runs = [...page.queued, ...page.running, ...page.endedRecently];
    expect(runs.length).toBeGreaterThan(3);
    for (const run of runs) expect(run.ticketId).toBe(ticketId(connection, run.ticketKey));
  });

  it("보드는 To do 런을 Running·Done 칸의 꼬리표 카드로 나누고 나머지 끝난 런과 겹치지 않는다(티켓 0100)", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const board = dashboardBoard(page);
    expect(keys(board.queued)).toEqual(keys(page.queued));
    expect(keys(board.running.todo)).toEqual(["ACME-11", "ACME-12"]);
    expect(keys(board.running.rest)).toEqual(keys(page.running));
    expect(keys(board.done.todo)).toEqual(["ACME-6", "ACME-5", "ACME-4", "ACME-3", "ACME-2"]);
    expect(keys(board.done.rest)).toEqual(["ACME-7", "ACME-1"]);
  });

  it("질문을 기다리는 런은 가장 오래된 대기부터 지난 시간을 담는다", () => {
    const { db, ids } = seedDatabase();
    const waiting = ids.get("ACME-11");
    if (waiting === undefined) throw new Error("seed");
    recordRunQuestions(db, waiting, [
      {
        id: toQuestionId("q-wait"),
        body: "어느 쪽으로 할까요?",
        options: [],
        askedAt: minutes(95),
      },
    ]);
    const run = loadHomePage(db, "ws-commerce", now, "UTC").attention.find(
      (item) => item.run.ticketKey === "ACME-11",
    )?.run;
    expect(run).toMatchObject({ state: "waiting-for-input", waitingMs: 25 * 60_000 });
  });
});

describe("loadHomePage PR 신호(0167)", () => {
  const endedView = (db: Database, key: string) => {
    const run = loadHomePage(db, "ws-commerce", now, "UTC").endedRecently.find(
      (candidate) => candidate.ticketKey === key,
    );
    if (run?.state !== "ended") throw new Error(`no ended ${key}`);
    return run;
  };

  const recordOpenPr = (db: Database, id: RunId) =>
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("pr-41"),
        displayId: "#41",
        url: "https://code.example.com/acme/web/pull/41",
        ci: "failure",
        checkedAt: minutes(95),
        signals: {
          open: true,
          headCommit: "abc",
          ciFailed: true,
          checkTotal: 4,
          failedCount: 1,
          failedChecks: ["lint"],
          checksTruncated: false,
          conflict: true,
          behindBy: 3,
        },
      },
    });

  it("Open PR의 신호를 담고, 머지되면 지난 신호를 남기지 않는다", () => {
    const { db } = seedDatabase();
    const id = addEndedRun(db, {
      key: "ACME-41",
      trackerProject: "tp-web",
      agentResult: "reported-success",
      prState: "open",
    });
    recordOpenPr(db, id);
    expect(endedView(db, "ACME-41").pullRequest?.signals).toMatchObject({
      ciFailed: true,
      conflict: true,
      behindBy: 3,
    });

    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(96) } });
    expect(endedView(db, "ACME-41").pullRequest?.signals).toBeNull();
  });

  it("PR을 못 읽은 런은 읽기 오류를 담고 신호는 비운다", () => {
    const { db } = seedDatabase();
    const id = addEndedRun(db, {
      key: "ACME-42",
      trackerProject: "tp-web",
      agentResult: "reported-success",
      prState: "unknown",
      prReadError: "no-access",
    });
    recordOpenPr(db, id);
    const run = endedView(db, "ACME-42");
    expect(run.prReadError).toBe("no-access");
    expect(run.pullRequest?.signals).toBeNull();
  });
});

describe("loadHomePage 공급자 사용량(0086)", () => {
  const claude = (
    windows: Array<{ kind: "session" | "weekly"; usedPercent: number; resetsAt: Date | null }>,
  ) => ({
    kind: "read" as const,
    providers: [{ provider: "claude", status: "ok" as const, windows }],
  });

  it("러너마다 지금 창 중 가장 높은 사용량과, Online 러너의 100% 창과 풀릴 때까지 남은 시간을 담는다", () => {
    const { db } = seedDatabase();
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-a"),
      readAt: now,
      reading: claude([
        { kind: "session", usedPercent: 100, resetsAt: new Date(now.getTime() + 72 * 60_000) },
        { kind: "weekly", usedPercent: 120, resetsAt: new Date(now.getTime() - 1) },
      ]),
    });
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-b"),
      readAt: now,
      reading: claude([{ kind: "session", usedPercent: 100, resetsAt: null }]),
    });
    const list = loadHomePage(db, "ws-commerce", now, "UTC").runners.list;
    expect(list.find((r) => r.id === "runner-a")).toMatchObject({
      usage: { provider: "claude", window: "session", usedPercent: 100 },
      limits: [{ provider: "claude", window: "session", resetsInMs: 72 * 60_000 }],
    });
    expect(list.find((r) => r.id === "runner-b")).toMatchObject({
      cause: "offline",
      usage: { provider: "claude", window: "session", usedPercent: 100 },
      limits: [],
    });
  });

  it("읽지 못했거나 읽지 않은 러너는 사용량이 없다", () => {
    const { db } = seedDatabase();
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-a"),
      readAt: now,
      reading: { kind: "unreadable" },
    });
    for (const runner of loadHomePage(db, "ws-commerce", now, "UTC").runners.list) {
      expect(runner).toMatchObject({ usage: null, limits: [] });
    }
  });
});
