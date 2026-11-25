import { describe, expect, it, vi } from "vitest";

import { followForeground } from "./app-state";
import type { AppStateSource } from "./app-state";

function fakeAppState(currentState: string) {
  const listeners: Array<(state: string) => void> = [];
  const remove = vi.fn<() => void>();
  const source: AppStateSource = {
    currentState,
    addEventListener: (_type, listener) => {
      listeners.push(listener);
      return { remove };
    },
  };
  const emit = (state: string) => {
    for (const listener of listeners) listener(state);
  };
  return { source, emit, remove };
}

describe("앱 상태와 연결(티켓 0224)", () => {
  it("inactive(제어 센터·알림 센터·Face ID·앱 전환기)는 앞에 있는 것으로 보고 연결을 유지한다", () => {
    const app = fakeAppState("active");
    const changes = vi.fn<(foreground: boolean) => void>();
    followForeground(app.source, changes);
    app.emit("inactive");
    app.emit("active");
    app.emit("inactive");
    expect(changes.mock.calls).toEqual([[true]]);
  });

  it("background로 갈 때만 뒤로 보내고, 돌아오면 한 번만 앞으로 알린다", () => {
    const app = fakeAppState("active");
    const changes = vi.fn<(foreground: boolean) => void>();
    followForeground(app.source, changes);
    app.emit("inactive");
    app.emit("background");
    app.emit("inactive");
    app.emit("active");
    expect(changes.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("처음 마운트 때 inactive나 unknown이어도 앞으로 본다", () => {
    for (const state of ["inactive", "unknown"]) {
      const changes = vi.fn<(foreground: boolean) => void>();
      followForeground(fakeAppState(state).source, changes);
      expect(changes.mock.calls).toEqual([[true]]);
    }
    const changes = vi.fn<(foreground: boolean) => void>();
    followForeground(fakeAppState("background").source, changes);
    expect(changes.mock.calls).toEqual([[false]]);
  });

  it("그만 따르면 구독을 푼다", () => {
    const app = fakeAppState("active");
    const stop = followForeground(app.source, () => undefined);
    stop();
    expect(app.remove).toHaveBeenCalledOnce();
  });
});
