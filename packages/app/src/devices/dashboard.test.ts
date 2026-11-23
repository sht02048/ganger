import { dashboardResponseSchema } from "@ganger/api";
import { toRunId, toTicketKey } from "@ganger/core";
import { describe, expect, it } from "vitest";
import type { HomePage, HomeRun } from "../home/model.js";
import type { QueuedReason } from "../runs/model.js";
import { toV1Dashboard } from "./dashboard.js";

const workspace = { id: "ws-1", name: "Acme" };

const base = {
  ticketId: "ticket",
  ticketKey: toTicketKey("ACME-1"),
  ticketTitle: "결제 재시도",
  trackerProject: "Web",
  workspace,
  runner: { name: "runner-a", online: true },
  agent: "claude",
  waitMs: 1000,
  executionMs: 2000,
  pullRequest: null,
  cancelling: false,
  control: null,
};

const blocker = { key: "ACME-9", title: "선행", stateName: "Todo", stateCategory: "todo" };

const queuedReasons: QueuedReason[] = [
  { kind: "starting" },
  { kind: "behind" },
  { kind: "no-capacity", runner: "runner-a" },
  { kind: "runner-offline" },
  { kind: "project-missing" },
  { kind: "assignment-blocked" },
  { kind: "usage-limit", provider: "claude", resetsInMs: 60_000 },
  { kind: "blockers-waiting", blockers: [blocker] },
  { kind: "blockers-stuck", cause: "cycle", blocker, blockers: [blocker] },
];

function common(id: string) {
  return { ...base, id: toRunId(id) };
}

function page(overrides: Partial<HomePage> = {}): HomePage {
  return {
    workspace: { kind: "one", workspace },
    attention: [],
    running: [],
    queued: [],
    runners: { list: [] },
    doneToday: { recent: [], total: 0 },
    endedRecently: [],
    ...overrides,
  };
}

describe("v1 Dashboard 계약", () => {
  it("Queued 이유 9종을 모두 담는다", () => {
    const queued = queuedReasons.map((queuedReason, index): HomeRun => ({
      ...common(`q-${index}`),
      state: "queued",
      queuedReason,
    }));
    const dashboard = toV1Dashboard(page({ queued }));
    const kinds = dashboard.columns.queued.flatMap((item) =>
      item.state === "queued" ? [item.queuedReason.kind] : [],
    );
    expect(kinds).toEqual(queuedReasons.map((reason) => reason.kind));
    const waiting = dashboard.columns.queued[7];
    expect(waiting?.state === "queued" && waiting.queuedReason).toMatchObject({
      blockers: [blocker],
      finished: [],
    });
  });

  it("Human Check, Paused와 멈춘 이유, 취소 중, PR 칩을 담는다", () => {
    const check: HomeRun = {
      ...common("check"),
      state: "waiting-for-input",
      input: { kind: "human-check", questionId: "q", body: "확인해 주세요", answered: false },
      waitingMs: 5,
    };
    const paused: HomeRun = {
      ...common("paused"),
      state: "paused",
      pausedMs: 10,
      pauseSource: "unreported",
      cancelling: true,
      pullRequest: {
        displayId: "#12",
        url: "https://example.com/pr/12",
        signals: {
          ciFailed: true,
          checkTotal: 3,
          failedCount: 1,
          failedChecks: ["test"],
          checksTruncated: false,
          conflict: true,
          behindBy: 2,
          checkedAt: "2026-11-23T00:00:00.000Z",
        },
        ci: "failure",
        state: "open",
        settledAt: null,
        settledAgoMs: null,
        branch: "acme-12",
      },
    };
    const dashboard = toV1Dashboard(
      page({ attention: [{ kind: "run", run: check }], running: [paused] }),
    );
    expect(dashboard.summary.todo).toEqual({ check: 1, answer: 0, stopped: 0 });
    expect(dashboard.columns.running.todo[0]).toMatchObject({
      todoTag: "human-check",
      input: { kind: "human-check" },
    });
    expect(dashboard.columns.running.rest[0]).toMatchObject({
      state: "paused",
      pauseSource: "unreported",
      cancelling: true,
      pullRequest: {
        problems: [{ kind: "ci-failed" }, { kind: "conflict" }, { kind: "behind", commits: 2 }],
      },
    });
  });

  it.each(["succeeded", "failed", "canceled"] as const)("결과 %s와 PR 정보를 담는다", (summary) => {
    const ended: HomeRun = {
      ...common("ended"),
      state: "ended",
      summary,
      agentResult: "reported-success",
      prState: "merged",
      prReadError: null,
      endedAt: "2026-11-23T00:00:00.000Z",
      endedAgoMs: 1,
    };
    const dashboard = toV1Dashboard(page({ endedRecently: [ended] }));
    expect(dashboard.columns.done.rest[0]).toMatchObject({ summary, prState: "merged" });
  });

  it("요약 문장에 필요한 값을 담고 사용량 한도 러너를 Runner Issue로 세지 않는다", () => {
    const limit = { provider: "claude", window: "session" as const, resetsInMs: 30_000 };
    const runner = {
      id: "r",
      name: "r",
      cause: null,
      offlineMs: null,
      used: 0,
      capacity: 1,
      usage: null,
      limits: [limit],
      loadHigh: null,
    };
    const offline = { ...runner, id: "o", cause: "offline" as const, limits: [] };
    const dashboard = toV1Dashboard(
      page({
        running: [{ ...common("a"), state: "running" }],
        queued: [{ ...common("b"), state: "queued", queuedReason: { kind: "behind" } }],
        runners: { list: [runner, offline] },
      }),
    );
    expect(dashboard.summary).toMatchObject({
      inProgress: 2,
      limitedRunners: 1,
      soonestLimitResetMs: 30_000,
      runnerIssues: 1,
    });
  });

  it("응답 봉투 스키마를 통과한다", () => {
    const data = toV1Dashboard(page({ running: [{ ...common("a"), state: "running" }] }));
    const parsed = dashboardResponseSchema.safeParse({
      meta: { serverVersion: "0.5.0", contractVersion: 1 },
      data,
    });
    expect(parsed.success).toBe(true);
  });
});
