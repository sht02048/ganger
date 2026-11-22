import { V1_PATHS } from "@ganger/api";

import type { FetchLike } from "./client";

export type StreamEnd = "rejected" | "failed";

export interface ChangeStreamHandlers {
  onReady: () => void;
  onChange: () => void;
  onAlive: () => void;
  onEnd: (reason: StreamEnd) => void;
}

function eventNameOf(block: string): string | null {
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) return line.slice("event:".length).trim();
  }
  return null;
}

function dispatch(block: string, handlers: ChangeStreamHandlers): void {
  handlers.onAlive();
  const event = eventNameOf(block);
  if (event === "ready") handlers.onReady();
  if (event === "change" || event === "reset") handlers.onChange();
}

async function pump(
  body: ReadableStream<Uint8Array>,
  handlers: ChangeStreamHandlers,
  isClosed: () => boolean,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (isClosed()) return;
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      dispatch(buffer.slice(0, boundary), handlers);
      if (isClosed()) return;
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function openChangeStream(
  fetcher: FetchLike,
  { server, token }: { server: string; token: string },
  handlers: ChangeStreamHandlers,
): () => void {
  const abort = new AbortController();
  let closed = false;
  const end = (reason: StreamEnd) => {
    if (closed) return;
    closed = true;
    handlers.onEnd(reason);
  };
  const run = async () => {
    const response = await fetcher(`${server}${V1_PATHS.changeStream}`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
      signal: abort.signal,
    });
    if (closed) return;
    if (response.status === 401) return end("rejected");
    if (!response.ok || response.body === null) return end("failed");
    await pump(response.body, handlers, () => closed);
    end("failed");
  };
  run().catch(() => end("failed"));
  return () => {
    closed = true;
    abort.abort();
  };
}
