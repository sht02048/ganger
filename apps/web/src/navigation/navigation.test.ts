import { describe, expect, it } from "vitest";
import {
  backState,
  backTargetOf,
  originOfHistoryState,
  originOfPath,
  ticketRunTarget,
} from "./back-target";
import { inAppHref, isPlainLinkClick } from "./in-app-links";

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const current = "https://ganger.example.com/tickets?f=mine";
const link = (href: string, extra: { target?: string; download?: boolean } = {}) => ({
  href,
  target: extra.target ?? "",
  download: extra.download ?? false,
});

describe("돌아가기 대상(0181)", () => {
  it.each([
    ["/", "dashboard"],
    ["/tickets", "tickets"],
    ["/runs", "runs"],
    ["/runs/", "runs"],
    ["/runs/run-1", "run"],
    ["/runners", "runners"],
    ["/stats", "stats"],
    ["/settings/mcp", "settings"],
    ["/onboarding", null],
  ])("%s 의 출발 화면은 %s 이다", (path, origin) => {
    expect(originOfPath(path)).toBe(origin);
  });

  it("이 문서에서 남긴 출발 화면이 있으면 history 로 돌아간다", () => {
    expect(backTargetOf(originOfHistoryState(backState("tickets")))).toEqual({
      kind: "history",
      origin: "tickets",
    });
    expect(backTargetOf("run")).toEqual({ kind: "history", origin: "run" });
  });

  it("출발 화면이 없으면 Runs 로 간다", () => {
    expect(backTargetOf(null)).toEqual({ kind: "runs", origin: "runs" });
  });

  it("새로고침 전 문서가 남긴 출발 화면은 쓰지 않는다", () => {
    expect(originOfHistoryState(backState("tickets", "earlier-document"))).toBeNull();
  });

  it("history state 의 모르는 값은 출발 화면으로 믿지 않는다", () => {
    expect(originOfHistoryState({ backOrigin: "tickets" })).toBeNull();
    expect(originOfHistoryState({ ...backState("tickets"), backOrigin: "elsewhere" })).toBeNull();
    expect(originOfHistoryState(null)).toBeNull();
  });
});

describe("Tickets 의 런 목적지(0181)", () => {
  it("런 보기는 Workspace 를 지켜 런 상세로 가고 출발 화면을 남긴다", () => {
    const target = ticketRunTarget("run-1", "ws-a");
    expect(target).toMatchObject({
      to: "/runs/$runId",
      params: { runId: "run-1" },
      search: { ws: "ws-a" },
    });
    expect(originOfHistoryState(target.state)).toBe("tickets");
    expect(target).not.toHaveProperty("hash");
  });

  it("답하기는 런 상세의 답하는 자리로 간다", () => {
    expect(ticketRunTarget("run-1", undefined, "answer")).toMatchObject({ hash: "answer" });
  });
});

describe("앱 안 링크 클릭(0181)", () => {
  it("수정 키 없는 왼쪽 클릭만 앱 안 이동이다", () => {
    expect(isPlainLinkClick(plain)).toBe(true);
    for (const change of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      expect(isPlainLinkClick({ ...plain, ...change })).toBe(false);
    }
  });

  it("앱 화면 주소는 경로·검색·해시를 그대로 넘긴다", () => {
    expect(inAppHref(link("https://ganger.example.com/runs/r1?ws=a#answer"), current)).toBe(
      "/runs/r1?ws=a#answer",
    );
    expect(inAppHref(link("https://ganger.example.com/"), current)).toBe("/");
  });

  it("바깥 주소, 새 창, 내려받기, 앱 화면이 아닌 경로는 브라우저에 맡긴다", () => {
    expect(inAppHref(link("https://example.org/runs"), current)).toBeNull();
    expect(
      inAppHref(link("https://ganger.example.com/runs", { target: "_blank" }), current),
    ).toBeNull();
    expect(
      inAppHref(link("https://ganger.example.com/runs", { download: true }), current),
    ).toBeNull();
    expect(inAppHref(link("https://ganger.example.com/api/logs"), current)).toBeNull();
    expect(inAppHref(link("https://ganger.example.com/ds"), current)).toBeNull();
  });

  it("같은 화면 안의 해시 이동은 브라우저에 맡긴다", () => {
    expect(inAppHref(link(`${current}#connections`), current)).toBeNull();
  });
});
