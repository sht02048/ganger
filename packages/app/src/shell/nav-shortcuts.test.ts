import { describe, expect, it } from "vitest";
import {
  desktopPagePathKeepingWorkspace,
  isDesktopPage,
  isNavScreen,
  navPathKeepingWorkspace,
  navScreens,
  navShortcutOf,
  navShortcuts,
} from "./nav-shortcuts.js";

describe("화면 이동 단축키 목록(0102)", () => {
  it("레일 순서대로 Mod+1~5, Settings는 Mod+,", () => {
    expect(navShortcuts.map((item) => [item.screen, item.shortcut])).toEqual([
      ["dashboard", "Mod+1"],
      ["tickets", "Mod+2"],
      ["runs", "Mod+3"],
      ["runners", "Mod+4"],
      ["stats", "Mod+5"],
      ["settings", "Mod+,"],
    ]);
  });

  it("화면마다 경로가 하나이고 키가 겹치지 않는다", () => {
    expect(new Set(navShortcuts.map((item) => item.path)).size).toBe(navShortcuts.length);
    expect(new Set(navShortcuts.map((item) => item.shortcut)).size).toBe(navShortcuts.length);
    expect(navShortcutOf("settings").path).toBe("/settings");
    expect(navShortcutOf("dashboard").path).toBe("/");
  });

  it("밖에서 받은 값은 목록에 있는 화면만 받아들인다", () => {
    expect(navScreens.every((screen) => isNavScreen(screen))).toBe(true);
    expect(isNavScreen("runs")).toBe(true);
    expect(isNavScreen("onboarding")).toBe(false);
    expect(isNavScreen(3)).toBe(false);
    expect(isNavScreen(undefined)).toBe(false);
  });

  it("다리 없이 주소를 바꿀 때는 그 화면 경로에 지금 Workspace(ws)만 남긴다", () => {
    expect(navPathKeepingWorkspace("runs", "?ws=acme&run=7")).toBe("/runs?ws=acme");
    expect(navPathKeepingWorkspace("dashboard", "?ws=a%26b")).toBe("/?ws=a%26b");
    expect(navPathKeepingWorkspace("settings", "")).toBe("/settings");
  });

  it("데스크톱 앱이 여는 앱 안 페이지는 목록에 있는 것만 받고 지금 Workspace를 남긴다(0214)", () => {
    expect(isDesktopPage("notifications")).toBe(true);
    expect(isDesktopPage("toString")).toBe(false);
    expect(isDesktopPage(1)).toBe(false);
    expect(desktopPagePathKeepingWorkspace("notifications", "?ws=acme&x=1")).toBe(
      "/settings/notifications?ws=acme",
    );
    expect(desktopPagePathKeepingWorkspace("notifications", "")).toBe("/settings/notifications");
  });
});
