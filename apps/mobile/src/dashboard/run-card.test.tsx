// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardRun, EndedRun } from "./model";
import { RunCard, SettledRow, prProblemTone, runMenuGroups } from "./run-card";
import type { RunMenuAction } from "./run-card";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mounted: Array<() => void> = [];

function mount(node: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {node}
      </SafeAreaProvider>,
    ),
  );
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
  trackerProject: "ACME",
  workspace: { id: "ws", name: "Payments" },
  runner: { name: "acme-runner", online: true },
  agent: "Claude",
  waitMs: 0,
  executionMs: null,
  pullRequest: null,
  cancelling: false,
  control: null,
  todoTag: null,
};

const noAction = () => {};
const buttons = (host: HTMLElement) => host.querySelectorAll('[role="button"]').length;

describe("RunCard", () => {
  it("이미 답한 Question에는 답하기를 두지 않고 보낸 사실을 말한다", () => {
    const run: DashboardRun = {
      ...base,
      state: "waiting-for-input",
      waitingMs: null,
      input: {
        kind: "question",
        questionId: "q",
        body: "질문",
        summary: "질문",
        choices: [],
        answered: true,
      },
    };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(buttons(host)).toBe(0);
    expect(host.textContent).toContain("답을 보냈어요");
  });

  it("이미 거절한 Permission에는 거절 버튼과 허용 안내를 두지 않는다", () => {
    const run: DashboardRun = {
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
    const paused: DashboardRun = {
      ...base,
      state: "paused",
      pausedMs: null,
      pauseSource: "operator",
    };
    expect(buttons(mount(<RunCard run={paused} onAction={noAction} />))).toBe(1);
    const cancelling: DashboardRun = { ...paused, cancelling: true };
    expect(buttons(mount(<RunCard run={cancelling} onAction={noAction} />))).toBe(0);
  });

  it("답하지 않은 Question은 요약 없이 answer 색 답하기를 둔다", () => {
    const actions: string[] = [];
    const run: DashboardRun = {
      ...base,
      state: "waiting-for-input",
      waitingMs: null,
      todoTag: "question",
      input: {
        kind: "question",
        questionId: "q",
        body: "어느 쪽으로 고칠까요?\n둘째 줄",
        summary: "어느 쪽으로 고칠까요?\n둘째 줄",
        choices: [],
        answered: false,
      },
    };
    const host = mount(<RunCard run={run} onAction={(action) => actions.push(action)} />);
    expect(host.textContent).not.toContain("어느 쪽으로 고칠까요?");
    const answer = host.querySelector('[aria-label="답하기"]');
    expect(answer?.getAttribute("data-testid")).toBe("button-answer");
    act(() => {
      answer?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual(["answer"]);
  });

  it("답하지 않은 Human Check는 내용 없이 check 색 확인하기를 둔다", () => {
    const actions: string[] = [];
    const run: DashboardRun = {
      ...base,
      state: "waiting-for-input",
      waitingMs: null,
      todoTag: "human-check",
      input: {
        kind: "human-check",
        questionId: "q",
        body: "PR을 확인해 주세요\n둘째 줄",
        answered: false,
      },
    };
    const host = mount(<RunCard run={run} onAction={(action) => actions.push(action)} />);
    expect(host.textContent).not.toContain("PR을 확인해 주세요");
    const check = host.querySelector('[aria-label="확인하기"]');
    expect(check?.getAttribute("data-testid")).toBe("button-check");
    act(() => {
      check?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual(["human-check"]);
  });

  it("이미 답한 Human Check는 버튼 없이 보낸 사실을 말한다", () => {
    const run: DashboardRun = {
      ...base,
      state: "waiting-for-input",
      waitingMs: null,
      todoTag: "human-check",
      input: { kind: "human-check", questionId: "q", body: "PR을 확인해 주세요", answered: true },
    };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(buttons(host)).toBe(0);
    expect(host.textContent).toContain("답을 보냈어요");
  });

  it("Paused 재개하기와 Permission 거절은 색을 바꾸지 않는다", () => {
    const paused: DashboardRun = {
      ...base,
      state: "paused",
      pausedMs: null,
      pauseSource: "operator",
    };
    const pausedHost = mount(<RunCard run={paused} onAction={noAction} />);
    expect(pausedHost.textContent).toContain("Ganger에서 멈춤");
    expect(pausedHost.querySelector('[aria-label="재개하기"]')?.getAttribute("data-testid")).toBe(
      "button-secondary",
    );
    const permission: DashboardRun = {
      ...base,
      state: "waiting-for-input",
      waitingMs: null,
      todoTag: "permission",
      input: { kind: "permission", promptId: "p", detail: "pnpm test", denied: false },
    };
    const permissionHost = mount(<RunCard run={permission} onAction={noAction} />);
    expect(permissionHost.textContent).toContain("pnpm test");
    expect(permissionHost.querySelector('[aria-label="거절"]')?.getAttribute("data-testid")).toBe(
      "button-danger",
    );
  });

  it("모든 Workspace를 볼 때만 Workspace 이름을 붙인다", () => {
    const run: DashboardRun = { ...base, state: "running" };
    expect(mount(<RunCard run={run} onAction={noAction} />).textContent).not.toContain("Payments");
    expect(mount(<RunCard run={run} showWorkspace onAction={noAction} />).textContent).toContain(
      "Payments",
    );
  });

  it("뒤처짐 칩은 문제 색을 쓰지 않는다", () => {
    const run: DashboardRun = {
      ...base,
      state: "running",
      pullRequest: {
        displayId: "PR-1",
        url: "https://example.com/pull/1",
        problems: [{ kind: "behind", commits: 2 }],
      },
    };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(host.querySelector('[data-testid="chip-neutral"]')?.textContent).toBe("2커밋 뒤");
    expect(host.querySelector('[data-testid="chip-problem"]')).toBeNull();
  });
});

describe("카드 행동 버튼 배치", () => {
  const space = { s1: "4px", s2: "8px" };

  it("아랫줄과 버튼 묶음 사이를 카드 간격보다 4 더 띄우고, 버튼끼리는 8 띄운다", () => {
    const run: DashboardRun = { ...base, state: "paused", pausedMs: null, pauseSource: "operator" };
    const host = mount(<RunCard run={run} onAction={noAction} onMenu={noAction} />);
    const actions = host.querySelector('[data-testid="card-actions"]');
    if (actions === null) throw new Error("card-actions not found");
    expect(getComputedStyle(actions).marginTop).toBe(space.s1);
    expect(getComputedStyle(actions).gap).toBe(space.s2);
    expect(actions.querySelectorAll('[role="button"]')).toHaveLength(1);
    expect(host.textContent).not.toContain("더 보기");
  });

  it("Failed 카드는 런 상세와 다시 맡기기를 한 줄에 같은 폭으로 둔다", () => {
    const failed: EndedRun = {
      ...settled,
      todoTag: "failed",
      summary: "failed",
      agentResult: "reported-failure",
    };
    const host = mount(<RunCard run={failed} onAction={noAction} />);
    const row = host.querySelector('[data-testid="card-action-row"]');
    if (row === null) throw new Error("card-action-row not found");
    expect(getComputedStyle(row).flexDirection).toBe("row");
    expect(getComputedStyle(row).gap).toBe(space.s2);
    const cells = [...row.children];
    expect(
      cells.map((cell) => cell.querySelector('[role="button"]')?.getAttribute("aria-label")),
    ).toEqual(["런 상세", "다시 맡기기"]);
    for (const cell of cells) expect(getComputedStyle(cell).flexGrow).toBe("1");
  });

  it("행동이 없으면 버튼 묶음을 두지 않는다", () => {
    const run: DashboardRun = { ...base, state: "running" };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(host.querySelector('[data-testid="card-actions"]')).toBeNull();
  });
});

describe("재개 요청 중", () => {
  it("재개 버튼을 숨기고 재개하는 중을 보인다", () => {
    const run: DashboardRun = {
      ...base,
      state: "paused",
      pausedMs: null,
      pauseSource: "operator",
      control: { control: "resume", status: "pending" },
    };
    const host = mount(<RunCard run={run} onAction={noAction} />);
    expect(buttons(host)).toBe(0);
    expect(host.textContent).toContain("재개하는 중");
  });
});

const settled: EndedRun = {
  ...base,
  state: "ended",
  summary: "succeeded",
  agentResult: "reported-success",
  prState: "none",
  prReadError: null,
  endedAt: "2026-11-23T00:00:00.000Z",
  endedAgoMs: 60_000,
};

describe("SettledRow", () => {
  it("PR 이 병합돼 To do 에서 빠진 Failed 런은 끝날 때 PR 이 열려 있었어도 병합됨으로 보인다(0235)", () => {
    const run: EndedRun = {
      ...settled,
      summary: "failed",
      agentResult: "timed-out",
      prState: "open",
      todoCleared: "pr-merged",
      pullRequest: { displayId: "#9", url: "https://example.com/pull/9", problems: [] },
    };
    const host = mount(<SettledRow run={run} />);
    expect(host.textContent).toContain("Failed");
    expect(host.textContent).toContain("PR #9 병합됨");
  });

  it("끝난 런에도 열린 PR의 칩을 보인다", () => {
    const run: EndedRun = {
      ...settled,
      prState: "open",
      pullRequest: {
        displayId: "PR-1",
        url: "https://example.com/pull/1",
        problems: [{ kind: "ci-failed" }],
      },
    };
    const host = mount(<SettledRow run={run} />);
    expect(host.querySelector('[data-testid="chip-problem"]')?.textContent).toBe("CI 실패");
  });

  it("Failed 꼬리표 카드에만 다시 맡기기를 두고, 누르면 그 동작을 알린다", () => {
    const actions: string[] = [];
    const failed: EndedRun = {
      ...settled,
      todoTag: "failed",
      summary: "failed",
      agentResult: "reported-failure",
    };
    const host = mount(<RunCard run={failed} onAction={(action) => actions.push(action)} />);
    const retry = host.querySelector('[aria-label="다시 맡기기"]');
    expect(retry).not.toBeNull();
    act(() => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(actions).toEqual(["retry"]);
    const plain = mount(<RunCard run={settled} onAction={() => undefined} />);
    expect(plain.querySelector('[aria-label="다시 맡기기"]')).toBeNull();
  });

  it("다시 맡겨 꼬리표가 없는 Failed 런은 Failed로 보인다", () => {
    const run: EndedRun = { ...settled, summary: "failed", agentResult: "reported-failure" };
    const host = mount(<SettledRow run={run} />);
    expect(host.querySelector('[data-testid="pill-failed"]')?.textContent).toBe("Failed");
  });

  it("PR 상태를 읽지 못하면 그렇게 말한다", () => {
    const run: EndedRun = {
      ...settled,
      prState: "unknown",
      prReadError: "no-access",
      pullRequest: { displayId: "PR-1", url: "https://example.com/pull/1", problems: [] },
    };
    expect(mount(<SettledRow run={run} />).textContent).toContain("PR 못 읽음");
  });
});

describe("모르는 값", () => {
  const unknownRun: DashboardRun = {
    ...base,
    state: "unknown",
    todoTag: null,
    pullRequest: null,
    cancelling: false,
    control: null,
  };

  it("모르는 상태의 런은 알 수 없는 상태로 보이고 런 상세만 열 수 있다", () => {
    const host = mount(<RunCard run={unknownRun} onAction={() => undefined} />);
    expect(host.textContent).toContain("알 수 없는 상태");
    expect(host.querySelector('[aria-label="런 상세"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="재개하기"]')).toBeNull();
  });

  it.each([
    ["모르는 제어 상태", { control: "resume", status: "unknown" }],
    ["모르는 제어 종류", { control: "unknown", status: "pending" }],
  ] as const)("%s의 멈춘 런에는 재개를 보이지 않는다", (_name, control) => {
    const run: DashboardRun = {
      ...base,
      state: "paused",
      pausedMs: null,
      pauseSource: "operator",
      todoTag: null,
      control,
    };
    const host = mount(<RunCard run={run} onAction={() => undefined} />);
    expect(host.querySelector('[aria-label="재개하기"]')).toBeNull();
  });

  it("제어 실패로 멈춘 런은 다시 재개할 수 있다", () => {
    const run: DashboardRun = {
      ...base,
      state: "paused",
      pausedMs: null,
      pauseSource: "operator",
      todoTag: null,
      control: { control: "resume", status: "failed" },
    };
    const host = mount(<RunCard run={run} onAction={() => undefined} />);
    expect(host.querySelector('[aria-label="재개하기"]')).not.toBeNull();
  });

  it("모르는 PR 문제는 문제 색을 쓰지 않는다", () => {
    expect(prProblemTone({ kind: "unknown" })).toBe("neutral");
    expect(prProblemTone({ kind: "ci-failed" })).toBe("problem");
    expect(prProblemTone({ kind: "conflict" })).toBe("problem");
  });

  it("모르는 PR 문제가 여럿이어도 화면을 깨지 않는다", () => {
    const run: DashboardRun = {
      ...unknownRun,
      pullRequest: {
        displayId: "#7",
        url: "https://example.com/pull/7",
        problems: [{ kind: "unknown" }, { kind: "unknown" }],
      },
    };
    const host = mount(<RunCard run={run} onAction={() => undefined} />);
    expect(host.textContent).toContain("알 수 없는 문제");
  });
});

describe("카드 … 메뉴", () => {
  const running: DashboardRun = { ...base, state: "running" };
  const withPr = (run: EndedRun, url: string): EndedRun => ({
    ...run,
    prState: "open",
    pullRequest: { displayId: "#7", url, problems: [] },
  });
  const menuButton = (host: HTMLElement, key = "ACME-1") =>
    host.querySelector(`[aria-label="${key} 메뉴"]`);
  const popover = () => document.body.querySelector('[data-testid="popover"]');
  const itemLabels = () =>
    Array.from(document.body.querySelectorAll('[role="menuitem"]')).map((item) =>
      item.getAttribute("aria-label"),
    );

  async function openMenu(host: HTMLElement) {
    const button = menuButton(host);
    if (button === null) throw new Error("menu button not found");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function choose(label: string) {
    const item = document.body.querySelector(`[role="menuitem"][aria-label="${label}"]`);
    if (item === null) throw new Error(`no item: ${label}`);
    await act(async () => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("진행 중인 런은 링크 묶음과 런 취소를 구분선으로 나눠 보인다", () => {
    expect(runMenuGroups(running)).toEqual([["open-ticket"], ["cancel"]]);
    expect(runMenuGroups({ ...running, cancelling: true })).toEqual([["open-ticket"]]);
  });

  it("끝난 런도 티켓을 열고, PR이 웹 주소이면 PR 열기를 더하며 런 취소는 없다", () => {
    expect(runMenuGroups(settled)).toEqual([["open-ticket"]]);
    expect(runMenuGroups(withPr(settled, "https://github.com/acme/app/pull/7"))).toEqual([
      ["open-ticket", "open-pr"],
    ]);
    expect(runMenuGroups(withPr(settled, "javascript:alert(1)"))).toEqual([["open-ticket"]]);
  });

  it("To do 의 Failed 런은 런 취소 자리에 확인했어요를 두고, 옛 서버가 치운 까닭 칸을 보내지 않으면 두지 않는다(0235)", () => {
    const failed: EndedRun = {
      ...settled,
      summary: "failed",
      agentResult: "timed-out",
      todoTag: "failed",
      todoCleared: null,
    };
    expect(runMenuGroups(failed)).toEqual([["open-ticket"], ["clear-todo"]]);
    const { todoCleared: _absent, ...fromOldServer } = failed;
    expect(runMenuGroups(fromOldServer)).toEqual([["open-ticket"]]);
    expect(runMenuGroups({ ...failed, todoTag: null, todoCleared: "operator" })).toEqual([
      ["open-ticket"],
    ]);
  });

  it("카드 아래에 더 보기 버튼을 두지 않고, 오른쪽 위 … 버튼으로 메뉴를 연다", async () => {
    const chosen: RunMenuAction[] = [];
    const host = mount(
      <RunCard run={running} onAction={noAction} onMenu={(action) => chosen.push(action)} />,
    );
    expect(host.textContent).not.toContain("더 보기");
    expect(host.querySelector('[data-testid="card-actions"]')).toBeNull();
    expect(menuButton(host)?.getAttribute("aria-expanded")).toBe("false");
    expect(popover()).toBeNull();
    await openMenu(host);
    expect(menuButton(host)?.getAttribute("aria-expanded")).toBe("true");
    expect(popover()?.getAttribute("role")).toBe("menu");
    expect(itemLabels()).toEqual(["Linear에서 열기", "런 취소"]);
    expect(document.body.querySelectorAll('[data-testid="popover-divider"]')).toHaveLength(1);
    await choose("런 취소");
    expect(chosen).toEqual(["cancel"]);
    expect(popover()).toBeNull();
  });

  it("바깥을 누르면 아무 항목도 고르지 않고 닫는다", async () => {
    const chosen: RunMenuAction[] = [];
    const host = mount(
      <RunCard run={running} onAction={noAction} onMenu={(action) => chosen.push(action)} />,
    );
    await openMenu(host);
    const backdrop = document.body.querySelector('[aria-label="메뉴 닫기"]');
    expect(backdrop?.getAttribute("role")).toBe("button");
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(popover()).toBeNull();
    expect(chosen).toEqual([]);
  });

  it("끝난 Failed 카드와 끝난 런 줄에도 … 메뉴가 있다", async () => {
    const failed: EndedRun = {
      ...settled,
      todoTag: "failed",
      summary: "failed",
      agentResult: "reported-failure",
    };
    const chosen: RunMenuAction[] = [];
    const card = mount(
      <RunCard run={failed} onAction={noAction} onMenu={(action) => chosen.push(action)} />,
    );
    await openMenu(card);
    expect(itemLabels()).toEqual(["Linear에서 열기"]);
    await choose("Linear에서 열기");
    expect(chosen).toEqual(["open-ticket"]);
    const row = mount(
      <SettledRow
        run={withPr(settled, "https://github.com/acme/app/pull/7")}
        onMenu={(action) => chosen.push(action)}
      />,
    );
    await openMenu(row);
    expect(itemLabels()).toEqual(["Linear에서 열기", "PR #7 GitHub에서 열기"]);
    await choose("PR #7 GitHub에서 열기");
    expect(chosen).toEqual(["open-ticket", "open-pr"]);
  });

  it("onMenu가 없으면 … 버튼을 두지 않는다", () => {
    const host = mount(<RunCard run={running} onAction={noAction} />);
    expect(menuButton(host)).toBeNull();
    expect(mount(<SettledRow run={settled} />).querySelector('[role="button"]')).toBeNull();
  });

  it("Linking을 직접 부르지 않는다", () => {
    const openURL = vi.spyOn(Linking, "openURL");
    mount(<RunCard run={running} onAction={noAction} onMenu={noAction} />);
    expect(openURL).not.toHaveBeenCalled();
    openURL.mockRestore();
  });
});
