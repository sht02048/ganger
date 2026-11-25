// @vitest-environment jsdom
import { APP_CONTRACT_VERSION, CONTRACT_VERSION, V1_PATHS, connectionQrText } from "@ganger/api";
import type { V1Dashboard } from "@ganger/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { busySnapshot } from "../demo/data";
import { pushDevice as webPushDevice } from "../notifications/push-device.web";
import { todoCountOf } from "../notifications/app-badge";
import { FirstPaintReady } from "../startup/first-paint";
import { SPLASH_MAX_MS, createSplashGate } from "../startup/splash-gate";
import { EMPTY_PUSH_MEMORY } from "../notifications/push-port";
import type { PushDevicePort, PushMemory } from "../notifications/push-port";
import { AppRoot } from "./app-root";
import { IDENTITY_PATH } from "./client";
import type { FetchLike } from "./client";
import type { CacheFiles } from "./offline-cache";
import { POLL_INTERVAL_MS, RETRY_MAX_MS } from "./session";
import type { ConnectionStore, StoredConnection } from "./stored-connection";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const NOW = new Date("2026-11-23T03:00:00.000Z");
const SERVER = "https://ganger.example.com";
const META = { serverVersion: "0.4.0", contractVersion: CONTRACT_VERSION };
const STORED: StoredConnection = { server: SERVER, token: "stored-token", deviceId: "d" };

type Mode = "ok" | "offline" | "revoked" | "host-blocked" | "old-server" | "old-app";

function fakeServer() {
  const state: {
    mode: Mode;
    requests: Array<{ path: string; method: string }>;
    dashboard: V1Dashboard;
    pushEnabled: boolean;
  } = {
    mode: "ok",
    pushEnabled: false,
    requests: [],
    dashboard: busySnapshot(NOW).dashboardFor("all"),
  };
  const ok = (data: unknown) => Response.json({ meta: META, data });
  const fetcher: FetchLike = (url, init) => {
    const { pathname: path } = new URL(url);
    const method = init?.method ?? "GET";
    state.requests.push({ path, method });
    if (state.mode === "offline") return Promise.reject(new TypeError("offline"));
    if (path === IDENTITY_PATH) {
      return Promise.resolve(Response.json({ product: "ganger", webAccess: "host-not-allowed" }));
    }
    if (path === V1_PATHS.changeStream) return Promise.resolve(new Response("", { status: 503 }));
    if (state.mode === "host-blocked") {
      return Promise.resolve(new Response("Blocked", { status: 403 }));
    }
    if (state.mode === "revoked") {
      return Promise.resolve(
        Response.json({ meta: META, error: { reason: "invalid-token" } }, { status: 401 }),
      );
    }
    if (state.mode === "old-server") {
      return Promise.resolve(new Response("", { status: 404 }));
    }
    if (state.mode === "old-app") {
      return Promise.resolve(
        Response.json({
          meta: { ...META, minClientContractVersion: APP_CONTRACT_VERSION + 1 },
          data: {},
        }),
      );
    }
    switch (path) {
      case V1_PATHS.thisDeviceNotifications:
        return Promise.resolve(
          ok({
            enabled: state.pushEnabled,
            hasPushAddress: state.pushEnabled,
            groups: {
              question: true,
              permission: true,
              humanCheckRequest: true,
              failedDisconnected: true,
              runnerIssue: true,
            },
          }),
        );
      case V1_PATHS.connect:
        return Promise.resolve(ok({ deviceId: "new", token: "new-token" }));
      case V1_PATHS.dashboard:
        return Promise.resolve(ok(state.dashboard));
      case V1_PATHS.runners:
        return Promise.resolve(ok({ runners: busySnapshot(NOW).runners }));
      case V1_PATHS.workspaces:
        return Promise.resolve(ok({ workspaces: [{ id: "ws-payments", name: "Payments" }] }));
      case V1_PATHS.thisDevice:
        return Promise.resolve(
          method === "DELETE"
            ? ok({ disconnected: true })
            : ok({ id: "d", name: "Acme iPhone", createdAt: NOW.toISOString() }),
        );
      default:
        throw new Error(`unexpected request: ${path}`);
    }
  };
  return { state, fetcher };
}

function memoryStore(initial: StoredConnection | null) {
  let value = initial;
  const failing = { save: false, clear: false };
  const store: ConnectionStore = {
    load: () => Promise.resolve(value),
    save: (next) => {
      if (failing.save) return Promise.reject(new Error("keychain"));
      value = next;
      return Promise.resolve();
    },
    clear: () => {
      if (failing.clear) return Promise.reject(new Error("keychain"));
      value = null;
      return Promise.resolve();
    },
  };
  return { store, failing, current: () => value };
}

const memoryPush: PushMemory = {
  load: () => Promise.resolve(EMPTY_PUSH_MEMORY),
  save: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};

function memoryCacheFiles() {
  const saved = new Map<string, string>();
  const files: CacheFiles = {
    read: (server) => Promise.resolve(saved.get(server) ?? null),
    write: (server, text) => {
      saved.set(server, text);
      return Promise.resolve();
    },
    remove: (server) => {
      saved.delete(server);
      return Promise.resolve();
    },
    removeAll: () => {
      saved.clear();
      return Promise.resolve();
    },
  };
  return { files, saved };
}

const mounted: Array<() => void> = [];

async function mount(
  store: ConnectionStore,
  fetcher: FetchLike,
  devConnection: { server: string; token: string } | null = null,
  cacheFiles: CacheFiles = memoryCacheFiles().files,
  markFirstPaint: () => void = () => undefined,
  pushDevice: PushDevicePort = webPushDevice,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <FirstPaintReady.Provider value={markFirstPaint}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
          }}
        >
          <AppRoot
            store={store}
            fetcher={fetcher}
            devConnection={devConnection}
            deviceName="Acme iPhone"
            pushDevice={pushDevice}
            pushMemory={memoryPush}
            cacheFiles={cacheFiles}
            allowPaste
          />
        </SafeAreaProvider>
      </FirstPaintReady.Provider>,
    );
    await vi.advanceTimersByTimeAsync(0);
  });
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const byLabel = (label: string) => document.body.querySelector(`[aria-label="${label}"]`);

async function press(label: string) {
  const element = byLabel(label);
  if (element === null) throw new Error(`no element: ${label}`);
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function paste(text: string) {
  const input = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="QR 내용 붙여 넣기(개발용)"]',
  );
  if (input === null) throw new Error("no paste field");
  await act(async () => {
    Reflect.set(HTMLInputElement.prototype, "value", text, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
});

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  vi.useRealTimers();
});

describe("디스크 캐시(M56)", () => {
  async function seededCache() {
    const cache = memoryCacheFiles();
    const server = fakeServer();
    await mount(memoryStore(STORED).store, server.fetcher, null, cache.files);
    for (const unmount of mounted.splice(0)) unmount();
    return cache;
  }

  it("서버에 닿지 않고 켜면 캐시와 n분 전 기준 띠를 보이고 행동 버튼을 끈다", async () => {
    const cache = await seededCache();
    await advance(5 * 60_000);
    const server = fakeServer();
    server.state.mode = "offline";
    const host = await mount(memoryStore(STORED).store, server.fetcher, null, cache.files);
    await advance(0);
    expect(host.textContent).toContain("ACME-138");
    expect(host.textContent).toContain("서버에 닿지 않아요 · 5분 전 기준");
    const answer = document.body.querySelector('[aria-label^="답하기"]');
    expect(answer?.getAttribute("aria-disabled")).toBe("true");
  });

  it("켤 때 캐시를 띠 없이 보이고 새 내용으로 바꾼 뒤, 닿지 않으면 띠를 보이고 버튼을 끈다", async () => {
    const cache = await seededCache();
    const server = fakeServer();
    let holding = true;
    let answer: (response: Response) => void = () => undefined;
    const held: FetchLike = (url, init) =>
      holding && new URL(url).pathname === V1_PATHS.dashboard
        ? new Promise((resolve) => (answer = resolve))
        : server.fetcher(url, init);
    const host = await mount(memoryStore(STORED).store, held, null, cache.files);
    expect(host.textContent).toContain("ACME-138");
    expect(host.textContent).not.toContain("기준");
    const renamed = JSON.stringify(busySnapshot(NOW).dashboardFor("all")).replaceAll(
      "ACME-138",
      "ACME-999",
    );
    const fresh: unknown = JSON.parse(renamed);
    await act(async () => {
      holding = false;
      answer(Response.json({ meta: META, data: fresh }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.textContent).toContain("ACME-999");
    expect(host.textContent).not.toContain("ACME-138");
    expect(host.textContent).not.toContain("기준");
    server.state.mode = "offline";
    await advance(POLL_INTERVAL_MS);
    expect(host.textContent).toContain("ACME-999");
    expect(host.textContent).toContain("기준");
    const action = document.body.querySelector('[aria-label^="답하기"]');
    expect(action?.getAttribute("aria-disabled")).toBe("true");
  });

  it("캐시 폴더를 지우지 못해도 연결 화면을 보인다", async () => {
    const server = fakeServer();
    const files: CacheFiles = {
      ...memoryCacheFiles().files,
      removeAll: () => {
        throw new Error("delete failed");
      },
    };
    const host = await mount(memoryStore(null).store, server.fetcher, null, files);
    expect(host.textContent).toContain("서버에 연결해요");
  });

  it("캐시 폴더를 지우지 못해도 새 연결을 끊지 않는다", async () => {
    const server = fakeServer();
    const memory = memoryStore(null);
    const files: CacheFiles = {
      ...memoryCacheFiles().files,
      removeAll: () => {
        throw new Error("delete failed");
      },
    };
    const host = await mount(memory.store, server.fetcher, null, files);
    await paste(connectionQrText({ server: SERVER, code: "code-1" }));
    await press("붙여 넣은 내용으로 연결");
    expect(memory.current()?.token).toBe("new-token");
    expect(server.state.requests).not.toContainEqual({
      path: V1_PATHS.thisDevice,
      method: "DELETE",
    });
    expect(host.textContent).toContain("Dashboard");
  });

  it("호환되지 않는 서버면 캐시와 업데이트 안내를 함께 보이고 행동 버튼을 끈다", async () => {
    const cache = await seededCache();
    const server = fakeServer();
    server.state.mode = "old-app";
    const host = await mount(memoryStore(STORED).store, server.fetcher, null, cache.files);
    await advance(0);
    expect(host.textContent).toContain("ACME-138");
    expect(host.textContent).toContain("앱을 업데이트해 주세요.");
    const answer = document.body.querySelector('[aria-label^="답하기"]');
    expect(answer?.getAttribute("aria-disabled")).toBe("true");
  });

  it("토큰이 거절되면 그 서버의 캐시를 지운다", async () => {
    const cache = await seededCache();
    expect(cache.saved.has(SERVER)).toBe(true);
    const server = fakeServer();
    server.state.mode = "revoked";
    await mount(memoryStore(STORED).store, server.fetcher, null, cache.files);
    await advance(0);
    expect(cache.saved.has(SERVER)).toBe(false);
  });

  it("연결을 끊으면 그 서버의 캐시를 지운다", async () => {
    const cache = await seededCache();
    const server = fakeServer();
    await mount(memoryStore(STORED).store, server.fetcher, null, cache.files);
    await press("설정");
    await press("이 기기 연결 끊기");
    await advance(0);
    expect(cache.saved.has(SERVER)).toBe(false);
  });

  it("캐시로 켠 뒤 러너를 읽지 못했으면 러너가 없다고 말하지 않는다", async () => {
    const cache = await seededCache();
    const server = fakeServer();
    server.state.mode = "offline";
    const host = await mount(memoryStore(STORED).store, server.fetcher, null, cache.files);
    await advance(0);
    const runners = document.body.querySelector('[aria-label^="Runners"]');
    if (runners === null) throw new Error("no Runners button");
    await act(async () => {
      runners.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.textContent).toContain("러너 정보를 불러오지 못했어요.");
    expect(host.textContent).not.toContain("아직 러너가 없어요.");
  });

  it("캐시 파일에 기기 토큰을 넣지 않는다", async () => {
    const cache = await seededCache();
    expect(cache.saved.get(SERVER)).not.toContain(STORED.token);
  });
});

describe("연결", () => {
  it("저장한 연결이 없으면 연결 화면을 보이고 QR 내용으로 연결해 토큰을 저장한다", async () => {
    const server = fakeServer();
    const memory = memoryStore(null);
    const host = await mount(memory.store, server.fetcher);
    expect(host.textContent).toContain("서버에 연결해요");
    await paste(connectionQrText({ server: SERVER, code: "code-1" }));
    await press("붙여 넣은 내용으로 연결");
    expect(memory.current()).toEqual({ server: SERVER, token: "new-token", deviceId: "new" });
    expect(host.textContent).toContain("Dashboard");
    expect(host.textContent).toContain("ACME-138");
  });

  it("토큰을 저장하지 못하면 방금 만든 기기를 지우고 다시 연결하라고 알린다", async () => {
    const server = fakeServer();
    const memory = memoryStore(null);
    memory.failing.save = true;
    const host = await mount(memory.store, server.fetcher);
    await paste(connectionQrText({ server: SERVER, code: "code-1" }));
    await press("붙여 넣은 내용으로 연결");
    expect(server.state.requests).toContainEqual({ path: V1_PATHS.thisDevice, method: "DELETE" });
    expect(host.textContent).toContain("이 기기에 연결을 저장하지 못했어요");
    expect(host.textContent).not.toContain("ACME-138");
  });

  it("Ganger QR이 아니면 요청을 보내지 않고 알린다", async () => {
    const server = fakeServer();
    const host = await mount(memoryStore(null).store, server.fetcher);
    await paste("https://example.com");
    await press("붙여 넣은 내용으로 연결");
    expect(host.textContent).toContain("Ganger 기기 연결 QR이 아니에요.");
    expect(server.state.requests).toEqual([]);
  });

  it("개발 빌드 연결은 QR 없이 dev 서버에 붙고 토큰을 저장하지 않는다", async () => {
    const server = fakeServer();
    const memory = memoryStore(null);
    const host = await mount(memory.store, server.fetcher, {
      server: "http://127.0.0.1:3000",
      token: "dev-token",
    });
    expect(host.textContent).toContain("ACME-138");
    expect(memory.current()).toBeNull();
  });
});

describe("연결 끊기와 거절", () => {
  it("이 기기 연결을 끊으면 서버에서 지우고 연결 화면으로 돌아간다", async () => {
    const server = fakeServer();
    const memory = memoryStore(STORED);
    const host = await mount(memory.store, server.fetcher);
    await press("설정");
    await press("이 기기 연결 끊기");
    expect(server.state.requests).toContainEqual({ path: V1_PATHS.thisDevice, method: "DELETE" });
    expect(memory.current()).toBeNull();
    expect(host.textContent).toContain("이 기기 연결을 끊었어요.");
  });

  it("서버에 닿지 않으면 끊었다고 하지 않고 이 기기에서만 지우는 길을 준다", async () => {
    const server = fakeServer();
    const memory = memoryStore(STORED);
    const host = await mount(memory.store, server.fetcher);
    await press("설정");
    server.state.mode = "offline";
    await press("이 기기 연결 끊기");
    expect(memory.current()).toEqual(STORED);
    expect(host.textContent).toContain("연결을 끊지 못했어요");
    await press("이 기기에서만 지우기");
    expect(memory.current()).toBeNull();
    expect(host.textContent).toContain("서버에 연결해요");
  });

  it("이 기기에서 지우기가 실패하면 끊었다고 하지 않고 연결 화면으로 가지 않는다", async () => {
    const server = fakeServer();
    const memory = memoryStore(STORED);
    const host = await mount(memory.store, server.fetcher);
    await press("설정");
    server.state.mode = "offline";
    await press("이 기기 연결 끊기");
    memory.failing.clear = true;
    await press("이 기기에서만 지우기");
    expect(memory.current()).toEqual(STORED);
    expect(host.textContent).toContain("이 기기에서 연결을 지우지 못했어요");
    expect(host.textContent).not.toContain("서버에 연결해요");
  });

  it("기기를 지워 토큰이 거절되면 연결을 지우고 연결 화면으로 돌아간다", async () => {
    const server = fakeServer();
    const memory = memoryStore(STORED);
    const host = await mount(memory.store, server.fetcher);
    server.state.mode = "revoked";
    await advance(POLL_INTERVAL_MS);
    expect(memory.current()).toBeNull();
    expect(host.textContent).toContain("이 기기의 연결이 지워졌어요");
  });

  it("Host 403은 연결을 지우지 않고 서버 맥의 주소 설정을 안내한다", async () => {
    const server = fakeServer();
    const memory = memoryStore(STORED);
    const host = await mount(memory.store, server.fetcher);
    server.state.mode = "host-blocked";
    await advance(POLL_INTERVAL_MS);
    expect(memory.current()).toEqual(STORED);
    expect(host.textContent).toContain("서버 맥의 Settings › 다른 기기에서 열 주소를 고쳐 주세요");
    expect(host.textContent).toContain("ACME-138");
  });

  it("최소 버전보다 낮은 서버를 안내한다", async () => {
    const server = fakeServer();
    server.state.mode = "old-server";
    const host = await mount(memoryStore(STORED).store, server.fetcher);
    expect(host.textContent).toContain("서버 맥의 Ganger를 업데이트해 주세요.");
  });

  it("서버가 이 앱을 더 받지 않으면 앱 업데이트를 안내한다", async () => {
    const server = fakeServer();
    server.state.mode = "old-app";
    const host = await mount(memoryStore(STORED).store, server.fetcher);
    expect(host.textContent).toContain("앱을 업데이트해 주세요.");
  });
});

describe("화면 갱신", () => {
  it("새 데이터가 와도 처음 연 칸을 바꾸지 않는다", async () => {
    const server = fakeServer();
    const board = busySnapshot(NOW).dashboardFor("all");
    const host = await mount(memoryStore(STORED).store, server.fetcher);
    const selected = () =>
      host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";
    expect(selected()).toContain("Running");
    server.state.dashboard = {
      ...board,
      columns: { ...board.columns, running: { todo: [], rest: board.columns.running.rest } },
    };
    await advance(POLL_INTERVAL_MS);
    expect(host.textContent).not.toContain("ACME-138");
    expect(selected()).toContain("Running");
  });
});

describe("서버에 닿지 않을 때(M31)", () => {
  it("다른 Workspace로 가면 그 Workspace가 받은 때를 띠에 쓰고, 받은 적 없으면 그렇게 말한다", async () => {
    const server = fakeServer();
    const host = await mount(memoryStore(STORED).store, server.fetcher);
    await advance(10 * 60_000);
    server.state.mode = "offline";
    await advance(POLL_INTERVAL_MS);
    await press("Workspace 고르기, 모든 Workspace");
    await press("Payments");
    expect(host.textContent).toContain("이 Workspace는 아직 받은 내용이 없어요.");
    expect(byLabel("다시 시도")).not.toBeNull();
    expect(host.querySelector('[data-testid="notice-band"]')?.textContent).toBe(
      "서버에 닿지 않아요",
    );
  });

  it("n분 전 기준 띠를 보이고 행동 버튼을 끄며 쓰기를 쌓지 않는다", async () => {
    const server = fakeServer();
    const host = await mount(memoryStore(STORED).store, server.fetcher);
    expect(byLabel("답하기")?.getAttribute("aria-disabled")).not.toBe("true");
    server.state.mode = "offline";
    await advance(3 * 60_000);
    expect(host.querySelector('[data-testid="notice-band"]')?.textContent).toContain("3분 전 기준");
    expect(host.textContent).toContain("ACME-138");
    expect(byLabel("답하기")?.getAttribute("aria-disabled")).toBe("true");
    await press("답하기");
    server.state.mode = "ok";
    await advance(RETRY_MAX_MS);
    expect(host.querySelector('[data-testid="notice-band"]')).toBeNull();
    expect(server.state.requests.filter((request) => request.method !== "GET")).toEqual([]);
  });
});

describe("앱 아이콘 배지", () => {
  function badgeDevice() {
    const counts: number[] = [];
    const device: PushDevicePort = {
      ...webPushDevice,
      setBadgeCount: (count) => {
        counts.push(count);
        return Promise.resolve();
      },
    };
    return { device, counts };
  }

  it("알림을 켠 기기는 전체 Workspace Dashboard의 처리할 일 수를 배지로 단다", async () => {
    const server = fakeServer();
    server.state.pushEnabled = true;
    const { device, counts } = badgeDevice();
    await mount(memoryStore(STORED).store, server.fetcher, null, undefined, undefined, device);
    const todo = todoCountOf(server.state.dashboard);
    expect(todo).toBeGreaterThan(0);
    expect(counts.at(-1)).toBe(todo);
  });

  it("알림을 끈 기기는 배지를 지운다", async () => {
    const { device, counts } = badgeDevice();
    await mount(
      memoryStore(STORED).store,
      fakeServer().fetcher,
      null,
      undefined,
      undefined,
      device,
    );
    expect(counts).toContain(0);
    expect(counts.every((count) => count === 0)).toBe(true);
  });

  it("연결을 끊으면 배지를 지운다", async () => {
    const server = fakeServer();
    server.state.pushEnabled = true;
    const { device, counts } = badgeDevice();
    await mount(memoryStore(STORED).store, server.fetcher, null, undefined, undefined, device);
    expect(counts.at(-1)).toBeGreaterThan(0);
    await press("설정");
    await press("이 기기 연결 끊기");
    expect(counts.at(-1)).toBe(0);
  });

  it("연결 화면과 데모 모드에서는 배지를 지운다", async () => {
    const { device, counts } = badgeDevice();
    await mount(memoryStore(null).store, fakeServer().fetcher, null, undefined, undefined, device);
    expect(counts).toEqual([0]);
    await press("데모로 둘러보기");
    expect(counts).toEqual([0, 0]);
  });
});

describe("첫 화면과 스플래시(티켓 0226)", () => {
  function fakeSplash() {
    const splash = { hides: 0, hide: () => (splash.hides += 1) };
    return splash;
  }

  async function seededCache() {
    const cache = memoryCacheFiles();
    await mount(memoryStore(STORED).store, fakeServer().fetcher, null, cache.files);
    await press("Workspace 고르기, 모든 Workspace");
    await press("Payments");
    for (const unmount of mounted.splice(0)) unmount();
    await advance(0);
    return cache;
  }

  function never<Value>(): Promise<Value> {
    return new Promise(() => undefined);
  }

  it("저장된 연결과 캐시 첫 화면이 보이면 서버 응답을 기다리지 않고 스플래시를 내린다", async () => {
    const cache = await seededCache();
    const splash = fakeSplash();
    const gate = createSplashGate(splash);
    const server = fakeServer();
    const held: FetchLike = (url, init) =>
      new URL(url).pathname === V1_PATHS.dashboard ? never() : server.fetcher(url, init);
    const host = await mount(memoryStore(STORED).store, held, null, cache.files, gate.ready);
    expect(host.textContent).toContain("ACME-138");
    expect(splash.hides).toBe(1);
    await advance(SPLASH_MAX_MS);
    expect(splash.hides).toBe(1);
  });

  it("캐시를 다 읽기 전에는 스플래시를 내리지 않는다", async () => {
    const cache = await seededCache();
    const splash = fakeSplash();
    const gate = createSplashGate(splash);
    let release: () => void = () => undefined;
    const slowFiles: CacheFiles = {
      ...cache.files,
      read: (server) =>
        new Promise((resolve) => {
          release = () => void cache.files.read(server).then(resolve);
        }),
    };
    const server = fakeServer();
    const held: FetchLike = (url, init) =>
      new URL(url).pathname === V1_PATHS.dashboard ? never() : server.fetcher(url, init);
    const host = await mount(memoryStore(STORED).store, held, null, slowFiles, gate.ready);
    await advance(SPLASH_MAX_MS / 2);
    expect(splash.hides).toBe(0);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.textContent).toContain("ACME-138");
    expect(splash.hides).toBe(1);
  });

  it("저장된 연결이 없으면 연결 화면을 보인 뒤 스플래시를 내린다", async () => {
    const splash = fakeSplash();
    const gate = createSplashGate(splash);
    const host = await mount(
      memoryStore(null).store,
      fakeServer().fetcher,
      null,
      memoryCacheFiles().files,
      gate.ready,
    );
    expect(host.textContent).toContain("서버에 연결해요");
    expect(splash.hides).toBe(1);
  });

  it("연결 정보를 읽지 못하고 있으면 상한 시간에 스플래시를 내린다", async () => {
    const splash = fakeSplash();
    const gate = createSplashGate(splash);
    const stuck: ConnectionStore = { ...memoryStore(null).store, load: () => never() };
    await mount(stuck, fakeServer().fetcher, null, memoryCacheFiles().files, gate.ready);
    await advance(SPLASH_MAX_MS - 1);
    expect(splash.hides).toBe(0);
    await advance(1);
    expect(splash.hides).toBe(1);
  });

  it("오프라인으로 켜도 다른 Workspace의 캐시 대시보드를 그 Workspace로 갈 때 꺼내 보인다", async () => {
    const cache = await seededCache();
    const server = fakeServer();
    server.state.mode = "offline";
    const host = await mount(memoryStore(STORED).store, server.fetcher, null, cache.files);
    await press("Workspace 고르기, 모든 Workspace");
    await press("Payments");
    expect(host.textContent).not.toContain("이 Workspace는 아직 받은 내용이 없어요.");
    expect(host.textContent).toContain("ACME-138");
    expect(host.querySelector('[data-testid="notice-band"]')?.textContent).toContain("기준");
  });
});
