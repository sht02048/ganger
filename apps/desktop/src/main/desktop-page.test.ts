import type { DesktopPage } from "@ganger/app/shell/nav-shortcuts";
import { describe, expect, it } from "vitest";
import { notificationSettingsMenuItem, openDesktopPage } from "./desktop-page.js";
import type { DesktopPagePort, ServerPageState } from "./desktop-page.js";

function fakePort(state: ServerPageState) {
  const calls: Array<string | { send: DesktopPage } | { load: string }> = [];
  const port: DesktopPagePort = {
    show: () => calls.push("show"),
    serverPage: () => state,
    send: (page) => calls.push({ send: page }),
    load: (path) => calls.push({ load: path }),
  };
  return { port, calls };
}

describe("알림 설정은 메인 창의 Settings 페이지로 연다(0214)", () => {
  it("트레이의 알림 설정…은 메인 창을 띄우고 서버 화면에 알림 페이지로 가라고 보낸다", () => {
    const { port, calls } = fakePort("ready");
    const item = notificationSettingsMenuItem("tray-notification-settings", "알림 설정…", port);
    expect(item).toMatchObject({ id: "tray-notification-settings", label: "알림 설정…" });
    item.click();
    expect(calls).toEqual(["show", { send: "notifications" }]);
  });

  it("서버 화면을 읽는 중이면 알림 페이지 주소를 바로 연다", () => {
    const { port, calls } = fakePort("loading");
    openDesktopPage("notifications", port);
    expect(calls).toEqual(["show", { load: "/settings/notifications" }]);
  });

  it("서버 화면이 아직 없으면(모드 고르기 같은 앱 화면) 창만 띄운다", () => {
    const { port, calls } = fakePort("none");
    openDesktopPage("notifications", port);
    expect(calls).toEqual(["show"]);
  });
});
