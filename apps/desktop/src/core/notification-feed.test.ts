import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { NotificationRecord } from "@ganger/app/notifications/feed";
import { afterEach, describe, expect, it } from "vitest";
import type { FeedConnection } from "./device-link.js";
import { NotificationFeed, SseParser } from "./notification-feed.js";
import type { FeedBatch, FeedTransport } from "./notification-feed.js";

const V1_META = { serverVersion: "0.5.0", contractVersion: 1 };

function record(id: number, seq: number, resolved = false): NotificationRecord {
  return {
    id,
    seq,
    kind: "question",
    target: { kind: "run", runId: `run-${id}`, workspaceId: "ws-1", ticketKey: `ACME-${id}` },
    subject: `ACME-${id}`,
    detail: null,
    createdAt: "2026-11-19T09:00:00.000Z",
    resolvedAt: resolved ? "2026-11-19T09:05:00.000Z" : null,
  };
}

class FakeServer {
  log: NotificationRecord[] = [];
  streamAvailable = true;
  tokenAccepted = true;
  proxyRefuses = false;
  unversionedRequests = 0;
  readonly v1Requests: Array<string | null> = [];
  readonly streamRequests: Array<string | null> = [];
  readonly pollRequests: Array<string | null> = [];
  private readonly clients = new Set<ServerResponse>();
  private server: Server | undefined;
  origin = "";

  async listen(): Promise<void> {
    this.server = createServer((request, response) => this.handle(request, response));
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("no TCP address");
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    this.dropClients();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  add(next: NotificationRecord): void {
    this.log.push(next);
    for (const client of this.clients) client.write(this.message(next));
  }

  dropClients(): void {
    for (const client of this.clients) client.destroy();
    this.clients.clear();
  }

  private cursor(): number {
    return Math.max(0, ...this.log.map((entry) => entry.seq));
  }

  private open(): number[] {
    const latest = new Map<number, NotificationRecord>();
    for (const entry of this.log) latest.set(entry.id, entry);
    return [...latest.values()]
      .filter((entry) => entry.resolvedAt === null)
      .map((entry) => entry.id);
  }

  private after(value: string | null): NotificationRecord[] {
    if (value === null) {
      const open = new Set(this.open());
      const latest = new Map<number, NotificationRecord>();
      for (const entry of this.log) latest.set(entry.id, entry);
      return [...latest.values()].filter((entry) => open.has(entry.id));
    }
    return this.log.filter((entry) => entry.seq > Number(value));
  }

  private message(entry: NotificationRecord): string {
    return `event: notification\nid: ${entry.seq}\ndata: ${JSON.stringify(entry)}\n\n`;
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", this.origin);
    const v1 = url.pathname.startsWith("/api/v1/");
    const pathname = v1 ? url.pathname.replace("/api/v1/", "/api/") : url.pathname;
    if (v1) {
      this.v1Requests.push(request.headers.authorization ?? null);
      if (this.proxyRefuses) {
        response.writeHead(401, { "content-type": "text/plain" }).end("proxy login required");
        return;
      }
      if (!this.tokenAccepted || request.headers.authorization !== `Bearer ${DEVICE_TOKEN}`) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ meta: V1_META, error: { reason: "invalid-token" } }));
        return;
      }
    } else {
      this.unversionedRequests += 1;
      response.writeHead(404).end();
      return;
    }
    if (pathname === "/api/notification-events/stream") {
      const header = request.headers["last-event-id"];
      const lastId = typeof header === "string" ? header : null;
      this.streamRequests.push(lastId);
      if (!this.streamAvailable) {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      for (const entry of this.after(lastId)) response.write(this.message(entry));
      response.write(
        `event: ready\nid: ${this.cursor()}\ndata: ${JSON.stringify({ cursor: this.cursor(), open: this.open() })}\n\n`,
      );
      this.clients.add(response);
      request.on("close", () => this.clients.delete(response));
      return;
    }
    if (pathname === "/api/notification-events") {
      const after = url.searchParams.get("after");
      this.pollRequests.push(after);
      response.writeHead(200, { "content-type": "application/json" });
      const feed = { events: this.after(after), cursor: this.cursor(), open: this.open() };
      response.end(JSON.stringify(v1 ? { meta: V1_META, data: feed } : feed));
      return;
    }
    response.writeHead(404).end();
  }
}

const servers: FakeServer[] = [];
const feeds: NotificationFeed[] = [];

afterEach(async () => {
  for (const feed of feeds.splice(0)) feed.stop();
  for (const server of servers.splice(0)) await server.close();
});

async function startServer(): Promise<FakeServer> {
  const server = new FakeServer();
  await server.listen();
  servers.push(server);
  return server;
}

const DEVICE_TOKEN = "device-token";
const tokenConnection = (): Promise<FeedConnection> =>
  Promise.resolve({ kind: "token", token: DEVICE_TOKEN });
function startFeed(
  server: FakeServer,
  overrides: {
    streamRetryMs?: number;
    idleTimeoutMs?: number;
    connection?: () => Promise<FeedConnection>;
    onRejected?: () => void;
    onUnsupported?: () => void;
  } = {},
) {
  const batches: FeedBatch[] = [];
  const transports: FeedTransport[] = [];
  const feed = new NotificationFeed({
    origin: server.origin,
    onBatch: (batch) => batches.push(batch),
    onTransport: (transport) => transports.push(transport),
    connection: overrides.connection ?? tokenConnection,
    ...(overrides.onRejected === undefined ? {} : { onRejected: overrides.onRejected }),
    ...(overrides.onUnsupported === undefined ? {} : { onUnsupported: overrides.onUnsupported }),
    pollMs: 20,
    reconnectMs: 10,
    maxReconnectMs: 20,
    streamRetryMs: overrides.streamRetryMs ?? 60_000,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 5_000,
  });
  feeds.push(feed);
  feed.start();
  return { feed, batches, transports };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const ids = (batches: ReadonlyArray<FeedBatch>) =>
  batches.flatMap((batch) => batch.events.map((event) => [event.id, event.seq]));

describe("SSE 파서", () => {
  it("여러 조각으로 나뉜 메시지와 주석, CRLF 를 읽는다", () => {
    const parser = new SseParser();
    expect(parser.push(": ping\n\nevent: rea")).toEqual([]);
    expect(parser.push('dy\r\nid: 4\r\ndata: {"a":1}\r\n\r\n')).toEqual([
      { event: "ready", id: "4", data: '{"a":1}' },
    ]);
  });
});

describe("v1 기기 토큰", () => {
  it("토큰을 실어 v1 경로로 붙고, 폴링도 v1 응답을 읽는다", async () => {
    const server = await startServer();
    server.add(record(1, 1));
    server.streamAvailable = false;
    const { batches, transports } = startFeed(server, { connection: tokenConnection });
    await waitFor(() => transports.includes("polling") && batches.length > 0);
    expect(server.v1Requests.every((auth) => auth === `Bearer ${DEVICE_TOKEN}`)).toBe(true);
    expect(server.v1Requests.length).toBeGreaterThan(0);
    expect(server.unversionedRequests).toBe(0);
    expect(ids(batches)).toEqual([[1, 1]]);
  });

  it("토큰이 거절되면 안내를 한 번 올리고 다시 요청하지 않는다", async () => {
    const server = await startServer();
    server.tokenAccepted = false;
    let rejected = 0;
    startFeed(server, {
      connection: tokenConnection,
      onRejected: () => {
        rejected += 1;
      },
    });
    await waitFor(() => rejected === 1);
    const requests = server.v1Requests.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rejected).toBe(1);
    expect(server.v1Requests).toHaveLength(requests);
  });

  it("연결 중 기기가 지워져 스트림이 끊기면 거절로 알아채고, 다시 연결하면 이어 받는다", async () => {
    const server = await startServer();
    server.add(record(1, 1));
    let rejected = 0;
    const { feed, batches } = startFeed(server, {
      connection: tokenConnection,
      onRejected: () => {
        rejected += 1;
      },
    });
    await waitFor(() => batches.length === 1);

    server.tokenAccepted = false;
    server.dropClients();
    await waitFor(() => rejected === 1);

    server.tokenAccepted = true;
    server.add(record(2, 2));
    feed.reconnect();
    await waitFor(() => ids(batches).some(([id]) => id === 2));
    expect(server.streamRequests.at(-1)).toBe("1");
  });

  it("앞단 프록시의 401 은 기기 거절로 보지 않고 다시 시도한다", async () => {
    const server = await startServer();
    server.proxyRefuses = true;
    let rejected = 0;
    startFeed(server, {
      connection: tokenConnection,
      onRejected: () => {
        rejected += 1;
      },
    });
    await waitFor(() => server.v1Requests.length >= 3);
    expect(rejected).toBe(0);
  });

  it("저장한 토큰을 쓸 수 없으면 요청 없이 거절로 알린다", async () => {
    const server = await startServer();
    let rejected = 0;
    startFeed(server, {
      connection: () => Promise.resolve({ kind: "rejected" }),
      onRejected: () => {
        rejected += 1;
      },
    });
    await waitFor(() => rejected === 1);
    expect(server.v1Requests).toEqual([]);
    expect(server.unversionedRequests).toBe(0);
  });

  it("v1 이 없는 옛 서버면 옛 경로로 돌아가지 않고 지원하지 않는다고 한 번 알린다", async () => {
    const server = await startServer();
    let unsupported = 0;
    let rejected = 0;
    const { transports } = startFeed(server, {
      connection: () => Promise.resolve({ kind: "unsupported" }),
      onUnsupported: () => {
        unsupported += 1;
      },
      onRejected: () => {
        rejected += 1;
      },
    });
    await waitFor(() => unsupported === 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(unsupported).toBe(1);
    expect(rejected).toBe(0);
    expect(transports).toEqual(["down"]);
    expect(server.v1Requests).toEqual([]);
    expect(server.unversionedRequests).toBe(0);
  });
});

describe("알림 사건 받기", () => {
  it("SSE 로 연결하면 열린 사건을 첫 묶음으로, 새 사건은 바로 받는다", async () => {
    const server = await startServer();
    server.add(record(1, 1));
    const { batches, transports } = startFeed(server);
    await waitFor(() => batches.length === 1);
    expect(batches[0]).toMatchObject({ initial: true, open: [1] });
    expect(ids(batches)).toEqual([[1, 1]]);
    server.add(record(2, 2));
    await waitFor(() => batches.length === 2);
    expect(batches[1]).toMatchObject({ initial: false, open: null });
    expect(ids(batches.slice(1))).toEqual([[2, 2]]);
    expect(transports).toEqual(["stream"]);
  });

  it("끊기면 다시 붙으며 Last-Event-ID 로 마지막 번호 뒤만 받는다", async () => {
    const server = await startServer();
    server.add(record(1, 1));
    const { batches } = startFeed(server);
    await waitFor(() => batches.length === 1);
    server.add(record(2, 2));
    await waitFor(() => batches.length === 2);
    server.dropClients();
    server.add(record(1, 3, true));
    server.add(record(3, 4));
    await waitFor(() => batches.length === 3);
    expect(server.streamRequests).toEqual([null, "2"]);
    expect(batches[2]).toMatchObject({ initial: true, open: [2, 3] });
    expect(ids(batches.slice(2))).toEqual([
      [1, 3],
      [3, 4],
    ]);
  });

  it("SSE 가 안 되면 같은 저장소를 읽는 폴링으로 같은 사건을 받는다", async () => {
    const server = await startServer();
    server.streamAvailable = false;
    server.add(record(1, 1));
    const { batches, transports } = startFeed(server);
    await waitFor(() => batches.length >= 1);
    expect(batches[0]).toMatchObject({ initial: true, open: [1] });
    expect(ids(batches.slice(0, 1))).toEqual([[1, 1]]);
    server.add(record(2, 2));
    await waitFor(() => ids(batches).some(([id]) => id === 2));
    expect(server.pollRequests[0]).toBeNull();
    expect(server.pollRequests).toContain("1");
    expect(transports).toContain("polling");
    expect(batches.filter((batch) => batch.initial)).toHaveLength(1);
  });

  it("하트비트도 오지 않고 멈춘 연결은 끊고 다시 붙는다", async () => {
    const server = await startServer();
    server.add(record(1, 1));
    const { batches } = startFeed(server, { idleTimeoutMs: 60 });
    await waitFor(() => server.streamRequests.length >= 2);
    expect(server.streamRequests.slice(0, 2)).toEqual([null, "1"]);
    expect(batches[0]).toMatchObject({ initial: true });
  });

  it("다시 붙었을 때 서버 번호가 더 작으면 그 번호를 따른다", async () => {
    const server = await startServer();
    server.add(record(1, 9));
    const { batches } = startFeed(server);
    await waitFor(() => batches.length === 1);
    server.log = [record(1, 1)];
    server.dropClients();
    await waitFor(() => batches.length === 2);
    expect(batches[1]).toMatchObject({ initial: true, cursor: 1 });
  });

  it("폴링하다가 SSE 가 돌아오면 다시 SSE 로 받는다", async () => {
    const server = await startServer();
    server.streamAvailable = false;
    const { batches, transports } = startFeed(server, { streamRetryMs: 50 });
    await waitFor(() => transports.includes("polling"));
    server.streamAvailable = true;
    await waitFor(() => transports.at(-1) === "stream");
    server.add(record(5, 5));
    await waitFor(() => ids(batches).some(([id]) => id === 5));
    expect(server.streamRequests.at(-1)).toBe("0");
  });
});
