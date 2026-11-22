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
  STREAM_RETRY_MS,
  STREAM_SILENCE_MS,
} from "./session";

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

function world() {
  const fake = fakeClient();
  const streams: ChangeStreamHandlers[] = [];
  const closes: Array<Mock<() => void>> = [];
  const onRejected = vi.fn<() => void>();
  const session = new LiveSession(
    {
      client: fake.client,
      openStream: (handlers) => {
        streams.push(handlers);
        const close = vi.fn<() => void>();
        closes.push(close);
        return close;
      },
      timeZone: "UTC",
      now: () => Date.now(),
      onRejected,
    },
    "all",
  );
  return { ...fake, session, streams, closes, onRejected };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const reads = (w: ReturnType<typeof world>) => w.client.dashboard.mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("행동 버튼을 켜는 때", () => {
  it("읽기가 성공해야 켜고, 뒤로 갔다 돌아오면 다시 읽을 때까지 끈다", async () => {
    const w = world();
    expect(w.session.getState().actionsReady).toBe(false);
    w.session.setForeground(true);
    await settle();
    expect(w.session.getState().actionsReady).toBe(true);
    w.session.setForeground(false);
    expect(w.session.getState().actionsReady).toBe(false);
    w.session.setForeground(true);
    expect(w.session.getState().actionsReady).toBe(false);
    await settle();
    expect(w.session.getState().actionsReady).toBe(true);
  });

  it("스트림이 말없이 끊기면 다시 읽을 때까지 끈다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
    w.streams[0]?.onReady();
    await settle();
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
    w.session.setForeground(true);
    await settle();
    w.streams[0]?.onReady();
    await settle();
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
    w.session.setForeground(true);
    await settle();
    w.streams[0]?.onReady();
    await settle();
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
    w.session.setForeground(true);
    await settle();
    w.session.setWorkspace("ws-other");
    expect(w.session.getState().actionsReady).toBe(false);
    await settle();
    expect(w.session.getState().actionsReady).toBe(true);
  });

  it("쓰기 실패 뒤 바로 다시 읽어 서버가 돌아오면 버튼을 켠다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
    w.session.noteFailure({ kind: "unreachable" });
    await settle();
    expect(w.session.getState()).toMatchObject({ phase: "live", actionsReady: true });
  });

  it("쓰기에서 서버에 닿지 않으면 바로 끈다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
    w.session.noteFailure({ kind: "unreachable" });
    expect(w.session.getState()).toMatchObject({ phase: "stale", actionsReady: false });
  });
});

describe("화면 갱신(M26)", () => {
  it("앞에 있을 때만 변경 기록에 붙고 뒤로 가면 닫는다", async () => {
    const w = world();
    expect(w.streams).toHaveLength(0);
    w.session.setForeground(true);
    await settle();
    expect(w.streams).toHaveLength(1);
    w.session.setForeground(false);
    expect(w.closes[0]).toHaveBeenCalledOnce();
    const before = reads(w);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(reads(w)).toBe(before);
  });

  it("변경 기록이 오면 묶어서 한 번 다시 읽는다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
    w.streams[0]?.onReady();
    await settle();
    const before = reads(w);
    w.streams[0]?.onChange();
    w.streams[0]?.onChange();
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(reads(w)).toBe(before + 1);
  });

  it("변경 기록이 붙어 있으면 폴링하지 않는다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
    w.streams[0]?.onReady();
    await settle();
    expect(w.session.getState().transport).toBe("stream");
    const before = reads(w);
    w.streams[0]?.onAlive();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(reads(w)).toBe(before);
  });

  it("변경 기록이 끊기면 폴링으로 넘어가고 나중에 다시 붙는다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
    w.streams[0]?.onReady();
    await settle();
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
    w.session.setForeground(true);
    await settle();
    w.streams[0]?.onReady();
    await settle();
    await vi.advanceTimersByTimeAsync(STREAM_SILENCE_MS);
    expect(w.closes[0]).toHaveBeenCalled();
    expect(w.session.getState().transport).toBe("polling");
  });
});

describe("연결 상태", () => {
  it("서버에 닿지 않으면 마지막 내용과 받은 때를 남긴다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
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
    w.session.setForeground(true);
    await settle();
    const firstAt = w.session.getState().dashboards.get("all")?.fetchedAt;
    w.session.setWorkspace("ws-b");
    await settle();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const state = w.session.getState();
    expect(state.dashboards.get("all")?.fetchedAt).toBe(firstAt);
    expect(state.dashboards.get("ws-b")?.fetchedAt).toBe(state.fetchedAt);
    expect(state.fetchedAt).toBeGreaterThan(firstAt ?? Number.POSITIVE_INFINITY);
  });

  it("서버 오류와 닿지 않음을 가른다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
    w.fail({ kind: "server-error" });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(w.session.getState()).toMatchObject({ phase: "stale", staleReason: "server-error" });
  });

  it("토큰이 거절되면 멈추고 알린다", async () => {
    const w = world();
    w.session.setForeground(true);
    await settle();
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
    w.session.setForeground(true);
    await settle();
    w.fail({ kind: "host-blocked" });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(w.session.getState().phase).toBe("host-blocked");
    expect(w.onRejected).not.toHaveBeenCalled();
  });

  it("맞지 않는 서버의 버전을 남긴다", async () => {
    const w = world();
    w.fail({ kind: "incompatible", serverVersion: "0.3.0" });
    w.session.setForeground(true);
    await settle();
    expect(w.session.getState()).toMatchObject({ phase: "incompatible", serverVersion: "0.3.0" });
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
