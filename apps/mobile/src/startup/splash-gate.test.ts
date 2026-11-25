import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SPLASH_MAX_MS, createSplashGate } from "./splash-gate";

function fakeSplash(failing = false) {
  const splash = {
    hides: 0,
    hide: () => {
      splash.hides += 1;
      if (failing) throw new Error("no splash");
    },
  };
  return splash;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("스플래시 게이트", () => {
  it("첫 화면이 준비되면 내리고, 상한 시간 타이머를 지운다", () => {
    const splash = fakeSplash();
    const gate = createSplashGate(splash);
    expect(splash.hides).toBe(0);
    gate.ready();
    expect(splash.hides).toBe(1);
    expect(gate.hidden()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("준비가 늦으면 상한 시간에 한 번 내리고, 늦게 온 준비는 다시 내리지 않는다", () => {
    const splash = fakeSplash();
    const gate = createSplashGate(splash);
    vi.advanceTimersByTime(SPLASH_MAX_MS - 1);
    expect(splash.hides).toBe(0);
    vi.advanceTimersByTime(1);
    expect(splash.hides).toBe(1);
    gate.ready();
    gate.ready();
    expect(splash.hides).toBe(1);
  });

  it("스플래시를 내리다 실패해도 앱을 멈추지 않는다", () => {
    const splash = fakeSplash(true);
    const gate = createSplashGate(splash);
    expect(() => gate.ready()).not.toThrow();
    expect(gate.hidden()).toBe(true);
  });
});
