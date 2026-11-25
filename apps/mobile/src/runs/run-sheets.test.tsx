// @vitest-environment jsdom
import type { AppRunDetail } from "@ganger/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Linking } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardRun } from "../dashboard/model";
import { demoRunDetail, demoRunPort } from "./run-port";
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

function fakePort(outcome: RunWriteOutcome = { kind: "sent" }, detail?: AppRunDetail) {
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
  const render = (actionsDisabled: boolean) =>
    root.render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <RunSheets sheet={sheet} port={port} disabled={actionsDisabled} onClose={onClose} />
      </SafeAreaProvider>,
    );
  await act(async () => {
    render(disabled);
    await Promise.resolve();
  });
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const setDisabled = (next: boolean) =>
    act(async () => {
      render(next);
      await Promise.resolve();
    });
  return { onClose, setDisabled };
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

describe("캐시한 런 상세(M56)", () => {
  const cached: AppRunDetail = {
    ...demoRunDetail(questionRun),
    summary: { outcome: null, agentResult: null, report: "캐시한 보고", startError: null },
  };
  const cachedDetail = () => ({ data: cached, fetchedAt: Date.now() - 5 * 60_000 });
  const cachedPort = (detail: RunPort["detail"]): RunPort => ({
    ...fakePort().port,
    cachedDetail,
    detail,
  });
  const settle = () =>
    act(async () => {
      await Promise.resolve();
    });

  it("런 상세는 새 내용이 오기 전에 캐시를 띠 없이 보인다", async () => {
    await open(
      { kind: "detail", run: questionRun },
      cachedPort(() => new Promise(() => undefined)),
    );
    expect(document.body.textContent).toContain("캐시한 보고");
    expect(document.body.textContent).not.toContain("기준");
  });

  it("새로 읽지 못하면 캐시의 저장 시각을 띠로 보인다", async () => {
    const port = cachedPort(() => Promise.resolve({ kind: "unavailable" }));
    await open({ kind: "detail", run: questionRun }, port);
    await settle();
    expect(document.body.textContent).toContain("캐시한 보고");
    expect(document.body.textContent).toContain("런 내용을 새로 읽지 못했어요 · 5분 전 기준");
  });

  it("연결이 돌아오면 다시 읽어 새 내용으로 바꾸고 띠를 지운다", async () => {
    const detail = vi
      .fn<RunPort["detail"]>()
      .mockResolvedValueOnce({ kind: "unavailable" })
      .mockResolvedValue({ kind: "ok", value: demoRunDetail(questionRun) });
    const { setDisabled } = await open(
      { kind: "detail", run: questionRun },
      cachedPort(detail),
      true,
    );
    await settle();
    expect(document.body.textContent).toContain("5분 전 기준");
    await setDisabled(false);
    await settle();
    expect(detail).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("5분 전 기준");
    expect(document.body.textContent).not.toContain("캐시한 보고");
  });

  it("서버가 런을 찾지 못하면 캐시 대신 그 사실을 보인다", async () => {
    const port = cachedPort(() => Promise.resolve({ kind: "not-found" }));
    await open({ kind: "detail", run: questionRun }, port);
    await settle();
    expect(document.body.textContent).toContain("런을 찾지 못했어요");
    expect(document.body.textContent).not.toContain("캐시한 보고");
  });

  it("답하기 시트는 오래된 캐시로 이미 답했다고 말하지 않는다", async () => {
    const answered = demoRunDetail(questionRun);
    const port: RunPort = {
      ...fakePort().port,
      cachedDetail: () => ({
        data: {
          ...answered,
          input: {
            kind: "question",
            questionId: "q-old",
            lead: [],
            choices: [],
            after: [],
            answered: true,
          },
        },
        fetchedAt: Date.now(),
      }),
      detail: () => Promise.resolve({ kind: "unavailable" }),
    };
    await open({ kind: "answer", run: questionRun }, port);
    await settle();
    expect(document.body.textContent).not.toContain("이미 답한 질문이에요");
    expect(document.body.textContent).toContain("내용을 불러오지 못했어요");
  });
});

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
    expect(write).toHaveBeenCalledExactlyOnceWith(
      questionRun,
      { action: "answer", questionId: "q-1", answer: "오른쪽" },
      expect.any(Function),
    );
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
    const answered: AppRunDetail = {
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
    const moved: AppRunDetail = { ...demoRunDetail(questionRun), state: "running", input: null };
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
    const detail: AppRunDetail = {
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
      "PR #7",
      "CI 실패",
    ]) {
      expect(text).toContain(part);
    }
    for (const hidden of ["지나온 일", "터미널", "타임라인"]) {
      expect(text).not.toContain(hidden);
    }
  });
});

describe("런 상세 PR 상자", () => {
  const prDetail = (patch: Partial<AppRunDetail>): AppRunDetail => ({
    ...demoRunDetail(failedRun),
    ...patch,
  });
  const pr = (patch: Partial<NonNullable<AppRunDetail["pullRequest"]>>) => ({
    displayId: "#7",
    url: "https://example.com/pull/7",
    ci: "success" as const,
    problems: [],
    state: "open" as const,
    stateSince: null,
    merge: null,
    ...patch,
  });
  const openDetail = async (detail: AppRunDetail) => {
    await open({ kind: "detail", run: failedRun }, fakePort({ kind: "sent" }, detail).port);
    return document.body.textContent ?? "";
  };
  const chips = (tone: string) =>
    Array.from(document.body.querySelectorAll(`[data-testid="chip-${tone}"]`)).map(
      (chip) => chip.textContent,
    );
  const box = () => document.body.querySelector('[data-testid="raised-box"]');

  it("PR 번호가 GitHub 링크이고 따로 열기 버튼을 두지 않는다", async () => {
    const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await openDetail(prDetail({ pullRequest: pr({}) }));
    const link = byLabel("PR #7 GitHub에서 열기");
    expect(link?.getAttribute("role")).toBe("link");
    expect(link?.textContent).toBe("PR #7");
    expect(document.body.textContent).not.toContain("GitHub에서 열기");
    expect(box()?.querySelector('[role="button"]')).toBeNull();
    await press("PR #7 GitHub에서 열기");
    expect(openURL).toHaveBeenCalledWith("https://example.com/pull/7");
    openURL.mockRestore();
  });

  it("열린 PR은 무채색 Open, CI 통과는 진행 색, 충돌은 문제 칩이다", async () => {
    await openDetail(prDetail({ pullRequest: pr({ problems: [{ kind: "conflict" }] }) }));
    expect(chips("neutral")).toEqual(["Open"]);
    expect(chips("progress")).toEqual(["CI 통과"]);
    expect(chips("problem")).toEqual(["충돌"]);
  });

  it("병합된 PR은 병합 색 칩에 병합을 본 때를 붙인다", async () => {
    await openDetail(
      prDetail({
        pullRequest: pr({
          state: "merged",
          stateSince: { at: "2026-11-23T00:00:00.000Z", agoMs: 3 * 60 * 60_000 },
        }),
      }),
    );
    expect(chips("merged")).toEqual(["Merged · 3 hr ago"]);
  });

  it("닫힌 PR은 무채색 Closed다", async () => {
    await openDetail(prDetail({ pullRequest: pr({ state: "closed" }) }));
    expect(chips("neutral")).toEqual(["Closed"]);
  });

  it("CI 실패 문제 칩이 있으면 CI 칩을 겹쳐 보이지 않는다", async () => {
    await openDetail(
      prDetail({ pullRequest: pr({ ci: "failure", problems: [{ kind: "ci-failed" }] }) }),
    );
    expect(chips("problem")).toEqual(["CI 실패"]);
  });

  it("계약 1 서버처럼 상태가 없으면 상태 칩을 빼고 CI 칩만 보인다", async () => {
    await openDetail(prDetail({ pullRequest: pr({ state: null }) }));
    expect(chips("neutral")).toEqual([]);
    expect(chips("progress")).toEqual(["CI 통과"]);
  });

  it("PR을 읽지 못하면 PR 못 읽음 칩 다음 줄에 러너·서버 계정 진단을 보인다", async () => {
    const text = await openDetail(
      prDetail({
        pullRequest: null,
        prReadError: "no-access",
        prReadDiagnosis: {
          kind: "different",
          runner: "acme-runner",
          runnerLogin: "acme-dev",
          server: { kind: "gh", logins: ["acme-bot", "acme-ci"] },
        },
      }),
    );
    expect(chips("problem")).toEqual(["PR 못 읽음"]);
    expect(text).toContain(
      "러너(acme-runner)는 acme-dev, 서버는 acme-bot, acme-ci 계정으로 읽어요. 서버 계정이 이 저장소를 볼 수 없어요.",
    );
    expect(text).not.toContain("아직 PR이 없어요");
  });

  it("붙여 넣은 토큰과 러너 계정을 모르는 경우의 진단 문장을 보인다", async () => {
    const text = await openDetail(
      prDetail({
        prReadError: "no-access",
        prReadDiagnosis: {
          kind: "runner-unknown",
          runner: "acme-runner",
          server: { kind: "token" },
        },
      }),
    );
    expect(text).toContain(
      "서버는 붙여 넣은 토큰으로 읽어요. 러너(acme-runner)의 gh 계정을 아직 몰라 토큰과 견줘 보지 못했어요.",
    );
  });

  it("진단이 없거나 모르는 진단이면 읽지 못한 이유를 보인다", async () => {
    const text = await openDetail(
      prDetail({ prReadError: "other", prReadDiagnosis: { kind: "unknown" } }),
    );
    expect(text).toContain("GitHub에서 PR을 읽지 못했어요");
    expect(text).not.toContain("러너(");
  });
});

describe("런 상세 머지 버튼", () => {
  const merge = {
    methods: ["squash", "merge"] as Array<"squash" | "merge" | "rebase">,
    defaultMethod: "squash" as const,
    blocked: null,
    noPermission: false,
    headCommit: "head-sha",
  };
  type Merge = NonNullable<NonNullable<AppRunDetail["pullRequest"]>["merge"]>;
  const withMerge = (
    patch: Partial<Merge> | null,
    over: Partial<AppRunDetail> = {},
    state: "open" | "merged" | "closed" = "open",
  ): AppRunDetail => ({
    ...demoRunDetail(failedRun),
    pullRequest: {
      displayId: "#7",
      url: "https://example.com/pull/7",
      ci: "success",
      problems: [],
      state,
      stateSince: null,
      merge: patch === null ? null : { ...merge, ...patch },
    },
    ...over,
  });
  const openWith = async (detail: AppRunDetail, outcome: RunWriteOutcome = { kind: "sent" }) => {
    const fake = fakePort(outcome, detail);
    const detailSpy = vi.spyOn(fake.port, "detail");
    await open({ kind: "detail", run: failedRun }, fake.port);
    return { ...fake, detailSpy };
  };
  const text = () => document.body.textContent ?? "";

  it("열린 PR 상자에 레포 기본 방식의 분할 버튼을 두고 누르면 본 head 로 바로 머지한다", async () => {
    const { write, detailSpy } = await openWith(withMerge({}));
    const group = byLabel("머지");
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.closest('[data-testid="raised-box"]')).not.toBeNull();
    expect(byLabel("머지 방식 바꾸기")).not.toBeNull();
    expect(isDisabled("Squash 머지")).toBe(false);
    await press("Squash 머지");
    expect(write.mock.calls[0]?.[1]).toEqual({
      action: "merge",
      method: "squash",
      expectedHead: "head-sha",
    });
    expect(text()).toContain("PR을 머지했어요");
    expect(detailSpy).toHaveBeenCalledTimes(2);
  });

  it("⌄ 로 레포가 허용한 방식만 골라 그 방식으로 머지한다", async () => {
    const { write } = await openWith(withMerge({}));
    await press("머지 방식 바꾸기");
    expect(byLabel("Squash 머지")?.getAttribute("role")).toBe("button");
    expect(byLabel("Rebase")).toBeNull();
    await press("Merge commit");
    await press("Merge commit 머지");
    expect(write.mock.calls[0]?.[1]).toMatchObject({ method: "merge" });
  });

  it("레포가 허용한 방식이 하나면 ⌄ 칸 없이 버튼 하나다", async () => {
    await openWith(withMerge({ methods: ["squash"] }));
    expect(byLabel("Squash 머지")).not.toBeNull();
    expect(byLabel("머지 방식 바꾸기")).toBeNull();
    expect(document.body.querySelector('[data-testid="split-divider"]')).toBeNull();
  });

  it.each([
    ["conflict", "충돌이 있어 머지할 수 없어요"],
    ["behind", "base를 받아야 머지할 수 있어요"],
    ["rules", "보호 규칙이 머지를 막고 있어요"],
    ["draft", "Draft PR이라 머지할 수 없어요"],
    ["unknown", "GitHub이 머지를 막고 있어요"],
  ] as const)("막힌 PR(%s)은 버튼을 끄고 이유를 보인다", async (blocked, reason) => {
    const { write } = await openWith(withMerge({ blocked }));
    expect(isDisabled("Squash 머지")).toBe(true);
    expect(isDisabled("머지 방식 바꾸기")).toBe(true);
    expect(text()).toContain(reason);
    await press("Squash 머지");
    expect(write).not.toHaveBeenCalled();
  });

  it("토큰에 머지 권한이 없으면 버튼을 끄고 권한 거절을 보인다", async () => {
    await openWith(withMerge({ noPermission: true }));
    expect(isDisabled("Squash 머지")).toBe(true);
    expect(text()).toContain("토큰에 머지 권한이 없어요");
  });

  it("기다리는 Human Check 가 있으면 머지하면 확인했어요로 답한다고 알린다", async () => {
    const hint = '머지하면 기다리는 Human Check에 "확인했어요"로 답해요';
    await openWith(
      withMerge(
        {},
        { input: { kind: "human-check", questionId: "q", body: "확인", answered: false } },
      ),
    );
    expect(text()).toContain(hint);
  });

  it("기다리는 Human Check 가 없으면 안내를 보이지 않는다", async () => {
    await openWith(withMerge({}));
    expect(text()).not.toContain("Human Check");
  });

  it("레포 규칙이 막으면 GitHub 이 준 이유를 알리고 머지됐다고 하지 않는다", async () => {
    await openWith(withMerge({}), {
      kind: "refused",
      reason: "blocked",
      message: "Review required",
    });
    await press("Squash 머지");
    expect(text()).toContain("레포 규칙이 머지를 막았어요: Review required");
    expect(text()).not.toContain("PR을 머지했어요");
  });

  it("그사이 head 가 바뀌면 다시 확인하라고 알린다", async () => {
    await openWith(withMerge({}), { kind: "refused", reason: "head-changed" });
    await press("Squash 머지");
    expect(text()).toContain("PR에 새 커밋이 올라왔어요");
  });

  it("데모 모드에서는 보내지 않는다고 알린다", async () => {
    await open(
      { kind: "detail", run: failedRun },
      { ...demoRunPort, detail: () => Promise.resolve({ kind: "ok", value: withMerge({}) }) },
    );
    await press("Squash 머지");
    expect(text()).toContain("데모 모드에서는 보내지 않아요");
    expect(text()).not.toContain("PR을 머지했어요");
  });

  it("연결이 끊겨 쓰기를 막은 동안에는 버튼을 끈다", async () => {
    const fake = fakePort({ kind: "sent" }, withMerge({}));
    await open({ kind: "detail", run: failedRun }, fake.port, true);
    expect(isDisabled("Squash 머지")).toBe(true);
  });

  it.each(["merged", "closed"] as const)("%s PR 에는 버튼이 없다", async (state) => {
    await openWith(withMerge({}, {}, state));
    expect(byLabel("머지")).toBeNull();
  });

  it("머지 정보가 없는 옛 서버 응답에는 버튼이 없다", async () => {
    await openWith(withMerge(null));
    expect(byLabel("머지")).toBeNull();
  });
});

describe("다시 맡기기 시트", () => {
  const withNextActions = (nextActions: AppRunDetail["nextActions"]): AppRunDetail => ({
    ...demoRunDetail(failedRun),
    nextActions,
  });
  const UNAVAILABLE = "같은 러너와 저장소로 맡길 수 없어요";

  it("확인을 눌러야 다시 맡긴다", async () => {
    const detail = withNextActions({ retry: "available", continue: "not-offered" });
    const { port, write } = fakePort({ kind: "sent" }, detail);
    const { onClose } = await open({ kind: "retry", run: failedRun }, port);
    expect(document.body.textContent).toContain("같은 저장소·러너·에이전트");
    expect(write).not.toHaveBeenCalled();
    await press("다시 맡기기");
    expect(write.mock.calls[0]?.[1]).toEqual({ action: "retry" });
    expect(onClose).toHaveBeenCalled();
  });

  it("맡길 수 없으면 버튼을 끄고 웹이나 데스크톱을 안내한다", async () => {
    const detail = withNextActions({ retry: "unavailable", continue: "not-offered" });
    const { port, write } = fakePort({ kind: "sent" }, detail);
    await open({ kind: "retry", run: failedRun }, port);
    expect(document.body.textContent).toContain(UNAVAILABLE);
    expect(document.body.textContent).toContain("웹이나 데스크톱에서 맡겨 주세요");
    expect(isDisabled("다시 맡기기")).toBe(true);
    await press("다시 맡기기");
    expect(write).not.toHaveBeenCalled();
  });

  it("서버가 맡길 수 없다고 거절하면 같은 안내를 보이고 버튼을 끈다", async () => {
    const detail = withNextActions({ retry: "available", continue: "not-offered" });
    const { port } = fakePort({ kind: "refused", reason: "cannot-assign" }, detail);
    await open({ kind: "retry", run: failedRun }, port);
    await press("다시 맡기기");
    expect(document.body.textContent).toContain(UNAVAILABLE);
    expect(isDisabled("다시 맡기기")).toBe(true);
  });

  it("이어서 맡기기는 서버가 허용할 때만 보인다", async () => {
    const hidden = withNextActions({ retry: "available", continue: "not-offered" });
    await open({ kind: "retry", run: failedRun }, fakePort({ kind: "sent" }, hidden).port);
    expect(byLabel("이어서 맡기기")).toBeNull();
    for (const unmount of mounted.splice(0)) unmount();
    const running = withNextActions({ retry: "available", continue: "agent-running" });
    await open({ kind: "retry", run: failedRun }, fakePort({ kind: "sent" }, running).port);
    expect(byLabel("이어서 맡기기")).toBeNull();
    expect(document.body.textContent).toContain("이전 에이전트가 멈춘 것을 확인하면");
  });

  it("이어서 맡기기는 말을 써야 보낼 수 있다", async () => {
    const detail = withNextActions({ retry: "available", continue: "available" });
    const { port, write } = fakePort({ kind: "sent" }, detail);
    await open({ kind: "retry", run: failedRun }, port);
    await press("이어서 맡기기");
    expect(document.body.textContent).toContain("이어서 맡길까요?");
    expect(isDisabled("이어서 맡기기")).toBe(true);
    await type("에이전트에게 할 말", "   ");
    expect(isDisabled("이어서 맡기기")).toBe(true);
    await press("이어서 맡기기");
    expect(write).not.toHaveBeenCalled();
    await type("에이전트에게 할 말", " 남은 시험을 고쳐 주세요 ");
    await press("이어서 맡기기");
    expect(write.mock.calls[0]?.[1]).toEqual({
      action: "continue",
      message: "남은 시험을 고쳐 주세요",
    });
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

describe("응답을 잃은 쓰기", () => {
  function confirmingPort() {
    let finish: (outcome: RunWriteOutcome) => void = () => undefined;
    let confirm: () => void = () => undefined;
    const write = vi.fn<RunPort["write"]>((_run, _write, onConfirming) => {
      confirm = onConfirming ?? confirm;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const port: RunPort = {
      detail: (run) => Promise.resolve({ kind: "ok", value: demoRunDetail(run) }),
      ticketLink: () => Promise.resolve({ kind: "demo" }),
      write,
    };
    return {
      port,
      write,
      confirm: () => act(async () => confirm()),
      finish: (outcome: RunWriteOutcome) => act(async () => finish(outcome)),
    };
  }

  it("버튼 자리에 확인 중을 보이고 끝나면 시트를 닫는다", async () => {
    const world = confirmingPort();
    const { onClose } = await open({ kind: "cancel", run: questionRun }, world.port);
    await press("런 취소하기");
    await world.confirm();
    expect(isDisabled("보냈는지 확인 중이에요")).toBe(true);
    await world.finish({ kind: "sent" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Human Check는 누른 버튼 자리에만 확인 중을 보인다", async () => {
    const world = confirmingPort();
    await open({ kind: "human-check", run: checkRun }, world.port);
    await press("고쳐 주세요");
    await world.confirm();
    expect(byLabel("보냈는지 확인 중이에요")).not.toBeNull();
    expect(byLabel("확인했어요")).not.toBeNull();
    expect(byLabel("고쳐 주세요")).toBeNull();
  });

  it("확인하지 못하면 다시 보내지 못하게 하고, 다시 읽으면 결과를 확인하라고 안내한다", async () => {
    const world = confirmingPort();
    const { onClose, setDisabled } = await open({ kind: "cancel", run: questionRun }, world.port);
    await press("런 취소하기");
    await world.confirm();
    await setDisabled(true);
    await world.finish({ kind: "unconfirmed" });
    expect(document.body.textContent).toContain("보냈는지 확인하지 못했어요");
    expect(isDisabled("런 취소하기")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await setDisabled(false);
    expect(document.body.textContent).toContain("Dashboard를 다시 읽었으니 닫고 결과를");
    expect(isDisabled("런 취소하기")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("다시 맡기기를 확인하지 못하면 이어서 맡기기로 넘어가지 못한다", async () => {
    const world = confirmingPort();
    await open({ kind: "retry", run: failedRun }, world.port);
    await press("다시 맡기기");
    await world.finish({ kind: "unconfirmed" });
    expect(isDisabled("이어서 맡기기")).toBe(true);
    expect(isDisabled("다시 맡기기")).toBe(true);
  });

  it("이어서 맡기기를 확인하지 못하면 뒤로 갔다 와도 잠금과 안내가 남는다", async () => {
    const world = confirmingPort();
    await open({ kind: "retry", run: failedRun }, world.port);
    await press("이어서 맡기기");
    await type("에이전트에게 할 말", "이어서 해 주세요");
    const send = document.body.querySelector(
      '[data-testid="sheet-footer"] [aria-label="이어서 맡기기"]',
    );
    await act(async () => {
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await world.finish({ kind: "unconfirmed" });
    await press("돌아가기");
    expect(document.body.textContent).toContain("보냈는지 확인하지 못했어요");
    expect(isDisabled("이어서 맡기기")).toBe(true);
    expect(isDisabled("다시 맡기기")).toBe(true);
  });

  it("서버가 분명히 거절하면 이유를 보이고 시트를 닫지 않는다", async () => {
    const world = confirmingPort();
    const { onClose } = await open({ kind: "cancel", run: questionRun }, world.port);
    await press("런 취소하기");
    await world.finish({ kind: "refused", reason: "already-ended" });
    expect(document.body.textContent).toContain("이미 끝난 런이에요");
    expect(world.write).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
