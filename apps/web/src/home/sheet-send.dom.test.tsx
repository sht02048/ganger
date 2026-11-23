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

async function openSheet(runId: string) {
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
