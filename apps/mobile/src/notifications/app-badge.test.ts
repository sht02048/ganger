import type { AppDashboard } from "@ganger/api";
import { describe, expect, it } from "vitest";

import { busySnapshot, emptySnapshot } from "../demo/data";
import { appBadgeCount, todoCountOf } from "./app-badge";

const NOW = new Date("2026-11-23T03:00:00.000Z");
const busy: AppDashboard = busySnapshot(NOW).dashboardFor("all");

describe("앱 아이콘 배지 수", () => {
  it("Dashboard 머리의 처리할 일 수(확인·답·멈춤)를 더한다", () => {
    const { check, answer, stopped } = busy.summary.todo;
    expect(todoCountOf(busy)).toBe(check + answer + stopped);
    expect(todoCountOf(busy)).toBeGreaterThan(0);
  });

  it("세그먼트의 처리할 일 수 합과 같다", () => {
    const { running, done } = busy.columns;
    expect(todoCountOf(busy)).toBe(running.todo.length + done.todo.length);
  });

  it("알림을 끈 기기는 0으로 지운다", () => {
    expect(appBadgeCount({ pushEnabled: false, allWorkspaces: busy })).toBe(0);
    expect(appBadgeCount({ pushEnabled: false, allWorkspaces: null })).toBe(0);
  });

  it("알림 설정이나 전체 Dashboard를 아직 모르면 배지를 건드리지 않는다", () => {
    expect(appBadgeCount({ pushEnabled: null, allWorkspaces: busy })).toBeNull();
    expect(appBadgeCount({ pushEnabled: true, allWorkspaces: null })).toBeNull();
  });

  it("처리할 일이 없으면 0이다", () => {
    const empty = emptySnapshot().dashboardFor("all");
    expect(appBadgeCount({ pushEnabled: true, allWorkspaces: empty })).toBe(0);
  });
});
