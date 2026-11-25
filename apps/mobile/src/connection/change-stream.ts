import { V1_PATHS } from "@ganger/api";
import { z } from "zod";

import type { FetchLike } from "./client";

export type StreamEnd = "rejected" | "failed";

const changeNoticeSchema = z.object({
  kind: z.string(),
  workspaceId: z.string().nullable(),
  part: z.string().nullable().catch(null),
});

export type ChangeNotice = z.infer<typeof changeNoticeSchema>;

export interface ChangeStreamHandlers {
  onReady: () => void;
  onChange: (notice: ChangeNotice | null) => void;
  onAlive: () => void;
  onEnd: (reason: StreamEnd) => void;
}

function fieldOf(block: string, field: "event" | "data"): string | null {
  const values = block
    .split("\n")
    .filter((line) => line.startsWith(`${field}:`))
    .map((line) => line.slice(field.length + 1).replace(/^ /, ""));
  return values.length === 0 ? null : values.join("\n");
}

export function changeNoticeOf(data: string | null): ChangeNotice | null {
  if (data === null) return null;
  try {
    const parsed = changeNoticeSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function dispatch(block: string, handlers: ChangeStreamHandlers): void {
  handlers.onAlive();
  const event = fieldOf(block, "event")?.trim();
  if (event === "ready") handlers.onReady();
  if (event === "change") handlers.onChange(changeNoticeOf(fieldOf(block, "data")));
  if (event === "reset") handlers.onChange(null);
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
