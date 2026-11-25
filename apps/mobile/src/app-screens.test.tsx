// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, describe, expect, it } from "vitest";

import { AppScreens } from "./app-screens";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const NOW = new Date(2026, 10, 23, 12, 0, 0);
const mounted: Array<() => void> = [];

function mountApp(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <AppScreens now={NOW} />
      </SafeAreaProvider>,
    );
  });
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

function press(element: Element | null | undefined) {
  if (element === null || element === undefined) throw new Error("element not found");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const byLabel = (host: ParentNode, label: string) => host.querySelector(`[aria-label="${label}"]`);
const tab = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('[role="tab"]')].find((item) => item.textContent?.startsWith(name));

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

describe("Dashboard 데모", () => {
  it("처리할 일이 있는 Running 칸부터 열고 노란 배지로 수를 보인다", () => {
    const host = mountApp();
    expect(tab(host, "Running")?.getAttribute("aria-selected")).toBe("true");
    expect(tab(host, "Running")?.querySelector('[data-testid="todo-badge"]')?.textContent).toBe(
      "4",
    );
    expect(tab(host, "Queued")?.querySelector('[data-testid="todo-badge"]')).toBeNull();
    expect(host.textContent).toContain("처리할 일 4 · Running 4");
  });

  it("Running 칸에 확인해 주세요 묶음과 카드 행동을 보인다", () => {
    const host = mountApp();
    const text = host.textContent ?? "";
    expect(text.indexOf("확인해 주세요")).toBeLessThan(text.indexOf("ACME-138"));
    for (const label of ["확인하기", "답하기", "거절", "재개하기"]) {
      expect(byLabel(host, label)).not.toBeNull();
    }
    expect(text).toContain("Ganger에서 멈춤");
    expect(text).toContain("보고 없이 멈춤");
    expect(text).toContain("취소 중");
    expect(text).toContain("CI 실패");
    expect(text).toContain("+1");
  });

  it("Queued 칸은 이유와 선행 티켓 칩, 멈춘 기다림 테두리를 보인다", () => {
    const host = mountApp();
    press(tab(host, "Queued"));
    const text = host.textContent ?? "";
    expect(text).toContain("빈 러너를 기다려요");
    expect(text).toContain("선행 티켓이 취소됐어요");
    expect(text).toContain("ACME-120");
    expect(host.querySelectorAll('[data-testid="card-problem"]')).toHaveLength(1);
  });

  it("Done 칸은 Failed 카드를 위에, 나머지를 한 줄 묶음으로 보인다", () => {
    const host = mountApp();
    press(tab(host, "Done"));
    const text = host.textContent ?? "";
    expect(byLabel(host, "런 상세")).not.toBeNull();
    expect(byLabel(host, "다시 맡기기")).not.toBeNull();
    expect(text.indexOf("ACME-119")).toBeLessThan(text.indexOf("처리할 일 없이 끝났어요"));
    expect(text).toContain("Succeeded");
    expect(text).toContain("Canceled");
    expect(text).toContain("PR #199 병합됨");
  });

  it("처리할 일만 켜면 꼬리표 없는 카드를 숨긴다", () => {
    const host = mountApp();
    expect(host.textContent).toContain("ACME-150");
    press(byLabel(host, "처리할 일만"));
    expect(host.textContent).not.toContain("ACME-150");
    expect(host.textContent).toContain("ACME-138");
  });

  it("처리할 일만 스위치는 개수 줄과 한 줄에 있고 라벨을 눌러도 바뀐다", () => {
    const host = mountApp();
    const row = host.querySelector('[data-testid="dashboard-count-row"]');
    const todoOnly = () => row?.querySelector('[role="switch"][aria-label="처리할 일만"]');
    expect(row?.textContent).toBe("처리할 일 4 · Running 4처리할 일만");
    expect(todoOnly()?.getAttribute("aria-checked")).toBe("false");
    const label = [...(todoOnly()?.querySelectorAll("div") ?? [])].find(
      (element) => element.textContent === "처리할 일만",
    );
    press(label);
    expect(todoOnly()?.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).not.toContain("ACME-150");
    press(label);
    expect(todoOnly()?.getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain("ACME-150");
  });

  it("Workspace를 고르면 그 Workspace의 런만 남는다", () => {
    const host = mountApp();
    press(byLabel(host, "Workspace 고르기, 모든 Workspace"));
    press(byLabel(document.body, "Growth"));
    expect(host.textContent).toContain("ACME-131");
    expect(host.textContent).not.toContain("ACME-138");
  });

  it("재개하기는 데모에서 보내지 않고 안내만 한다", async () => {
    const host = mountApp();
    await act(async () => {
      byLabel(host, "재개하기")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("데모 모드에서는 보내지 않아요");
  });
});

describe("화면 오가기", () => {
  it("Runners에 다녀와도 고른 칸과 Workspace가 남는다", () => {
    const host = mountApp();
    press(byLabel(host, "Workspace 고르기, 모든 Workspace"));
    press(byLabel(document.body, "Growth"));
    press(tab(host, "Queued"));
    press(byLabel(host, "Runners, 문제 러너 2대"));
    press(byLabel(host, "뒤로"));
    expect(tab(host, "Queued")?.getAttribute("aria-selected")).toBe("true");
    expect(byLabel(host, "Workspace 고르기, Growth")).not.toBeNull();
  });

  it("설정에서 끈 알림 종류가 다시 들어가도 꺼져 있다", () => {
    const host = mountApp();
    press(byLabel(host, "설정"));
    const permission = () =>
      host.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="Permission"]');
    press(permission());
    expect(permission()?.checked).toBe(false);
    press(byLabel(host, "뒤로"));
    press(byLabel(host, "설정"));
    expect(permission()?.checked).toBe(false);
  });
});

describe("Runners 데모", () => {
  it("문제 러너 수를 배지로 보이고, 화면에서 고치는 곳을 안내한다", () => {
    const host = mountApp();
    expect(host.querySelector('[data-testid="runner-issue-badge"]')?.textContent).toBe("2");
    press(byLabel(host, "Runners, 문제 러너 2대"));
    const text = host.textContent ?? "";
    expect(text).toContain("고치기는 Ganger 웹이나 데스크톱 앱의 Runners에서 해요");
    expect(text).toContain("GitHub 인증을 다시 해야 해요");
    expect(text).toContain("Claude 5시간 한도에 닿았어요");
    expect(text).toContain("사용량을 읽지 못했어요");
    expect(text).toContain("Claude 주간");
    expect(host.querySelectorAll('[role="progressbar"]').length).toBeGreaterThan(0);
    press(byLabel(host, "뒤로"));
    expect(host.textContent).toContain("Dashboard");
  });
});

describe("설정 데모", () => {
  it("알림 종류를 데스크톱과 같은 5묶음으로 보인다", () => {
    const host = mountApp();
    press(byLabel(host, "설정"));
    for (const kind of [
      "Question",
      "Permission",
      "Human Check",
      "Failed · Disconnected",
      "Runner Issue",
    ]) {
      expect(host.textContent).toContain(kind);
    }
    expect(host.textContent).toContain("Expo Push");
    expect(host.textContent).toContain("앱 버전");
  });

  it("빈 화면 미리 보기를 켜면 Dashboard에 쉬는 마스코트가 나온다", () => {
    const host = mountApp();
    press(byLabel(host, "설정"));
    const switches = host.querySelectorAll('input[type="checkbox"]');
    press(switches[switches.length - 1]);
    press(byLabel(host, "뒤로"));
    expect(host.querySelector('[data-testid="mascot-resting"]')).not.toBeNull();
    expect(host.textContent).toContain("에이전트가 묻거나 멈추면 알려 줄게요.");
    expect(host.textContent).toContain("처리할 일도, 진행 중인 런도 없어요.");
  });
});

describe("제품 앱 경계", () => {
  it("저장소의 demo 패키지를 import 하지 않는다", () => {
    const root = join(import.meta.dirname, "..");
    const files = [
      join(root, "index.ts"),
      ...readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" })
        .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
        .map((file) => join(root, "src", file)),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/from "(?:\.\.\/)+demo\/src|@ganger\/demo/);
    }
  });
});
