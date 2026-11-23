import { spawn } from "node:child_process";
import { once } from "node:events";
import { WORKER_WAKE_ENV, WORKER_WAKE_VIA_IPC } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { sendDeviceActivityVia, wakeWorkerVia } from "./worker-wake";

const enabled = { [WORKER_WAKE_ENV]: WORKER_WAKE_VIA_IPC };

function recordingChannel(env: Record<string, string>, connected = true) {
  const sent: unknown[] = [];
  return {
    sent,
    channel: {
      env,
      connected,
      send: (message: unknown, callback: (error: Error | null) => void) => {
        sent.push(message);
        callback(null);
        return true;
      },
    },
  };
}

describe("web 의 기기 사용 보고 전달", () => {
  it("start 가 띄운 web 은 기기와 마지막 사용 시각을 IPC 로 보낸다", () => {
    const { sent, channel } = recordingChannel(enabled);
    sendDeviceActivityVia(channel, { deviceId: "mac", lastUsedAt: 1000 });
    expect(sent).toEqual([{ type: "device-activity", deviceId: "mac", lastUsedAt: 1000 }]);
  });

  it("start 가 띄우지 않았으면 보내지 않는다", () => {
    const { sent, channel } = recordingChannel({});
    sendDeviceActivityVia(channel, { deviceId: "mac", lastUsedAt: 1000 });
    expect(sent).toEqual([]);
  });
});

describe("web 의 worker 깨우기 신호", () => {
  it("start 가 띄운 web 은 IPC 통로로 { type: wake } 를 보낸다", () => {
    const { sent, channel } = recordingChannel(enabled);
    wakeWorkerVia(channel);
    expect(sent).toEqual([{ type: "wake" }]);
  });

  it("start 가 띄우지 않았거나 통로가 닫혀 있으면 아무것도 보내지 않는다", () => {
    for (const { sent, channel } of [
      recordingChannel({}),
      recordingChannel({ [WORKER_WAKE_ENV]: "socket" }),
      recordingChannel(enabled, false),
    ]) {
      wakeWorkerVia(channel);
      expect(sent).toEqual([]);
    }
    expect(() => wakeWorkerVia({ env: enabled, connected: true })).not.toThrow();
  });

  it("보내는 사이 통로가 닫혀도 예외나 error 이벤트를 내지 않는다", async () => {
    const child = spawn(process.execPath, ["-e", ""], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const errors: unknown[] = [];
    child.on("error", (error) => errors.push(error));
    await once(child, "exit");
    expect(child.connected).toBe(false);

    wakeWorkerVia({ env: enabled, connected: true, send: child.send.bind(child) });
    await new Promise((resolve) => setImmediate(resolve));

    expect(errors).toEqual([]);
  });
});
