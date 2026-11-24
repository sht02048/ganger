import { toPermissionRequestId, toQuestionId } from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  answerRunQuestion,
  listOpenNotificationEvents,
  recordPermissionWaits,
  recordRunQuestions,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { minutes, now, seedDatabase } from "../testing/seed";
import { readNotificationFeed, syncNotifications, throttledSync } from "./notifications";

function openKinds(db: Database): Array<[string, string]> {
  return listOpenNotificationEvents(db)
    .map((event): [string, string] => [event.kind, event.subject])
    .toSorted(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
}

function runOf(ids: Map<string, RunId>, key: string): RunId {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`${key} missing`);
  return id;
}

describe("알림 사건", () => {
  it("Failed·Disconnected·러너 Offline 을 사건으로 남기고 Succeeded·Queued·Running 은 남기지 않는다. Human Check 종류는 없다 (0145)", () => {
    const { db } = seedDatabase();
    syncNotifications(db, now);
    expect(openKinds(db)).toEqual([
      ["disconnected", "ACME-12"],
      ["failed", "ACME-2"],
      ["failed", "ACME-3"],
      ["failed", "ACME-4"],
      ["failed", "ACME-5"],
      ["failed", "ACME-6"],
      ["runner-offline", "runner-b"],
    ]);
    expect(
      openKinds(db).some(([, subject]) =>
        ["ACME-1", "ACME-7", "ACME-10", "ACME-13"].includes(subject),
      ),
    ).toBe(false);
  });

  it("런 사건은 그 런의 Workspace 와 티켓을 대상으로 둔다", () => {
    const { db, ids } = seedDatabase();
    syncNotifications(db, now);
    const failed = listOpenNotificationEvents(db).find((event) => event.subject === "ACME-2");
    expect(failed?.target).toEqual({
      kind: "run",
      runId: runOf(ids, "ACME-2"),
      workspaceId: "ws-commerce",
      ticketKey: "ACME-2",
    });
  });

  it("답하지 않은 Question 을 사건으로 남기고, 답을 남기면 해결한다", () => {
    const { db, ids } = seedDatabase();
    const runId = runOf(ids, "ACME-11");
    recordRunQuestions(db, runId, [
      { id: toQuestionId("q-1"), body: "어느 쪽으로 할까요?", options: [], askedAt: minutes(100) },
    ]);
    syncNotifications(db, now);
    const question = listOpenNotificationEvents(db).find((event) => event.kind === "question");
    expect(question?.cause).toBe(`question:${runId}:q-1`);

    answerRunQuestion(
      db,
      { runId: runId, questionId: toQuestionId("q-1"), answer: "A" },
      minutes(101),
    );
    syncNotifications(db, minutes(121));
    expect(listOpenNotificationEvents(db).some((event) => event.kind === "question")).toBe(false);
  });

  it("Permission 을 사건으로 남긴다", () => {
    const { db, ids } = seedDatabase();
    recordPermissionWaits(db, runOf(ids, "ACME-11"), [
      {
        id: toPermissionRequestId("apr-1"),
        detail: "Bash(touch notes.txt)",
        requestedAt: minutes(100),
      },
    ]);
    syncNotifications(db, now);
    expect(openKinds(db)).toContainEqual(["permission", "ACME-11"]);
  });
});

describe("알림 사건 읽기", () => {
  it("번호 없이 읽으면 열린 사건 모두와 지금 번호를, 번호를 주면 그 뒤 바뀐 것만 준다", () => {
    const { db, ids } = seedDatabase();
    syncNotifications(db, now);
    const first = readNotificationFeed(db, null);
    expect(first.events).toHaveLength(7);
    expect(first.open.toSorted((a, b) => a - b)).toEqual(
      first.events.map((event) => event.id).toSorted((a, b) => a - b),
    );

    recordRunQuestions(db, runOf(ids, "ACME-11"), [
      { id: toQuestionId("q-9"), body: "계속할까요?", options: [], askedAt: minutes(121) },
    ]);
    syncNotifications(db, minutes(122));
    const next = readNotificationFeed(db, first.cursor);
    expect(next.events.map((event) => [event.kind, event.subject])).toEqual([
      ["question", "ACME-11"],
    ]);
    expect(next.cursor).toBeGreaterThan(first.cursor);
    expect(readNotificationFeed(db, next.cursor).events).toEqual([]);
  });

  it("서버의 지금 번호보다 큰 번호를 주면 처음부터 열린 사건을 준다", () => {
    const { db } = seedDatabase();
    syncNotifications(db, now);
    const fresh = readNotificationFeed(db, null);
    const ahead = readNotificationFeed(db, fresh.cursor + 100);
    expect(ahead.events).toEqual(fresh.events);
    expect(ahead.cursor).toBe(fresh.cursor);
  });

  it("짧은 간격의 동기화는 한 번만 돈다", () => {
    let clock = 0;
    let runs = 0;
    const sync = throttledSync(
      () => {
        runs += 1;
      },
      () => clock,
      1_000,
    );
    sync();
    clock = 500;
    sync();
    clock = 1_000;
    sync();
    expect(runs).toBe(2);
  });
});
