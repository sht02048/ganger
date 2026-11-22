import { describe, expect, it } from "vitest";
import { DeviceLink, deviceTokenStore, registerDesktop } from "./device-link.js";
import type { RegisterResult, TokenCipher } from "./device-link.js";
import type { AppSettings, SettingsStore } from "./settings.js";

const ORIGIN = "http://127.0.0.1:4000";

function memorySettings(initial: AppSettings = {}): SettingsStore & { value: AppSettings } {
  const store = {
    value: initial,
    read: () => store.value,
    write: (next: AppSettings) => {
      store.value = next;
    },
  };
  return store;
}

const reversingCipher: TokenCipher = {
  isAvailable: () => true,
  encrypt: (text) => `sealed:${Buffer.from(text).toString("base64")}`,
  decrypt: (sealed) => {
    if (!sealed.startsWith("sealed:")) throw new Error("cannot open");
    return Buffer.from(sealed.slice("sealed:".length), "base64").toString();
  },
};

function linkWith(settings: SettingsStore, results: RegisterResult[], cipher = reversingCipher) {
  const registers: string[] = [];
  const link = new DeviceLink({
    store: deviceTokenStore(settings, cipher),
    identify: () => Promise.resolve("instance-1"),
    register: (origin) => {
      registers.push(origin);
      return Promise.resolve(results.shift() ?? { kind: "failed" });
    },
  });
  return { link, registers };
}

describe("데스크톱 기기 연결(M48)", () => {
  it("저장한 토큰이 없으면 처음 한 번 자동 등록하고 암호화해 저장한다", async () => {
    const settings = memorySettings();
    const { link, registers } = linkWith(settings, [{ kind: "registered", token: "token-1" }]);

    expect(await link.connection(ORIGIN)).toEqual({ kind: "token", token: "token-1" });
    expect(await link.connection(ORIGIN)).toEqual({ kind: "token", token: "token-1" });

    expect(registers).toHaveLength(1);
    expect(JSON.stringify(settings.value)).not.toContain("token-1");
  });

  it("저장한 토큰이 있으면 다시 켜도 등록하지 않는다", async () => {
    const settings = memorySettings();
    await linkWith(settings, [{ kind: "registered", token: "token-1" }]).link.connection(ORIGIN);
    const restarted = linkWith(settings, []);

    expect(await restarted.link.connection(ORIGIN)).toEqual({ kind: "token", token: "token-1" });
    expect(restarted.registers).toEqual([]);
  });

  it("저장한 토큰을 풀 수 없으면 조용히 등록하지 않고 거절로 알린다", async () => {
    const settings = memorySettings({ deviceTokens: { "instance-1": "broken" } });
    const { link, registers } = linkWith(settings, [{ kind: "registered", token: "new" }]);

    expect(await link.connection(ORIGIN)).toEqual({ kind: "rejected" });
    expect(registers).toEqual([]);
  });

  it("사용자가 다시 연결을 누르면 새 토큰으로 바꾼다", async () => {
    const settings = memorySettings();
    const { link, registers } = linkWith(settings, [
      { kind: "registered", token: "token-1" },
      { kind: "registered", token: "token-2" },
    ]);
    await link.connection(ORIGIN);

    expect(await link.reconnect(ORIGIN)).toBe(true);

    expect(registers).toHaveLength(2);
    expect(await link.connection(ORIGIN)).toEqual({ kind: "token", token: "token-2" });
  });

  it("암호화를 쓸 수 없으면 토큰을 파일에 두지 않고 메모리에만 둔다", async () => {
    const settings = memorySettings();
    const cipher = { ...reversingCipher, isAvailable: () => false };
    const { link } = linkWith(settings, [{ kind: "registered", token: "token-1" }], cipher);

    expect(await link.connection(ORIGIN)).toEqual({ kind: "token", token: "token-1" });
    expect(settings.value.deviceTokens).toBeUndefined();
  });

  it("v1 이 없는 옛 서버는 옛 경로로, 등록 실패는 나중에 다시 시도로 돌린다", async () => {
    const legacy = linkWith(memorySettings(), [{ kind: "unsupported" }]);
    expect(await legacy.link.connection(ORIGIN)).toEqual({ kind: "legacy" });
    const failed = linkWith(memorySettings(), [{ kind: "failed" }]);
    expect(await failed.link.connection(ORIGIN)).toEqual({ kind: "unavailable" });
  });
});

describe("자동 등록 요청", () => {
  const respond = (status: number, body: string): typeof fetch => {
    return () => Promise.resolve(new Response(body, { status }));
  };

  it("토큰을 읽고, 없는 경로는 옛 서버로, 서버 오류는 실패로 본다", async () => {
    const meta = { serverVersion: "0.5.0", contractVersion: 1 };
    const ok = JSON.stringify({ meta, data: { deviceId: "d", token: "t" } });
    expect(await registerDesktop(ORIGIN, "Mac", respond(200, ok))).toEqual({
      kind: "registered",
      token: "t",
    });
    expect(await registerDesktop(ORIGIN, "Mac", respond(404, ""))).toEqual({ kind: "unsupported" });
    expect(await registerDesktop(ORIGIN, "Mac", respond(500, ""))).toEqual({ kind: "failed" });
  });
});
