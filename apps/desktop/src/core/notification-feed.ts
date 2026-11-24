import { notificationReadySchema, notificationRecordSchema } from "@ganger/app/notifications/feed";
import type { NotificationRecord } from "@ganger/app/notifications/feed";
import { V1_NOTIFICATION_PATHS, notificationFeedResponseSchema, v1ErrorSchema } from "@ganger/api";
import type { FeedConnection } from "./device-link.js";

export interface FeedBatch {
  events: NotificationRecord[];
  open: number[] | null;
  cursor: number;
  initial: boolean;
}

export type FeedTransport = "stream" | "polling" | "down";

export interface NotificationFeedOptions {
  origin: string;
  onBatch: (batch: FeedBatch) => void;
  onTransport?: (transport: FeedTransport) => void;
  connection: () => Promise<FeedConnection>;
  onRejected?: () => void;
  onUnsupported?: () => void;
  fetch?: typeof fetch;
  pollMs?: number;
  reconnectMs?: number;
  maxReconnectMs?: number;
  streamRetryMs?: number;
  streamFailuresBeforePolling?: number;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface SseMessage {
  event: string;
  data: string;
  id: string | null;
}

export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];
  private id: string | null = null;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (match === null) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const message = this.line(line);
      if (message !== null) messages.push(message);
    }
    return messages;
  }

  private line(line: string): SseMessage | null {
    if (line.length === 0) {
      if (this.data.length === 0) {
        this.event = "";
        return null;
      }
      const message = { event: this.event || "message", data: this.data.join("\n"), id: this.id };
      this.event = "";
      this.data = [];
      return message;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\u0000")) this.id = value;
    return null;
  }
}

function authorization(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function isTokenRefused(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  const body: unknown = await response.json().catch(() => null);
  return v1ErrorSchema.safeParse(body).data?.error.reason === "invalid-token";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const FEED_POLL_MS = 5_000;
export const FEED_RECONNECT_MS = 1_000;
export const FEED_MAX_RECONNECT_MS = 30_000;
export const FEED_STREAM_RETRY_MS = 60_000;
export const FEED_IDLE_TIMEOUT_MS = 45_000;

export class NotificationFeed {
  private readonly options: NotificationFeedOptions;
  private readonly fetch: typeof fetch;
  private cursor: number | null = null;
  private stopped = true;
  private generation = 0;
  private abort: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private streamFailures = 0;
  private reconnectDelay: number;
  private mode: "stream" | "polling" = "stream";
  private pollingSince = 0;
  private needsInitial = true;
  private transport: FeedTransport | undefined;

  constructor(options: NotificationFeedOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    this.reconnectDelay = options.reconnectMs ?? FEED_RECONNECT_MS;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.run();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.abort?.abort();
    this.abort = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  reconnect(): void {
    this.stop();
    this.mode = "stream";
    this.streamFailures = 0;
    this.reconnectDelay = this.options.reconnectMs ?? FEED_RECONNECT_MS;
    this.start();
  }

  private run(): void {
    const generation = (this.generation += 1);
    this.needsInitial = true;
    if (this.mode === "polling") void this.poll(generation);
    else void this.stream(generation);
  }

  private later(ms: number, generation: number, next: () => void): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (generation === this.generation && !this.stopped) next();
    }, ms);
  }

  private async token(generation: number): Promise<string | null> {
    const connection = await this.options.connection();
    if (generation !== this.generation) return null;
    switch (connection.kind) {
      case "token":
        return connection.token;
      case "rejected":
        this.giveUp(this.options.onRejected);
        return null;
      case "unsupported":
        this.giveUp(this.options.onUnsupported);
        return null;
      case "unavailable":
        throw new Error("no device connection");
    }
  }

  private reject(): void {
    this.giveUp(this.options.onRejected);
  }

  private giveUp(notify: (() => void) | undefined): void {
    this.stop();
    this.setTransport("down");
    notify?.();
  }

  private setTransport(transport: FeedTransport): void {
    if (transport === this.transport) return;
    this.transport = transport;
    this.options.onTransport?.(transport);
  }

  private emit(events: NotificationRecord[], open: number[] | null, cursor: number): void {
    const latest = Math.max(cursor, ...events.map((event) => event.seq));
    this.cursor = open === null ? Math.max(this.cursor ?? 0, latest) : latest;
    const initial = this.needsInitial;
    this.needsInitial = false;
    this.options.onBatch({ events, open, cursor: this.cursor, initial });
  }

  private async stream(generation: number): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    let ready = false;
    const idleMs = this.options.idleTimeoutMs ?? FEED_IDLE_TIMEOUT_MS;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const watch = () => {
      if (idle !== undefined) clearTimeout(idle);
      idle = setTimeout(() => abort.abort(), idleMs);
    };
    try {
      watch();
      const token = await this.token(generation);
      if (token === null) return;
      const headers: Record<string, string> = {
        accept: "text/event-stream",
        ...authorization(token),
      };
      if (this.cursor !== null) headers["last-event-id"] = String(this.cursor);
      const response = await this.fetch(
        new URL(V1_NOTIFICATION_PATHS.stream, this.options.origin),
        {
          headers,
          signal: abort.signal,
          redirect: "error",
        },
      );
      if (await isTokenRefused(response)) {
        if (generation === this.generation) this.reject();
        return;
      }
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !type.startsWith("text/event-stream") || response.body === null) {
        await response.body?.cancel();
        throw new Error(`stream unavailable: ${response.status}`);
      }
      const parser = new SseParser();
      const decoder = new TextDecoder();
      const backlog: NotificationRecord[] = [];
      const reader = response.body.getReader();
      watch();
      for (;;) {
        const { done, value } = await reader.read().finally(watch);
        if (generation !== this.generation) return;
        if (done) break;
        for (const message of parser.push(decoder.decode(value, { stream: true }))) {
          const data = parseJson(message.data);
          if (message.event === "notification") {
            const record = notificationRecordSchema.safeParse(data);
            if (!record.success) continue;
            if (ready) this.emit([record.data], null, record.data.seq);
            else backlog.push(record.data);
          } else if (message.event === "ready") {
            const parsed = notificationReadySchema.safeParse(data);
            if (!parsed.success) continue;
            ready = true;
            this.streamFailures = 0;
            this.reconnectDelay = this.options.reconnectMs ?? FEED_RECONNECT_MS;
            this.setTransport("stream");
            this.emit(backlog.splice(0), parsed.data.open, parsed.data.cursor);
          }
        }
      }
    } catch {
      if (generation !== this.generation) return;
    } finally {
      if (idle !== undefined) clearTimeout(idle);
      if (this.abort === abort) this.abort = undefined;
      abort.abort();
    }
    if (generation !== this.generation || this.stopped) return;
    if (!ready) this.streamFailures += 1;
    const limit = this.options.streamFailuresBeforePolling ?? 2;
    if (this.streamFailures >= limit) {
      this.mode = "polling";
      this.pollingSince = Date.now();
      this.run();
      return;
    }
    this.setTransport("down");
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, this.options.maxReconnectMs ?? FEED_MAX_RECONNECT_MS);
    this.later(delay, generation, () => this.run());
  }

  private async poll(generation: number): Promise<void> {
    try {
      const token = await this.token(generation);
      if (token === null) return;
      const url = new URL(V1_NOTIFICATION_PATHS.feed, this.options.origin);
      if (this.cursor !== null) url.searchParams.set("after", String(this.cursor));
      const response = await this.fetch(url, {
        headers: authorization(token),
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 5_000),
        redirect: "error",
      });
      if (generation !== this.generation) return;
      if (await isTokenRefused(response)) {
        if (generation === this.generation) this.reject();
        return;
      }
      if (!response.ok) throw new Error(`poll failed: ${response.status}`);
      const body: unknown = await response.json();
      if (generation !== this.generation) return;
      const feed = notificationFeedResponseSchema.safeParse(body).data?.data;
      if (feed === undefined) throw new Error("poll response did not parse");
      this.setTransport("polling");
      this.emit(feed.events, feed.open, feed.cursor);
    } catch {
      if (generation !== this.generation) return;
      this.setTransport("down");
    }
    if (this.stopped || generation !== this.generation) return;
    const retryStream = this.options.streamRetryMs ?? FEED_STREAM_RETRY_MS;
    if (Date.now() - this.pollingSince >= retryStream) {
      this.later(0, generation, () => {
        this.mode = "stream";
        this.streamFailures = 0;
        void this.stream(generation);
      });
      return;
    }
    this.later(this.options.pollMs ?? FEED_POLL_MS, generation, () => void this.poll(generation));
  }
}
