// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { HomeRun } from "../demo/contract";
import { RunCard, SettledRow } from "./run-card";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mounted: Array<() => void> = [];

function mount(node: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

const base = {
  id: "run-1",
  ticketId: "ticket-1",
  ticketKey: "ACME-1",
  ticketTitle: "제목",
  workspace: { id: "ws", name: "Payments" },
  runner: { name: "acme-runner", online: true },
  agent: "Claude",
  waitMs: 0,
  executionMs: null,
  pullRequest: null,
  cancelling: false,
};

const noAction = () => {};
const buttons = (host: HTMLElement) => host.querySelectorAll('[role="button"]').length;

describe("RunCard", () => {
  it("이미 답한 Question에는 답하기를 두지 않고 보낸 사실을 말한다", () => {
    const run: HomeRun = {
      ...base,
      state: "waiting-for-input",
      waitingMs: null,
      input: { kind: "question", questionId: "q", body: "질문", choices: [], answered: true },
    };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(buttons(host)).toBe(0);
    expect(host.textContent).toContain("답을 보냈어요");
  });

  it("이미 거절한 Permission에는 거절 버튼과 허용 안내를 두지 않는다", () => {
    const run: HomeRun = {
      ...base,
      state: "waiting-for-input",
      waitingMs: null,
      input: { kind: "permission", promptId: "p", detail: "pnpm test", denied: true },
    };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(buttons(host)).toBe(0);
    expect(host.textContent).toContain("거절을 보냈어요");
    expect(host.textContent).not.toContain("허용은 러너");
  });

  it("취소 중인 Paused 런에는 재개하기를 두지 않는다", () => {
    const paused: HomeRun = {
      ...base,
      state: "paused",
      pausedMs: null,
      pauseSource: "operator",
    };
    expect(buttons(mount(<RunCard run={paused} onAction={noAction} />))).toBe(1);
    const cancelling: HomeRun = { ...paused, cancelling: true };
    expect(buttons(mount(<RunCard run={cancelling} onAction={noAction} />))).toBe(0);
  });

  it("긴 질문은 첫 줄만 보인다", () => {
    const run: HomeRun = {
      ...base,
      state: "waiting-for-input",
      waitingMs: null,
      input: {
        kind: "question",
        questionId: "q",
        body: "첫 줄\n둘째 줄",
        choices: [],
        answered: false,
      },
    };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(host.textContent).toContain("첫 줄");
    expect(host.textContent).not.toContain("둘째 줄");
  });

  it("모든 Workspace를 볼 때만 Workspace 이름을 붙인다", () => {
    const run: HomeRun = { ...base, state: "running" };
    expect(mount(<RunCard run={run} onAction={noAction} />).textContent).not.toContain("Payments");
    expect(mount(<RunCard run={run} showWorkspace onAction={noAction} />).textContent).toContain(
      "Payments",
    );
  });

  it("뒤처짐 칩은 문제 색을 쓰지 않는다", () => {
    const run: HomeRun = {
      ...base,
      state: "running",
      pullRequest: {
        displayId: "PR-1",
        url: "https://example.com/pull/1",
        signals: { ciFailed: false, conflict: false, behindBy: 2 },
      },
    };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(host.querySelector('[data-testid="chip-neutral"]')?.textContent).toBe("2커밋 뒤");
    expect(host.querySelector('[data-testid="chip-problem"]')).toBeNull();
  });
});

describe("SettledRow", () => {
  it("끝난 런에도 열린 PR의 칩을 보인다", () => {
    const run: HomeRun & { state: "ended" } = {
      ...base,
      state: "ended",
      summary: "succeeded",
      prState: "open",
      endedAt: "2026-11-23T00:00:00.000Z",
      endedAgoMs: 60_000,
      pullRequest: {
        displayId: "PR-1",
        url: "https://example.com/pull/1",
        signals: { ciFailed: true, conflict: false, behindBy: null },
      },
    };
    const host = mount(<SettledRow run={run} />);
    expect(host.querySelector('[data-testid="chip-problem"]')?.textContent).toBe("CI 실패");
  });
});
