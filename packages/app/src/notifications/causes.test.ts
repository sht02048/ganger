import { toRunnerId, toRunnerKind } from "@ganger/core";
import type { ProviderUsage } from "@ganger/core";
import type { StoredRunner } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { partitionHome } from "../home/model.js";
import { notificationCauses } from "./causes.js";
import { parseAfter } from "./feed.js";

const now = new Date(Date.UTC(2026, 11, 19, 9, 0));
const minutes = (value: number) => new Date(now.getTime() + value * 60_000);
const emptyPage = partitionHome({
  workspace: { kind: "none" },
  runs: [],
  runners: { list: [] },
  doneToday: [],
  endedRecently: [],
});

function runner(id: string, overrides: Partial<StoredRunner> = {}): StoredRunner {
  return {
    id: toRunnerId(id),
    kind: toRunnerKind("fake"),
    name: id,
    config: {},
    capacity: 1,
    online: true,
    assignmentBlocked: false,
    prerequisites: null,
    mailbox: null,
    checkedAt: minutes(-1),
    checkError: null,
    offlineSince: null,
    providerUsage: null,
    load: null,
    ghAccounts: null,
    projects: [],
    ...overrides,
  };
}

const atLimit: ProviderUsage = {
  provider: "claude",
  status: "ok",
  windows: [{ kind: "session", usedPercent: 100, resetsAt: minutes(60) }],
};

describe("Runner Issue 알림 원인", () => {
  it("Offline, GitHub 인증 깨짐, 공급자 사용량 한도를 원인으로 낸다", () => {
    const causes = notificationCauses(
      emptyPage,
      [
        runner("offline", { online: false }),
        runner("auth", { assignmentBlocked: true }),
        runner("limit", {
          providerUsage: { readAt: minutes(-1), reading: { kind: "read", providers: [atLimit] } },
        }),
        runner("fine"),
      ],
      now,
    );
    expect(causes.map((cause) => [cause.kind, cause.cause, cause.detail])).toEqual([
      ["runner-offline", "runner-offline:offline", null],
      ["runner-auth", "runner-auth:auth", null],
      ["runner-usage-limit", "runner-usage-limit:limit:claude", "claude"],
    ]);
  });

  it("한 번도 점검하지 않은 러너와 Offline 러너의 다른 원인은 내지 않는다", () => {
    const causes = notificationCauses(
      emptyPage,
      [
        runner("new", { online: false, checkedAt: null }),
        runner("down", { online: false, assignmentBlocked: true }),
      ],
      now,
    );
    expect(causes.map((cause) => cause.cause)).toEqual(["runner-offline:down"]);
  });

  it("오래된 사용량 값은 한도로 보지 않는다", () => {
    const causes = notificationCauses(
      emptyPage,
      [
        runner("stale", {
          providerUsage: { readAt: minutes(-60), reading: { kind: "read", providers: [atLimit] } },
        }),
      ],
      now,
    );
    expect(causes).toEqual([]);
  });
});

describe("이어 받을 번호 읽기", () => {
  it("음이 아닌 정수만 받고 나머지는 처음부터로 본다", () => {
    expect(parseAfter("12")).toBe(12);
    expect(parseAfter(" 3 ")).toBe(3);
    expect(parseAfter(null)).toBeNull();
    expect(parseAfter("")).toBeNull();
    expect(parseAfter("-1")).toBeNull();
    expect(parseAfter("1.5")).toBeNull();
    expect(parseAfter("abc")).toBeNull();
  });
});
