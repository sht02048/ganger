import type { DesktopPage } from "@ganger/app/shell/nav-shortcuts";
import { describe, expect, it } from "vitest";
import { PAGE_LISTENER_WAIT_MS, deliverDesktopPage } from "./page-delivery.js";

function harness() {
  const listeners = new Set<(page: DesktopPage) => void>();
  const opened: DesktopPage[] = [];
  const unsupported: DesktopPage[] = [];
  const pending: Array<() => void> = [];
  let waited = 0;
  const delivery = {
    listeners: () => listeners,
    unsupported: (page: DesktopPage) => unsupported.push(page),
    later: (run: () => void, ms: number) => {
      waited += ms;
      pending.push(run);
    },
  };
  const flush = (steps: number) => {
    for (let index = 0; index < steps; index += 1) pending.shift()?.();
  };
  return { listeners, opened, unsupported, delivery, flush, waited: () => waited };
}

describe("서버 화면에 앱 안 페이지 열기(0214)", () => {
  it("화면이 듣고 있으면 바로 그 페이지로 보낸다", () => {
    const h = harness();
    h.listeners.add((page) => h.opened.push(page));
    deliverDesktopPage("notifications", h.delivery);
    expect(h.opened).toEqual(["notifications"]);
    expect(h.unsupported).toEqual([]);
  });

  it("화면이 아직 듣기 전이면 기다렸다가, 듣기 시작하면 보낸다", () => {
    const h = harness();
    deliverDesktopPage("notifications", h.delivery);
    h.flush(3);
    h.listeners.add((page) => h.opened.push(page));
    h.flush(1);
    expect(h.opened).toEqual(["notifications"]);
    expect(h.unsupported).toEqual([]);
  });

  it("끝내 듣지 않으면(그 페이지를 모르는 옛 서버 화면) 없는 주소로 옮기지 않고 앱에 알린다", () => {
    const h = harness();
    deliverDesktopPage("notifications", h.delivery);
    h.flush(1_000);
    expect(h.opened).toEqual([]);
    expect(h.unsupported).toEqual(["notifications"]);
    expect(h.waited()).toBeGreaterThanOrEqual(PAGE_LISTENER_WAIT_MS);
  });
});
