import { describe, expect, it } from "vitest";
import {
  allowedHosts,
  checkRequest,
  hostnameOfHostHeader,
  rejectionLogFields,
  rejectionResponse,
} from "@ganger/app/request-guard";
import type { AllowedHostsInput } from "@ganger/app/request-guard";

const configured: AllowedHostsInput = {
  bindHost: "127.0.0.1",
  webAddress: "https://server.example.ts.net",
  webhookAddress: "https://hooks.example.com",
};
const unset: AllowedHostsInput = { bindHost: "127.0.0.1", webAddress: null, webhookAddress: null };

function request(
  path: string,
  init: { method?: string; host?: string; origin?: string; funnel?: boolean } = {},
): Request {
  const headers = new Headers();
  if (init.host !== undefined) headers.set("host", init.host);
  if (init.origin !== undefined) headers.set("origin", init.origin);
  if (init.funnel === true) headers.set("tailscale-funnel-request", "?1");
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: init.method ?? "GET",
    headers,
  });
}

function verdictOf(req: Request, input: AllowedHostsInput = configured) {
  return checkRequest(req, allowedHosts(input));
}

describe("Host 검사", () => {
  it("127.0.0.1·localhost·[::1] 은 주소를 정하지 않아도 늘 받는다", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "LOCALHOST", "[::1]:3000"]) {
      expect(verdictOf(request("/runs", { host }), unset)).toEqual({ ok: true });
    }
  });

  it("443 이 아닌 포트로 연 열 주소는 그 포트의 Host 와 Origin 을 받는다", () => {
    const onFallbackPort: AllowedHostsInput = {
      bindHost: "127.0.0.1",
      webAddress: "https://server.example.ts.net:8444",
      webhookAddress: null,
    };
    const post = request("/_serverFn/x", {
      method: "POST",
      host: "server.example.ts.net:8444",
      origin: "https://server.example.ts.net:8444",
    });
    expect(verdictOf(post, onFallbackPort)).toEqual({ ok: true });
    expect(
      verdictOf(request("/runs", { host: "other.example.ts.net:8444" }), onFallbackPort),
    ).toMatchObject({
      ok: false,
      reason: "host-not-allowed",
    });
  });

  it("주소를 잘못 넣어도 127.0.0.1 은 막히지 않는다", () => {
    const wrong = {
      bindHost: "0.0.0.0",
      webAddress: "https://typo.example.com",
      webhookAddress: null,
    };
    expect(verdictOf(request("/settings", { host: "127.0.0.1:3000" }), wrong)).toEqual({
      ok: true,
    });
  });

  it("다른 기기에서 열 주소의 호스트는 포트가 달라도 받는다", () => {
    for (const host of [
      "server.example.ts.net",
      "server.example.ts.net:443",
      "Server.Example.ts.net.",
    ]) {
      expect(verdictOf(request("/runs", { host }))).toEqual({ ok: true });
    }
  });

  it("허용하지 않은 Host 는 403 host-not-allowed 로 거절한다(DNS 리바인딩)", () => {
    expect(verdictOf(request("/runs", { host: "evil.example:3000" }))).toEqual({
      ok: false,
      status: 403,
      reason: "host-not-allowed",
      host: "evil.example:3000",
      origin: null,
    });
  });

  it("바깥 주소를 정하지 않았으면 tailnet 이름으로 온 화면 요청을 거절한다", () => {
    const verdict = verdictOf(request("/runs", { host: "server.example.ts.net" }), unset);
    expect(verdict).toMatchObject({ ok: false, reason: "host-not-allowed" });
  });

  it("바인드 주소가 특정 주소면 그 주소로 온 요청을 받고, 와일드카드는 받지 않는다", () => {
    const tailnetIp = { ...unset, bindHost: "100.64.0.1" };
    expect(verdictOf(request("/runs", { host: "100.64.0.1:3000" }), tailnetIp)).toEqual({
      ok: true,
    });
    const wildcard = { ...unset, bindHost: "0.0.0.0" };
    expect(verdictOf(request("/runs", { host: "0.0.0.0:3000" }), wildcard)).toMatchObject({
      ok: false,
      reason: "host-not-allowed",
    });
  });

  it("Host 헤더에 사용자 정보·경로를 섞으면 받지 않는다", () => {
    expect(hostnameOfHostHeader("evil.example@127.0.0.1")).toBeNull();
    expect(hostnameOfHostHeader("127.0.0.1/x")).toBeNull();
    expect(hostnameOfHostHeader("")).toBeNull();
    expect(verdictOf(request("/runs", { host: "evil.example@127.0.0.1" }))).toMatchObject({
      ok: false,
      reason: "host-not-allowed",
    });
  });

  it("Linear가 이 서버에 닿을 주소의 호스트는 webhook 경로에서만 받는다", () => {
    const webhook = request("/api/webhooks/tracker/c-1", {
      method: "POST",
      host: "hooks.example.com",
    });
    expect(verdictOf(webhook)).toEqual({ ok: true });
    expect(verdictOf(request("/runs", { host: "hooks.example.com" }))).toMatchObject({
      ok: false,
      reason: "host-not-allowed",
    });
  });

  it("신원 확인 경로는 Host 를 보지 않는다", () => {
    expect(verdictOf(request("/api/identity", { host: "server.example.ts.net" }), unset)).toEqual({
      ok: true,
    });
    expect(
      verdictOf(request("/api/identity", { method: "POST", host: "evil.example" }), unset),
    ).toMatchObject({ ok: false, reason: "host-not-allowed" });
  });

  it("webhook 확인 경로(GET)는 아직 저장하지 않은 닿을 주소에서도 받는다", () => {
    const ping = "/api/webhooks/ping/instance-1";
    expect(verdictOf(request(ping, { host: "new.example.ts.net:8443" }), unset)).toEqual({
      ok: true,
    });
    expect(
      verdictOf(request(ping, { method: "POST", host: "new.example.ts.net" }), unset),
    ).toMatchObject({ ok: false, reason: "host-not-allowed" });
    expect(
      verdictOf(request("/api/webhooks/tracker/conn-1", { host: "new.example.ts.net" }), unset),
    ).toMatchObject({ ok: false, reason: "host-not-allowed" });
  });

  it("닿을 주소 호스트로는 확인 경로가 있어도 webhook 경로 밖을 받지 않는다", () => {
    expect(
      verdictOf(request("/api/webhooks/../settings", { host: "hooks.example.com" })),
    ).toMatchObject({ ok: false, reason: "host-not-allowed" });
    expect(verdictOf(request("/settings", { host: "hooks.example.com" }))).toMatchObject({
      ok: false,
      reason: "host-not-allowed",
    });
  });
});

describe("와일드카드 바인드의 tailnet 자동 허용(0157)", () => {
  const MAGIC = "server.example.ts.net";
  const IP = "100.64.0.10";
  const IPV6 = "[fd7a:115c:a1e0::10]";
  const wildcard: AllowedHostsInput = {
    bindHost: "0.0.0.0",
    webAddress: null,
    webhookAddress: null,
    tailnetHosts: [MAGIC, IP, "fd7a:115c:a1e0::10"],
    webPort: 3000,
  };
  const rejected = { ok: false, reason: "host-not-allowed" };

  describe.each([MAGIC, IP, IPV6])("%s", (name) => {
    it("서버 포트로 오면 화면을 받는다", () => {
      expect(verdictOf(request("/settings", { host: `${name}:3000` }), wildcard)).toEqual({
        ok: true,
      });
    });

    it.each([`${name}:443`, `${name}:8443`, `${name}:10000`, name])(
      "%s 는 화면을 막고 webhook 경로만 받는다",
      (host) => {
        expect(verdictOf(request("/settings", { host }), wildcard)).toMatchObject(rejected);
        expect(
          verdictOf(request("/api/webhooks/tracker/conn", { method: "POST", host }), wildcard),
        ).toEqual({ ok: true });
      },
    );

    it("Funnel 요청이 Host 를 서버 포트로 꾸며도 화면을 막고 webhook 경로만 받는다", () => {
      const host = `${name}:3000`;
      expect(verdictOf(request("/settings", { host, funnel: true }), wildcard)).toMatchObject(
        rejected,
      );
      expect(
        verdictOf(
          request("/api/webhooks/tracker/conn", { method: "POST", host, funnel: true }),
          wildcard,
        ),
      ).toEqual({ ok: true });
    });
  });

  it("서버 포트가 Funnel 포트거나 webhook 주소의 host:port 면 자동 허용하지 않는다", () => {
    const onFunnelPort = { ...wildcard, webPort: 8443 };
    expect(verdictOf(request("/settings", { host: `${MAGIC}:8443` }), onFunnelPort)).toMatchObject(
      rejected,
    );
    const sameAsWebhook = { ...wildcard, webhookAddress: `https://${MAGIC}:3000` };
    expect(verdictOf(request("/settings", { host: `${MAGIC}:3000` }), sameAsWebhook)).toMatchObject(
      rejected,
    );
    expect(verdictOf(request("/settings", { host: `${IP}:3000` }), sameAsWebhook)).toEqual({
      ok: true,
    });
  });

  it("상태를 바꾸는 요청의 Origin 도 서버 포트만 받는다", () => {
    const post = (origin: string, funnel = false) =>
      verdictOf(
        request("/_serverFn/x", { method: "POST", host: `${MAGIC}:3000`, origin, funnel }),
        wildcard,
      );
    expect(post(`http://${MAGIC}:3000`)).toEqual({ ok: true });
    expect(post(`https://${MAGIC}`)).toMatchObject({ ok: false, reason: "origin-not-allowed" });
    expect(post(`https://${MAGIC}:8443`)).toMatchObject({
      ok: false,
      reason: "origin-not-allowed",
    });
    expect(post(`http://${MAGIC}:3000`, true)).toMatchObject(rejected);
  });

  it.each(["127.0.0.1", "127.0.0.1:3000", "localhost:3000", "[::1]", MAGIC, `${MAGIC}:443`])(
    "Funnel 요청은 Host 를 %s 로 보내도 화면과 서버 함수에 닿지 못한다",
    (host) => {
      const operator = { ...wildcard, webAddress: `https://${MAGIC}` };
      for (const input of [wildcard, operator]) {
        expect(verdictOf(request("/settings", { host, funnel: true }), input)).toMatchObject(
          rejected,
        );
        expect(
          verdictOf(request("/_serverFn/x", { method: "POST", host, funnel: true }), input),
        ).toMatchObject(rejected);
      }
    },
  );

  it("운영자가 직접 넣은 다른 기기에서 열 주소는 어느 포트로 와도 그대로 받는다", () => {
    const operator = { ...wildcard, webAddress: `https://${MAGIC}` };
    for (const host of [MAGIC, `${MAGIC}:443`, `${MAGIC}:3000`]) {
      expect(verdictOf(request("/settings", { host }), operator)).toEqual({ ok: true });
    }
  });
});

describe("Origin 검사", () => {
  const serverFn = "/_serverFn/abc";

  it("허용한 Origin 의 POST(server function)는 통과한다", () => {
    for (const origin of ["http://127.0.0.1:3000", "https://server.example.ts.net"]) {
      expect(
        verdictOf(request(serverFn, { method: "POST", host: "127.0.0.1:3000", origin })),
      ).toEqual({ ok: true });
    }
  });

  it("다른 사이트의 Origin 으로 온 POST 는 403 origin-not-allowed 로 거절한다", () => {
    expect(
      verdictOf(
        request(serverFn, {
          method: "POST",
          host: "127.0.0.1:3000",
          origin: "https://evil.example",
        }),
      ),
    ).toEqual({
      ok: false,
      status: 403,
      reason: "origin-not-allowed",
      host: "127.0.0.1:3000",
      origin: "https://evil.example",
    });
  });

  it("null Origin 과 http·https 가 아닌 Origin 은 거절한다", () => {
    for (const origin of ["null", "file://", "chrome-extension://abc"]) {
      expect(
        verdictOf(request(serverFn, { method: "POST", host: "127.0.0.1", origin })),
      ).toMatchObject({ ok: false, reason: "origin-not-allowed" });
    }
  });

  it("Linear가 이 서버에 닿을 주소는 화면의 Origin 으로 받지 않는다", () => {
    expect(
      verdictOf(
        request(serverFn, {
          method: "POST",
          host: "127.0.0.1",
          origin: "https://hooks.example.com",
        }),
      ),
    ).toMatchObject({ ok: false, reason: "origin-not-allowed" });
  });

  it("Origin 이 없는 POST 는 브라우저가 아닌 클라이언트라 받는다", () => {
    expect(verdictOf(request(serverFn, { method: "POST", host: "127.0.0.1" }))).toEqual({
      ok: true,
    });
  });

  it("GET 은 Origin 을 보지 않는다", () => {
    expect(
      verdictOf(request("/runs", { host: "127.0.0.1", origin: "https://evil.example" })),
    ).toEqual({ ok: true });
  });

  it("webhook 은 Origin 없이도, 어떤 Origin 이어도 통과한다(서명으로 검증)", () => {
    const path = "/api/webhooks/tracker/c-1";
    expect(verdictOf(request(path, { method: "POST", host: "hooks.example.com" }))).toEqual({
      ok: true,
    });
    expect(
      verdictOf(
        request(path, { method: "POST", host: "127.0.0.1", origin: "https://linear.example" }),
      ),
    ).toEqual({ ok: true });
  });
});

describe("거절 응답과 로그", () => {
  it("403 과 까닭을 글로 돌려주고, 로그에 상태 코드·까닭·경로·Host 를 남긴다", async () => {
    const req = request("/runs", { host: "evil.example:3000" });
    const verdict = verdictOf(req);
    if (verdict.ok) throw new Error("expected rejection");
    const response = rejectionResponse(verdict.reason);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("does not accept the host name");
    expect(rejectionLogFields(req, verdict)).toEqual({
      status: 403,
      reason: "host-not-allowed",
      method: "GET",
      path: "/runs",
      host: "evil.example:3000",
      origin: null,
    });
  });
});
