// @vitest-environment jsdom
import type { V1DeviceNotifications, V1SaveDeviceNotifications } from "@ganger/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { V1PushClient } from "../connection/client";
import { EMPTY_PUSH_MEMORY } from "./push-port";
import type { PushDevicePort, PushMemoryValue, PushPermission } from "./push-port";
import { useDeviceNotifications } from "./use-device-notifications";
import type { DeviceNotificationsState } from "./use-device-notifications";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const GROUPS = {
  question: true,
  permission: true,
  humanCheckRequest: true,
  failedDisconnected: true,
  runnerIssue: true,
};
const OFF: V1DeviceNotifications = { enabled: false, groups: GROUPS, hasPushAddress: false };
const NEW_ADDRESS = "ExponentPushToken[renewed]";

function setup(options: {
  server?: V1DeviceNotifications;
  memory?: PushMemoryValue;
  permission?: PushPermission;
  address?: string | null;
}) {
  let server = options.server ?? OFF;
  let stored = options.memory ?? EMPTY_PUSH_MEMORY;
  const saves: V1SaveDeviceNotifications[] = [];
  const client: V1PushClient = {
    deviceNotifications: () => Promise.resolve({ ok: true, data: server, serverVersion: "0.4.0" }),
    saveDeviceNotifications: (request) => {
      saves.push(request);
      server = {
        enabled: request.enabled,
        groups: request.groups,
        hasPushAddress: server.hasPushAddress || request.expoPushToken !== undefined,
      };
      return Promise.resolve({ ok: true, data: server, serverVersion: "0.4.0" });
    },
    notificationEvent: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
  };
  const device: PushDevicePort = {
    supported: true,
    permission: () => Promise.resolve(options.permission ?? "granted"),
    requestPermission: () => Promise.resolve(options.permission ?? "granted"),
    pushAddress: () =>
      Promise.resolve(options.address === undefined ? NEW_ADDRESS : options.address),
    subscribeResponses: () => () => undefined,
  };
  const memory = {
    load: () => Promise.resolve(stored),
    save: (value: PushMemoryValue) => {
      stored = value;
      return Promise.resolve();
    },
    clear: () => Promise.resolve(),
  };
  const current: { state: DeviceNotificationsState | null } = { state: null };
  function Probe() {
    current.state = useDeviceNotifications({ client, device, memory, foreground: true });
    return null;
  }
  return { Probe, current, saves, device, stored: () => stored };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function mount(Probe: () => null) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanups.push(() => act(() => root.unmount()));
}

async function press(work: () => void) {
  await act(async () => {
    work();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("앱의 알림 설정(M11, M40, 결정 1)", () => {
  it("처음 연결하면 알림을 받을지 묻고, 허용하면 주소를 넘긴다", async () => {
    const view = setup({});
    await mount(view.Probe);
    expect(view.current.state?.asking).toBe(true);

    await press(() => view.current.state?.accept());

    expect(view.saves).toMatchObject([{ enabled: true, expoPushToken: NEW_ADDRESS }]);
    expect(view.saves[0]?.requestId.length).toBeGreaterThanOrEqual(16);
    expect(view.current.state?.preferences?.enabled).toBe(true);
    expect(view.stored()).toEqual({ asked: true, registered: true, address: NEW_ADDRESS });
  });

  it("나중에를 고르면 다시 묻지 않는다", async () => {
    const view = setup({ permission: "undetermined" });
    await mount(view.Probe);
    await press(() => view.current.state?.decline());
    expect(view.current.state?.asking).toBe(false);
    expect(view.stored().asked).toBe(true);
    expect(view.saves).toEqual([]);
  });

  it("이미 권한이 있는 폰에서 나중에를 고르면 주소만 넘겨받아 옛 기기 행의 푸시를 멈춘다", async () => {
    const view = setup({ permission: "granted" });
    await mount(view.Probe);
    await press(() => view.current.state?.decline());
    expect(view.saves).toMatchObject([{ enabled: false, expoPushToken: NEW_ADDRESS }]);
    expect(view.stored()).toMatchObject({ asked: true, registered: false });
  });

  it("서버가 무효 주소로 지웠으면 다시 켜라는 안내를 보이고, 켜면 새 주소를 넘긴다", async () => {
    const view = setup({
      memory: { asked: true, registered: true, address: "ExponentPushToken[old]" },
    });
    await mount(view.Probe);
    expect(view.current.state?.notice).toBe("address-lost");
    expect(view.current.state?.asking).toBe(false);

    const preferences = view.current.state?.preferences;
    if (!preferences) throw new Error("설정을 읽지 못했다");
    await press(() => view.current.state?.change({ ...preferences, enabled: true }));

    expect(view.saves).toMatchObject([{ enabled: true, expoPushToken: NEW_ADDRESS }]);
    expect(view.current.state?.notice).toBeNull();
  });

  it("직접 끈 기기에는 무효 주소 안내를 보이지 않는다", async () => {
    const view = setup({
      server: { ...OFF, hasPushAddress: true },
      memory: { asked: true, registered: true, address: NEW_ADDRESS },
    });
    await mount(view.Probe);
    expect(view.current.state?.notice).toBeNull();
  });

  it("시스템 권한을 거절하면 서버에 보내지 않고 안내한다", async () => {
    const view = setup({ permission: "denied" });
    await mount(view.Probe);
    await press(() => view.current.state?.accept());
    expect(view.saves).toEqual([]);
    expect(view.current.state?.notice).toBe("permission-denied");
  });

  it("주소를 받지 못하면 켜지 않고 안내한다", async () => {
    const view = setup({ address: null });
    await mount(view.Probe);
    await press(() => view.current.state?.accept());
    expect(view.saves).toEqual([]);
    expect(view.current.state?.notice).toBe("address-failed");
  });

  it("종류를 끄면 주소 없이 설정만 저장한다", async () => {
    const view = setup({
      server: { enabled: true, groups: GROUPS, hasPushAddress: true },
      memory: { asked: true, registered: true, address: NEW_ADDRESS },
    });
    await mount(view.Probe);
    const preferences = view.current.state?.preferences;
    if (!preferences) throw new Error("설정을 읽지 못했다");
    await press(() =>
      view.current.state?.change({
        ...preferences,
        kinds: { ...preferences.kinds, question: false },
      }),
    );
    expect(view.saves).toHaveLength(1);
    expect(view.saves[0]?.groups.question).toBe(false);
    expect(view.saves[0]).not.toHaveProperty("expoPushToken");
  });

  it("주소를 읽는 사이 알림을 끄면 지난 켜짐으로 되돌리지 않는다", async () => {
    let giveAddress: (address: string) => void = () => undefined;
    const view = setup({
      server: { enabled: true, groups: GROUPS, hasPushAddress: true },
      memory: { asked: true, registered: true, address: "ExponentPushToken[old]" },
    });
    view.device.pushAddress = () =>
      new Promise((resolve) => {
        giveAddress = resolve;
      });
    await mount(view.Probe);
    const preferences = view.current.state?.preferences;
    if (!preferences) throw new Error("설정을 읽지 못했다");
    await press(() => view.current.state?.change({ ...preferences, enabled: false }));
    await press(() => giveAddress(NEW_ADDRESS));
    expect(view.saves.map((save) => save.enabled)).toEqual([false]);
  });

  it("앱을 열 때 주소가 바뀌었으면 새 주소를 넘긴다", async () => {
    const view = setup({
      server: { enabled: true, groups: GROUPS, hasPushAddress: true },
      memory: { asked: true, registered: true, address: "ExponentPushToken[old]" },
    });
    await mount(view.Probe);
    expect(view.saves).toMatchObject([{ enabled: true, expoPushToken: NEW_ADDRESS }]);
    expect(view.stored().address).toBe(NEW_ADDRESS);
  });
});
