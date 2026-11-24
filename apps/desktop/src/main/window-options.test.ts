import { HIDDEN_TITLE_BAR, TITLE_BAR_COOKIE } from "@ganger/app/shell/window-chrome";
import { windowFrame } from "@ganger/ui/window-frame";
import { describe, expect, it } from "vitest";
import {
  TRAFFIC_LIGHTS,
  mainWindowOptions,
  titleBarCookie,
  trafficLightPosition,
} from "./window-options.js";

describe("창 제목 표시줄(0113)", () => {
  it("본 창은 제목 표시줄을 숨기고 신호등만 남기며, 바탕을 Ink 로 칠해 열 때 흰 화면이 번쩍이지 않는다", () => {
    const options = mainWindowOptions("Ganger", "/preload.js");
    expect(options.titleBarStyle).toBe("hidden");
    expect(options.trafficLightPosition).toEqual(trafficLightPosition());
    expect(options.backgroundColor).toBe(windowFrame.background);
    expect(options.webPreferences).toMatchObject({
      preload: "/preload.js",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });

  it("본 창은 최소 720px 폭을 지킨다", () => {
    expect(mainWindowOptions("Ganger", "/preload.js")).toMatchObject({
      minWidth: 720,
      title: "Ganger",
      show: false,
    });
  });

  it("신호등은 레일 안, 맨 위 56px 줄의 가운데 높이에 온다", () => {
    const { x, y } = trafficLightPosition();
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + TRAFFIC_LIGHTS.width).toBeLessThanOrEqual(windowFrame.railWidth);
    expect(x).toBe(windowFrame.railWidth - TRAFFIC_LIGHTS.width - x);
    expect(y + TRAFFIC_LIGHTS.height / 2).toBe(windowFrame.titleBarHeight / 2);
    expect({ x, y }).toEqual({ x: 15, y: 20 });
  });

  it("서버 화면에는 제목 표시줄을 숨겼다는 쿠키를 그 서버 주소에 심는다", () => {
    expect(titleBarCookie("http://127.0.0.1:8787/runs?ws=acme")).toEqual({
      url: "http://127.0.0.1:8787",
      path: "/",
      name: TITLE_BAR_COOKIE,
      value: HIDDEN_TITLE_BAR,
      sameSite: "lax",
    });
  });
});
