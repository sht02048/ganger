import { EventEmitter } from "node:events";
import { WORKER_WAKE_ENV, WORKER_WAKE_VIA_IPC } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { listenForDeviceActivity, listenForWake } from "./wake-listener.js";

function source(env: Record<string, string>, connected = true) {
  return Object.assign(new EventEmitter(), { env, connected });
}

const enabled = { [WORKER_WAKE_ENV]: WORKER_WAKE_VIA_IPC };

describe("worker 의 깨우기 신호 수신", () => {
  it("start 가 띄운 worker 는 { type: wake } 를 받을 때만 깨운다", () => {
    const channel = source(enabled);
    let woken = 0;
    expect(listenForWake(channel, () => (woken += 1))).toBe(true);

    for (const other of [{ error: "no-entry" }, "wake", { type: "sleep" }, null, 1]) {
      channel.emit("message", other);
    }
    expect(woken).toBe(0);

    channel.emit("message", { type: "wake" });
    channel.emit("message", { type: "wake" });
    expect(woken).toBe(2);
  });

  it("기기 사용 보고는 모양이 맞을 때만 받고 깨우기 신호와 섞이지 않는다", () => {
    const channel = source(enabled);
    const records: [string, number][] = [];
    let woken = 0;
    listenForWake(channel, () => (woken += 1));
    expect(listenForDeviceActivity(channel, (deviceId, at) => records.push([deviceId, at]))).toBe(
      true,
    );

    channel.emit("message", { type: "device-activity", deviceId: "", lastUsedAt: 1 });
    channel.emit("message", { type: "device-activity", deviceId: "mac", lastUsedAt: "1" });
    channel.emit("message", { type: "device-activity", deviceId: "mac", lastUsedAt: 1000 });
    expect(records).toEqual([["mac", 1000]]);
    expect(woken).toBe(0);
  });

  it("start 가 띄우지 않았으면 기기 사용 보고를 듣지 않는다", () => {
    const channel = source({});
    expect(listenForDeviceActivity(channel, () => undefined)).toBe(false);
    expect(channel.listenerCount("message")).toBe(0);
  });

  it("start 가 띄우지 않았거나 IPC 통로가 없으면 듣지 않는다", () => {
    const cases = [source({}), source({ [WORKER_WAKE_ENV]: "socket" }), source(enabled, false)];
    for (const channel of cases) {
      let woken = 0;
      expect(listenForWake(channel, () => (woken += 1))).toBe(false);
      channel.emit("message", { type: "wake" });
      expect([channel.listenerCount("message"), woken]).toEqual([0, 0]);
    }
  });
});
