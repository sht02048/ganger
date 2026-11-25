import { describe, expect, it } from "vitest";
import { latestChangeSeq } from "./change-events.js";
import { openDatabase } from "./database.js";
import {
  DEVICE_LAST_SEEN_INTERVAL_MS,
  addDevice,
  getDeviceNotifications,
  listDevices,
  removeDevice,
  saveDeviceNotifications,
  seeDeviceByTokenHash,
} from "./devices.js";
import { migrate } from "./migrate.js";

const at = new Date("2026-11-23T00:00:00.000Z");

function database() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

describe("기기 표", () => {
  it("목록에 토큰 해시와 Expo 푸시 주소를 싣지 않는다", () => {
    const db = database();
    const device = addDevice(db, { name: "iPhone", kind: "phone", tokenHash: "hash" }, at);
    db.$client
      .prepare("UPDATE devices SET expo_push_token = ? WHERE id = ?")
      .run("ExponentPushToken[secret]", device.id);
    const [listed] = listDevices(db);
    expect(listed).toEqual({
      id: device.id,
      name: "iPhone",
      kind: "phone",
      createdAt: at,
      lastSeenAt: null,
    });
  });

  it("기기를 더하고 지우면 설정 변경을 기록한다", () => {
    const db = database();
    const before = latestChangeSeq(db);
    const device = addDevice(db, { name: "iPhone", kind: "phone", tokenHash: "hash" }, at);
    const added = latestChangeSeq(db);
    expect(added).toBeGreaterThan(before);
    expect(removeDevice(db, device.id, at)).toBe(true);
    expect(latestChangeSeq(db)).toBeGreaterThan(added);
    expect(removeDevice(db, device.id, at)).toBe(false);
  });

  it("지운 기기의 토큰 해시는 찾지 못한다", () => {
    const db = database();
    const device = addDevice(db, { name: "iPhone", kind: "phone", tokenHash: "hash" }, at);
    expect(seeDeviceByTokenHash(db, "hash", at)).toBe(device.id);
    removeDevice(db, device.id, at);
    expect(seeDeviceByTokenHash(db, "hash", at)).toBeNull();
  });

  it("마지막 접속은 정한 간격마다만 쓴다", () => {
    const db = database();
    addDevice(db, { name: "iPhone", kind: "phone", tokenHash: "hash" }, at);
    seeDeviceByTokenHash(db, "hash", at);
    const soon = new Date(at.getTime() + DEVICE_LAST_SEEN_INTERVAL_MS - 1);
    seeDeviceByTokenHash(db, "hash", soon);
    expect(listDevices(db)[0]?.lastSeenAt).toEqual(at);
    const later = new Date(at.getTime() + DEVICE_LAST_SEEN_INTERVAL_MS);
    seeDeviceByTokenHash(db, "hash", later);
    expect(listDevices(db)[0]?.lastSeenAt).toEqual(later);
  });

  it("알림은 꺼진 채로 시작하고 종류 5묶음은 켜져 있다", () => {
    const db = database();
    const device = addDevice(db, { name: "iPhone", kind: "phone", tokenHash: "hash" }, at);
    expect(getDeviceNotifications(db, device.id)).toEqual({
      enabled: false,
      groups: {
        question: true,
        permission: true,
        humanCheckRequest: true,
        failedDisconnected: true,
        runnerIssue: true,
      },
    });
  });

  it("종류 5묶음을 묶음마다 따로 저장하고 읽는다", () => {
    const db = database();
    const device = addDevice(db, { name: "iPhone", kind: "phone", tokenHash: "hash" }, at);
    const saved = {
      enabled: true,
      groups: {
        question: false,
        permission: true,
        humanCheckRequest: false,
        failedDisconnected: true,
        runnerIssue: false,
      },
    };
    expect(saveDeviceNotifications(db, device.id, saved)).toBe(true);
    expect(getDeviceNotifications(db, device.id)).toEqual(saved);
    expect(saveDeviceNotifications(db, "missing", saved)).toBe(false);
    expect(getDeviceNotifications(db, "missing")).toBeNull();
  });
});
