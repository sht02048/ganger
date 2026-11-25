// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, describe, expect, it, vi } from "vitest";

import { busySnapshot } from "../demo/data";
import { demoRunPort } from "../runs/run-port";
import type { RunPort } from "../runs/run-port";
import { DashboardScreen, INITIAL_DASHBOARD_VIEW } from "./dashboard-screen";
import type { ColumnKey } from "./model";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const NOW = new Date("2026-11-23T03:00:00.000Z");
const LINEAR = "https://linear.app/acme/issue/ACME-150/card";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

async function showDashboard(column: ColumnKey, port: RunPort) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  await act(async () => {
    root.render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <DashboardScreen
          snapshot={busySnapshot(NOW)}
          view={{ ...INITIAL_DASHBOARD_VIEW, column }}
          onViewChange={() => undefined}
          onOpenRunners={() => undefined}
          onOpenSettings={() => undefined}
          port={port}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
}

async function click(selector: string) {
  const element = document.body.querySelector(selector);
  if (element === null) throw new Error(`no element: ${selector}`);
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const openMenu = (key: string) => click(`[aria-label="${key} 메뉴"]`);
const choose = (label: string) => click(`[role="menuitem"][aria-label="${label}"]`);

describe("Dashboard 카드 … 메뉴", () => {
  it("Linear에서 열기는 트래커가 준 웹 주소를 그대로 열어 앱이 있으면 앱이 받게 한다", async () => {
    const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const ticketLink = vi.fn<RunPort["ticketLink"]>(() =>
      Promise.resolve({ kind: "ok", value: LINEAR }),
    );
    await showDashboard("running", { ...demoRunPort, ticketLink });
    await openMenu("ACME-150");
    await choose("Linear에서 열기");
    expect(ticketLink.mock.calls[0]?.[0].ticketKey).toBe("ACME-150");
    expect(openURL).toHaveBeenCalledExactlyOnceWith(LINEAR);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("데모에서는 열지 않고 데모라고 알린다", async () => {
    const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await showDashboard("running", demoRunPort);
    await openMenu("ACME-150");
    await choose("Linear에서 열기");
    expect(openURL).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("데모 모드에서는 보내지 않아요");
  });

  it("주소를 읽지 못하면 알림 시트로 말한다", async () => {
    await showDashboard("running", {
      ...demoRunPort,
      ticketLink: () => Promise.resolve({ kind: "unavailable" }),
    });
    await openMenu("ACME-150");
    await choose("Linear에서 열기");
    expect(document.body.textContent).toContain("Linear를 열지 못했어요");
  });

  it("런 취소는 취소 확인 시트를 연다", async () => {
    await showDashboard("running", demoRunPort);
    await openMenu("ACME-150");
    await choose("런 취소");
    expect(document.body.textContent).toContain("이 런을 취소할까요?");
  });

  it("끝난 런 줄에서 티켓과 GitHub PR을 연다", async () => {
    const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await showDashboard("done", {
      ...demoRunPort,
      ticketLink: () => Promise.resolve({ kind: "ok", value: LINEAR }),
    });
    await openMenu("ACME-117");
    expect(document.body.querySelector('[role="menuitem"][aria-label="런 취소"]')).toBeNull();
    await choose("PR #203 GitHub에서 열기");
    expect(openURL).toHaveBeenLastCalledWith("https://example.com/acme/pay/pull/203");
    await openMenu("ACME-117");
    await choose("Linear에서 열기");
    expect(openURL).toHaveBeenLastCalledWith(LINEAR);
  });

  it("PR을 열지 못하면 알림 시트로 말한다", async () => {
    vi.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));
    await showDashboard("done", demoRunPort);
    await openMenu("ACME-117");
    await choose("PR #203 GitHub에서 열기");
    expect(document.body.textContent).toContain("PR을 열지 못했어요");
  });

  it("주소를 기다리는 동안 Linear에서 열기를 다시 골라도 한 번만 연다", async () => {
    const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    let answer: (link: { kind: "ok"; value: string }) => void = () => undefined;
    const ticketLink = vi.fn<RunPort["ticketLink"]>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await showDashboard("running", { ...demoRunPort, ticketLink });
    await openMenu("ACME-150");
    await choose("Linear에서 열기");
    await openMenu("ACME-150");
    await choose("Linear에서 열기");
    await act(async () => {
      answer({ kind: "ok", value: LINEAR });
      await Promise.resolve();
    });
    expect(ticketLink).toHaveBeenCalledOnce();
    expect(openURL).toHaveBeenCalledOnce();
  });
});

describe("Failed 카드 … 메뉴의 확인했어요(0235)", () => {
  it("확인했어요는 clear-todo 쓰기를 보내고 To do에서 뺐다고 읽어 주며, 끝난 런이라 런 취소는 없다", async () => {
    const { AccessibilityInfo } = await import("react-native");
    const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    const write = vi.fn<RunPort["write"]>(() => Promise.resolve({ kind: "sent" }));
    await showDashboard("done", { ...demoRunPort, write });
    await openMenu("ACME-119");
    expect(document.body.querySelector('[role="menuitem"][aria-label="런 취소"]')).toBeNull();
    await choose("확인했어요");
    expect(write.mock.calls.map(([run, request]) => [run.ticketKey, request])).toEqual([
      ["ACME-119", { action: "clear-todo" }],
    ]);
    expect(announce).toHaveBeenCalledWith("To do에서 뺐어요");
  });

  it("서버가 거절하면 알림 시트로 말한다", async () => {
    await showDashboard("done", {
      ...demoRunPort,
      write: () => Promise.resolve({ kind: "refused", reason: "state-changed" }),
    });
    await openMenu("ACME-119");
    await choose("확인했어요");
    expect(document.body.textContent).toContain("To do에서 빼지 못했어요");
    expect(document.body.textContent).toContain("런의 상태가 그사이 바뀌었어요");
  });

  it("데모에서는 보내지 않고 데모라고 알린다", async () => {
    await showDashboard("done", demoRunPort);
    await openMenu("ACME-119");
    await choose("확인했어요");
    expect(document.body.textContent).toContain("데모 모드에서는 보내지 않아요");
  });

  it("PR 이 병합돼 To do에서 빠진 Failed 줄은 PR 병합됨을 보이고, 메뉴에 확인했어요 대신 다시 맡기기를 둔다", async () => {
    await showDashboard("done", demoRunPort);
    expect(document.body.textContent).toContain("PR #199 병합됨");
    await openMenu("ACME-115");
    expect(document.body.querySelector('[role="menuitem"][aria-label="확인했어요"]')).toBeNull();
    await choose("다시 맡기기");
    expect(document.body.textContent).toContain("다시 맡길까요?");
  });
});
