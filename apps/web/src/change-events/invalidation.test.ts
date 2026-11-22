import { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { CHANGE_KINDS } from "@ganger/db/change-events-model";
import type { ChangeKind } from "@ganger/db/change-events-model";
import { describe, expect, it } from "vitest";
import { invalidatedKeysOf } from "./invalidation";
import type { ReceivedChange } from "./invalidation";
import { queryClientTarget } from "./subscription";

const SCREEN_KEYS: ReadonlyArray<QueryKey> = [
  ["shell"],
  ["dashboard", "", "Asia/Seoul"],
  ["runs", "list", { ws: "", ended: false }, "Asia/Seoul"],
  ["runs", "detail", "run-1"],
  ["runs", "detail", "run-2"],
  ["runners", "list"],
  ["runners", "checks-pending"],
  ["stats", "", 7, "Asia/Seoul"],
  ["tickets", "runs", ""],
  ["tracker", "tickets", ""],
  ["tracker", "labels", "conn-1", "tp-1"],
  ["settings", "general", ""],
];

const EXPECTED: Record<ChangeKind, ReadonlyArray<string>> = {
  run: [
    "dashboard",
    "runs.list",
    "runs.detail.run-1",
    "runs.detail.run-2",
    "runners.list",
    "stats",
    "tickets.runs",
    "settings",
  ],
  assignment: [
    "dashboard",
    "runs.list",
    "runs.detail.run-1",
    "runs.detail.run-2",
    "runners.list",
    "stats",
    "tickets.runs",
    "settings",
  ],
  runner: [
    "shell",
    "dashboard",
    "runs.list",
    "runs.detail.run-1",
    "runs.detail.run-2",
    "runners.list",
    "stats",
    "tickets.runs",
    "settings",
  ],
  workspace: [
    "shell",
    "dashboard",
    "runs.list",
    "runs.detail.run-1",
    "runs.detail.run-2",
    "runners.list",
    "stats",
    "tickets.runs",
    "settings",
  ],
  settings: [
    "dashboard",
    "runs.list",
    "runs.detail.run-1",
    "runs.detail.run-2",
    "stats",
    "tickets.runs",
    "settings",
  ],
  tracker: ["tracker.tickets", "tracker.labels"],
};

function label(key: QueryKey): string {
  const [first, second, third] = key;
  if (first === "runs" && second === "detail") return `runs.detail.${String(third)}`;
  if (first === "runs" || first === "runners" || first === "tickets" || first === "tracker")
    return `${String(first)}.${String(second)}`;
  return String(first);
}

function seededClient(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
  for (const key of SCREEN_KEYS) queryClient.setQueryData(key, "cached");
  return queryClient;
}

function invalidatedLabels(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => label(query.queryKey))
    .toSorted();
}

const change = (kind: ChangeKind, part: ReceivedChange["part"] = null): ReceivedChange => ({
  kind,
  targetId: kind === "run" ? "run-1" : "target-1",
  workspaceId: null,
  part,
});

describe("기기 목록", () => {
  it("설정 변경이면 Settings 키와 겹치지 않는 기기 목록 키를 다시 읽는다", () => {
    const keys = invalidatedKeysOf([
      { kind: "settings", targetId: null, workspaceId: null, part: null },
    ]);
    expect(keys).toContainEqual(["devices"]);
  });
});

describe("변경 기록 → query key 무효화(스펙 0003 5.4)", () => {
  it.for(CHANGE_KINDS)("%s 줄은 표의 key만 무효화한다", (kind) => {
    const queryClient = seededClient();
    queryClientTarget(queryClient).invalidate(invalidatedKeysOf([change(kind)]));
    expect(invalidatedLabels(queryClient)).toEqual(EXPECTED[kind].toSorted());
  });

  it("로그 요청과 그 결과 줄은 그 런의 상세만 무효화한다", () => {
    const queryClient = seededClient();
    queryClientTarget(queryClient).invalidate(invalidatedKeysOf([change("run", "log")]));
    expect(invalidatedLabels(queryClient)).toEqual(["runs.detail.run-1"]);
  });

  it("reset은 모든 query를 무효화한다", () => {
    const queryClient = seededClient();
    queryClientTarget(queryClient).invalidateAll();
    expect(invalidatedLabels(queryClient)).toHaveLength(SCREEN_KEYS.length);
  });

  it("한 번에 온 줄은 key를 모으고, 접두사에 덮이는 key는 빼서 한 번씩만 무효화한다", () => {
    expect(invalidatedKeysOf([change("run"), change("run"), change("run", "log")])).toEqual([
      ["runs", "detail"],
      ["runs", "list"],
      ["dashboard"],
      ["tickets", "runs"],
      ["runners", "list"],
      ["stats"],
      ["settings"],
    ]);
    expect(invalidatedKeysOf([change("run"), change("runner")])).toEqual([
      ["dashboard"],
      ["tickets", "runs"],
      ["runners", "list"],
      ["stats"],
      ["settings"],
      ["shell"],
      ["runs"],
    ]);
  });
});
