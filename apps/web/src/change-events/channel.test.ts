import type { QueryKey } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANGE_BATCH_MS,
  CHANGE_REOPEN_MS,
  CHANGE_SILENCE_MS,
  ChangeChannel,
  DISCONNECTED_POLL_MS,
  EVENT_SOURCE_CLOSED,
  EVENT_SOURCE_OPEN,
  SHOWN_REFRESH_AFTER_MS,
} from "./channel";
import type { ChangeEventSource } from "./channel";

const CONNECTING = 0;

class FakeEventSource implements ChangeEventSource {
  readyState = CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly #listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = EVENT_SOURCE_CLOSED;
  }

  open(): void {
    this.readyState = EVENT_SOURCE_OPEN;
    this.onopen?.(new Event("open"));
  }

  emit(type: string, data: unknown, id?: number): void {
    const event = new MessageEvent<string>(type, {
      data: JSON.stringify(data),
      lastEventId: id === undefined ? "" : String(id),
    });
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }

  fail(readyState: number): void {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }
}

interface Harness {
  sources: FakeEventSource[];
  invalidated: QueryKey[][];
  resets: number;
  refetches: number;
  channel: ChangeChannel;
  latest(): FakeEventSource;
}

function start(after: number | null): Harness {
  const sources: FakeEventSource[] = [];
  const harness: Harness = {
    sources,
    invalidated: [],
    resets: 0,
    refetches: 0,
    channel: new ChangeChannel({
      after,
      open: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
      target: {
        invalidate: (keys) => harness.invalidated.push([...keys]),
        invalidateAll: () => {
          harness.resets += 1;
        },
        refetchVisible: () => {
          harness.refetches += 1;
        },
      },
    }),
    latest: () => {
      const source = sources.at(-1);
      if (source === undefined) throw new Error("no event source");
      return source;
    },
  };
  harness.channel.start();
  return harness;
}

const runChange = (targetId: string) => ({
  kind: "run",
  targetId,
  workspaceId: "ws-1",
  part: null,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("변경 기록 구독(스펙 0003 5.3·5.4·5.5)", () => {
  it("첫 연결은 서버 렌더가 넘긴 번호로 이어 받는다", () => {
    const h = start(41);
    expect(h.latest().url).toBe("/api/change-events/stream?after=41");
    h.channel.close();
  });

  it("번호를 받지 못했으면 번호 없이 연결해 서버의 지금 번호부터 받는다", () => {
    const h = start(null);
    expect(h.latest().url).toBe("/api/change-events/stream");
    h.channel.close();
  });

  it("한 번에 온 줄은 모아 한 번 무효화한다", () => {
    const h = start(0);
    h.latest().open();
    h.latest().emit("ready", { seq: 0 }, 0);
    h.latest().emit("change", runChange("run-1"), 1);
    h.latest().emit("change", runChange("run-2"), 2);
    h.latest().emit("change", { ...runChange("run-2"), part: "log" }, 3);
    expect(h.invalidated).toEqual([]);

    vi.advanceTimersByTime(CHANGE_BATCH_MS);
    expect(h.invalidated).toHaveLength(1);
    expect(h.invalidated[0]).toContainEqual(["runs", "detail"]);
    expect(h.invalidated[0]).toContainEqual(["dashboard"]);
    expect(h.channel.lastSeq).toBe(3);
    h.channel.close();
  });

  it("모르는 모양의 줄은 버린다", () => {
    const h = start(0);
    h.latest().emit("change", { kind: "nope" }, 1);
    vi.advanceTimersByTime(CHANGE_BATCH_MS);
    expect(h.invalidated).toEqual([]);
    h.channel.close();
  });

  it("reset을 받으면 모든 query를 무효화하고, 모아 둔 줄은 버린다", () => {
    const h = start(5);
    h.latest().emit("change", runChange("run-1"), 6);
    h.latest().emit("reset", { seq: 9 }, 9);
    vi.advanceTimersByTime(CHANGE_BATCH_MS);
    expect(h.resets).toBe(1);
    expect(h.invalidated).toEqual([]);
    expect(h.channel.lastSeq).toBe(9);
    h.channel.close();
  });

  it("오류 뒤 연결이 열려 있지 않으면 30초마다 보이는 query를 다시 읽고, 다시 붙으면 멈춘다", () => {
    const h = start(0);
    h.latest().open();
    h.latest().fail(CONNECTING);
    expect(h.channel.disconnected).toBe(true);

    vi.advanceTimersByTime(DISCONNECTED_POLL_MS * 2);
    expect(h.refetches).toBe(2);

    h.latest().open();
    expect(h.channel.disconnected).toBe(false);
    vi.advanceTimersByTime(DISCONNECTED_POLL_MS * 2);
    expect(h.refetches).toBe(2);
    h.channel.close();
  });

  it("열린 채 오류를 알리면(곧 다시 붙음) 끊김으로 치지 않는다", () => {
    const h = start(0);
    h.latest().open();
    h.latest().fail(EVENT_SOURCE_OPEN);
    expect(h.channel.disconnected).toBe(false);
    h.channel.close();
  });

  it("브라우저가 다시 붙지 않는 닫힘이면 마지막 번호로 직접 다시 연결한다", () => {
    const h = start(3);
    h.latest().open();
    h.latest().emit("change", runChange("run-1"), 7);
    h.latest().fail(EVENT_SOURCE_CLOSED);
    expect(h.channel.disconnected).toBe(true);
    expect(h.sources).toHaveLength(1);

    vi.advanceTimersByTime(CHANGE_REOPEN_MS);
    expect(h.sources).toHaveLength(2);
    expect(h.latest().url).toBe("/api/change-events/stream?after=7");

    h.latest().open();
    expect(h.channel.disconnected).toBe(false);
    h.channel.close();
  });

  it("하트비트도 없이 조용하면 끊김으로 보고 다시 연결하며, 그동안 30초마다 다시 읽는다", () => {
    const h = start(0);
    h.latest().open();
    vi.advanceTimersByTime(CHANGE_SILENCE_MS - 1);
    h.latest().emit("heartbeat", null);
    vi.advanceTimersByTime(CHANGE_SILENCE_MS - 1);
    expect(h.channel.disconnected).toBe(false);

    vi.advanceTimersByTime(1);
    expect(h.channel.disconnected).toBe(true);
    expect(h.sources[0]?.closed).toBe(true);

    vi.advanceTimersByTime(DISCONNECTED_POLL_MS);
    expect(h.refetches).toBe(1);
    expect(h.sources.length).toBeGreaterThan(1);
    h.channel.close();
  });

  it("숨은 탭은 연결을 닫고(모아 둔 줄은 먼저 무효화), 다시 보이면 마지막 번호로 이어 받는다", () => {
    const h = start(3);
    h.latest().open();
    h.latest().emit("change", runChange("run-1"), 8);
    h.latest().fail(0);

    h.channel.hide();
    expect(h.invalidated).toHaveLength(1);
    expect(h.sources[0]?.closed).toBe(true);
    expect(h.channel.disconnected).toBe(false);
    vi.advanceTimersByTime(CHANGE_SILENCE_MS + DISCONNECTED_POLL_MS * 2);
    expect(h.refetches).toBe(0);
    expect(h.sources).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    h.channel.show();
    expect(h.sources).toHaveLength(2);
    expect(h.latest().url).toBe("/api/change-events/stream?after=8");
    h.channel.show();
    expect(h.sources).toHaveLength(2);
    h.channel.close();
  });

  describe("다시 볼 때 오래 못 들었으면 다시 읽기(티켓 0210)", () => {
    it("1분 넘게 숨었다 다시 보이면 이어 받으면서 보이는 query도 한 번 다시 읽는다", () => {
      const h = start(3);
      h.latest().open();
      h.channel.hide();
      vi.advanceTimersByTime(SHOWN_REFRESH_AFTER_MS + 1);

      h.channel.show();
      h.channel.show();

      expect(h.sources).toHaveLength(2);
      expect(h.refetches).toBe(1);
      h.channel.close();
    });

    it("1분 안에 다시 보이면 이어 받기만 하고 따로 다시 읽지 않는다", () => {
      const h = start(3);
      h.latest().open();
      h.channel.hide();
      vi.advanceTimersByTime(SHOWN_REFRESH_AFTER_MS - 1);

      h.channel.show();

      expect(h.sources).toHaveLength(2);
      expect(h.refetches).toBe(0);
      h.channel.close();
    });

    it("하트비트를 받고 있는 연결은 포커스를 얻어도 건드리지 않는다", () => {
      const h = start(3);
      h.latest().open();
      for (let beat = 0; beat < 8; beat += 1) {
        vi.advanceTimersByTime(15_000);
        h.latest().emit("heartbeat", null);
      }

      h.channel.show();

      expect(h.sources).toHaveLength(1);
      expect(h.refetches).toBe(0);
      h.channel.close();
    });

    it("잠듦으로 타이머가 멈춘 채 시계만 1분 넘게 흘렀으면, 보이는 채로 포커스를 얻을 때 다시 붙고 다시 읽는다", () => {
      const h = start(3);
      h.latest().open();
      h.latest().emit("change", runChange("run-1"), 8);
      vi.setSystemTime(Date.now() + SHOWN_REFRESH_AFTER_MS * 10);

      h.channel.show();

      expect(h.invalidated).toHaveLength(1);
      expect(h.sources[0]?.closed).toBe(true);
      expect(h.sources).toHaveLength(2);
      expect(h.latest().url).toBe("/api/change-events/stream?after=8");
      expect(h.refetches).toBe(1);
      h.channel.show();
      expect(h.sources).toHaveLength(2);
      expect(h.refetches).toBe(1);
      h.channel.close();
    });
  });

  it("닫으면 연결과 타이머를 모두 거둔다", () => {
    const h = start(0);
    h.latest().fail(CONNECTING);
    h.channel.close();
    expect(h.latest().closed).toBe(true);
    vi.advanceTimersByTime(DISCONNECTED_POLL_MS * 3);
    expect(h.refetches).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
