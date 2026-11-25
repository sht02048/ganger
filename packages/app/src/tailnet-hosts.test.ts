import { describe, expect, it } from "vitest";
import { hostBlockedResponse, wantsHostBlockedPage } from "./host-blocked-page.js";
import { allowedHosts, isWildcardBind } from "./request-guard.js";
import { createTailnetHostsCache } from "./tailnet-hosts.js";
import { parseThisTailnetAddresses } from "./tailscale.js";
import type { ThisTailnetAddresses } from "./tailscale.js";

const HOST = "server.example.ts.net";
const IP = "100.64.0.10";

describe("이 기기의 tailnet 주소 읽기", () => {
  it("MagicDNS 이름과 IPv4·IPv6 를 허용 목록 모양으로 읽는다", () => {
    const output = JSON.stringify({
      BackendState: "Running",
      Self: { DNSName: `${HOST}.`, TailscaleIPs: [IP, "fd7a:115c:a1e0::1", "weird"] },
    });
    expect(parseThisTailnetAddresses(output)).toEqual({
      kind: "known",
      hosts: [HOST, IP, "[fd7a:115c:a1e0::1]"],
    });
  });

  it("꺼져 있으면 없음, 이상한 출력이면 모름이다", () => {
    expect(parseThisTailnetAddresses(JSON.stringify({ BackendState: "Stopped" }))).toEqual({
      kind: "none",
    });
    expect(parseThisTailnetAddresses("not json")).toEqual({ kind: "unknown" });
  });
});

describe("와일드카드 바인드의 자동 허용", () => {
  const base = { webAddress: null, webhookAddress: null, tailnetHosts: [HOST, IP], webPort: 3000 };

  it.each(["0.0.0.0", "::", "[::]"])("%s 로 띄우면 자기 tailnet 주소를 허용한다", (bindHost) => {
    expect(isWildcardBind(bindHost)).toBe(true);
    const { web, tailnetWeb, webhook } = allowedHosts({ ...base, bindHost });
    expect([...tailnetWeb]).toEqual([`${HOST}:3000`, `${IP}:3000`]);
    expect(webhook.has(HOST)).toBe(true);
    expect(web.has(HOST)).toBe(false);
    expect(web.has("0.0.0.0")).toBe(false);
  });

  it("특정 주소로 띄우면 tailnet 주소를 더하지 않는다", () => {
    const { web, tailnetWeb, webhook } = allowedHosts({ ...base, bindHost: "127.0.0.1" });
    expect(isWildcardBind("127.0.0.1")).toBe(false);
    expect(web.has(HOST)).toBe(false);
    expect(tailnetWeb.size).toBe(0);
    expect(webhook.has(HOST)).toBe(false);
  });
});

describe("tailnet 주소 기억", () => {
  function cache(results: ThisTailnetAddresses[]) {
    let clock = 0;
    let reads = 0;
    const hosts = createTailnetHostsCache(
      () => {
        const result = results[Math.min(reads, results.length - 1)];
        reads += 1;
        return result === undefined
          ? Promise.reject(new Error("no result"))
          : Promise.resolve(result);
      },
      () => clock,
      1_000,
    );
    return { hosts, reads: () => reads, tick: (ms: number) => (clock += ms) };
  }

  it("정한 시간 안에는 다시 읽지 않고 동시 요청은 한 번만 읽는다", async () => {
    const c = cache([{ kind: "known", hosts: [HOST] }]);
    await Promise.all([c.hosts.refresh(), c.hosts.refresh()]);
    await c.hosts.refresh();
    expect(c.reads()).toBe(1);
    c.tick(1_000);
    await c.hosts.refresh();
    expect(c.reads()).toBe(2);
  });

  it("읽지 못하면 마지막 주소를 지키고, Tailscale 이 꺼지면 비운다", async () => {
    const c = cache([{ kind: "known", hosts: [HOST] }, { kind: "unknown" }, { kind: "none" }]);
    await c.hosts.refresh();
    c.tick(1_000);
    await c.hosts.refresh();
    expect(c.hosts.hosts()).toEqual([HOST]);
    c.tick(1_000);
    await c.hosts.refresh();
    expect(c.hosts.hosts()).toEqual([]);
  });
});

describe("주소가 허용되지 않은 안내 화면", () => {
  const copy = {
    title: (host: string | null) => `이 서버가 ${host ?? "이 주소"}를 허용하지 않아요`,
    body: "서버 맥의 Settings › 모바일에서 휴대폰에서 열기를 켜면 그 주소로 열 수 있어요.",
  };
  const request = (host: string, accept = "text/html", method = "GET") =>
    new Request("http://127.0.0.1:3000/", { method, headers: { host, accept } });

  it("페이지 이동에만 안내 화면을 주고 fetch·POST 에는 주지 않는다", () => {
    expect(wantsHostBlockedPage(request(HOST))).toBe(true);
    expect(wantsHostBlockedPage(request(HOST, "application/json"))).toBe(false);
    expect(wantsHostBlockedPage(request(HOST, "text/html", "POST"))).toBe(false);
  });

  it("403 으로 주소와 할 일을 보이고 스크립트를 막는다", async () => {
    const response = hostBlockedResponse(request(`${HOST}:3000`), copy);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain(`이 서버가 ${HOST}를 허용하지 않아요`);
    expect(html).toContain(copy.body);
  });

  it("Host 값이 이상하면 화면에 옮기지 않는다", async () => {
    const html = await hostBlockedResponse(request("<script>alert(1)</script>"), copy).text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("이 서버가 이 주소를 허용하지 않아요");
  });
});
