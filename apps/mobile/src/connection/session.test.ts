import type { V1Dashboard } from "@ganger/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { busySnapshot } from "../demo/data";
import type { ChangeStreamHandlers } from "./change-stream";
import type { V1Client, V1Failure, V1Result } from "./client";
import {
  CHANGE_DEBOUNCE_MS,
  LiveSession,
  POLL_INTERVAL_MS,
  RETRY_MAX_MS,
  STREAM_READY_WAIT_MS,
  STREAM_RETRY_MS,
  STREAM_SILENCE_MS,
} from "./session";
import type { SessionDeps } from "./session";

const NOW = new Date("2026-11-23T03:00:00.000Z");
const dashboard: V1Dashboard = busySnapshot(NOW).dashboardFor("all");
const device = { id: "d", name: "iPhone", createdAt: NOW.toISOString() };

function fakeClient() {
  let failure: V1Failure | null = null;
  const reply = <Data>(data: Data): Promise<V1Result<Data>> =>
    Promise.resolve(
      failure === null ? { ok: true, data, serverVersion: "0.4.0" } : { ok: false, failure },
    );
  const client = {
    dashboard: vi.fn<V1Client["dashboard"]>(() => reply(dashboard)),
    runners: vi.fn<V1Client["runners"]>(() => reply({ runners: [] })),
    workspaces: vi.fn<V1Client["workspaces"]>(() => reply({ workspaces: [] })),
    thisDevice: vi.fn<V1Client["thisDevice"]>(() => reply(device)),
    disconnect: vi.fn<V1Client["disconnect"]>(() => reply({ disconnected: true as const })),
  };
  return { client, fail: (next: V1Failure | null) => (failure = next) };
}

function world(workspaceId = "all", { streamsFail = false } = {}) {
  const fake = fakeClient();
  const streams: ChangeStreamHandlers[] = [];
  const closes: Array<Mock<() => void>> = [];
  const openedAt: number[] = [];
  const onRejected = vi.fn<() => void>();
  const onDashboardRead = vi.fn<NonNullable<SessionDeps["onDashboardRead"]>>();
  const onDashboardConfirmed = vi.fn<NonNullable<SessionDeps["onDashboardConfirmed"]>>();
  const session = new LiveSession(
    {
      client: fake.client,
      openStream: (handlers) => {
        streams.push(handlers);
        openedAt.push(Date.now() - NOW.getTime());
        if (streamsFail) queueMicrotask(() => handlers.onEnd("failed"));
        const close = vi.fn<() => void>();
        closes.push(close);
        return close;
      },
      timeZone: "UTC",
      now: () => Date.now(),
      onRejected,
      onDashboardRead,
      onDashboardConfirmed,
    },
    workspaceId,
  );
  return {
    ...fake,
    session,
    streams,
    closes,
    openedAt,
    onRejected,
    onDashboardRead,
    onDashboardConfirmed,
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

async function foregroundWithoutStream(w: ReturnType<typeof world>) {
  w.session.setForeground(true);
  await vi.advanceTimersByTimeAsync(STREAM_READY_WAIT_MS);
}

async function connect(w: ReturnType<typeof world>) {
  w.session.setForeground(true);
  w.streams.at(-1)?.onReady();
  await settle();
}
const reads = (w: ReturnType<typeof world>) => w.client.dashboard.mock.calls.length;

function requestCounts(w: ReturnType<typeof world>) {
  return {
    dashboard: w.client.dashboard.mock.calls.length,
    workspaces: w.client.workspaces.mock.calls.length,
    runners: w.client.runners.mock.calls.length,
    device: w.client.thisDevice.mock.calls.length,
  };
}

function clearRequests(w: ReturnType<typeof world>) {
  for (const read of [
    w.client.dashboard,
    w.client.workspaces,
    w.client.runners,
    w.client.thisDevice,
  ]) {
    read.mockClear();
  }
}

const NO_REQUESTS = { dashboard: 0, workspaces: 0, runners: 0, device: 0 };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("캐시 복원(M56)", () => {
  const cachedAt = NOW.getTime() - 5 * 60_000;
  const restored = {
    dashboards: new Map([["all", { data: dashboard, fetchedAt: cachedAt }]]),
    workspaces: [{ id: "ws-cached", name: "Cached" }],
  };

  it("복원해도 읽기 전에는 loading이라 띠가 없고 행동 버튼을 켜지 않는다", () => {
    const w = world();
    w.session.restore(restored);
    const state = w.session.getState();
    expect(state.phase).toBe("loading");
    expect(state.actionsReady).toBe(false);
    expect(state.dashboards.get("all")?.fetchedAt).toBe(cachedAt);
    expect(state.workspaces).toEqual(restored.workspaces);
  });

  it("늦게 끝난 복원이 이미 읽은 새 내용을 덮지 않는다", async () => {
    const w = world();
    await connect(w);
    w.session.restore(restored);
    const state = w.session.getState();
    expect(state.phase).toBe("live");
    expect(state.actionsReady).toBe(true);
    expect(state.dashboards.get("all")?.fetchedAt).toBe(NOW.getTime());
    expect(state.fetchedAt).toBe(NOW.getTime());
    expect(state.workspaces).toEqual([]);
  });

  it("복원 뒤 서버에 닿지 않으면 stale로 바뀌고 저장 시각을 유지한다", async () => {
    const w = world();
    w.session.restore(restored);
    w.fail({ kind: "unreachable" });
    await connect(w);
    const state = w.session.getState();
    expect(state.phase).toBe("stale");
    expect(state.actionsReady).toBe(false);
    expect(state.fetchedAt).toBe(cachedAt);
  });
});

describe("행동 버튼을 켜는 때", () => {
  it("읽기가 성공해야 켜고, 뒤로 갔다 돌아오면 다시 읽을 때까지 끈다", async () => {
    const w = world();
    expect(w.session.getState().actionsReady).toBe(false);
    await connect(w);
    expect(w.session.getState().actionsReady).toBe(true);
    w.session.setForeground(false);
    expect(w.session.getState().actionsReady).toBe(false);
    w.session.setForeground(true);
    expect(w.session.getState().actionsReady).toBe(false);
    w.streams.at(-1)?.onReady();
    await settle();
    expect(w.session.getState().actionsReady).toBe(true);
  });

  it("스트림이 말없이 끊기면 다시 읽을 때까지 끈다", async () => {
    const w = world();
    await connect(w);
    expect(w.session.getState().actionsReady).toBe(true);
    w.fail({ kind: "unreachable" });
    await vi.advanceTimersByTimeAsync(STREAM_SILENCE_MS);
    expect(w.session.getState().actionsReady).toBe(false);
    w.fail(null);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(w.session.getState().actionsReady).toBe(true);
  });

  it("끊기기 전에 시작한 읽기의 성공으로는 켜지 않는다", async () => {
    const w = world();
    await connect(w);
    let finishRead: (reply: V1Result<V1Dashboard>) => void = () => undefined;
    w.client.dashboard.mockImplementationOnce(
      () => new Promise((resolve) => (finishRead = resolve)),
    );
    void w.session.refresh();
    w.streams[0]?.onEnd("failed");
    expect(w.session.getState().actionsReady).toBe(false);
    finishRead({ ok: true, data: dashboard, serverVersion: "0.4.0" });
    await Promise.resolve();
    await Promise.resolve();
    expect(w.session.getState().actionsReady).toBe(false);
    await settle();
    expect(w.session.getState().actionsReady).toBe(true);
  });

  it("읽는 동안 쓰기 실패가 와도 다시 읽어 버튼을 되살린다", async () => {
    const w = world();
    await connect(w);
    let finishRead: (reply: V1Result<V1Dashboard>) => void = () => undefined;
    w.client.dashboard.mockImplementationOnce(
      () => new Promise((resolve) => (finishRead = resolve)),
    );
    void w.session.refresh();
    w.session.noteFailure({ kind: "unreachable" });
    finishRead({ ok: true, data: dashboard, serverVersion: "0.4.0" });
    await settle();
    expect(w.session.getState()).toMatchObject({ phase: "live", actionsReady: true });
  });

  it("Workspace를 바꾸면 새로 읽을 때까지 끈다", async () => {
    const w = world();
    await connect(w);
    w.session.setWorkspace("ws-other");
    expect(w.session.getState().actionsReady).toBe(false);
    await settle();
    expect(w.session.getState().actionsReady).toBe(true);
  });

  it("쓰기 실패 뒤 바로 다시 읽어 서버가 돌아오면 버튼을 켠다", async () => {
    const w = world();
    await connect(w);
    w.session.noteFailure({ kind: "unreachable" });
    await settle();
    expect(w.session.getState()).toMatchObject({ phase: "live", actionsReady: true });
  });

  it("쓰기에서 서버에 닿지 않으면 바로 끈다", async () => {
    const w = world();
    await connect(w);
    w.session.noteFailure({ kind: "unreachable" });
    expect(w.session.getState()).toMatchObject({ phase: "stale", actionsReady: false });
  });
});

describe("화면 갱신(M26)", () => {
  it("앞에 있을 때만 변경 기록에 붙고 뒤로 가면 닫는다", async () => {
    const w = world();
    expect(w.streams).toHaveLength(0);
    await connect(w);
    expect(w.streams).toHaveLength(1);
    w.session.setForeground(false);
    expect(w.closes[0]).toHaveBeenCalledOnce();
    const before = reads(w);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(reads(w)).toBe(before);
  });

  it("변경 기록이 오면 묶어서 한 번 다시 읽는다", async () => {
    const w = world();
    await connect(w);
    const before = reads(w);
    w.streams[0]?.onChange(null);
    w.streams[0]?.onChange(null);
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(reads(w)).toBe(before + 1);
  });

  it("변경 기록이 붙어 있으면 폴링하지 않는다", async () => {
    const w = world();
    await connect(w);
    expect(w.session.getState().transport).toBe("stream");
    const before = reads(w);
    w.streams[0]?.onAlive();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(reads(w)).toBe(before);
  });

  it("변경 기록이 끊기면 폴링으로 넘어가고 나중에 다시 붙는다", async () => {
    const w = world();
    await connect(w);
    w.streams[0]?.onEnd("failed");
    await settle();
    expect(w.session.getState().transport).toBe("polling");
    const before = reads(w);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(reads(w)).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS);
    expect(w.streams).toHaveLength(2);
  });

  it("변경 기록이 말없이 멈춰도 폴링으로 넘어간다", async () => {
    const w = world();
    await connect(w);
    await vi.advanceTimersByTimeAsync(STREAM_SILENCE_MS);
    expect(w.closes[0]).toHaveBeenCalled();
    expect(w.session.getState().transport).toBe("polling");
  });
});

describe("연결 상태", () => {
  it("서버에 닿지 않으면 마지막 내용과 받은 때를 남긴다", async () => {
    const w = world();
    await foregroundWithoutStream(w);
    const fetchedAt = w.session.getState().fetchedAt;
    w.fail({ kind: "unreachable" });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const state = w.session.getState();
    expect(state.phase).toBe("stale");
    expect(state.fetchedAt).toBe(fetchedAt);
    expect(state.dashboards.get("all")?.data).toBe(dashboard);
    expect(state.dashboards.get("all")?.fetchedAt).toBe(fetchedAt);
    w.fail(null);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(w.session.getState().phase).toBe("live");
  });

  it("Workspace마다 받은 때를 따로 둔다", async () => {
    const w = world();
    await foregroundWithoutStream(w);
    const firstAt = w.session.getState().dashboards.get("all")?.fetchedAt;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    w.session.setWorkspace("ws-b");
    await settle();
    const state = w.session.getState();
    expect(state.dashboards.get("all")?.fetchedAt).toBe(firstAt);
    expect(state.dashboards.get("ws-b")?.fetchedAt).toBe(state.fetchedAt);
    expect(state.fetchedAt).toBeGreaterThan(firstAt ?? Number.POSITIVE_INFINITY);
  });

  it("서버 오류와 닿지 않음을 가른다", async () => {
    const w = world();
    await foregroundWithoutStream(w);
    w.fail({ kind: "server-error" });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(w.session.getState()).toMatchObject({ phase: "stale", staleReason: "server-error" });
  });

  it("토큰이 거절되면 멈추고 알린다", async () => {
    const w = world();
    await foregroundWithoutStream(w);
    w.fail({ kind: "token-rejected" });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(w.onRejected).toHaveBeenCalledOnce();
    expect(w.closes[0]).toHaveBeenCalled();
    const before = reads(w);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(reads(w)).toBe(before);
  });

  it("Host 403은 토큰 거절이 아니라 연결을 유지한다", async () => {
    const w = world();
    await foregroundWithoutStream(w);
    w.fail({ kind: "host-blocked" });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(w.session.getState().phase).toBe("host-blocked");
    expect(w.onRejected).not.toHaveBeenCalled();
  });

  it("맞지 않는 서버의 버전을 남긴다", async () => {
    const w = world();
    w.fail({ kind: "incompatible", update: "app", serverVersion: "0.3.0" });
    await foregroundWithoutStream(w);
    expect(w.session.getState()).toMatchObject({
      phase: "incompatible",
      serverVersion: "0.3.0",
      neededUpdate: "app",
      actionsReady: false,
    });
  });

  it("읽는 동안 다시 읽기를 요청해도 겹치지 않고 끝난 뒤 한 번 더 읽는다", async () => {
    const w = world();
    let release: (value: V1Result<V1Dashboard>) => void = () => undefined;
    w.client.dashboard.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    w.session.setForeground(true);
    void w.session.refresh();
    void w.session.refresh();
    expect(reads(w)).toBe(1);
    release({ ok: true, data: dashboard, serverVersion: "0.4.0" });
    await settle();
    expect(reads(w)).toBe(2);
  });
});

describe("변경 종류에 맞춰 필요한 만큼만 다시 읽기(티켓 0224)", () => {
  const change = (kind: string, workspaceId: string | null, part: string | null = null) => ({
    kind,
    workspaceId,
    part,
  });

  const withoutQueued: V1Dashboard = {
    ...dashboard,
    columns: { ...dashboard.columns, queued: [] },
  };

  async function countsAfter(
    viewing: string,
    notice: Parameters<ChangeStreamHandlers["onChange"]>[0],
    { queued = false } = {},
  ) {
    const w = world(viewing);
    if (!queued) {
      w.client.dashboard.mockResolvedValue({
        ok: true,
        data: withoutQueued,
        serverVersion: "0.4.0",
      });
    }
    await connect(w);
    clearRequests(w);
    w.streams[0]?.onChange(notice);
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    return requestCounts(w);
  }

  it.each([
    ["보는 Workspace의 런", "ws-a", change("run", "ws-a"), { dashboard: 1, runners: 1 }],
    ["모든 Workspace 보기의 런", "all", change("run", "ws-b"), { dashboard: 1, runners: 1 }],
    ["다른 Workspace의 런(자리 수만 바뀜)", "ws-a", change("run", "ws-b"), { runners: 1 }],
    ["다른 Workspace의 배정", "ws-a", change("assignment", "ws-b"), { runners: 1 }],
    ["런의 log 부분", "ws-a", change("run", "ws-a", "log"), {}],
    ["러너(부하 수치 포함)", "ws-a", change("runner", null), { runners: 1, dashboard: 1 }],
    ["다른 Workspace 목록 변경", "ws-a", change("workspace", "ws-b"), { workspaces: 1 }],
    ["보는 Workspace 변경", "ws-a", change("workspace", "ws-a"), { workspaces: 1, dashboard: 1 }],
    ["설정", "ws-a", change("settings", null), { dashboard: 1, workspaces: 1, runners: 1 }],
    ["트래커", "ws-a", change("tracker", null), {}],
    [
      "모르는 종류",
      "ws-a",
      change("future-kind", "ws-b"),
      { dashboard: 1, workspaces: 1, runners: 1, device: 1 },
    ],
    [
      "reset 또는 읽지 못한 줄",
      "ws-a",
      null,
      { dashboard: 1, workspaces: 1, runners: 1, device: 1 },
    ],
  ])("%s는 필요한 것만 읽는다", async (_name, viewing, notice, expected) => {
    expect(await countsAfter(viewing, notice)).toEqual({ ...NO_REQUESTS, ...expected });
  });

  it("묶인 변경은 범위를 합쳐 한 번 읽는다", async () => {
    const w = world("ws-a");
    await connect(w);
    clearRequests(w);
    w.streams[0]?.onChange(change("run", "ws-a"));
    w.streams[0]?.onChange(change("runner", null));
    w.streams[0]?.onChange(change("run", "ws-b"));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(requestCounts(w)).toEqual({ ...NO_REQUESTS, dashboard: 1, runners: 1 });
  });

  it("보는 Workspace에 대기 런이 있으면 다른 Workspace의 런 변경에도 대기 사유를 위해 대시보드를 읽는다", async () => {
    expect(await countsAfter("ws-a", change("run", "ws-b"), { queued: true })).toEqual({
      ...NO_REQUESTS,
      dashboard: 1,
      runners: 1,
    });
  });

  it("stale 뒤 변경이 오면 서버 내용을 모두 읽어 되살린다", async () => {
    const w = world("ws-a");
    await connect(w);
    w.fail({ kind: "server-error" });
    w.session.noteFailure({ kind: "server-error" });
    await settle();
    expect(w.session.getState().phase).toBe("stale");
    w.fail(null);
    clearRequests(w);
    w.streams[0]?.onChange(change("run", "ws-a"));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(requestCounts(w)).toEqual({ dashboard: 1, workspaces: 1, runners: 1, device: 0 });
    expect(w.session.getState().phase).toBe("live");
  });
});

describe("같은 응답이면 상태를 바꾸지 않기(티켓 0224)", () => {
  it("변경으로 다시 읽은 내용이 같으면 상태도 알림도 그대로다", async () => {
    const w = world();
    await connect(w);
    const before = w.session.getState();
    const listener = vi.fn<() => void>();
    w.session.subscribe(listener);
    await vi.advanceTimersByTimeAsync(5_000);
    w.streams[0]?.onChange(null);
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(reads(w)).toBe(2);
    expect(w.session.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("시간만 흘러 화면의 분 단위가 같으면 그대로 두고, 분이 바뀌면 새로 쓴다", async () => {
    const w = world();
    const queued = dashboard.columns.queued[0];
    if (queued === undefined) throw new Error("demo data has no queued run");
    const startedAt = Date.now();
    const timed = (): V1Dashboard => ({
      ...dashboard,
      columns: {
        ...dashboard.columns,
        queued: [{ ...queued, waitMs: 90_000 + Date.now() - startedAt }],
      },
    });
    w.client.dashboard.mockImplementation(() =>
      Promise.resolve({ ok: true, data: timed(), serverVersion: "0.4.0" }),
    );
    await connect(w);
    const before = w.session.getState();
    await vi.advanceTimersByTimeAsync(20_000);
    w.streams[0]?.onChange(null);
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(w.session.getState()).toBe(before);

    await vi.advanceTimersByTimeAsync(20_000);
    w.streams[0]?.onChange(null);
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(w.session.getState()).not.toBe(before);
  });

  it("내용이 바뀐 부분만 새 값으로 바꾸고 나머지는 그대로 둔다", async () => {
    const w = world();
    await connect(w);
    const before = w.session.getState();
    w.client.runners.mockResolvedValue({
      ok: true,
      data: {
        runners: [
          {
            id: "r1",
            name: "mac",
            cause: null,
            offlineMs: null,
            used: 1,
            capacity: 2,
            usage: null,
            limits: [],
          },
        ],
      },
      serverVersion: "0.4.0",
    });
    w.streams[0]?.onChange({ kind: "runner", workspaceId: null, part: null });
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    const after = w.session.getState();
    expect(after).not.toBe(before);
    expect(after.runners).toHaveLength(1);
    expect(after.dashboards).toBe(before.dashboards);
    expect(after.workspaces).toBe(before.workspaces);
  });

  it("내용이 같으면 캐시에는 받은 때만 알리고, 바뀌면 저장을 맡긴다", async () => {
    const w = world();
    await connect(w);
    expect(w.onDashboardRead).toHaveBeenCalledOnce();
    w.streams[0]?.onChange(null);
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(w.onDashboardRead).toHaveBeenCalledOnce();
    expect(w.onDashboardConfirmed).toHaveBeenCalledOnce();

    w.client.dashboard.mockResolvedValue({
      ok: true,
      data: { ...dashboard, summary: { ...dashboard.summary, inProgress: 99 } },
      serverVersion: "0.4.0",
    });
    w.streams[0]?.onChange(null);
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(w.onDashboardRead).toHaveBeenCalledTimes(2);
  });

  it("같은 내용으로 확인만 한 때도 연결이 끊기면 띠의 받은 때로 쓴다", async () => {
    const w = world();
    await connect(w);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    w.streams[0]?.onChange(null);
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    const confirmedAt = Date.now();
    expect(w.session.getState().dashboards.get("all")?.fetchedAt).toBe(NOW.getTime());

    w.session.noteFailure({ kind: "unreachable" });
    const state = w.session.getState();
    expect(state.phase).toBe("stale");
    expect(state.dashboards.get("all")?.fetchedAt).toBe(confirmedAt);
    expect(state.fetchedAt).toBe(confirmedAt);
  });

  it("직접 다시 읽기를 누르면 내용이 같아도 받은 때를 새로 쓴다", async () => {
    const w = world();
    await connect(w);
    await vi.advanceTimersByTimeAsync(60_000);
    await w.session.refresh();
    expect(w.session.getState().dashboards.get("all")?.fetchedAt).toBe(Date.now());
  });
});

describe("전면 복귀와 연결(티켓 0224)", () => {
  it("앞으로 오면 스트림이 준비될 때 한 번만 읽는다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
    expect(requestCounts(w)).toEqual(NO_REQUESTS);
    w.streams[0]?.onReady();
    await vi.advanceTimersByTimeAsync(STREAM_READY_WAIT_MS * 2);
    expect(requestCounts(w)).toEqual({ dashboard: 1, workspaces: 1, runners: 1, device: 1 });

    w.session.setForeground(false);
    w.session.setForeground(true);
    w.streams[1]?.onReady();
    await vi.advanceTimersByTimeAsync(STREAM_READY_WAIT_MS * 2);
    expect(requestCounts(w)).toEqual({ dashboard: 2, workspaces: 2, runners: 2, device: 2 });
  });

  it("스트림 준비가 늦으면 기다리지 않고 한 번 읽고, 늦게 준비되면 놓친 변경이 없게 한 번 더 읽는다", async () => {
    const w = world();
    w.session.setForeground(true);
    await vi.advanceTimersByTimeAsync(STREAM_READY_WAIT_MS);
    expect(reads(w)).toBe(1);
    expect(w.session.getState().phase).toBe("live");
    w.streams[0]?.onReady();
    await settle();
    expect(reads(w)).toBe(2);
  });

  it("스트림이 바로 끊기면 기다리지 않고 기기 정보까지 한 번 읽는다", async () => {
    const w = world();
    w.session.setForeground(true);
    w.streams[0]?.onEnd("failed");
    await settle();
    expect(requestCounts(w)).toEqual({ dashboard: 1, workspaces: 1, runners: 1, device: 1 });
    await vi.advanceTimersByTimeAsync(STREAM_READY_WAIT_MS);
    expect(reads(w)).toBe(1);
  });

  it("뒤로 가면 기다리던 읽기와 타이머를 모두 거둔다", async () => {
    const w = world();
    await connect(w);
    w.streams[0]?.onChange(null);
    w.session.setForeground(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS * 3);
    expect(reads(w)).toBe(1);
  });
});

describe("서버에 닿지 않을 때 다시 시도 간격(티켓 0224)", () => {
  it("폴링은 15→30→60→60초로 늘고, 성공하면 15초로 돌아간다", async () => {
    const w = world("all", { streamsFail: true });
    const at: number[] = [];
    w.client.dashboard.mockImplementation(() => {
      at.push(Date.now() - NOW.getTime());
      return Promise.resolve({ ok: false, failure: { kind: "unreachable" } });
    });
    w.session.setForeground(true);
    await vi.advanceTimersByTimeAsync(165_000);
    expect(at).toEqual([0, 15_000, 45_000, 105_000, 165_000]);

    w.client.dashboard.mockImplementation(() => {
      at.push(Date.now() - NOW.getTime());
      return Promise.resolve({ ok: true, data: dashboard, serverVersion: "0.4.0" });
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(at.at(-1)).toBe(225_000);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(at.at(-1)).toBe(240_000);
  });

  it("스트림 다시 붙기도 15→30→60초로 늘고, 준비되면 처음 간격으로 돌아간다", async () => {
    const w = world("all", { streamsFail: true });
    w.fail({ kind: "unreachable" });
    w.session.setForeground(true);
    await vi.advanceTimersByTimeAsync(225_000);
    expect(w.openedAt).toEqual([0, 15_000, 45_000, 105_000, 165_000, 225_000]);
  });

  it("스트림이 한 번 준비되면 다음 끊김은 다시 15초 뒤에 붙는다", async () => {
    const w = world();
    w.session.setForeground(true);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      w.streams.at(-1)?.onEnd("failed");
      await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    }
    w.streams.at(-1)?.onReady();
    await settle();
    const opened = w.openedAt.length;
    const readyAt = Date.now() - NOW.getTime();
    w.streams.at(-1)?.onEnd("failed");
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS);
    expect(w.openedAt.slice(opened)).toEqual([readyAt + STREAM_RETRY_MS]);
  });
});
