import { describe, expect, it } from "vitest";
import type { EnsureResult } from "../core/local-server.js";
import { screenOutlivedServerSwap, viewMenu } from "./view-menu.js";

const URL_A = "http://127.0.0.1:4000";

function running(replaced: boolean): EnsureResult {
  return {
    kind: "running",
    replaced,
    status: {
      state: "running",
      owner: "app",
      pid: 1,
      url: URL_A,
      identity: { product: "ganger", version: "0.4.0", instanceId: "i", webAccess: "allowed" },
    },
  };
}

describe("보기 메뉴(0180)", () => {
  it("다시 불러오기를 한국어 이름으로 맨 위에 두고 기본 항목을 그대로 둔다", () => {
    const menu = viewMenu({ label: "보기", reloadLabel: "다시 불러오기" });
    const items = Array.isArray(menu.submenu) ? menu.submenu : [];
    expect(menu.label).toBe("보기");
    expect(items[0]).toMatchObject({ role: "reload", label: "다시 불러오기" });
    expect(items.map((item) => item.role ?? item.type)).toEqual([
      "reload",
      "forceReload",
      "toggleDevTools",
      "separator",
      "resetZoom",
      "zoomIn",
      "zoomOut",
      "separator",
      "togglefullscreen",
    ]);
  });
});

describe("서버 교체 뒤 창 다시 불러오기(0180)", () => {
  it("교체한 서버의 화면을 이미 보고 있으면 다시 불러온다", () => {
    expect(screenOutlivedServerSwap(running(true), URL_A)).toBe(true);
  });

  it("창이 아직 서버 화면이 아니면 곧 새로 열리므로 다시 불러오지 않는다", () => {
    expect(screenOutlivedServerSwap(running(true), undefined)).toBe(false);
  });

  it("서버를 바꾸지 않았거나 켜지 못했으면 다시 불러오지 않는다", () => {
    expect(screenOutlivedServerSwap(running(false), URL_A)).toBe(false);
    expect(screenOutlivedServerSwap({ kind: "failed", reason: "x" }, URL_A)).toBe(false);
  });
});
