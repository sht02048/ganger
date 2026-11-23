// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toRunId, toTicketKey } from "@ganger/core";
import type { MergeMethod } from "@ganger/core";
import type { MergePrResult } from "@ganger/app/home/merge-pr";
import type { HomePullRequest, HomeRun } from "@ganger/app/home/model";
import type { MergeView, PrSignalsView } from "@ganger/app/pr-signals-view";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import { appMessages, defaultLocale } from "../i18n";
import { homeMessages } from "./messages";
import { PrTabContent } from "./sheet-pr-tab";
import type { MergeHandler } from "./sheet-pr-tab";

const toast = vi.hoisted(() => vi.fn<(message: string) => void>());

vi.mock("@ganger/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ganger/ui")>()),
  showToast: toast,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(Element.prototype, { getAnimations: () => [] });
Object.assign(Element.prototype, { scrollIntoView: () => {} });
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});

const m = homeJson.sheet.pr.merge;
const p = homeJson.sheet.pr;

const signals: PrSignalsView = {
  ciFailed: false,
  checkTotal: 3,
  failedCount: 0,
  failedChecks: [],
  checksTruncated: false,
  conflict: false,
  behindBy: 0,
  checkedAt: "2026-11-23T12:00:00.000Z",
};

const ready: MergeView = {
  methods: ["squash", "merge", "rebase"],
  defaultMethod: "merge",
  blocked: null,
  noPermission: false,
};

function pr(merge: MergeView | null, over: Partial<HomePullRequest> = {}): HomePullRequest {
  return {
    displayId: "#42",
    url: "https://code.example.com/acme/web/pull/42",
    signals,
    ci: "success",
    state: "open",
    settledAt: null,
    settledAgoMs: null,
    branch: "acme-1-login",
    title: "Add login",
    baseBranch: "develop",
    commits: [],
    merge,
    ...over,
  };
}

function run(pullRequest: HomePullRequest): HomeRun {
  return {
    id: toRunId("run-1"),
    ticketId: "ticket-ACME-1",
    ticketKey: toTicketKey("ACME-1"),
    ticketTitle: "로그인",
    trackerProject: "Web",
    workspace: { id: "ws-commerce", name: "Commerce" },
    runner: { name: "runner-1", online: true },
    agent: "claude",
    waitMs: 0,
    executionMs: 60_000,
    pullRequest,
    cancelling: false,
    control: null,
    state: "running",
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  toast.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle(work: () => void = () => {}): Promise<void> {
  await act(async () => {
    work();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(pullRequest: HomePullRequest, onMerge: MergeHandler = unusedMerge) {
  await settle(() =>
    root.render(
      <IntlProvider
        locale={defaultLocale}
        messages={{ ...appMessages, ...homeMessages }}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <PrTabContent run={run(pullRequest)} onMerge={onMerge} />
      </IntlProvider>,
    ),
  );
}

function unusedMerge(): Promise<MergePrResult> {
  return Promise.reject(new Error("unused"));
}

function mergeButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '[data-merge-control] button[data-variant="primary"]',
  );
  if (button === null) throw new Error("no merge button");
  return button;
}

function shownLabel(button: HTMLButtonElement): string {
  const labels = [...button.querySelectorAll("span > span")].filter(
    (label) => label.getAttribute("aria-hidden") !== "true",
  );
  return labels.map((label) => label.textContent).join("");
}

function methodTrigger(): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>(
    `[data-merge-control] button[aria-label="${m.methodMenu}"]`,
  );
  if (trigger === null) throw new Error("no method menu");
  return trigger;
}

function isOff(button: HTMLButtonElement): boolean {
  return button.disabled || button.getAttribute("aria-disabled") === "true";
}

async function openMethods(): Promise<HTMLElement[]> {
  await settle(() => {
    methodTrigger().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    methodTrigger().click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemradio"]')];
}

function problemRows(): string[] {
  return [...container.querySelectorAll('[data-signal-tone="problem"] dt')].map(
    (dt) => dt.textContent,
  );
}

describe("「PR」 탭 머지 버튼 (0201)", () => {
  it("탭 맨 위에 레포 기본 방식 이름의 노란 머지 버튼을 둔다", async () => {
    await render(pr(ready));
    const button = mergeButton();
    expect(shownLabel(button)).toBe(m.button.merge);
    expect(isOff(button)).toBe(false);
    const first = container.firstElementChild?.firstElementChild;
    expect(first?.hasAttribute("data-merge-control")).toBe(true);
  });

  it("방식 메뉴는 레포가 허용한 방식만 보이고, 고르면 버튼 글과 머지 방식이 바뀐다", async () => {
    const onMerge = vi.fn<MergeHandler>((_runId, method: MergeMethod) =>
      Promise.resolve({ ok: true, method, replayed: false }),
    );
    await render(pr({ ...ready, methods: ["squash", "merge"] }), onMerge);
    const items = await openMethods();
    expect(items.map((item) => item.textContent)).toEqual([m.option.squash, m.option.merge]);
    expect(items[1]?.getAttribute("aria-checked")).toBe("true");
    await settle(() => items[0]?.click());
    expect(shownLabel(mergeButton())).toBe(m.button.squash);
    await settle(() => mergeButton().click());
    expect(onMerge).toHaveBeenCalledWith("run-1", "squash");
  });

  it("허용 방식이 하나면 메뉴 없이 버튼만 둔다", async () => {
    await render(pr({ ...ready, methods: ["squash"], defaultMethod: "squash" }));
    expect(shownLabel(mergeButton())).toBe(m.button.squash);
    expect(container.querySelector(`button[aria-label="${m.methodMenu}"]`)).toBeNull();
  });

  it("누르면 확인 없이 바로 머지하고 성공을 토스트로 알린다", async () => {
    const onMerge = vi.fn<MergeHandler>(() =>
      Promise.resolve({ ok: true, method: "merge", replayed: false }),
    );
    await render(pr(ready), onMerge);
    await settle(() => mergeButton().click());
    expect(onMerge).toHaveBeenCalledWith("run-1", "merge");
    expect(toast).toHaveBeenCalledWith(m.done);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("머지가 거절되면 이유를 토스트로 알린다", async () => {
    await render(pr(ready), () =>
      Promise.resolve({ ok: false, reason: "blocked", message: "Required review missing" }),
    );
    await settle(() => mergeButton().click());
    expect(toast).toHaveBeenCalledWith(
      m.failed.blockedBecause.replace("{message}", "Required review missing"),
    );
  });

  it("보내는 동안 버튼을 막아 두 번 보내지 않는다", async () => {
    let finish: (result: MergePrResult) => void = () => {};
    const onMerge = vi.fn<MergeHandler>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(pr(ready), onMerge);
    await settle(() => mergeButton().click());
    expect(mergeButton().getAttribute("aria-busy")).toBe("true");
    await settle(() => mergeButton().click());
    expect(onMerge).toHaveBeenCalledTimes(1);
    await settle(() => finish({ ok: true, method: "merge", replayed: false }));
    expect(mergeButton().getAttribute("aria-busy")).toBe("false");
  });

  it("레포 규칙이 막으면 버튼을 끄고 이유는 아래 빨간 줄로만 보인다", async () => {
    await render(
      pr({ ...ready, blocked: "conflict" }, { signals: { ...signals, conflict: true } }),
    );
    expect(isOff(mergeButton())).toBe(true);
    expect(isOff(methodTrigger())).toBe(true);
    expect(problemRows()).toEqual([p.conflict]);
    expect(container.querySelector("[data-merge-control] p")).toBeNull();
  });

  it.each([
    ["rules", p.rules, p.rulesValue.blocked],
    ["draft", p.rules, p.rulesValue.draft],
    ["behind", p.base, p.baseValue.mustUpdate],
  ] as const)("막힌 이유 %s 는 빨간 줄로 보인다", async (blocked, row, text) => {
    await render(pr({ ...ready, blocked }));
    expect(isOff(mergeButton())).toBe(true);
    expect(problemRows()).toEqual([row]);
    expect(container.textContent).toContain(text);
  });

  it("CI 실패로 보호 규칙이 막으면 CI 줄만 빨갛고 규칙 줄을 따로 두지 않는다", async () => {
    await render(
      pr(
        { ...ready, blocked: "rules" },
        { ci: "failure", signals: { ...signals, ciFailed: true, failedCount: 1 } },
      ),
    );
    expect(problemRows()).toEqual([p.ci]);
  });

  it("토큰에 머지 권한이 없으면 버튼을 끄고 Settings 로 가는 안내를 보인다", async () => {
    await render(pr({ ...ready, noPermission: true }));
    const button = mergeButton();
    expect(isOff(button)).toBe(true);
    const note = container.querySelector("[data-merge-control] p");
    expect(note?.textContent).toBe(`${m.noPermission} · ${m.toSettings}`);
    expect(button.getAttribute("aria-describedby")).toBe(note?.id);
    expect(note?.querySelector("a")?.getAttribute("href")).toBe("/settings#connections");
  });

  it("머지 정보가 없거나 머지된 PR 에는 버튼을 두지 않는다", async () => {
    await render(pr(null));
    expect(container.querySelector("[data-merge-control]")).toBeNull();
    await render(pr(ready, { state: "merged" }));
    expect(container.querySelector("[data-merge-control]")).toBeNull();
  });
});
