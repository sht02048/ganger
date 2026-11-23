import type { AppNotificationRecord } from "@ganger/api";
import { describe, expect, it } from "vitest";

import type { DashboardRun } from "../dashboard/model";
import {
  OPEN_SHEET_ACTION,
  destinationOf,
  notificationsToDismiss,
  parseBackgroundPush,
  pushOpenOf,
  sheetKindFor,
  toGroups,
  toPreferences,
} from "./push-data";

const record = (target: AppNotificationRecord["target"]): AppNotificationRecord => ({
  id: 7,
  seq: 7,
  kind: "question",
  target,
  subject: "제목",
  detail: null,
  createdAt: "2026-11-23T00:00:00.000Z",
  resolvedAt: null,
});
const runWith = (todoTag: DashboardRun["todoTag"]) => ({ todoTag });

describe("알림 눌러서 열기(M16, M22)", () => {
  it("본문을 누르면 런 상세, 버튼을 누르면 그 시트를 연다", () => {
    expect(
      pushOpenOf({ device: "d", eventId: 7 }, "expo.modules.notifications.actions.DEFAULT"),
    ).toEqual({
      kind: "event",
      device: "d",
      eventId: 7,
      action: false,
    });
    expect(pushOpenOf({ device: "d", eventId: 7 }, OPEN_SHEET_ACTION)).toMatchObject({
      action: true,
    });
    expect(sheetKindFor(runWith("question"), true)).toBe("answer");
    expect(sheetKindFor(runWith("human-check"), true)).toBe("human-check");
    expect(sheetKindFor(runWith("question"), false)).toBe("detail");
  });

  it("이미 처리돼 꼬리표가 바뀐 런은 버튼을 눌러도 상세를 연다", () => {
    expect(sheetKindFor(runWith(null), true)).toBe("detail");
  });

  it("묶음은 처리할 일로, 러너 사건은 Runners 로, 못 읽은 사건은 Dashboard 로 간다", () => {
    expect(pushOpenOf({ device: "d", bundleId: "bundle-1" }, "x")).toEqual({
      kind: "todo",
      device: "d",
    });
    expect(destinationOf(record({ kind: "runner", runnerId: "r" }), false)).toEqual({
      screen: "runners",
    });
    expect(destinationOf(null, true)).toEqual({ screen: "dashboard", todoOnly: false, run: null });
    expect(
      destinationOf(
        record({ kind: "run", runId: "run-1", workspaceId: "w", ticketKey: "ACME-1" }),
        true,
      ),
    ).toMatchObject({ run: { id: "run-1", action: true } });
  });

  it("모르는 모양과 지우기 푸시는 열지 않는다", () => {
    expect(pushOpenOf({ device: "d", eventId: "7" }, "x")).toBeNull();
    expect(pushOpenOf({ device: "d", clear: ["event-1"] }, "x")).toBeNull();
  });
});

describe("조용한 푸시로 지우기(M33)", () => {
  it("백그라운드 페이로드의 dataString 을 읽는다", () => {
    expect(
      parseBackgroundPush({
        data: { dataString: JSON.stringify({ device: "d", clear: ["event-1"] }) },
      }),
    ).toEqual({ device: "d", clear: ["event-1"] });
    expect(parseBackgroundPush({ data: { dataString: "{" } })).toBeNull();
    expect(parseBackgroundPush(null)).toBeNull();
  });

  it("이 기기의 지울 사건과 묶음만 고르고 다른 서버의 같은 번호는 남긴다", () => {
    expect(
      notificationsToDismiss(
        [
          { identifier: "a", data: { device: "d", eventId: 1 } },
          { identifier: "b", data: { device: "d", eventId: 2 } },
          { identifier: "c", data: { device: "d", bundleId: "bundle-3" } },
          { identifier: "d", data: { other: true } },
          { identifier: "e", data: { device: "other-server", eventId: 1 } },
        ],
        { device: "d", clear: ["event-1", "bundle-3"] },
      ),
    ).toEqual(["a", "c"]);
  });
});

describe("종류별 켜기 이름", () => {
  it("앱의 humanCheck 와 서버의 humanCheckRequest 를 오간다", () => {
    const groups = {
      question: true,
      permission: false,
      humanCheckRequest: false,
      failedDisconnected: true,
      runnerIssue: true,
    };
    const preferences = toPreferences(true, groups);
    expect(preferences.kinds.humanCheck).toBe(false);
    expect(toGroups(preferences)).toEqual(groups);
  });
});
