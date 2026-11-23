import { describe, expect, it, vi } from "vitest";

import { openChangeStream } from "./change-stream";
import type { ChangeStreamHandlers } from "./change-stream";
import type { FetchLike } from "./client";

const target = { server: "https://ganger.example.com", token: "secret" };

function handlers() {
  return {
    onReady: vi.fn<ChangeStreamHandlers["onReady"]>(),
    onChange: vi.fn<ChangeStreamHandlers["onChange"]>(),
    onAlive: vi.fn<ChangeStreamHandlers["onAlive"]>(),
    onEnd: vi.fn<ChangeStreamHandlers["onEnd"]>(),
  };
}

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

describe("변경 기록 SSE 읽기", () => {
  it("기기 토큰을 실어 열고 나뉘어 온 사건을 읽는다", async () => {
    const fetcher = vi.fn<FetchLike>(() =>
      Promise.resolve(
        streamOf([
          "retry: 3000\n\nevent: ready\nid: 1\ndata: {}\n\nevent: cha",
          'nge\nid: 2\ndata: {"kind":"run"}\n\nevent: reset\ndata: {}\n\nevent: heartbeat\ndata: null\n\n',
        ]),
      ),
    );
    const on = handlers();
    openChangeStream(fetcher, target, on);
    await vi.waitFor(() => expect(on.onEnd).toHaveBeenCalledWith("failed"));
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://ganger.example.com/api/v1/change-events/stream",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer secret",
    });
    expect(on.onReady).toHaveBeenCalledOnce();
    expect(on.onChange).toHaveBeenCalledTimes(2);
    expect(on.onAlive).toHaveBeenCalledTimes(5);
  });

  it("401은 거절로, 다른 실패는 실패로 끝낸다", async () => {
    const rejected = handlers();
    openChangeStream(() => Promise.resolve(new Response("", { status: 401 })), target, rejected);
    await vi.waitFor(() => expect(rejected.onEnd).toHaveBeenCalledWith("rejected"));
    const failed = handlers();
    openChangeStream(() => Promise.reject(new TypeError("offline")), target, failed);
    await vi.waitFor(() => expect(failed.onEnd).toHaveBeenCalledWith("failed"));
  });

  it("닫은 뒤에는 끝을 알리지 않고 요청을 멈춘다", async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher: FetchLike = (_url, init) => {
      signal = init?.signal;
      return new Promise(() => undefined);
    };
    const on = handlers();
    const close = openChangeStream(fetcher, target, on);
    close();
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(on.onEnd).not.toHaveBeenCalled();
  });
});
