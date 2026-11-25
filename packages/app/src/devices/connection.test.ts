import { parseConnectionQr } from "@ganger/api";
import { listDevices, migrate, openDatabase, removeDevice } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { ENROLLMENT_TTL_MS } from "../runner-setup/enrollment.js";
import {
  DesktopRegistrations,
  DeviceConnectionCodes,
  authenticateDevice,
  connectDevice,
  loadDevicesView,
  registerDesktop,
  removeDeviceById,
  startDeviceConnection,
} from "./connection.js";
import { DeviceStreams } from "./streams.js";

const at = new Date("2026-11-23T00:00:00.000Z");
const SERVER = "https://ganger.example.com";

function world(clock = { now: at.getTime() }) {
  const db = openDatabase(":memory:");
  migrate(db);
  const codes = new DeviceConnectionCodes({ now: () => clock.now });
  return { db, codes, clock };
}

function issuedCode(codes: DeviceConnectionCodes): string {
  const started = startDeviceConnection({ codes, webAddress: SERVER });
  if (!started.ok) throw new Error("QR을 만들지 못했다");
  const qr = parseConnectionQr(started.qr);
  if (qr === null) throw new Error("QR을 읽지 못했다");
  return qr.code;
}

function connected(context: ReturnType<typeof world>) {
  const reply = connectDevice(context, { code: issuedCode(context.codes), name: "iPhone" }, at);
  if (reply.status !== 200) throw new Error("연결하지 못했다");
  return reply.result;
}

describe("기기 연결 코드", () => {
  it("러너 등록 토큰과 같은 10분을 살고 QR에 서버 주소를 싣는다", () => {
    const { codes } = world();
    const started = startDeviceConnection({ codes, webAddress: SERVER });
    expect(started).toMatchObject({ ok: true, expiresInMs: ENROLLMENT_TTL_MS });
    if (!started.ok) return;
    const qr = parseConnectionQr(started.qr);
    expect(qr?.server).toBe(SERVER);
    expect(qr?.code).toHaveLength(32);
  });

  it.each([null, "", "http://ganger.example.com"])(
    "다른 기기에서 열 주소가 %j이면 코드를 만들지 않는다",
    (webAddress) => {
      const { codes } = world();
      expect(startDeviceConnection({ codes, webAddress })).toEqual({
        ok: false,
        reason: "no-https-address",
      });
    },
  );

  it("코드 원문을 메모리에 두지 않는다", () => {
    const { codes } = world();
    const code = issuedCode(codes);
    const held = JSON.stringify(
      Object.values(codes).flatMap((value) => (value instanceof Map ? [...value.entries()] : [])),
    );
    expect(held).not.toContain(code);
  });

  it("한 번 쓴 코드를 거절한다", () => {
    const context = world();
    const code = issuedCode(context.codes);
    expect(connectDevice(context, { code, name: "iPhone" }, at).status).toBe(200);
    expect(connectDevice(context, { code, name: "iPad" }, at)).toEqual({
      status: 410,
      reason: "used-code",
    });
    expect(listDevices(context.db)).toHaveLength(1);
  });

  it("만료된 코드를 거절한다", () => {
    const context = world();
    const code = issuedCode(context.codes);
    context.clock.now += ENROLLMENT_TTL_MS;
    expect(connectDevice(context, { code, name: "iPhone" }, at)).toEqual({
      status: 410,
      reason: "expired-code",
    });
    expect(listDevices(context.db)).toHaveLength(0);
  });

  it("모르는 코드를 거절한다", () => {
    const context = world();
    expect(connectDevice(context, { code: "nope", name: "iPhone" }, at)).toEqual({
      status: 401,
      reason: "unknown-code",
    });
  });

  it("이름이 잘못된 요청은 코드를 쓰지 않는다", () => {
    const context = world();
    const code = issuedCode(context.codes);
    expect(connectDevice(context, { code, name: "  " }, at)).toEqual({
      status: 400,
      reason: "invalid-request",
    });
    expect(connectDevice(context, { code, name: "iPhone" }, at).status).toBe(200);
  });

  it("새 QR을 만들면 앞의 코드는 쓸 수 없다", () => {
    const context = world();
    const first = startDeviceConnection({ codes: context.codes, webAddress: SERVER });
    if (!first.ok) throw new Error("QR을 만들지 못했다");
    startDeviceConnection({ codes: context.codes, webAddress: SERVER, replacing: first.id });
    const code = parseConnectionQr(first.qr)?.code;
    expect(connectDevice(context, { code, name: "iPhone" }, at)).toMatchObject({
      reason: "unknown-code",
    });
  });
});

describe("기기 토큰", () => {
  it("토큰 원문을 DB에 두지 않는다", () => {
    const context = world();
    const { token } = connected(context);
    const rows = context.db.$client.prepare("SELECT * FROM devices").all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("Bearer 토큰으로 기기를 확인한다", () => {
    const context = world();
    const { deviceId, token } = connected(context);
    expect(authenticateDevice(context.db, `Bearer ${token}`, at)).toBe(deviceId);
  });

  it.each([null, "", "Bearer", "Bearer ", "Basic abc", "Bearer wrong-token", "Bearer a b"])(
    "확인할 수 없는 값을 거절한다: %j",
    (authorization) => {
      const context = world();
      connected(context);
      expect(authenticateDevice(context.db, authorization, at)).toBeNull();
    },
  );

  it("지운 기기의 토큰을 바로 거절한다", () => {
    const context = world();
    const { deviceId, token } = connected(context);
    removeDevice(context.db, deviceId, at);
    expect(authenticateDevice(context.db, `Bearer ${token}`, at)).toBeNull();
  });

  it("데스크톱 등록을 같은 requestId 로 다시 보내면 기기를 늘리지 않고 앞 토큰을 끊는다", () => {
    const { db } = world();
    const registrations = new DesktopRegistrations();
    const body = { name: "Acme Mac", requestId: "request-id-0000001" };
    const first = registerDesktop({ db, registrations }, body, at);
    const second = registerDesktop({ db, registrations }, body, at);
    if (first.status !== 200 || second.status !== 200) throw new Error("등록 실패");

    expect(second.result.deviceId).toBe(first.result.deviceId);
    expect(listDevices(db)).toHaveLength(1);
    expect(authenticateDevice(db, `Bearer ${first.result.token}`, at)).toBeNull();
    expect(authenticateDevice(db, `Bearer ${second.result.token}`, at)).toBe(first.result.deviceId);
  });

  it("같은 requestId 에 이름이 다르면 거절하고, requestId 가 없으면 거절한다", () => {
    const { db } = world();
    const registrations = new DesktopRegistrations();
    const requestId = "request-id-0000002";
    registerDesktop({ db, registrations }, { name: "Acme Mac", requestId }, at);

    expect(registerDesktop({ db, registrations }, { name: "Other", requestId }, at)).toEqual({
      status: 400,
      reason: "invalid-request",
    });
    expect(registerDesktop({ db, registrations }, { name: "Acme Mac" }, at)).toEqual({
      status: 400,
      reason: "invalid-request",
    });
    expect(listDevices(db)).toHaveLength(1);
  });

  it("지운 기기의 requestId 로 다시 보내면 새 기기로 등록한다", () => {
    const { db } = world();
    const registrations = new DesktopRegistrations();
    const body = { name: "Acme Mac", requestId: "request-id-0000003" };
    const first = registerDesktop({ db, registrations }, body, at);
    if (first.status !== 200) throw new Error("등록 실패");
    removeDevice(db, first.result.deviceId, at);

    const second = registerDesktop({ db, registrations }, body, at);

    if (second.status !== 200) throw new Error("등록 실패");
    expect(second.result.deviceId).not.toBe(first.result.deviceId);
    expect(authenticateDevice(db, `Bearer ${second.result.token}`, at)).toBe(
      second.result.deviceId,
    );
  });

  it("기기를 지우면 그 기기의 열린 스트림을 닫고, 없는 기기는 아무것도 닫지 않는다", async () => {
    const context = world();
    const { deviceId } = connected(context);
    const streams = new DeviceStreams();
    const reader = streams.track(deviceId, new ReadableStream<Uint8Array>()).getReader();

    expect(removeDeviceById({ db: context.db, streams }, "missing", at)).toEqual({ ok: false });
    expect(streams.openCount(deviceId)).toBe(1);

    expect(removeDeviceById({ db: context.db, streams }, deviceId, at)).toEqual({ ok: true });
    expect((await reader.read()).done).toBe(true);
    expect(streams.openCount(deviceId)).toBe(0);
  });

  it("기기 목록 화면 값에 토큰, 해시, Expo 푸시 주소가 없다", () => {
    const context = world();
    const { deviceId, token } = connected(context);
    context.db.$client
      .prepare("UPDATE devices SET expo_push_token = ? WHERE id = ?")
      .run("ExponentPushToken[secret]", deviceId);
    const stored = context.db.$client.prepare("SELECT token_hash FROM devices").get();
    const view = JSON.stringify(loadDevicesView(context.db, SERVER, at));
    expect(view).toContain("iPhone");
    expect(view).not.toContain(token);
    expect(view).not.toContain(String(stored?.["token_hash"]));
    expect(view).not.toContain("ExponentPushToken");
    expect(view.toLowerCase()).not.toContain("expo");
  });

  it("휴대폰은 phone, 데스크톱 앱은 desktop 으로 넣고 목록 화면에는 휴대폰만 보인다", () => {
    const context = world();
    const phone = connected(context);
    const registrations = new DesktopRegistrations();
    const desktop = registerDesktop(
      { db: context.db, registrations },
      { name: "Acme Mac", requestId: "request-id-0000004" },
      at,
    );
    if (desktop.status !== 200) throw new Error("등록 실패");

    expect(listDevices(context.db).map(({ id, kind }) => ({ id, kind }))).toEqual(
      expect.arrayContaining([
        { id: phone.deviceId, kind: "phone" },
        { id: desktop.result.deviceId, kind: "desktop" },
      ]),
    );
    expect(loadDevicesView(context.db, SERVER, at).devices.map((device) => device.id)).toEqual([
      phone.deviceId,
    ]);
  });
});
