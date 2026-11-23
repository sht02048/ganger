import { describe, expect, it } from "vitest";
import { noticePageResponse } from "./host-blocked-page.js";
import { runTicketResponse } from "./run-ticket-link.js";
import type { RunTicketCopy, RunTicketLink } from "./run-ticket-link.js";

const copy: RunTicketCopy = {
  notFound: { title: "찾지 못했어요", body: "티켓이 없어요." },
  unavailable: { title: "연결하지 못했어요", body: "다시 열어 보세요." },
};

const request = new Request("http://127.0.0.1/runs/run-1/ticket");
const found = (url: string): RunTicketLink => ({ status: 200, url });

describe("runTicketResponse", () => {
  it("https 티켓 주소로 리다이렉트하고 보낸 곳을 넘기지 않는다", () => {
    const response = runTicketResponse(request, found("https://tracker.example.com/ACME-1"), copy);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://tracker.example.com/ACME-1");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    "http://tracker.example.com/ACME-1",
    "https://user:secret@tracker.example.com/ACME-1",
    "javascript:alert(1)",
    "//evil.example",
    "nope",
  ])("%s 로는 리다이렉트하지 않고 찾지 못함 안내를 보인다", async (url) => {
    const response = runTicketResponse(request, found(url), copy);
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("찾지 못했어요");
  });

  it("티켓이 없으면 찾지 못함 안내를 보인다", async () => {
    const response = runTicketResponse(request, { status: 404, reason: "not-found" }, copy);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("티켓이 없어요.");
  });

  it("트래커에 닿지 않으면 연결 안내를 보인다", async () => {
    const response = runTicketResponse(
      request,
      { status: 503, reason: "tracker-unavailable" },
      copy,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("연결하지 못했어요");
  });
});

describe("noticePageResponse", () => {
  it("문구를 이스케이프하고 받은 상태 코드로 응답한다", async () => {
    const response = noticePageResponse(request, {
      title: "<script>",
      body: "본문",
      status: 404,
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("&lt;script&gt;");
  });
});
