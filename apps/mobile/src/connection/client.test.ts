import { CONTRACT_VERSION, V1_PATHS } from "@ganger/api";
import { describe, expect, it, vi } from "vitest";

import { IDENTITY_PATH, REQUEST_TIMEOUT_MS, connectToServer, createV1Client } from "./client";
import type { FetchLike } from "./client";
import { MINIMUM_SERVER_VERSION, isServerVersionSupported } from "./version";

const SERVER = "https://ganger.example.com";
const META = { serverVersion: MINIMUM_SERVER_VERSION, contractVersion: CONTRACT_VERSION };
const json = (body: unknown, status = 200) => Response.json(body, { status });

function routes(table: Record<string, () => Response>): FetchLike {
  return (url) => {
    const path = new URL(url).pathname;
    const reply = table[path];
    if (reply === undefined) throw new Error(`unexpected request: ${path}`);
    return Promise.resolve(reply());
  };
}

const client = (fetcher: FetchLike) => createV1Client(fetcher, { server: SERVER, token: "t" });

describe("v1 응답 가르기", () => {
  it("토큰 거절 본문이 있는 401만 토큰 거절로 읽는다", async () => {
    const refused = routes({
      [V1_PATHS.runners]: () => json({ meta: META, error: { reason: "invalid-token" } }, 401),
    });
    expect(await client(refused).runners()).toEqual({
      ok: false,
      failure: { kind: "token-rejected" },
    });
  });

  it("프록시가 만든 401은 토큰 거절이 아니라 연결을 지우지 않는다", async () => {
    const proxy = routes({ [V1_PATHS.runners]: () => new Response("login", { status: 401 }) });
    expect(await client(proxy).runners()).toEqual({
      ok: false,
      failure: { kind: "server-error" },
    });
  });

  it("Host 403은 identity의 webAccess로 토큰 거절과 가른다", async () => {
    const blocked = routes({
      [V1_PATHS.runners]: () => new Response("Blocked", { status: 403 }),
      [IDENTITY_PATH]: () => json({ product: "ganger", webAccess: "host-not-allowed" }),
    });
    expect(await client(blocked).runners()).toEqual({
      ok: false,
      failure: { kind: "host-blocked" },
    });
  });

  it("identity가 허용이라고 답한 403은 Host 거절로 안내하지 않는다", async () => {
    const other = routes({
      [V1_PATHS.runners]: () => new Response("Blocked", { status: 403 }),
      [IDENTITY_PATH]: () => json({ product: "ganger", webAccess: "allowed" }),
    });
    expect(await client(other).runners()).toEqual({
      ok: false,
      failure: { kind: "server-error" },
    });
  });

  it("Ganger가 아닌 identity 응답은 Host 거절로 안내하지 않는다", async () => {
    const proxy = routes({
      [V1_PATHS.runners]: () => new Response("Blocked", { status: 403 }),
      [IDENTITY_PATH]: () => json({ ok: true }),
    });
    expect(await client(proxy).runners()).toEqual({
      ok: false,
      failure: { kind: "server-error" },
    });
  });

  it("네트워크 실패는 닿지 않음으로 읽는다", async () => {
    const down: FetchLike = () => Promise.reject(new TypeError("offline"));
    expect(await client(down).runners()).toEqual({
      ok: false,
      failure: { kind: "unreachable" },
    });
  });

  it("응답 없이 걸린 요청은 제한 시간 뒤 닿지 않음으로 읽는다", async () => {
    vi.useFakeTimers();
    try {
      const hanging: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      const reply = client(hanging).runners();
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      expect(await reply).toEqual({ ok: false, failure: { kind: "unreachable" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("최소 버전보다 낮은 서버를 맞지 않는 서버로 읽는다", async () => {
    const old = routes({
      [V1_PATHS.runners]: () =>
        json({ meta: { ...META, serverVersion: "0.3.9" }, data: { runners: [] } }),
    });
    expect(await client(old).runners()).toEqual({
      ok: false,
      failure: { kind: "incompatible", serverVersion: "0.3.9" },
    });
  });

  it("계약 버전이 다른 서버와 v1 경로가 없는 서버를 맞지 않는 서버로 읽는다", async () => {
    const future = routes({
      [V1_PATHS.runners]: () =>
        json({ meta: { ...META, contractVersion: CONTRACT_VERSION + 1 }, data: { runners: [] } }),
    });
    expect(await client(future).runners()).toMatchObject({
      ok: false,
      failure: { kind: "incompatible" },
    });
    const missing = routes({ [V1_PATHS.runners]: () => new Response("", { status: 404 }) });
    expect(await client(missing).runners()).toEqual({
      ok: false,
      failure: { kind: "incompatible", serverVersion: null },
    });
  });

  it.each([
    ["0.4.0", true],
    ["0.4.1-rc.1", true],
    ["1.0.0", true],
    ["0.3.99", false],
    ["unknown", false],
  ])("서버 버전 %s의 지원 여부는 %s다", (version, supported) => {
    expect(isServerVersionSupported(version, "0.4.0")).toBe(supported);
  });
});

describe("연결 코드 교환", () => {
  it("토큰 없이 코드와 기기 이름을 보내 토큰을 받는다", async () => {
    const fetcher = vi.fn<FetchLike>(() =>
      Promise.resolve(json({ meta: META, data: { deviceId: "d", token: "new" } })),
    );
    const reply = await connectToServer(fetcher, { server: SERVER, code: "c", name: "iPhone" });
    expect(reply).toEqual({ ok: true, result: { deviceId: "d", token: "new" } });
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ code: "c", name: "iPhone" }));
  });

  it.each(["unknown-code", "expired-code", "used-code"] as const)(
    "%s 거절을 이유 값으로 돌려준다",
    async (reason) => {
      const fetcher = routes({
        [V1_PATHS.connect]: () => json({ meta: META, error: { reason } }, 410),
      });
      expect(await connectToServer(fetcher, { server: SERVER, code: "c", name: "i" })).toEqual({
        ok: false,
        failure: { kind: "code-refused", reason },
      });
    },
  );
});
