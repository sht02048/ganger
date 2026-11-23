// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitHistory } from "./index";
import type { CommitHistoryLoad } from "./index";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const commits = [
  { id: "b", headline: "Fix", sha: "bbbbbbb", author: "kim", time: "5 min ago", href: null },
];

function mount(
  load: CommitHistoryLoad | null,
  onExpandedChange = vi.fn<(expanded: boolean) => void>(),
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  draw(load, onExpandedChange);
  return onExpandedChange;
}

function draw(
  load: CommitHistoryLoad | null,
  onExpandedChange = vi.fn<(expanded: boolean) => void>(),
) {
  act(() =>
    root?.render(
      <CommitHistory
        summary="커밋 1개"
        newTabLabel="새 탭"
        commits={load === null ? commits : []}
        load={load}
        onExpandedChange={onExpandedChange}
      />,
    ),
  );
}

function summary(): HTMLButtonElement {
  const button = host?.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (button === null || button === undefined) throw new Error("no summary");
  return button;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("CommitHistory 받아 오기(티켓 0206)", () => {
  it("펼치고 접을 때 바뀐 펼침 상태를 알린다", () => {
    const onExpandedChange = mount(null);
    act(() => summary().click());
    act(() => summary().click());
    expect(onExpandedChange.mock.calls).toEqual([[true], [false]]);
  });

  it("받아 오는 중이면 펼친 자리에 회전 고리와 상태 글을 두고 목록은 두지 않는다", () => {
    mount({ kind: "loading", label: "불러오는 중" });
    act(() => summary().click());
    const region = document.getElementById(summary().getAttribute("aria-controls") ?? "");
    expect(region?.dataset["commitLoad"]).toBe("loading");
    expect(region?.querySelector('[role="status"]')?.textContent).toBe("불러오는 중");
    expect(region?.querySelector("[data-spinner]")).not.toBeNull();
    expect(host?.querySelector("ol")).toBeNull();
  });

  it("실패하면 상태 글과 다시 시도를 두고, 다시 시도는 접힘 줄로 포커스를 옮긴 뒤 부른다", () => {
    const onRetry = vi.fn<() => void>(() => {
      expect(document.activeElement).toBe(summary());
    });
    mount({ kind: "failed", message: "못 불러왔어요", retryLabel: "다시 시도", onRetry });
    act(() => summary().click());
    const region = document.getElementById(summary().getAttribute("aria-controls") ?? "");
    expect(region?.querySelector('[role="status"]')?.textContent).toBe("못 불러왔어요");
    const retry = [...(region?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "다시 시도",
    );
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(summary());
  });

  it("받아 온 뒤에는 같은 자리에 목록을 펼친다", () => {
    mount({ kind: "loading", label: "불러오는 중" });
    act(() => summary().click());
    draw(null);
    const list = document.getElementById(summary().getAttribute("aria-controls") ?? "");
    expect(list?.tagName).toBe("OL");
    expect(list?.textContent).toContain("Fix");
  });
});
