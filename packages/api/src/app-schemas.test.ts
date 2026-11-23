import { describe, expect, it } from "vitest";

import {
  appDashboardRunSchema,
  appErrorSchema,
  appNotificationRecordSchema,
  appRunDetailSchema,
  appRunnerSchema,
} from "./app-schemas.js";
import { dashboardRunSchema } from "./dashboard.js";
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
  input: null,
  nextActions: { retry: "not-offered", continue: "not-offered" },
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
      id: "r",
      name: "runner",
      cause: "future-cause",
      offlineMs: null,
      used: 0,
      capacity: 1,
      usage: { kind: "future-usage" },
      limits: [{ provider: "claude", window: "future-window", resetsInMs: null }],
    });
    expect(parsed).toMatchObject({
      cause: "unknown",
      usage: { kind: "unknown" },
      limits: [{ window: "unknown" }],
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
