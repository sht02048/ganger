// @vitest-environment jsdom
import type { V1RunDetail } from "@ganger/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardRun } from "../dashboard/model";
import { demoRunDetail } from "./run-port";
import type { RunPort, RunWrite, RunWriteOutcome } from "./run-port";
import { RunSheets } from "./run-sheets";
import type { OpenRunSheet } from "./run-sheets";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const base = {
  id: "run-1",
  ticketId: "ticket-1",
  ticketKey: "ACME-1",
  ticketTitle: "결제 재시도",
  trackerProject: "ACME",
  workspace: { id: "ws", name: "Payments" },
  runner: { name: "acme-runner", online: true },
  agent: "claude",
  waitMs: 0,
  executionMs: null,
  pullRequest: null,
  cancelling: false,
  control: null,
};

const questionRun: DashboardRun = {
  ...base,
  state: "waiting-for-input",
  waitingMs: null,
  todoTag: "question",
  input: {
    kind: "question",
    questionId: "q-1",
    body: "어느 쪽으로 할까요?",
    summary: "어느 쪽으로 할까요?",
    choices: ["왼쪽", "오른쪽"],
    answered: false,
  },
};

const checkRun: DashboardRun = {
  ...base,
  state: "waiting-for-input",
  waitingMs: null,
  todoTag: "human-check",
  input: {
    kind: "human-check",
    questionId: "q-2",
    body: "PR을 확인해 주세요 https://example.com/pull/7",
    answered: false,
  },
};

const permissionRun: DashboardRun = {
  ...base,
  state: "waiting-for-input",
  waitingMs: null,
  todoTag: "permission",
  input: { kind: "permission", promptId: "p-1", detail: "pnpm test", denied: false },
};

const failedRun: DashboardRun = {
  ...base,
  state: "ended",
  todoTag: "failed",
  summary: "failed",
  agentResult: "reported-failure",
  prState: "open",
  prReadError: null,
  endedAt: "2026-11-23T00:00:00.000Z",
  endedAgoMs: 60_000,
  pullRequest: {
    displayId: "#7",
    url: "https://example.com/pull/7",
    problems: [{ kind: "ci-failed" }],
  },
};

function fakePort(outcome: RunWriteOutcome = { kind: "sent" }, detail?: V1RunDetail) {
  const write = vi.fn<(run: DashboardRun, next: RunWrite) => Promise<RunWriteOutcome>>(() =>
    Promise.resolve(outcome),
  );
  const port: RunPort = {
    detail: (run) => Promise.resolve({ kind: "ok", value: detail ?? demoRunDetail(run) }),
    ticketLink: () => Promise.resolve({ kind: "ok", value: "https://tracker.example.com/ACME-1" }),
    write,
  };
  return { port, write };
}

const mounted: Array<() => void> = [];

async function open(sheet: OpenRunSheet, port: RunPort, disabled = false) {
  const onClose = vi.fn<() => void>();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <RunSheets sheet={sheet} port={port} disabled={disabled} onClose={onClose} />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { onClose };
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

const byLabel = (label: string) => document.body.querySelector(`[aria-label="${label}"]`);

async function press(label: string) {
  const element = byLabel(label);
  if (element === null) throw new Error(`no element: ${label}`);
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function type(label: string, value: string) {
  const element = byLabel(label);
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`no textarea: ${label}`);
  await act(async () => {
    Reflect.set(HTMLTextAreaElement.prototype, "value", value, element);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

const isDisabled = (label: string) => byLabel(label)?.getAttribute("aria-disabled") === "true";

describe("답하기 시트", () => {
  it("질문, 맥락, 선택지, 직접 쓰기, 고정된 안내와 보내기를 보인다", async () => {
    await open({ kind: "answer", run: questionRun }, fakePort().port);
    const text = document.body.textContent ?? "";
    for (const part of [
      "어느 쪽으로 할까요?",
      "ACME-1 결제 재시도",
      "왼쪽",
      "오른쪽",
      "직접 쓰기",
    ]) {
      expect(text).toContain(part);
    }
    const footer = document.body.querySelector('[data-testid="sheet-footer"]');
    expect(footer?.textContent).toContain("보내면 되돌릴 수 없어요");
    expect(footer?.querySelector('[aria-label="보내기"]')).not.toBeNull();
  });

  it("고르기만 해서는 보내지 않고, 보내기를 눌러야 보낸다", async () => {
    const { port, write } = fakePort();
    const { onClose } = await open({ kind: "answer", run: questionRun }, port);
    expect(isDisabled("보내기")).toBe(true);
    await press("오른쪽");
    expect(write).not.toHaveBeenCalled();
    expect(byLabel("오른쪽")?.getAttribute("aria-checked")).toBe("true");
    await press("보내기");
    expect(write).toHaveBeenCalledExactlyOnceWith(questionRun, {
      action: "answer",
      questionId: "q-1",
      answer: "오른쪽",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("직접 쓴 답을 보낸다", async () => {
    const { port, write } = fakePort();
    await open({ kind: "answer", run: questionRun }, port);
    await press("직접 쓰기");
    expect(isDisabled("보내기")).toBe(true);
    await type("직접 쓴 답", "  가운데로 해 주세요 ");
    await press("보내기");
    expect(write.mock.calls[0]?.[1]).toEqual({
      action: "answer",
      questionId: "q-1",
      answer: "가운데로 해 주세요",
    });
  });

  it("늦게 간 답이 거절되면 이유를 보이고 다시 보내지 못하게 한다", async () => {
    const { port } = fakePort({ kind: "refused", reason: "already-answered" });
    const { onClose } = await open({ kind: "answer", run: questionRun }, port);
    await press("왼쪽");
    await press("보내기");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "다른 곳에서 이미 답한 질문이에요. 다시 보내지 않아도 돼요.",
    );
    expect(isDisabled("보내기")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("서버에 닿지 않으면 안내하고 다시 보낼 수 있게 둔다", async () => {
    const { port, write } = fakePort({ kind: "failed", cause: "unreachable" });
    await open({ kind: "answer", run: questionRun }, port);
    await press("왼쪽");
    await press("보내기");
    expect(document.body.textContent).toContain("서버에 닿지 않아 보내지 못했어요");
    expect(isDisabled("보내기")).toBe(false);
    await press("보내기");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("보내는 동안에는 시트를 닫지 않는다", async () => {
    let finish: (outcome: RunWriteOutcome) => void = () => undefined;
    const { port, write } = fakePort();
    write.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { onClose } = await open({ kind: "answer", run: questionRun }, port);
    await press("왼쪽");
    await press("보내기");
    await press("닫기");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      finish({ kind: "failed", cause: "unreachable" });
      await Promise.resolve();
    });
    await press("닫기");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("연결을 확인하는 동안에는 보내기를 끈다", async () => {
    await open({ kind: "answer", run: questionRun }, fakePort().port, true);
    await press("왼쪽");
    expect(isDisabled("보내기")).toBe(true);
  });
});

describe("Human Check 시트", () => {
  it("무엇을 확인할지와 링크, 덧붙일 말을 보인다", async () => {
    await open({ kind: "human-check", run: checkRun }, fakePort().port);
    expect(document.body.textContent).toContain("PR을 확인해 주세요");
    expect(document.body.querySelector('[role="link"]')?.textContent).toBe(
      "https://example.com/pull/7",
    );
    expect(byLabel("에이전트에게 함께 보낼 말(선택)")).not.toBeNull();
  });

  it.each([
    ["확인했어요", "confirmed"],
    ["고쳐 주세요", "changes-requested"],
  ] as const)("%s를 덧붙일 말과 함께 보낸다", async (label, decision) => {
    const { port, write } = fakePort();
    const { onClose } = await open({ kind: "human-check", run: checkRun }, port);
    await type("에이전트에게 함께 보낼 말(선택)", "시험을 더해 주세요");
    await press(label);
    expect(write.mock.calls[0]?.[1]).toEqual({
      action: "human-check",
      questionId: "q-2",
      decision,
      note: "시험을 더해 주세요",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("이미 답한 요청이면 폼 대신 안내를 보인다", async () => {
    const detail = demoRunDetail(checkRun);
    const answered: V1RunDetail = {
      ...detail,
      input: { kind: "human-check", questionId: "q-2", body: "확인", answered: true },
    };
    await open({ kind: "human-check", run: checkRun }, fakePort({ kind: "sent" }, answered).port);
    expect(document.body.textContent).toContain("이미 답한 요청이에요");
    expect(byLabel("확인했어요")).toBeNull();
  });
});

describe("늦게 연 시트", () => {
  it("런이 Waiting for Input이 아니면 이미 답했다고 하지 않고 상태가 바뀌었다고 말한다", async () => {
    const moved: V1RunDetail = { ...demoRunDetail(questionRun), state: "running", input: null };
    await open({ kind: "answer", run: questionRun }, fakePort({ kind: "sent" }, moved).port);
    expect(document.body.textContent).toContain("런의 상태가 그사이 바뀌었어요");
    expect(document.body.textContent).not.toContain("이미 답한");
  });
});

describe("Permission 거절 시트", () => {
  it("허용 안내를 보이고 거절을 보낸다", async () => {
    const { port, write } = fakePort();
    await open({ kind: "deny", run: permissionRun }, port);
    expect(document.body.textContent).toContain("허용은 러너의 Orca에서 해요");
    await type("거절 이유(선택)", "지금은 안 돼요");
    await press("거절 보내기");
    expect(write.mock.calls[0]?.[1]).toEqual({
      action: "deny",
      promptId: "p-1",
      reason: "지금은 안 돼요",
    });
  });

  it("러너에서 이미 처리했으면 그 이유를 보인다", async () => {
    await open(
      { kind: "deny", run: permissionRun },
      fakePort({ kind: "refused", reason: "resolved" }).port,
    );
    await press("거절 보내기");
    expect(document.body.textContent).toContain("러너에서 이미 처리한 요청이에요");
  });
});

describe("취소 확인 시트", () => {
  it("확인을 눌러야 취소를 보낸다", async () => {
    const { port, write } = fakePort();
    await open({ kind: "cancel", run: questionRun }, port);
    expect(document.body.textContent).toContain("이 런을 취소할까요?");
    expect(write).not.toHaveBeenCalled();
    await press("런 취소하기");
    expect(write.mock.calls[0]?.[1]).toEqual({ action: "cancel" });
  });

  it("이미 끝난 런이면 그 이유를 보인다", async () => {
    await open(
      { kind: "cancel", run: questionRun },
      fakePort({ kind: "refused", reason: "already-ended" }).port,
    );
    await press("런 취소하기");
    expect(document.body.textContent).toContain("이미 끝난 런이에요.");
  });
});

describe("런 상세", () => {
  it("처리할 일 띠, 요약, PR 구역을 보이고 타임라인과 터미널은 싣지 않는다", async () => {
    const detail: V1RunDetail = {
      ...demoRunDetail(failedRun),
      summary: {
        outcome: "failed",
        agentResult: "reported-failure",
        report: "시험이 실패했어요",
        startError: null,
      },
    };
    await open({ kind: "detail", run: failedRun }, fakePort({ kind: "sent" }, detail).port);
    const text = document.body.textContent ?? "";
    for (const part of [
      "처리할 일",
      "런이 실패했어요",
      "요약",
      "완료 보고(실패)",
      "시험이 실패했어요",
      "PR",
      "#7",
      "CI 실패",
      "GitHub에서 열기",
    ]) {
      expect(text).toContain(part);
    }
    for (const hidden of ["지나온 일", "터미널", "타임라인"]) {
      expect(text).not.toContain(hidden);
    }
  });
});

describe("카드 메뉴", () => {
  it("런 취소는 같은 시트 안에서 확인을 거쳐 보낸다", async () => {
    const { port, write } = fakePort();
    await open({ kind: "menu", run: questionRun }, port);
    const dialogs = () => document.body.querySelectorAll('[aria-modal="true"]').length;
    const before = dialogs();
    await press("런 취소");
    expect(document.body.textContent).toContain("이 런을 취소할까요?");
    expect(dialogs()).toBe(before);
    expect(write).not.toHaveBeenCalled();
    await press("런 취소하기");
    expect(write.mock.calls[0]?.[1]).toEqual({ action: "cancel" });
  });

  it("Linear에서 열기와 런 취소를 보이고, 취소 중이면 런 취소를 뺀다", async () => {
    await open({ kind: "menu", run: questionRun }, fakePort().port);
    expect(byLabel("Linear에서 열기")).not.toBeNull();
    expect(byLabel("런 취소")).not.toBeNull();
    for (const unmount of mounted.splice(0)) unmount();
    await open({ kind: "menu", run: { ...questionRun, cancelling: true } }, fakePort().port);
    expect(byLabel("Linear에서 열기")).not.toBeNull();
    expect(byLabel("런 취소")).toBeNull();
  });
});
