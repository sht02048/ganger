// @vitest-environment jsdom
import { CONTRACT_VERSION, V1_PATHS, connectionQrText } from "@ganger/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { busySnapshot } from "../demo/data";
import { AppRoot } from "./app-root";
import { IDENTITY_PATH } from "./client";
import type { FetchLike } from "./client";
import { POLL_INTERVAL_MS } from "./session";
import type { ConnectionStore, StoredConnection } from "./stored-connection";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const NOW = new Date("2026-11-23T03:00:00.000Z");
const SERVER = "https://ganger.example.com";
const META = { serverVersion: "0.4.0", contractVersion: CONTRACT_VERSION };
const STORED: StoredConnection = { server: SERVER, token: "stored-token", deviceId: "d" };

type Mode = "ok" | "offline" | "revoked" | "host-blocked" | "old-server";

function fakeServer() {
  const state: { mode: Mode; requests: Array<{ path: string; method: string }> } = {
    mode: "ok",
    requests: [],
  };
  const ok = (data: unknown) => Response.json({ meta: META, data });
  const fetcher: FetchLike = (url, init) => {
    const { pathname: path } = new URL(url);
    const method = init?.method ?? "GET";
    state.requests.push({ path, method });
    if (state.mode === "offline") return Promise.reject(new TypeError("offline"));
    if (path === IDENTITY_PATH) {
      return Promise.resolve(Response.json({ webAccess: "host-not-allowed" }));
    }
    if (path === V1_PATHS.changeStream) return new Promise(() => undefined);
    if (state.mode === "host-blocked") {
      return Promise.resolve(new Response("Blocked", { status: 403 }));
    }
    if (state.mode === "revoked") {
      return Promise.resolve(
        Response.json({ meta: META, error: { reason: "invalid-token" } }, { status: 401 }),
      );
    }
    if (state.mode === "old-server") {
      return Promise.resolve(
        Response.json({ meta: { ...META, serverVersion: "0.3.0" }, data: {} }),
      );
    }
    switch (path) {
      case V1_PATHS.connect:
        return Promise.resolve(ok({ deviceId: "new", token: "new-token" }));
      case V1_PATHS.dashboard:
        return Promise.resolve(ok(busySnapshot(NOW).dashboardFor("all")));
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
  const store: ConnectionStore = {
    load: () => Promise.resolve(value),
    save: (next) => {
      value = next;
      return Promise.resolve();
    },
    clear: () => {
      value = null;
      return Promise.resolve();
    },
  };
  return { store, current: () => value };
}

const mounted: Array<() => void> = [];

async function mount(
  store: ConnectionStore,
  fetcher: FetchLike,
  devConnection: { server: string; token: string } | null = null,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
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
          allowPaste
        />
      </SafeAreaProvider>,
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
    expect(host.textContent).toContain("서버 맥의 Settings › 주소를 고쳐 주세요");
    expect(host.textContent).toContain("ACME-138");
  });

  it("최소 버전보다 낮은 서버를 안내한다", async () => {
    const server = fakeServer();
    server.state.mode = "old-server";
    const host = await mount(memoryStore(STORED).store, server.fetcher);
    expect(host.textContent).toContain(
      "서버 0.3.0은 이 앱과 맞지 않아요. 0.4.0 이상으로 올려 주세요.",
    );
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
    await advance(POLL_INTERVAL_MS);
    expect(host.querySelector('[data-testid="notice-band"]')).toBeNull();
    expect(server.state.requests.filter((request) => request.method !== "GET")).toEqual([]);
  });
});
