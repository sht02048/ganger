import { toRunnerId, toRunnerKind } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import {
  forgetInvalidPushAddress,
  getDevicePushSettings,
  listPushDeliveries,
  listPushDevices,
  recordPushSent,
  saveDevicePushSettings,
} from "./device-push.js";
import { addDevice, listDevices, removeDevice } from "./devices.js";
import { migrate } from "./migrate.js";
import { syncNotificationEvents } from "./notification-events.js";
import type { NotificationCause } from "./notification-events.js";
import { saveRunner } from "./settings.js";

const at = new Date("2026-11-23T00:00:00.000Z");
const TOKEN = "ExponentPushToken[device-a]";
const GROUPS = {
  question: true,
  permission: true,
  humanCheckRequest: true,
  failedDisconnected: true,
  runnerIssue: true,
};
const runnerId = toRunnerId("runner-a");
const cause: NotificationCause = {
  kind: "runner-offline",
  cause: "runner-offline:a",
  target: { kind: "runner", runnerId },
  subject: "a",
  detail: null,
};

function database() {
  const db = openDatabase(":memory:");
  migrate(db);
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "a",
    config: {},
    capacity: 1,
  });
  return db;
}

describe("기기 푸시 설정과 보낸 기록", () => {
  it("주소 없이는 알림을 켜지 못하고 응답에는 주소 대신 있는지만 싣는다", () => {
    const db = database();
    const { id } = addDevice(db, { name: "폰", tokenHash: "h" }, at);
    expect(saveDevicePushSettings(db, id, { enabled: true, groups: GROUPS })).toBe(
      "no-push-address",
    );
    expect(
      saveDevicePushSettings(db, id, { enabled: true, groups: GROUPS, expoPushToken: TOKEN }),
    ).toBe("saved");
    const settings = getDevicePushSettings(db, id);
    expect(settings).toMatchObject({ enabled: true, hasPushAddress: true });
    expect(JSON.stringify(settings)).not.toContain(TOKEN);
  });

  it("같은 주소를 다른 기기가 넘기면 앞 기기에서 주소를 뗀다", () => {
    const db = database();
    const first = addDevice(db, { name: "앞", tokenHash: "h1" }, at);
    const second = addDevice(db, { name: "뒤", tokenHash: "h2" }, at);
    saveDevicePushSettings(db, first.id, { enabled: true, groups: GROUPS, expoPushToken: TOKEN });
    saveDevicePushSettings(db, second.id, { enabled: true, groups: GROUPS, expoPushToken: TOKEN });
    expect(listPushDevices(db).map((device) => device.id)).toEqual([second.id]);
  });

  it("무효 주소를 지우면 알림을 끄고 기기 연결은 남긴다", () => {
    const db = database();
    const { id } = addDevice(db, { name: "폰", tokenHash: "h" }, at);
    saveDevicePushSettings(db, id, { enabled: true, groups: GROUPS, expoPushToken: TOKEN });
    expect(forgetInvalidPushAddress(db, id, "ExponentPushToken[other]")).toBe(false);
    expect(forgetInvalidPushAddress(db, id, TOKEN)).toBe(true);
    expect(getDevicePushSettings(db, id)).toMatchObject({ enabled: false, hasPushAddress: false });
    expect(listDevices(db).map((device) => device.id)).toEqual([id]);
  });

  it("켜는 순간 열려 있던 사건은 보내지 않음으로 적는다", () => {
    const db = database();
    syncNotificationEvents(db, [cause], at);
    const { id } = addDevice(db, { name: "폰", tokenHash: "h" }, at);
    saveDevicePushSettings(db, id, { enabled: true, groups: GROUPS, expoPushToken: TOKEN });
    expect(listPushDeliveries(db)).toMatchObject([{ deviceId: id, firstSentAt: null }]);
  });

  it("기기를 지우면 보낸 기록도 함께 지운다", () => {
    const db = database();
    const { id } = addDevice(db, { name: "폰", tokenHash: "h" }, at);
    saveDevicePushSettings(db, id, { enabled: true, groups: GROUPS, expoPushToken: TOKEN });
    syncNotificationEvents(db, [cause], at);
    recordPushSent(db, id, [1], null, at);
    expect(listPushDeliveries(db)).toHaveLength(1);
    removeDevice(db, id, at);
    expect(listPushDeliveries(db)).toEqual([]);
  });
});
