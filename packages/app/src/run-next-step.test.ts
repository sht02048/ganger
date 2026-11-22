import { describe, expect, it } from "vitest";
import type { RunDetail } from "./run-detail/model.js";
import { nextStepInputOfDetail, runNextStep } from "./run-next-step.js";
import type { RunNextStepDetail, RunNextStepInput } from "./run-next-step.js";

const active = { pullRequest: null, cancelling: false };
const ended = {
  pullRequest: null,
  state: "ended",
  summary: "succeeded",
  prState: "none",
  laterPrState: null,
  keptWorktree: null,
  superseded: false,
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
    ["취소 중인 Disconnected", { ...active, cancelling: true, state: "disconnected" }, "none"],
    ["Succeeded", ended, "none"],
    ["Canceled", { ...ended, summary: "canceled" }, "none"],
    ["Failed", { ...ended, summary: "failed" }, "failed"],
    ["남긴 워크트리", { ...ended, keptWorktree: { removing: false } }, "kept-worktree"],
    ["지우는 워크트리", { ...ended, keptWorktree: { removing: true } }, "none"],
    [
      "워크트리를 남긴 Failed",
      { ...ended, summary: "failed", keptWorktree: { removing: false } },
      "failed",
    ],
    ["새 런이 생긴 옛 Failed", { ...ended, summary: "failed", superseded: true }, "none"],
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
});

describe("nextStepInputOfDetail", () => {
  const detail = (patch: Partial<RunNextStepDetail>): RunNextStepDetail => ({
    id: "run-2",
    assignedAt: "2026-11-22T01:00:00.000Z",
    otherRuns: [],
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

  it.each([
    ["늦게 맡긴 런", "run-1", "2026-11-22T02:00:00.000Z", "none"],
    ["같은 때 맡긴 뒤 id의 런", "run-3", "2026-11-22T01:00:00.000Z", "none"],
    ["같은 때 맡긴 앞 id의 런", "run-1", "2026-11-22T01:00:00.000Z", "pr-ci-failed"],
    ["먼저 맡긴 런", "run-3", "2026-11-22T00:00:00.000Z", "pr-ci-failed"],
  ])("같은 티켓의 %s", (_name, id, assignedAt, expected) => {
    const run = detail({ status: endedStatus, pullRequest, otherRuns: [{ id, assignedAt }] });
    expect(runNextStep(nextStepInputOfDetail(run))).toBe(expected);
  });

  it("RunDetail을 그대로 받아요", () => {
    const accepts: (run: RunDetail) => RunNextStepInput = nextStepInputOfDetail;
    expect(accepts).toBe(nextStepInputOfDetail);
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
