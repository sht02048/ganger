import { describe, expect, it } from "vitest";
import type { RunDetail } from "./run-detail/model.js";
import { nextStepInputOfDetail, runNextStep } from "./run-next-step.js";
import type { RunNextStepDetail, RunNextStepInput } from "./run-next-step.js";
import type { RunView } from "./runs/model.js";

const active = { pullRequest: null, cancelling: false };
const ended = {
  pullRequest: null,
  state: "ended",
  summary: "succeeded",
  prState: "none",
  laterPrState: null,
} satisfies RunNextStepInput;
const failingPr = { signals: { ciFailed: true, conflict: true } };
const conflictPr = { signals: { ciFailed: false, conflict: true } };

describe("runNextStep", () => {
  it.each<[string, RunNextStepInput, string]>([
    ["Queued", { ...active, state: "queued", queuedReason: { kind: "behind" } }, "none"],
    [
      "멈춘 기다림",
      { ...active, state: "queued", queuedReason: { kind: "blockers-stuck" } },
      "blockers-stuck",
    ],
    ["Running", { ...active, state: "running" }, "none"],
    ["Paused", { ...active, state: "paused" }, "paused"],
    ["Disconnected", { ...active, state: "disconnected" }, "disconnected"],
    ["입력을 모르는 대기", { ...active, state: "waiting-for-input" }, "waiting-input"],
    [
      "읽지 못한 입력",
      { ...active, state: "waiting-for-input", input: { kind: "unknown" } },
      "waiting-input",
    ],
    [
      "Question",
      { ...active, state: "waiting-for-input", input: { kind: "question", answered: false } },
      "question",
    ],
    [
      "답한 Question",
      { ...active, state: "waiting-for-input", input: { kind: "question", answered: true } },
      "none",
    ],
    [
      "Human Check",
      { ...active, state: "waiting-for-input", input: { kind: "human-check", answered: false } },
      "human-check",
    ],
    [
      "Permission",
      { ...active, state: "waiting-for-input", input: { kind: "permission", denied: false } },
      "permission",
    ],
    [
      "거절한 Permission",
      { ...active, state: "waiting-for-input", input: { kind: "permission", denied: true } },
      "none",
    ],
    ["취소 중", { ...active, cancelling: true, state: "paused" }, "none"],
    ["Succeeded", ended, "none"],
    ["Canceled", { ...ended, summary: "canceled" }, "none"],
    ["Failed", { ...ended, summary: "failed" }, "failed"],
    ["남긴 워크트리", { ...ended, keptWorktree: { removing: false } }, "kept-worktree"],
    ["지우는 워크트리", { ...ended, keptWorktree: { removing: true } }, "none"],
    ["열린 PR의 CI 실패", { ...ended, prState: "open", pullRequest: failingPr }, "pr-ci-failed"],
    ["열린 PR의 충돌", { ...ended, prState: "open", pullRequest: conflictPr }, "pr-conflict"],
    [
      "PR 문제가 Failed보다 먼저",
      { ...ended, summary: "failed", prState: "open", pullRequest: failingPr },
      "pr-ci-failed",
    ],
    [
      "나중에 병합된 PR",
      { ...ended, prState: "open", laterPrState: "merged", pullRequest: failingPr },
      "none",
    ],
    [
      "다음 런이 이어 받은 런",
      { ...ended, summary: "failed", prState: "open", pullRequest: failingPr, superseded: true },
      "none",
    ],
  ])("%s", (_name, input, expected) => {
    expect(runNextStep(input)).toBe(expected);
  });

  it("Runs 목록의 런을 그대로 받아요", () => {
    const run = {
      id: "run-1",
      ticketKey: "ACME-1",
      ticketTitle: "결제 실패 재시도",
      trackerProject: "Payments",
      branch: null,
      runner: null,
      agent: "claude",
      waitMs: 0,
      executionMs: 1,
      pullRequest: null,
      attention: false,
      state: "ended",
      endedAt: "2026-11-22T00:00:00.000Z",
      endedAgoMs: 0,
      agentResult: "reported-failure",
      prState: "none",
      laterPrState: null,
      prReadError: null,
      summary: "failed",
    } satisfies RunView;
    expect(runNextStep(run)).toBe("failed");
  });
});

describe("nextStepInputOfDetail", () => {
  const detail = (patch: Partial<RunNextStepDetail>): RunNextStepDetail => ({
    pullRequest: null,
    cancelPending: false,
    prHandedOver: false,
    continuedBy: null,
    status: { state: "running" },
    ...patch,
  });
  const endedStatus: RunDetail["status"] = {
    state: "ended",
    agentResult: "reported-failure",
    prState: "open",
    prReadError: null,
    summary: "failed",
    keptWorktree: null,
    laterPrState: null,
  };
  const pullRequest: RunDetail["pullRequest"] = {
    displayId: "#12",
    url: "https://example.com/acme/repo/pull/12",
    ci: "failure",
    signals: {
      ciFailed: true,
      checkTotal: 3,
      failedCount: 1,
      failedChecks: ["check"],
      checksTruncated: false,
      conflict: false,
      behindBy: 0,
      checkedAt: "2026-11-22T00:00:00.000Z",
    },
  };

  it("끝난 런의 PR 문제를 읽어요", () => {
    expect(runNextStep(nextStepInputOfDetail(detail({ status: endedStatus, pullRequest })))).toBe(
      "pr-ci-failed",
    );
  });

  it("이어서 맡긴 런과 PR을 넘긴 런은 처리할 일이 없어요", () => {
    const continuedBy = { number: 2 };
    expect(
      runNextStep(nextStepInputOfDetail(detail({ status: endedStatus, pullRequest, continuedBy }))),
    ).toBe("none");
    expect(
      runNextStep(
        nextStepInputOfDetail(detail({ status: endedStatus, pullRequest, prHandedOver: true })),
      ),
    ).toBe("none");
  });

  it("취소 요청을 cancelling으로 옮겨요", () => {
    expect(
      runNextStep(
        nextStepInputOfDetail(
          detail({
            cancelPending: true,
            status: {
              state: "paused",
              pausedSince: null,
              pauseSource: "operator",
              lastOutput: null,
            },
          }),
        ),
      ),
    ).toBe("none");
  });
});
