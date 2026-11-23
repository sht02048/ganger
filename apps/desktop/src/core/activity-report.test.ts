import { V1_DEVICE_ACTIVITY_PATH } from "@ganger/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityReporter } from "./activity-report.js";
import type { FeedConnection } from "./device-link.js";

const ORIGIN = "http://127.0.0.1:4000";

function reporter(connection: FeedConnection, idleSeconds = 7) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fakeFetch: typeof fetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return Promise.resolve(Response.json({}));
  };
  const instance = new ActivityReporter({
    origin: ORIGIN,
    connection: () => Promise.resolve(connection),
    idleSeconds: () => idleSeconds,
    fetch: fakeFetch,
    intervalMs: 60_000,
  });
  return { instance, calls };
}

describe("데스크톱의 마지막 사용 보고(M32)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("기기 토큰으로 유휴 초를 보고한다", async () => {
    const { instance, calls } = reporter({ kind: "token", token: "device-token" });
    await instance.report();
    expect(calls[0]?.url).toBe(`${ORIGIN}${V1_DEVICE_ACTIVITY_PATH}`);
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ idleSeconds: 7 }));
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer device-token");
  });

  it("시작하면 바로 한 번 보고하고 1분마다 보고하며 멈추면 끝낸다", async () => {
    const { instance, calls } = reporter({ kind: "token", token: "device-token" });
    instance.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    instance.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(calls).toHaveLength(2);
  });

  it("기기 토큰이 없으면 보고하지 않는다", async () => {
    for (const kind of ["legacy", "rejected", "unavailable"] as const) {
      const { instance, calls } = reporter({ kind });
      await instance.report();
      expect(calls).toHaveLength(0);
    }
  });
});
