import { toQuestionId } from "@ganger/core";
import type { RunId } from "@ganger/core";
import { recordRunQuestions } from "@ganger/db";
import type { Database } from "@ganger/db";
import { afterEach, describe, expect, it } from "vitest";
import { minutes, now, seedDatabase } from "../testing/seed";
import { readNotificationFeed, syncNotifications } from "./notifications";
import { lastEventId, notificationStream, notificationStreamResponse } from "./stream";

interface Message {
  event: string | null;
  id: string | null;
  data: unknown;
}

function parseData(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function parse(text: string): Message[] {
  return text
    .split("\n\n")
    .filter((block) => block.includes("data: "))
    .map((block) => {
      const fields = new Map(
        block.split("\n").map((line) => {
          const at = line.indexOf(": ");
          return [line.slice(0, at), line.slice(at + 2)] as const;
        }),
      );
      return {
        event: fields.get("event") ?? null,
        id: fields.get("id") ?? null,
        data: parseData(fields.get("data") ?? "null"),
      };
    });
}

const openReaders: Array<ReadableStreamDefaultReader<Uint8Array>> = [];

afterEach(async () => {
  for (const reader of openReaders.splice(0)) await reader.cancel();
});

function open(db: Database, after: number | null, clock: { at: Date }) {
  const stream = notificationStream({
    after,
    sync: () => syncNotifications(db, clock.at),
    read: (cursor) => readNotificationFeed(db, cursor),
    pollMs: 10,
    heartbeatMs: 25,
  });
  const reader = stream.getReader();
  openReaders.push(reader);
  const decoder = new TextDecoder();
  let text = "";
  return {
    async until(predicate: (text: string) => boolean): Promise<string> {
      while (!predicate(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      return text;
    },
  };
}

function askQuestion(db: Database, ids: Map<string, RunId>, id: string, at: Date) {
  const runId = ids.get("ACME-11");
  if (runId === undefined) throw new Error("ACME-11 missing");
  recordRunQuestions(db, runId, [
    { id: toQuestionId(id), body: "계속할까요?", options: [], askedAt: at },
  ]);
}

describe("알림 사건 SSE", () => {
  it("연결하면 열린 사건과 ready 를 바로 보내고, 새 사건도 이어서 보낸다", async () => {
    const { db, ids } = seedDatabase();
    const clock = { at: now };
    const client = open(db, null, clock);
    const first = parse(await client.until((text) => text.includes("event: ready")));
    const notifications = first.filter((message) => message.event === "notification");
    expect(notifications).toHaveLength(7);
    const ready = first.find((message) => message.event === "ready");
    expect(typeof ready?.id).toBe("string");
    expect(ready?.data).toHaveProperty("cursor");

    askQuestion(db, ids, "q-live", minutes(121));
    clock.at = minutes(122);
    const later = parse(await client.until((text) => text.includes('"kind":"question"')));
    const question = later.find(
      (message) =>
        message.event === "notification" &&
        typeof message.data === "object" &&
        message.data !== null &&
        "kind" in message.data &&
        message.data.kind === "question",
    );
    expect(question?.id).not.toBeNull();
  });

  it("Last-Event-ID 를 주면 그 번호 뒤에 바뀐 사건만 보낸다", async () => {
    const { db, ids } = seedDatabase();
    syncNotifications(db, now);
    const { cursor } = readNotificationFeed(db, null);
    askQuestion(db, ids, "q-after", minutes(121));
    const client = open(db, cursor, { at: minutes(122) });
    const messages = parse(await client.until((text) => text.includes("event: ready")));
    const notifications = messages.filter((message) => message.event === "notification");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.data).toMatchObject({ kind: "question", subject: "ACME-11" });
  });

  it("프록시가 끊지 않게 하트비트 주석을 보낸다", async () => {
    const { db } = seedDatabase();
    const client = open(db, null, { at: now });
    const text = await client.until((value) => value.includes(": ping"));
    expect(text).toContain(": ping");
  });

  it("응답은 버퍼링하지 않는 event-stream 이고, Last-Event-ID 머리를 쿼리보다 먼저 본다", () => {
    const response = notificationStreamResponse(new ReadableStream());
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("no-transform");
    const request = new Request("http://127.0.0.1/api/v1/notification-events/stream?after=3", {
      headers: { "last-event-id": "7" },
    });
    expect(lastEventId(request)).toBe("7");
    expect(lastEventId(new Request("http://127.0.0.1/x?after=3"))).toBe("3");
  });
});
