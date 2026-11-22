// @vitest-environment jsdom
import type { DevicesView, StartDeviceConnectionResult } from "@ganger/app/devices/connection";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { appMessages, defaultLocale } from "../i18n";
import { DevicesSection } from "./devices-section";
import type { DeviceActions } from "./devices-section";
import { settingsMessages } from "./messages";

const ADDRESS = "https://ganger.example.com";
const OTHER_ADDRESS = "https://other.example.com";

function issued(id: string): StartDeviceConnectionResult {
  return { ok: true, id, qr: `ganger://connect?server=x&code=${id}`, expiresInMs: 600_000 };
}

function harness() {
  const pending: Array<(result: StartDeviceConnectionResult) => void> = [];
  const cancel = vi.fn<DeviceActions["cancel"]>(() => Promise.resolve());
  const actions: DeviceActions = {
    start: () => new Promise((resolve) => pending.push(resolve)),
    cancel,
    remove: () => Promise.resolve({ ok: true }),
  };
  return { actions, cancel, pending };
}

let container: HTMLDivElement;
let root: Root;

function draw(view: DevicesView, actions: DeviceActions) {
  act(() => {
    root.render(
      <IntlProvider
        locale={defaultLocale}
        messages={{ ...appMessages, ...settingsMessages }}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <DevicesSection view={view} actions={actions} />
      </IntlProvider>,
    );
  });
}

function press(name: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  );
  if (button === undefined) throw new Error(`${name} 버튼이 없다`);
  act(() => button.click());
}

async function settle(resolve: (() => void) | undefined) {
  await act(async () => {
    resolve?.();
    await Promise.resolve();
  });
}

const shownQr = () => container.querySelector('svg[role="img"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("기기 연결 QR의 수명(0104)", () => {
  it("새 QR을 기다리는 동안 닫으면 늦게 온 코드를 보이지 않고 취소한다", async () => {
    const { actions, cancel, pending } = harness();
    draw({ address: ADDRESS, devices: [] }, actions);
    press(settings.devices.showQr);
    await settle(() => pending[0]?.(issued("first")));
    press(settings.devices.renew);
    press(settings.devices.close);
    await settle(() => pending[1]?.(issued("second")));
    expect(shownQr()).toBeNull();
    expect(cancel).toHaveBeenCalledWith("first");
    expect(cancel).toHaveBeenCalledWith("second");
  });

  it("QR을 띄우면 포커스를 QR 묶음으로 옮긴다", async () => {
    const { actions, pending } = harness();
    draw({ address: ADDRESS, devices: [] }, actions);
    press(settings.devices.showQr);
    await settle(() => pending[0]?.(issued("open")));
    expect(document.activeElement?.getAttribute("aria-label")).toBe(settings.devices.qrLabel);
  });

  it("기다리는 동안 화면을 떠나면 늦게 온 코드를 취소한다", async () => {
    const { actions, cancel, pending } = harness();
    draw({ address: ADDRESS, devices: [] }, actions);
    press(settings.devices.showQr);
    act(() => root.render(null));
    await settle(() => pending[0]?.(issued("late")));
    expect(cancel).toHaveBeenCalledWith("late");
  });

  it.each([OTHER_ADDRESS, null])("주소가 %s로 바뀌면 QR을 닫고 코드를 취소한다", async (next) => {
    const { actions, cancel, pending } = harness();
    draw({ address: ADDRESS, devices: [] }, actions);
    press(settings.devices.showQr);
    await settle(() => pending[0]?.(issued("open")));
    expect(shownQr()).not.toBeNull();
    draw({ address: next, devices: [] }, actions);
    expect(shownQr()).toBeNull();
    expect(cancel).toHaveBeenCalledWith("open");
    draw({ address: ADDRESS, devices: [] }, actions);
    expect(shownQr()).toBeNull();
  });
});
