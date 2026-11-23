// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, describe, expect, it } from "vitest";

import { busySnapshot } from "../demo/data";
import { DashboardScreen, INITIAL_DASHBOARD_VIEW } from "./dashboard-screen";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const NOW = new Date("2026-11-23T03:00:00.000Z");
const snapshot = busySnapshot(NOW);
const questionRun = snapshot
  .dashboardFor("all")
  .columns.running.todo.find((run) => run.todoTag === "question");

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("알림의 답하기 버튼으로 Dashboard 열기(M22)", () => {
  it("새 Dashboard 를 읽을 때까지 기다렸다가 답하기 시트를 연다", async () => {
    if (questionRun === undefined) throw new Error("데모에 Question 런이 없다");
    const openRun = { id: questionRun.id, action: true };
    let handled = 0;
    const onHandled = () => {
      handled += 1;
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(() => {
      act(() => root.unmount());
      host.remove();
    });
    const render = (settled: boolean) => (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <DashboardScreen
          snapshot={snapshot}
          view={{ ...INITIAL_DASHBOARD_VIEW, column: "running" }}
          onViewChange={() => undefined}
          onOpenRunners={() => undefined}
          onOpenSettings={() => undefined}
          openRun={openRun}
          openRunSettled={settled}
          onOpenRunHandled={onHandled}
        />
      </SafeAreaProvider>
    );
    await act(async () => {
      root.render(render(false));
      await Promise.resolve();
    });
    expect(handled).toBe(0);

    await act(async () => {
      root.render(render(true));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handled).toBe(1);
    expect(document.body.textContent).toContain("보내면 되돌릴 수 없어요");
  });
});
