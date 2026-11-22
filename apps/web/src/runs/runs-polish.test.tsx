import { toPermissionRequestId, toQuestionId } from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  answerRunQuestion,
  denyPermissionWait,
  listRuns,
  listRunsWithRecords,
  recordPermissionWaits,
  recordRunQuestions,
  requestRunCancel,
} from "@ganger/db";
import type * as DbModule from "@ganger/db";
import type { Database } from "@ganger/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import runsJson from "../../messages/ko/runs.json" with { type: "json" };
import { runnerRunsWorkspace } from "@ganger/app/runners/model";
import { runWord, runnerCards, situationParts, waitingRuns } from "@ganger/app/runs/board";
import type { BoardRun, RunsBoardPage } from "@ganger/app/runs/board";
import { loadBoardRun, loadRunsBoard } from "@ganger/app/runs/board-load";
import { renderWithMessages } from "../testing/render";
import { commerce, labs, minutes, now, offlineQueuedKey, seedDatabase } from "../testing/seed";
import { runDetailRunnerHref } from "./hrefs";
import { runsMessages } from "./messages";
import { RunPanelBody } from "./run-panel";
import { RunsScreen } from "./runs-screen";

vi.mock("@ganger/db", async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  return {
    ...actual,
    listRuns: vi.fn<typeof actual.listRuns>(actual.listRuns),
    listRunsWithRecords: vi.fn<typeof actual.listRunsWithRecords>(actual.listRunsWithRecords),
  };
});

const noop = () => {};
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function screen(page: RunsBoardPage) {
  return renderWithMessages(
    <RunsScreen
      page={page}
      workspaces={[]}
      selectedId={undefined}
      onSelect={noop}
      onOpen={noop}
      onPickWorkspace={noop}
      runHref={(id) => `/runs/${id}`}
    />,
    runsMessages,
  );
}

function panel(run: BoardRun) {
  return textOf(
    renderWithMessages(
      <RunPanelBody run={run} detailHref={`/runs/${run.id}`} onOpenDetail={noop} />,
      runsMessages,
    ),
  );
}

function boardRun(db: Database, key: string): BoardRun {
  const page = loadRunsBoard(db, commerce, now, { view: "all" });
  const run = [...page.active, ...page.ended].find((r) => r.ticketKey === key);
  if (run === undefined) throw new Error(`${key} not on board`);
  return run;
}

function askQuestion(db: Database, id: RunId) {
  const questionId = toQuestionId("q-1");
  recordRunQuestions(db, id, [
    { id: questionId, body: "어느 쪽일까요?", options: [], askedAt: minutes(100) },
  ]);
  return questionId;
}

function must(id: RunId | undefined): RunId {
  if (id === undefined) throw new Error("run not seeded");
  return id;
}

beforeEach(() => {
  vi.mocked(listRuns).mockClear();
  vi.mocked(listRunsWithRecords).mockClear();
});

describe("런 하나 읽기(0178)", () => {
  it("목록 경로와 단일 경로가 모든 런에서 같은 값을 낸다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, commerce, now, { view: "all" });
    for (const listed of [...page.active, ...page.ended]) {
      const single = loadBoardRun(db, commerce, listed.id, now);
      expect(single).toEqual({ ...listed, canContinue: single?.canContinue });
    }
  });

  it("단일 경로는 그 티켓의 런만 읽고, Queued 가 아니면 큐를 읽지 않는다", () => {
    const { db, ids } = seedDatabase();
    const run = must(ids.get("ACME-10"));
    loadBoardRun(db, commerce, run, now);
    const filters = vi.mocked(listRuns).mock.calls.map(([, filter]) => filter);
    expect(filters).toHaveLength(1);
    expect(filters[0]?.ticket?.key).toBe("ACME-10");
    expect(vi.mocked(listRunsWithRecords)).not.toHaveBeenCalled();
  });

  it("Queued 런은 자리 계산에 필요한 큐를 읽는다", () => {
    const { db, ids } = seedDatabase();
    const single = loadBoardRun(db, commerce, must(ids.get("ACME-13")), now);
    expect(single?.state).toBe("queued");
    expect(vi.mocked(listRunsWithRecords)).toHaveBeenCalledWith(db, { states: ["queued"] });
  });
});

describe("답을 남긴 런(0178)", () => {
  it("전하기 전의 답은 답을 보냈어요이고, 기다리는 수와 맨 위에서 빠진다", () => {
    const { db, ids } = seedDatabase();
    const id = must(ids.get("ACME-11"));
    const questionId = askQuestion(db, id);
    expect(runWord(boardRun(db, "ACME-11"))).toBe("question");
    answerRunQuestion(db, { runId: id, questionId, answer: "왼쪽" }, minutes(110));
    const run = boardRun(db, "ACME-11");
    expect(runWord(run)).toBe("answer-sent");
    expect(situationParts([run])).toEqual([{ key: "settling", count: 1 }]);
    expect(panel(run)).toContain(runsJson.panel.reason.answerSent);
    expect(panel(run)).not.toContain(runsJson.panel.reason["waiting-for-input"]);
  });

  it("권한 거절은 거절했어요이고 패널도 같은 사실을 말한다", () => {
    const { db, ids } = seedDatabase();
    const id = must(ids.get("ACME-11"));
    const permissionId = toPermissionRequestId("perm-1");
    recordPermissionWaits(db, id, [{ id: permissionId, detail: "rm", requestedAt: minutes(100) }]);
    denyPermissionWait(db, { runId: id, permissionId, reason: "안 돼요" }, minutes(110));
    const run = boardRun(db, "ACME-11");
    expect(runWord(run)).toBe("permission-denied");
    expect(panel(run)).toContain(runsJson.panel.reason.permissionDenied);
  });
});

describe("기다리는 런 이유(0178)", () => {
  it("카드 제목과 줄마다 짧은 이유를 보인다", () => {
    const { db } = seedDatabase();
    const text = textOf(screen(loadRunsBoard(db, commerce, now)));
    expect(text).toContain(runsJson.now.queueTitle);
    expect(text).toContain(runsJson.now.queueReason["runner-offline"]);
    expect(boardRun(db, offlineQueuedKey).state).toBe("queued");
  });
});

describe("취소 중(0178)", () => {
  it("취소 중인 런은 카드 맨 아래에 있고 상황 수에서 빠진다", () => {
    const { db, ids } = seedDatabase();
    requestRunCancel(db, must(ids.get("ACME-11")), minutes(110));
    const page = loadRunsBoard(db, commerce, now);
    const cancelling = page.active.find((run) => run.ticketKey === "ACME-11");
    if (cancelling === undefined) throw new Error("run not on board");
    expect(runWord(cancelling)).toBe("cancelling");
    const card = runnerCards(page.runners, page.active).find((c) =>
      c.runs.some((run) => run.id === cancelling.id),
    );
    expect(card?.runs.at(-1)?.id).toBe(cancelling.id);
    expect(situationParts([cancelling])).toEqual([{ key: "settling", count: 1 }]);
  });

  it("기다리는 런 카드에서도 취소 중이 맨 아래다", () => {
    const { db, ids } = seedDatabase();
    const id = must(ids.get("ACME-13"));
    const before = loadRunsBoard(db, commerce, now).active;
    const list = waitingRuns(
      before.map((run) => (run.id === id ? { ...run, cancelling: true, waitMs: 1e9 } : run)),
    );
    expect(list.at(-1)?.id).toBe(id);
  });

  it("끊긴 런이라도 취소 중이면 패널이 취소 안내를 먼저 말한다", () => {
    const { db, ids } = seedDatabase();
    requestRunCancel(db, must(ids.get("ACME-12")), minutes(110));
    const run = boardRun(db, "ACME-12");
    expect(run.nextStep).toBe("none");
    expect(panel(run)).toContain(runsJson.panel.cancellingReason);
  });
});

describe("다른 Workspace 러너(0178)", () => {
  const at = (id: string) => ({ id, ticketKey: id, workspace: { id, name: id } });
  const occupying = (id: string) => ({
    ...at(id),
    ticketTitle: null,
    state: "running" as const,
    waitingFor: null,
    executionMs: 0,
  });

  it("런이 한 Workspace 면 그곳으로, 나뉘거나 없으면 지금 Workspace 로 간다", () => {
    const queued = (id: string) => ({ ...at(id), waitMs: 0 });
    expect(runnerRunsWorkspace({ occupying: [occupying("a")], queued: [] }, "now")).toBe("a");
    expect(runnerRunsWorkspace({ occupying: [occupying("a")], queued: [queued("b")] }, "now")).toBe(
      "now",
    );
    expect(runnerRunsWorkspace({ occupying: [], queued: [] }, "now")).toBe("now");
  });

  it("런 상세의 러너 링크는 URL 대신 그 런의 Workspace 를 쓴다", () => {
    const found = { kind: "found" as const, run: { workspace: { id: "ws-run" } } };
    expect(runDetailRunnerHref(found, "ws-url", "r")).toBe("/runs?ws=ws-run&runner=r");
    expect(runDetailRunnerHref({ kind: "not-found" }, "ws-url", "r")).toBe(
      "/runs?ws=ws-url&runner=r",
    );
  });

  it("한 곳이면 그 Workspace 링크, 여러 곳이면 문장만, 나뉜 러너에도 보인다", () => {
    const { db, ids } = seedDatabase();
    const page = loadRunsBoard(db, commerce, now);
    const running = page.active.find((run) => run.id === ids.get("ACME-10"));
    const runnerId = running?.runnerId;
    if (running === undefined || runnerId === null || runnerId === undefined)
      throw new Error("run not on board");
    const seats = (onlyWorkspaceId: string | null) => ({
      ...page,
      active: [running],
      runners: [
        {
          id: runnerId,
          name: "split",
          online: true,
          capacity: 4,
          used: 3,
          otherWorkspaces: { count: 2, onlyWorkspaceId },
        },
      ],
    });
    const sentence = "다른 Workspace에서 2개가 돌아요";
    const linked = screen(seats(labs));
    expect(textOf(linked)).toContain(sentence);
    expect(linked).toContain(`href="/runs?ws=${labs}&amp;runner=${runnerId}"`);
    const plain = screen(seats(null));
    expect(textOf(plain)).toContain(sentence);
    expect(plain).not.toContain(`href="/runs?ws=${labs}`);
  });

  it("로더가 다른 Workspace 런 수와 단일 Workspace 를 센다", () => {
    const { db, ids } = seedDatabase();
    const labRun = loadBoardRun(db, labs, must(ids.get("LAB-1")), now);
    const seat = loadRunsBoard(db, commerce, now).runners.find((r) => r.id === labRun?.runnerId);
    expect(seat?.otherWorkspaces).toEqual({ count: 1, onlyWorkspaceId: labs });
  });
});
