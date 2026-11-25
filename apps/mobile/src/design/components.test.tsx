// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Button,
  Card,
  Chip,
  ExternalLink,
  InlineSwitch,
  RaisedBox,
  RESTING_MASCOT_PATHS,
  RestingMascot,
  Segment,
  Sheet,
  StatusPill,
  SwitchRow,
  TodoBadge,
  buttonColorsOf,
  pillColorsOf,
} from "./components";
import { toneColorOf } from "./text";
import { colors } from "./tokens";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mounted: Array<() => void> = [];

function mount(node: ReactNode): HTMLElement {
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
        {node}
      </SafeAreaProvider>,
    );
  });
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

function press(element: Element | null) {
  if (element === null) throw new Error("element not found");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

describe("Button", () => {
  it("누르면 onPress를 부른다", () => {
    const onPress = vi.fn<() => void>();
    const host = mount(<Button label="재개하기" onPress={onPress} />);
    press(host.querySelector('[role="button"]'));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("answer는 Question 알약 계열, check는 Human Check 알약 계열 색이다", () => {
    const answer = buttonColorsOf("answer");
    expect(answer.surface).toBe(colors.answerSoft);
    expect(toneColorOf(answer.tone)).toBe(colors.answer);
    expect(answer.surface).toBe(pillColorsOf("question").surface);
    const check = buttonColorsOf("check");
    expect(check.surface).toBe(colors.checkSoft);
    expect(toneColorOf(check.tone)).toBe(colors.check);
    expect(check.surface).toBe(pillColorsOf("human-check").surface);
  });

  it("기존 변형의 색은 그대로다", () => {
    expect(buttonColorsOf("primary").surface).toBe(colors.accent);
    expect(toneColorOf(buttonColorsOf("primary").tone)).toBe(colors.textOnAccent);
    expect(buttonColorsOf("secondary").surface).toBe(colors.bgControl);
    expect(toneColorOf(buttonColorsOf("secondary").tone)).toBe(colors.textPrimary);
    expect(buttonColorsOf("danger").surface).toBe(colors.bgControl);
    expect(toneColorOf(buttonColorsOf("danger").tone)).toBe(colors.problem);
  });

  it("고른 변형을 표시하고, 고르지 않으면 secondary다", () => {
    const host = mount(
      <>
        <Button label="답하기" variant="answer" />
        <Button label="확인하기" variant="check" />
        <Button label="재개하기" />
      </>,
    );
    const ids = [...host.querySelectorAll('[role="button"]')].map((button) =>
      button.getAttribute("data-testid"),
    );
    expect(ids).toEqual(["button-answer", "button-check", "button-secondary"]);
  });

  it("꺼져 있으면 부르지 않는다", () => {
    const onPress = vi.fn<() => void>();
    const host = mount(<Button label="재개하기" disabled onPress={onPress} />);
    press(host.querySelector('[role="button"]'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("TodoBadge", () => {
  it("처리할 일이 없으면 그리지 않는다", () => {
    const host = mount(<TodoBadge count={0} label="처리할 일 0개" />);
    expect(host.querySelector('[data-testid="todo-badge"]')).toBeNull();
  });

  it("처리할 일 수를 보인다", () => {
    const host = mount(<TodoBadge count={3} label="처리할 일 3개" />);
    expect(host.querySelector('[data-testid="todo-badge"]')?.textContent).toBe("3");
  });
});

describe("Segment", () => {
  const options = [
    {
      value: "queued",
      label: "Queued",
      todoCount: 0,
      todoLabel: "처리할 일 0개",
      accessibilityLabel: "Queued",
    },
    {
      value: "running",
      label: "Running",
      todoCount: 2,
      todoLabel: "처리할 일 2개",
      accessibilityLabel: "Running, 처리할 일 2개",
    },
  ] as const;

  it("고른 칸을 알리고 다른 칸을 누르면 값을 넘긴다", () => {
    const onChange = vi.fn<(next: "queued" | "running") => void>();
    const host = mount(<Segment options={options} value="queued" onChange={onChange} />);
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
    press(tabs[1] ?? null);
    expect(onChange).toHaveBeenCalledWith("running");
  });

  it("처리할 일이 있는 칸에만 배지를 붙인다", () => {
    const host = mount(<Segment options={options} value="queued" onChange={() => {}} />);
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs[0]?.querySelector('[data-testid="todo-badge"]')).toBeNull();
    expect(tabs[1]?.querySelector('[data-testid="todo-badge"]')?.textContent).toBe("2");
  });
});

describe("StatusPill", () => {
  it("상태 이름을 보인다", () => {
    const host = mount(<StatusPill status="human-check" label="Human Check" />);
    expect(host.textContent).toBe("Human Check");
  });

  it("색 하나에 뜻 하나다(ADR 0010 5번)", () => {
    expect(pillColorsOf("question").dot).toBe(colors.answer);
    expect(pillColorsOf("permission").dot).toBe(colors.answer);
    expect(pillColorsOf("waiting-for-input").dot).toBe(colors.answer);
    expect(pillColorsOf("human-check").dot).toBe(colors.check);
    for (const status of ["failed", "disconnected", "runner-issue", "offline"] as const) {
      expect(pillColorsOf(status).dot).toBe(colors.problem);
    }
    for (const status of ["running", "online"] as const) {
      expect(pillColorsOf(status).dot).toBe(colors.progress);
    }
    expect(pillColorsOf("succeeded").dot).toBe(colors.merged);
    expect(pillColorsOf("unknown")).toEqual({
      dot: colors.textDisabled,
      surface: colors.bgControl,
    });
    for (const status of ["queued", "paused", "canceled"] as const) {
      expect(pillColorsOf(status).dot).toBe(colors.idle);
    }
  });

  it("노랑을 상태 색으로 쓰지 않는다", () => {
    const statuses = [
      "question",
      "permission",
      "waiting-for-input",
      "human-check",
      "failed",
      "disconnected",
      "runner-issue",
      "offline",
      "running",
      "online",
      "succeeded",
      "queued",
      "paused",
      "canceled",
    ] as const;
    for (const status of statuses) expect(pillColorsOf(status).dot).not.toBe(colors.accent);
  });
});

describe("SwitchRow", () => {
  it("누르면 바뀐 값을 넘긴다", () => {
    const onChange = vi.fn<(next: boolean) => void>();
    const host = mount(<SwitchRow label="처리할 일만" value={false} onChange={onChange} />);
    press(host.querySelector('input[type="checkbox"]'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("InlineSwitch", () => {
  it("라벨을 접근 이름으로 갖는 스위치 하나로 읽히고 켜짐 상태를 알린다", () => {
    const host = mount(<InlineSwitch label="처리할 일만" value onChange={() => {}} />);
    const switches = [...host.querySelectorAll('[role="switch"]')].filter(
      (element) => element.closest('[aria-hidden="true"]') === null,
    );
    expect(switches).toHaveLength(1);
    expect(switches[0]?.getAttribute("aria-label")).toBe("처리할 일만");
    expect(switches[0]?.getAttribute("aria-checked")).toBe("true");
    const track = host.querySelector('[data-testid="inline-switch-track"]');
    expect(track?.getAttribute("aria-hidden")).toBe("true");
  });

  it("라벨 글자를 눌러도 바뀐 값을 넘긴다", () => {
    const onChange = vi.fn<(next: boolean) => void>();
    const host = mount(<InlineSwitch label="처리할 일만" value={false} onChange={onChange} />);
    const label = [...host.querySelectorAll('[role="switch"] div')].find(
      (element) => element.textContent === "처리할 일만",
    );
    press(label ?? null);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("스위치를 눌러도 한 번만 바뀐 값을 넘긴다", () => {
    const onChange = vi.fn<(next: boolean) => void>();
    const host = mount(<InlineSwitch label="처리할 일만" value onChange={onChange} />);
    press(host.querySelector('[data-testid="inline-switch-track"] input'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("꺼져 있으면 넘기지 않는다", () => {
    const onChange = vi.fn<(next: boolean) => void>();
    const host = mount(
      <InlineSwitch label="처리할 일만" value={false} disabled onChange={onChange} />,
    );
    press(host.querySelector('[role="switch"]'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Card", () => {
  it("멈춘 기다림은 문제 테두리로 그린다", () => {
    const host = mount(<Card emphasis="problem">내용</Card>);
    expect(host.querySelector('[data-testid="card-problem"]')).not.toBeNull();
  });
});

describe("Chip", () => {
  it("병합·진행 칩은 상태 알약과 같은 색을 쓰고 기본은 무채색이다", () => {
    const host = mount(
      <>
        <Chip label="Merged" tone="merged" />
        <Chip label="CI 통과" tone="progress" />
        <Chip label="Open" />
      </>,
    );
    expect(host.querySelector('[data-testid="chip-merged"]')?.textContent).toBe("Merged");
    expect(host.querySelector('[data-testid="chip-progress"]')?.textContent).toBe("CI 통과");
    expect(host.querySelector('[data-testid="chip-neutral"]')?.textContent).toBe("Open");
    expect(pillColorsOf("succeeded").dot).toBe(colors.merged);
    expect(pillColorsOf("running").dot).toBe(colors.progress);
  });
});

describe("ExternalLink", () => {
  it("접근 이름을 가진 링크이고 누르면 onPress를 부른다", () => {
    const onPress = vi.fn<() => void>();
    const host = mount(
      <ExternalLink label="PR #7" accessibilityLabel="PR #7 GitHub에서 열기" onPress={onPress} />,
    );
    const link = host.querySelector('[aria-label="PR #7 GitHub에서 열기"]');
    expect(link?.getAttribute("role")).toBe("link");
    expect(link?.textContent).toBe("PR #7");
    act(() => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe("RaisedBox", () => {
  it("내용을 감싼다", () => {
    const host = mount(<RaisedBox>내용</RaisedBox>);
    expect(host.querySelector('[data-testid="raised-box"]')?.textContent).toBe("내용");
  });
});

describe("Sheet", () => {
  it("열려 있을 때만 내용을 보이고 바깥을 누르면 닫는다", () => {
    const onClose = vi.fn<() => void>();
    mount(
      <Sheet visible title="Workspace" closeLabel="닫기" onClose={onClose}>
        시트 내용
      </Sheet>,
    );
    expect(document.body.textContent).toContain("시트 내용");
    press(document.body.querySelector('[aria-label="닫기"]'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("닫혀 있으면 내용을 그리지 않는다", () => {
    mount(
      <Sheet visible={false} title="Workspace" closeLabel="닫기" onClose={() => {}}>
        숨은 내용
      </Sheet>,
    );
    expect(document.body.textContent).not.toContain("숨은 내용");
  });
});

describe("RestingMascot", () => {
  it("브랜드 원본의 그림과 같고 화면 읽기에서 숨는다", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../../../../packages/ui/brand/mascot-resting.svg"),
      "utf8",
    );
    for (const path of Object.values(RESTING_MASCOT_PATHS)) expect(source).toContain(`d="${path}"`);
    const host = mount(<RestingMascot />);
    const mascot = host.querySelector('[data-testid="mascot-resting"]');
    expect(mascot?.getAttribute("aria-hidden")).toBe("true");
  });
});
