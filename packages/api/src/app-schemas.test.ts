import { describe, expect, it } from "vitest";

import {
  appDashboardRunSchema,
  appErrorSchema,
  appNotificationRecordSchema,
  appRunDetailSchema,
  appRunnerSchema,
} from "./app-schemas.js";
import { dashboardRunSchema } from "./dashboard.js";
import { runnerSchema } from "./runners.js";
import { runDetailSchema } from "./runs.js";

const base = {
  id: "run-1",
  ticketId: "ticket-1",
  ticketKey: "ACME-1",
  ticketTitle: "제목",
  trackerProject: "ACME",
  workspace: { id: "ws", name: "Payments" },
  runner: null,
  agent: "claude",
  waitMs: 0,
  executionMs: null,
  pullRequest: null,
  cancelling: false,
  control: null,
  todoTag: null,
};

const detail = {
  id: "run-1",
  ticketKey: "ACME-1",
  ticketTitle: "제목",
  workspace: { id: "ws", name: "Payments" },
  runner: null,
  agent: "claude",
  state: "running",
  nextStep: "none",
  cancelling: false,
  pausedSince: null,
  summary: { outcome: null, agentResult: null, report: null, startError: null },
  pullRequest: null,
  prReadError: null,
  prReadDiagnosis: null,
  input: null,
  nextActions: { retry: "not-offered", continue: "not-offered" },
};

const runner = {
  id: "r",
  name: "runner",
  cause: null,
  offlineMs: null,
  used: 0,
  capacity: 1,
  usage: null,
  limits: [],
  ghAccounts: null,
};

const mergedPr = {
  displayId: "#7",
  url: "https://example.com/acme/pay/pull/7",
  ci: "success",
  problems: [],
  state: "merged",
  stateSince: { at: "2026-11-25T00:00:00.000Z", agoMs: 60_000 },
  merge: null,
};

const openPr = {
  ...mergedPr,
  state: "open",
  stateSince: null,
  merge: {
    methods: ["squash", "merge"],
    defaultMethod: "squash",
    blocked: "conflict",
    noPermission: false,
    headCommit: "abc123",
  },
};

describe("앱의 응답 검사", () => {
  it("아는 값은 서버 스키마와 같게 읽는다", () => {
    const run = { ...base, state: "queued", queuedReason: { kind: "starting" } };
    expect(appDashboardRunSchema.parse(run)).toEqual(dashboardRunSchema.parse(run));
    expect(appRunDetailSchema.parse(detail)).toEqual(runDetailSchema.parse(detail));
  });

  it("모르는 필드를 버린다", () => {
    const parsed = appDashboardRunSchema.parse({ ...base, state: "running", future: 1 });
    expect(parsed).not.toHaveProperty("future");
  });

  it("모르는 런 상태를 unknown으로 읽는다", () => {
    expect(appDashboardRunSchema.parse({ ...base, state: "archived" }).state).toBe("unknown");
  });

  it("아는 상태인데 필요한 필드가 없으면 unknown으로 숨기지 않고 실패한다", () => {
    expect(appDashboardRunSchema.safeParse({ ...base, state: "queued" }).success).toBe(false);
  });

  it("런 안의 모르는 종류와 enum을 unknown으로 읽는다", () => {
    const run = appDashboardRunSchema.parse({
      ...base,
      todoTag: "future-tag",
      state: "queued",
      queuedReason: { kind: "future-reason" },
      pullRequest: { displayId: "#1", url: "u", problems: [{ kind: "future-problem" }] },
    });
    expect(run.todoTag).toBe("unknown");
    expect(run.pullRequest?.problems).toEqual([{ kind: "unknown" }]);
    expect(run).toMatchObject({ queuedReason: { kind: "unknown" } });
  });

  it("모르는 제어 값은 unknown으로 읽고 잘못된 제어는 숨기지 않고 실패한다", () => {
    const run = appDashboardRunSchema.parse({
      ...base,
      state: "running",
      control: { control: "restart", status: "future" },
    });
    expect(run.control).toEqual({ control: "unknown", status: "unknown" });
    expect(
      appDashboardRunSchema.safeParse({ ...base, state: "running", control: { status: "pending" } })
        .success,
    ).toBe(false);
  });

  it("런 상세의 모르는 값을 unknown으로 읽는다", () => {
    const parsed = appRunDetailSchema.parse({
      ...detail,
      state: "archived",
      nextStep: "future-step",
      input: { kind: "future-input" },
      nextActions: { retry: "future-offer", continue: "future-offer" },
    });
    expect(parsed).toMatchObject({
      state: "unknown",
      nextStep: "unknown",
      input: { kind: "unknown" },
      nextActions: { retry: "unknown", continue: "unknown" },
    });
  });

  it("러너의 모르는 원인·사용량 종류를 unknown으로 읽는다", () => {
    const parsed = appRunnerSchema.parse({
      ...runner,
      cause: "future-cause",
      usage: { kind: "future-usage" },
      limits: [{ provider: "claude", window: "future-window", resetsInMs: null }],
    });
    expect(parsed).toMatchObject({
      cause: "unknown",
      usage: { kind: "unknown" },
      limits: [{ window: "unknown" }],
    });
  });

  it("PR 상태·읽기 실패·진단과 러너 gh 계정을 서버 스키마와 같게 읽는다", () => {
    const withPr = {
      ...detail,
      state: "ended",
      pullRequest: mergedPr,
      prReadError: "no-access",
      prReadDiagnosis: {
        kind: "different",
        runner: "acme-runner",
        runnerLogin: "acme-dev",
        server: { kind: "gh", logins: ["acme-bot"] },
      },
    };
    expect(appRunDetailSchema.parse(withPr)).toEqual(runDetailSchema.parse(withPr));
    const withGh = {
      ...runner,
      ghAccounts: {
        kind: "logged-in",
        readAt: "2026-11-25T00:00:00.000Z",
        agoMs: 0,
        accounts: [{ host: "github.com", login: "acme-dev", active: true, expired: true }],
      },
    };
    expect(appRunnerSchema.parse(withGh)).toEqual(runnerSchema.parse(withGh));
  });

  it("계약 1 서버의 응답은 새 필드 없이 읽고 비어 있다고 본다", () => {
    const { prReadError: _error, prReadDiagnosis: _diagnosis, ...contractOne } = detail;
    const { state: _state, stateSince: _since, merge: _merge, ...contractOnePr } = mergedPr;
    const parsed = appRunDetailSchema.parse({ ...contractOne, pullRequest: contractOnePr });
    expect(parsed).toMatchObject({
      prReadError: null,
      prReadDiagnosis: null,
      pullRequest: { state: null, stateSince: null, merge: null },
    });
    const { ghAccounts: _gh, ...contractOneRunner } = runner;
    expect(appRunnerSchema.parse(contractOneRunner).ghAccounts).toBeUndefined();
    expect(runDetailSchema.safeParse(contractOne).success).toBe(false);
  });

  it("PR 상태·진단·gh 계정의 모르는 값을 unknown으로 읽는다", () => {
    const parsed = appRunDetailSchema.parse({
      ...detail,
      pullRequest: { ...mergedPr, state: "future-state" },
      prReadError: "future-error",
      prReadDiagnosis: { kind: "future-diagnosis" },
    });
    expect(parsed).toMatchObject({
      pullRequest: { state: "unknown" },
      prReadError: "unknown",
      prReadDiagnosis: { kind: "unknown" },
    });
    const diagnosed = appRunDetailSchema.parse({
      ...detail,
      prReadDiagnosis: { kind: "runner-unknown", runner: "r", server: { kind: "future-reader" } },
    });
    expect(diagnosed.prReadDiagnosis).toEqual({
      kind: "runner-unknown",
      runner: "r",
      server: { kind: "unknown" },
    });
    expect(appRunnerSchema.parse({ ...runner, ghAccounts: { kind: "future" } }).ghAccounts).toEqual(
      {
        kind: "unknown",
      },
    );
  });

  it("끝난 런의 To do 에서 빠진 까닭을 서버 스키마와 같게 읽고, 계약 3 서버는 칸이 없다고 본다(0235)", () => {
    const ended = {
      ...base,
      state: "ended",
      summary: "failed",
      agentResult: "timed-out",
      prState: "open",
      prReadError: null,
      todoCleared: "pr-merged",
      endedAt: "2026-11-25T00:00:00.000Z",
      endedAgoMs: 60_000,
    };
    expect(appDashboardRunSchema.parse(ended)).toEqual(dashboardRunSchema.parse(ended));
    expect(appDashboardRunSchema.parse({ ...ended, todoCleared: "future" })).toMatchObject({
      todoCleared: "unknown",
    });
    const { todoCleared: _cleared, ...contractThree } = ended;
    expect(appDashboardRunSchema.parse(contractThree)).not.toHaveProperty("todoCleared");
    expect(dashboardRunSchema.safeParse(contractThree).success).toBe(false);
  });

  it("열린 PR 의 머지 정보를 서버 스키마와 같게 읽는다", () => {
    const withMerge = { ...detail, pullRequest: openPr };
    expect(appRunDetailSchema.parse(withMerge)).toEqual(runDetailSchema.parse(withMerge));
  });

  it("계약 2 서버의 응답은 머지 정보 없이 읽고 머지 버튼이 없다고 본다", () => {
    const { merge: _merge, ...contractTwoPr } = openPr;
    const parsed = appRunDetailSchema.parse({ ...detail, pullRequest: contractTwoPr });
    expect(parsed.pullRequest?.merge).toBeNull();
    expect(runDetailSchema.safeParse({ ...detail, pullRequest: contractTwoPr }).success).toBe(
      false,
    );
  });

  it("모르는 머지 방식은 빼고, 레포 기본이 빠지면 남은 첫 방식을 고른다", () => {
    const parsed = appRunDetailSchema.parse({
      ...detail,
      pullRequest: {
        ...openPr,
        merge: {
          ...openPr.merge,
          methods: ["fast-forward", "merge"],
          defaultMethod: "fast-forward",
          blocked: "future-block",
        },
      },
    });
    expect(parsed.pullRequest?.merge).toEqual({
      methods: ["merge"],
      defaultMethod: "merge",
      blocked: "unknown",
      noPermission: false,
      headCommit: "abc123",
    });
  });

  it("아는 머지 방식이 하나도 없으면 머지 정보를 비운다", () => {
    const parsed = appRunDetailSchema.parse({
      ...detail,
      pullRequest: {
        ...openPr,
        merge: { ...openPr.merge, methods: ["fast-forward"], defaultMethod: "fast-forward" },
      },
    });
    expect(parsed.pullRequest?.merge).toBeNull();
  });

  it("거절에 실린 GitHub 이유 문장을 읽고, 없으면 비운다", () => {
    const meta = { serverVersion: "0.7.0", contractVersion: 3 };
    expect(
      appErrorSchema.parse({ meta, error: { reason: "blocked", message: "Review required" } })
        .error,
    ).toEqual({ reason: "blocked", message: "Review required" });
    expect(appErrorSchema.parse({ meta, error: { reason: "head-changed" } }).error).toEqual({
      reason: "head-changed",
      message: null,
    });
  });

  it("모르는 알림 대상과 거절 이유를 unknown으로 읽는다", () => {
    const record = appNotificationRecordSchema.parse({
      id: 1,
      seq: 1,
      kind: "future-kind",
      target: { kind: "future-target" },
      subject: "제목",
      detail: null,
      createdAt: "2026-11-23T00:00:00.000Z",
      resolvedAt: null,
    });
    expect(record.target.kind).toBe("unknown");
    const refusal = appErrorSchema.parse({
      meta: { serverVersion: "0.5.0", contractVersion: 2 },
      error: { reason: "future-reason" },
    });
    expect(refusal.error.reason).toBe("unknown");
  });
});
