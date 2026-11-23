// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, describe, expect, it } from "vitest";

import { busySnapshot } from "../demo/data";
import { demoRunDetail, demoRunPort } from "../runs/run-port";
import type { RunPort } from "../runs/run-port";
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

  it("캐시에 런이 있으면 새 Dashboard 전에 상세를 먼저 보이고, 읽은 뒤 답하기 시트로 바꾼다", async () => {
    if (questionRun === undefined) throw new Error("데모에 Question 런이 없다");
    const cachedDetail = demoRunDetail(questionRun);
    const port: RunPort = {
      ...demoRunPort,
      cachedDetail: () => ({ data: cachedDetail, fetchedAt: NOW.getTime() }),
      detail: () => Promise.resolve({ kind: "ok", value: cachedDetail }),
    };
    const openRun = { id: questionRun.id, action: true };
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
          port={port}
          openRun={openRun}
          openRunSettled={settled}
        />
      </SafeAreaProvider>
    );
    await act(async () => {
      root.render(render(false));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("런 상세");
    expect(document.body.textContent).not.toContain("보내면 되돌릴 수 없어요");

    await act(async () => {
      root.render(render(true));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("보내면 되돌릴 수 없어요");
  });

  it("행동이 꺼져 있으면 캐시 상세를 보이고, 연결이 돌아오면 답하기 시트로 바꾼다", async () => {
    if (questionRun === undefined) throw new Error("데모에 Question 런이 없다");
    const cachedDetail = demoRunDetail(questionRun);
    let online = false;
    let handled = 0;
    const port: RunPort = {
      ...demoRunPort,
      cachedDetail: () => ({ data: cachedDetail, fetchedAt: NOW.getTime() }),
      detail: () =>
        Promise.resolve(online ? { kind: "ok", value: cachedDetail } : { kind: "unavailable" }),
    };
    const openRun = { id: questionRun.id, action: true };
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
    const render = (actionsDisabled: boolean) => (
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
          actionsDisabled={actionsDisabled}
          port={port}
          openRun={openRun}
          openRunSettled
          onOpenRunHandled={onHandled}
        />
      </SafeAreaProvider>
    );
    await act(async () => {
      root.render(render(true));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handled).toBe(0);
    expect(document.body.textContent).toContain("런 내용을 새로 읽지 못했어요");
    expect(document.body.textContent).not.toContain("보내면 되돌릴 수 없어요");

    online = true;
    await act(async () => {
      root.render(render(false));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handled).toBe(1);
    expect(document.body.textContent).toContain("보내면 되돌릴 수 없어요");
  });
});
