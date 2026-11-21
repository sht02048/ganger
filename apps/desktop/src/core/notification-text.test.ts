import type { NotificationRecord } from "@ganger/app/notifications/feed";
import { describe, expect, it } from "vitest";
import { notificationText } from "./notification-text.js";

function record(
  kind: NotificationRecord["kind"],
  detail: string | null = null,
): NotificationRecord {
  const runner = kind.startsWith("runner-");
  return {
    id: 1,
    seq: 1,
    kind,
    target: runner
      ? { kind: "runner", runnerId: "runner-a" }
      : { kind: "run", runId: "run-1", workspaceId: "ws-1", ticketKey: "ACME-1" },
    subject: runner ? "runner-a" : "ACME-1",
    detail,
    createdAt: "2026-11-19T09:00:00.000Z",
    resolvedAt: null,
  };
}

describe("알림 문구", () => {
  it("제목은 종류 이름, 본문은 무엇을 할지 말한다", () => {
    const text = (kind: NotificationRecord["kind"], detail: string | null = null) =>
      notificationText({ kind: "event", record: record(kind, detail), reminder: false });
    expect(text("question")).toEqual({
      title: "Question",
      body: "ACME-1 에이전트가 답을 기다려요.",
    });
    expect(text("failed")).toEqual({
      title: "Failed",
      body: "ACME-1 런이 실패했어요. 다시 맡길지 확인해 주세요.",
    });
    expect(text("disconnected").title).toBe("Disconnected");
    expect(text("runner-offline")).toEqual({
      title: "Runner Issue",
      body: "runner-a 러너가 Offline이에요.",
    });
    expect(text("runner-auth").body).toBe("runner-a 러너의 GitHub 인증이 깨져 할당에서 빠졌어요.");
    expect(text("runner-usage-limit", "claude").body).toBe(
      "runner-a 러너가 Claude 사용량 한도에 닿았어요.",
    );
  });

  it("다시 알림, 묶음, 놓친 일 문구", () => {
    expect(
      notificationText({ kind: "event", record: record("question"), reminder: true }).body,
    ).toBe("ACME-1 에이전트가 10 min 답을 기다려요.");
    expect(notificationText({ kind: "bundle", count: 5 })).toEqual({
      title: "To do",
      body: "처리할 일 5개가 생겼어요.",
    });
    expect(notificationText({ kind: "missed", count: 2 }).body).toBe(
      "꺼져 있던 동안 처리할 일 2개가 생겼어요.",
    );
  });
});
