// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomePage, HomeRun, InputWait } from "@ganger/app/home/model";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import questionJson from "../../messages/ko/question.json" with { type: "json" };
import { appMessages, defaultLocale } from "../i18n";
import { MutationRejectedError } from "../query/mutation-error";
import { toRunId, toTicketKey } from "@ganger/core";
import { HomeScreen } from "./home-screen";
import type { HomeScreenProps } from "./home-screen";
import { homeMessages } from "./messages";

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

const workspace = { id: "ws-commerce", name: "Commerce" };

function baseRun(id: string, key: string) {
  return {
    id: toRunId(id),
    ticketId: `ticket-${key}`,
    ticketKey: toTicketKey(key),
    ticketTitle: `${key} 제목`,
    trackerProject: "Web",
    workspace,
    runner: { name: "runner-1", online: true },
    agent: "claude",
    waitMs: 0,
    executionMs: 60_000,
    pullRequest: null,
    cancelling: false,
    control: null,
  };
}

function waitingRun(id: string, key: string): HomeRun {
  return { ...baseRun(id, key), state: "waiting-for-input", input: null, waitingMs: 60_000 };
}

function endedRun(id: string, key: string): HomeRun {
  return {
    ...baseRun(id, key),
    state: "ended",
    agentResult: "reported-success",
    prState: "none",
    prReadError: null,
    summary: "succeeded",
    endedAt: "2026-11-23T00:00:00.000Z",
    endedAgoMs: 60_000,
  };
}

function loadSeededPage(): HomePage {
  return {
    workspace: { kind: "one", workspace },
    attention: [
      { kind: "run", run: waitingRun("run-target", KEY) },
      {
        kind: "run",
        run: {
          ...waitingRun("run-other", "ACME-12"),
          state: "waiting-for-input",
          input: { ...permissionInput },
          waitingMs: 60_000,
        },
      },
    ],
    running: [],
    queued: [],
    runners: { list: [] },
    doneToday: { recent: [], total: 0 },
    endedRecently: [endedRun("run-ended", "ACME-30")],
  };
}

const KEY = "ACME-11";
const questionInput: InputWait = {
  kind: "question",
  questionId: "q-1",
  body: "재시도 간격을 바꿀까요?",
  choices: ["지수 백오프", "30초 고정"],
  answered: false,
};
const checkInput: InputWait = {
  kind: "human-check",
  questionId: "q-check",
  body: "미리보기를 확인해 주세요",
  answered: false,
};
const permissionInput: InputWait = {
  kind: "permission",
  promptId: "p-1",
  detail: "git push --force",
  denied: false,
};

function targetRun(page: HomePage): HomeRun {
  const found = page.attention.find((item) => item.run.ticketKey === KEY);
  if (found === undefined) throw new Error(`no ${KEY}`);
  return found.run;
}

function withInput(page: HomePage, input: InputWait): HomePage {
  return {
    ...page,
    attention: page.attention.map((item) =>
      item.run.ticketKey === KEY ? { ...item, run: { ...item.run, input } } : item,
    ),
  };
}

function withoutRun(page: HomePage): HomePage {
  return { ...page, attention: page.attention.filter((item) => item.run.ticketKey !== KEY) };
}

function movedToDone(page: HomePage): HomePage {
  const run = targetRun(page);
  const ended = page.endedRecently[0];
  if (ended === undefined) throw new Error("no ended run");
  return {
    ...withoutRun(page),
    endedRecently: [{ ...ended, id: run.id, ticketKey: run.ticketKey }, ...page.endedRecently],
  };
}

let container: HTMLDivElement;
let root: Root;

const resolved = () => Promise.resolve();

function draw(page: HomePage, actions: Partial<HomeScreenProps> = {}) {
  act(() => {
    root.render(
      <IntlProvider
        locale={defaultLocale}
        messages={{ ...appMessages, ...homeMessages }}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <HomeScreen
          page={page}
          onAnswer={resolved}
          onHumanCheck={resolved}
          onDeny={resolved}
          onControl={() => Promise.resolve("requested")}
          {...actions}
        />
      </IntlProvider>,
    );
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function cardButton(runId: string): HTMLElement {
  const button = container.querySelector<HTMLElement>(
    `li[data-run="${runId}"] button[aria-haspopup]`,
  );
  if (button === null) throw new Error(`no card ${runId}`);
  return button;
}

function dialogButton(name: string): HTMLElement {
  const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent === name,
  );
  if (button === undefined) throw new Error(`no button ${name}`);
  return button;
}

async function press(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await settle();
}

function cardAnswerButton(runId: string): HTMLElement | null {
  const names: ReadonlyArray<string> = [homeJson.card.answer, homeJson.card.check];
  return (
    [
      ...container.querySelectorAll<HTMLElement>(
        `li[data-run="${runId}"] button:not([aria-haspopup])`,
      ),
    ].find((button) => names.includes(button.textContent)) ?? null
  );
}

async function openSheet(runId: string) {
  await press(cardAnswerButton(runId) ?? cardButton(runId));
  expect(dialog()).not.toBeNull();
}

async function openSummary(runId: string) {
  await press(cardButton(runId));
  expect(dialog()).not.toBeNull();
}

async function sendQuestion() {
  const radio = dialog()?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (radio === undefined || radio === null) throw new Error("no radio");
  await press(radio);
  await press(dialogButton(questionJson.send));
}

beforeEach(() => {
  toast.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const fill = (template: string) => template.replace("{key}", KEY);

describe("Dashboard 패널의 티켓 링크(티켓 0197)", () => {
  it("티켓 줄에 런의 트래커 경로를 새 탭으로 여는 이름 있는 링크가 있다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    draw(page);
    const runId = targetRun(page).id;
    await openSheet(runId);
    const name = `${homeJson.sheet.openInTracker} (${homeJson.sheet.newTab})`;
    const link = dialog()?.querySelector<HTMLAnchorElement>(`a[aria-label="${name}"]`);
    expect(link?.getAttribute("href")).toBe(`/runs/${encodeURIComponent(runId)}/ticket`);
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toContain("noreferrer");
  });
});

describe("Dashboard 패널 보내기(티켓 0193)", () => {
  it("질문에 답하면 패널을 닫고 토스트를 띄우고 카드로 포커스를 돌린다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    draw(page);
    const runId = targetRun(page).id;
    await openSheet(runId);
    await sendQuestion();
    expect(dialog()).toBeNull();
    expect(toast.mock.calls).toEqual([[fill(homeJson.sheetSent.answered)]]);
    expect(document.activeElement).toBe(cardButton(runId));
  });

  it.for([
    { name: questionJson.humanCheck.confirm, message: homeJson.sheetSent.confirmed },
    {
      name: questionJson.humanCheck.requestChanges,
      message: homeJson.sheetSent["changes-requested"],
    },
  ])("Human Check $name 을 보내면 패널을 닫고 결과를 알린다", async ({ name, message }) => {
    const page = withInput(loadSeededPage(), checkInput);
    draw(page);
    const runId = targetRun(page).id;
    await openSheet(runId);
    await press(dialogButton(name));
    expect(dialog()).toBeNull();
    expect(toast.mock.calls).toEqual([[fill(message)]]);
    expect(document.activeElement).toBe(cardButton(runId));
  });

  it("Permission 거절을 보내면 패널을 닫고 결과를 알린다", async () => {
    const page = withInput(loadSeededPage(), permissionInput);
    draw(page);
    const runId = targetRun(page).id;
    await openSheet(runId);
    await press(dialogButton(homeJson.permission.send));
    expect(dialog()).toBeNull();
    expect(toast.mock.calls).toEqual([[fill(homeJson.sheetSent.denied)]]);
    expect(document.activeElement).toBe(cardButton(runId));
  });

  it("보내는 동안 카드가 다른 칸으로 옮겨지면 옮긴 카드로 포커스를 돌린다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    const runId = targetRun(page).id;
    const onAnswer = () => {
      draw(movedToDone(page), { onAnswer });
      return Promise.resolve();
    };
    draw(page, { onAnswer });
    await openSheet(runId);
    await sendQuestion();
    expect(dialog()).toBeNull();
    const moved = cardButton(runId);
    expect(moved.closest('section[aria-label="Done"]')).not.toBeNull();
    expect(document.activeElement).toBe(moved);
  });

  it("보내는 동안 카드가 사라지면 그 칸 제목으로 포커스를 돌린다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    const onAnswer = () => {
      draw(withoutRun(page), { onAnswer });
      return Promise.resolve();
    };
    draw(page, { onAnswer });
    await openSheet(targetRun(page).id);
    await sendQuestion();
    expect(dialog()).toBeNull();
    expect(document.activeElement?.tagName).toBe("H2");
    expect(document.activeElement?.textContent).toBe(homeJson.column.running);
  });

  it("패널이 닫힌 뒤 카드가 Done으로 옮겨져도 옮긴 카드로 포커스를 따라간다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    const runId = targetRun(page).id;
    draw(page);
    await openSheet(runId);
    await sendQuestion();
    expect(document.activeElement).toBe(cardButton(runId));
    draw(movedToDone(page));
    await settle();
    const moved = cardButton(runId);
    expect(moved.closest('section[aria-label="Done"]')).not.toBeNull();
    expect(document.activeElement).toBe(moved);
  });

  it("Human Check를 보낸 뒤 런이 재개돼 다른 목록으로 옮겨져도 포커스를 따라간다", async () => {
    const page = withInput(loadSeededPage(), checkInput);
    const run = targetRun(page);
    draw(page);
    await openSheet(run.id);
    await press(dialogButton(questionJson.humanCheck.confirm));
    expect(document.activeElement).toBe(cardButton(run.id));
    draw({ ...withoutRun(page), running: [{ ...baseRun(run.id, KEY), state: "running" }] });
    await settle();
    expect(document.activeElement).toBe(cardButton(run.id));
  });

  it("패널이 닫힌 뒤 운영자가 포커스를 옮겼으면 카드가 옮겨져도 빼앗지 않는다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    const runId = targetRun(page).id;
    draw(page);
    await openSheet(runId);
    await sendQuestion();
    const other = page.attention.find((item) => item.run.id !== runId)?.run;
    if (other === undefined) throw new Error("no other run");
    const elsewhere = cardButton(other.id);
    act(() => elsewhere.focus());
    draw(movedToDone(page));
    await settle();
    expect(document.activeElement).toBe(cardButton(other.id));
  });

  it("운영자가 빈 곳을 눌러 포커스를 풀면 다음 갱신에서 카드로 되돌리지 않는다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    const runId = targetRun(page).id;
    draw(page);
    await openSheet(runId);
    await sendQuestion();
    act(() => cardButton(runId).blur());
    expect(document.activeElement).toBe(document.body);
    draw({ ...page });
    await settle();
    expect(document.activeElement).toBe(document.body);
    draw(movedToDone(page));
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it("보낸 뒤 Workspace가 바뀌면 새 화면의 칸 제목으로 포커스를 옮기지 않는다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    const runId = targetRun(page).id;
    draw(page);
    await openSheet(runId);
    await sendQuestion();
    draw({
      ...withoutRun(page),
      workspace: { kind: "one", workspace: { id: "ws-other", name: "Other" } },
    });
    await settle();
    expect(document.activeElement?.tagName).not.toBe("H2");
  });

  it("보드에서 사라진 끝난 런의 패널을 닫으면 Done 칸 머리로 포커스를 돌린다", async () => {
    const page = loadSeededPage();
    draw(page);
    await openSheet("run-ended");
    draw({ ...page, endedRecently: [] });
    await press(dialogButton(homeJson.sheet.close));
    expect(document.activeElement?.closest('section[aria-label="Done"]')).not.toBeNull();
    expect(document.activeElement?.tagName).toBe("A");
  });

  it("보내는 중 닫았다가 같은 런을 다시 열면 앞선 성공이 새 패널을 닫지 않는다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    const runId = targetRun(page).id;
    let finish = () => {};
    const onAnswer = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    draw(page, { onAnswer });
    await openSheet(runId);
    await sendQuestion();
    await press(dialogButton(homeJson.sheet.close));
    await openSheet(runId);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    await settle();
    expect(dialog()).not.toBeNull();
    expect(toast.mock.calls).toEqual([[fill(homeJson.sheetSent.answered)]]);
  });

  it("보내는 동안 다른 런의 패널을 열었으면 그 패널을 닫지 않는다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    const runId = targetRun(page).id;
    const other = page.attention.find((item) => item.run.id !== runId)?.run;
    if (other === undefined) throw new Error("no other run");
    let finish = () => {};
    const onAnswer = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    draw(page, { onAnswer });
    await openSheet(runId);
    await sendQuestion();
    const close = dialogButton(homeJson.sheet.close);
    await press(close);
    await openSheet(other.id);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    await settle();
    expect(dialog()?.textContent).toContain(other.ticketKey);
    expect(toast.mock.calls).toEqual([[fill(homeJson.sheetSent.answered)]]);
  });

  it("서버가 질문 답을 거절하면 패널을 남겨 이유를 보이고 토스트를 띄우지 않는다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    draw(page, { onAnswer: () => Promise.reject(new MutationRejectedError("already-answered")) });
    await openSheet(targetRun(page).id);
    await sendQuestion();
    const status = dialog()?.querySelector('[role="status"]');
    expect(status?.textContent).toBe(homeJson.question.rejected["already-answered"]);
    expect(document.activeElement).toBe(status);
    expect(toast).not.toHaveBeenCalled();
  });

  it("서버가 Human Check 답을 거절하면 패널을 남겨 이유를 보인다", async () => {
    const page = withInput(loadSeededPage(), checkInput);
    draw(page, { onHumanCheck: () => Promise.reject(new MutationRejectedError("not-found")) });
    await openSheet(targetRun(page).id);
    await press(dialogButton(questionJson.humanCheck.confirm));
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe(
      homeJson.humanCheck.rejected["not-found"],
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it("서버가 Permission 거절을 거절하면 패널을 남겨 이유를 보인다", async () => {
    const page = withInput(loadSeededPage(), permissionInput);
    draw(page, { onDeny: () => Promise.reject(new MutationRejectedError("resolved")) });
    await openSheet(targetRun(page).id);
    await press(dialogButton(homeJson.permission.send));
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe(
      homeJson.permission.rejected.resolved,
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it("네트워크 오류면 패널과 폼을 남기고 실패를 보인다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    draw(page, { onAnswer: () => Promise.reject(new Error("offline")) });
    await openSheet(targetRun(page).id);
    await sendQuestion();
    expect(dialog()?.textContent).toContain(questionJson.failed);
    expect(dialogButton(questionJson.send)).toBeDefined();
    expect(toast).not.toHaveBeenCalled();
  });
});

function tabs(): HTMLElement[] {
  return [...(dialog()?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
}

function selectedTab(): string | undefined {
  return tabs().find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
}

function tabNamed(prefix: string): HTMLElement {
  const tab = tabs().find((candidate) => candidate.textContent.startsWith(prefix));
  if (tab === undefined) throw new Error(`no tab ${prefix}`);
  return tab;
}

const failingPr: HomeRun["pullRequest"] = {
  displayId: "#42",
  url: "https://code.example.com/acme/web/pull/42",
  signals: {
    ciFailed: true,
    checkTotal: 4,
    failedCount: 1,
    failedChecks: ["lint"],
    checksTruncated: false,
    conflict: false,
    behindBy: 0,
    checkedAt: "2026-11-23T00:00:00.000Z",
  },
  ci: "failure",
  state: "open",
  settledAt: null,
  settledAgoMs: null,
  branch: "acme-30",
};

function withEndedPr(page: HomePage, pullRequest: HomeRun["pullRequest"]): HomePage {
  return {
    ...page,
    endedRecently: page.endedRecently.map((run) => ({ ...run, pullRequest })),
  };
}

const sheet = homeJson.sheet;

describe("Dashboard 패널 탭(티켓 0199)", () => {
  it("「런」과 「PR」 탭을 두고, PR 이 없으면 「PR」 옆에 흐린 없음을 단다", async () => {
    const page = withInput(loadSeededPage(), checkInput);
    draw(page);
    await openSheet(targetRun(page).id);
    expect(dialog()?.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe(
      sheet.tabs.label,
    );
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      sheet.tabs.run,
      `${sheet.tabs.pr}${sheet.tabs.prNone}`,
    ]);
    expect(selectedTab()).toBe(sheet.tabs.run);
  });

  it("Queued 런은 「PR」 탭이 없다", async () => {
    const page: HomePage = {
      ...loadSeededPage(),
      queued: [
        { ...baseRun("run-queued", "ACME-40"), state: "queued", queuedReason: { kind: "behind" } },
      ],
    };
    draw(page);
    await openSummary("run-queued");
    expect(tabs().map((tab) => tab.textContent)).toEqual([sheet.tabs.run]);
  });

  it("answer 모드는 「런」 탭 맨 위에 폼을 보이고, 카드 본문으로 연 summary 모드는 폼 없이 기다리는 일을 줄로 보인다", async () => {
    const page = withInput(loadSeededPage(), questionInput);
    draw(page);
    const runId = targetRun(page).id;
    await openSheet(runId);
    expect(dialog()?.querySelector('input[type="radio"]')).not.toBeNull();
    await press(dialogButton(sheet.close));

    await openSummary(runId);
    expect(dialog()?.querySelector('input[type="radio"]')).toBeNull();
    expect(dialog()?.textContent).toContain(sheet.waitingFor.question);
    expect(dialog()?.textContent).toContain(sheet.worked);
  });

  it("Permission 은 따로 여는 버튼이 없어 summary 모드에서도 거절 폼을 보인다", async () => {
    const page = withInput(loadSeededPage(), permissionInput);
    draw(page);
    await openSummary(targetRun(page).id);
    expect(dialogButton(homeJson.permission.send)).toBeDefined();
  });

  it("끝난 런의 PR 에 CI 실패가 있으면 「PR」 탭으로 열고 탭 이름에 번호와 빨간 점 이름을 단다", async () => {
    draw(withEndedPr(loadSeededPage(), failingPr));
    await openSummary("run-ended");
    const pr = tabNamed("PR #42");
    expect(pr.getAttribute("aria-selected")).toBe("true");
    expect(pr.querySelector("[data-tab-dot]")?.getAttribute("data-tab-dot")).toBe("problem");
    expect(pr.textContent).toBe(`PR #42${sheet.prDot.problem}`);
    expect(dialog()?.textContent).toContain("lint");
  });

  it("고른 탭은 다시 읽어도 남고, 패널을 닫았다 다시 열면 처음 규칙으로 돌아간다", async () => {
    const page = withEndedPr(loadSeededPage(), failingPr);
    draw(page);
    await openSummary("run-ended");
    await press(tabNamed(sheet.tabs.run));
    expect(selectedTab()).toBe(sheet.tabs.run);
    draw({ ...page });
    await settle();
    expect(selectedTab()).toBe(sheet.tabs.run);
    await press(dialogButton(sheet.close));
    await openSummary("run-ended");
    expect(selectedTab()).toBe(`PR #42${sheet.prDot.problem}`);
  });

  it("「PR」 탭에 다녀와도 「런」 탭에 쓰던 답이 남는다", async () => {
    const page = withInput(loadSeededPage(), { ...questionInput, choices: [] });
    draw(page);
    await openSheet(targetRun(page).id);
    const textarea = dialog()?.querySelector("textarea");
    if (textarea === null || textarea === undefined) throw new Error("no textarea");
    await act(async () => {
      Reflect.set(HTMLTextAreaElement.prototype, "value", "지수 백오프로 바꿔 주세요", textarea);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await press(tabNamed(sheet.tabs.pr));
    await press(tabNamed(sheet.tabs.run));
    expect(dialog()?.querySelector("textarea")?.value).toBe("지수 백오프로 바꿔 주세요");
  });
});
