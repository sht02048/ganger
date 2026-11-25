// @vitest-environment jsdom
import type { DevicesView, StartDeviceConnectionResult } from "@ganger/app/devices/connection";
import type { MobileAccessResult, MobileAccessView } from "@ganger/app/mobile-access";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { appMessages, defaultLocale } from "../i18n";
import { settingsMessages } from "./messages";
import { MobileScreen } from "./mobile-page";
import type { MobileActions } from "./mobile-page";
import type { DeviceActions } from "./mobile-phones";

const HOST = "studio.example.ts.net";
const ADDRESS = `https://${HOST}`;
const ON: MobileAccessView = {
  kind: "on",
  address: ADDRESS,
  viaTailscale: true,
  fallbackPort: null,
};
const OFF: MobileAccessView = { kind: "off", host: HOST, portInUse: null };

function issued(id: string): StartDeviceConnectionResult {
  return { ok: true, id, qr: `ganger://connect?server=x&code=${id}`, expiresInMs: 600_000 };
}

function phone(id: string, name: string) {
  return {
    id,
    name,
    createdAt: "2026-11-25T00:00:00.000Z",
    createdAgoMs: 0,
    lastSeenAt: null,
    lastSeenAgoMs: null,
  };
}

function harness(over: Partial<MobileActions> = {}) {
  const pending: Array<(result: StartDeviceConnectionResult) => void> = [];
  const start = vi.fn<DeviceActions["start"]>(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const cancel = vi.fn<DeviceActions["cancel"]>(() => Promise.resolve());
  const deviceActions: DeviceActions = {
    start,
    cancel,
    remove: () => Promise.resolve({ ok: true }),
  };
  const actions: MobileActions = {
    turnOn: () => Promise.resolve({ ok: true }),
    turnOff: () => Promise.resolve({ ok: true }),
    recheck: () => Promise.resolve(null),
    ...over,
  };
  return { deviceActions, actions, start, cancel, pending };
}

let container: HTMLDivElement;
let root: Root;

function draw(
  access: MobileAccessView,
  devices: DevicesView,
  h: Pick<ReturnType<typeof harness>, "deviceActions" | "actions">,
) {
  act(() => {
    root.render(
      <IntlProvider
        locale={defaultLocale}
        messages={{ ...appMessages, ...settingsMessages }}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <MobileScreen
          access={access}
          devices={devices}
          deviceActions={h.deviceActions}
          actions={h.actions}
          nav={null}
        />
      </IntlProvider>,
    );
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent.includes(name),
  );
  if (found === undefined) throw new Error(`${name} 버튼이 없다`);
  return found;
}

async function settle(resolve?: () => void) {
  await act(async () => {
    resolve?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const shownQr = () => container.querySelector('svg[role="img"]');
const statusText = () => container.querySelector('[role="status"][tabindex="-1"]')?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("모바일 페이지의 QR(0230)", () => {
  it("켠 상태로 열면 누르지 않아도 페이지 안에 QR 을 펼친다", async () => {
    const h = harness();
    draw(ON, { devices: [], address: ADDRESS }, h);
    expect(h.start).toHaveBeenCalledTimes(1);
    await settle(() => h.pending[0]?.(issued("first")));
    expect(shownQr()).not.toBeNull();
    expect(container.textContent).toContain(settings.mobile.qr.title);
    expect(container.textContent).toContain(settings.mobile.qr.tailscale);
    expect(container.textContent).toContain("10분 동안 한 번만 쓸 수 있어요 · 10:00 남음");
  });

  it("남은 시간이 줄고 10분이 지나면 QR 을 내리고 새 QR 만들기를 남긴다", async () => {
    vi.useFakeTimers();
    const h = harness();
    draw(ON, { devices: [], address: ADDRESS }, h);
    await settle(() => h.pending[0]?.(issued("first")));
    act(() => {
      vi.advanceTimersByTime(18_000);
    });
    expect(container.textContent).toContain("9:42 남음");
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(shownQr()).toBeNull();
    expect(container.textContent).toContain(settings.mobile.qr.expired);
    act(() => button(settings.mobile.qr.renew).click());
    expect(h.start).toHaveBeenLastCalledWith(undefined);
  });

  it("새 QR 만들기는 앞 코드를 바꿔 달라고 보낸다", async () => {
    const h = harness();
    draw(ON, { devices: [], address: ADDRESS }, h);
    await settle(() => h.pending[0]?.(issued("first")));
    act(() => button(settings.mobile.qr.renew).click());
    expect(h.start).toHaveBeenLastCalledWith("first");
  });

  it("휴대폰이 연결되면 QR 을 내리고 연결한 이름을 보인다", async () => {
    const h = harness();
    draw(ON, { devices: [], address: ADDRESS }, h);
    await settle(() => h.pending[0]?.(issued("first")));
    draw(ON, { devices: [phone("p1", "Acme iPhone")], address: ADDRESS }, h);
    expect(shownQr()).toBeNull();
    expect(container.textContent).toContain("연결했어요: Acme iPhone");
    expect(h.cancel).toHaveBeenCalledWith("first");
  });

  it("끄거나 화면을 떠나면 열어 둔 코드와 늦게 온 코드를 취소한다", async () => {
    const h = harness();
    draw(ON, { devices: [], address: ADDRESS }, h);
    await settle(() => h.pending[0]?.(issued("first")));
    draw(OFF, { devices: [], address: null }, h);
    expect(h.cancel).toHaveBeenCalledWith("first");

    draw(ON, { devices: [], address: ADDRESS }, h);
    act(() => root.render(null));
    await settle(() => h.pending[1]?.(issued("late")));
    expect(h.cancel).toHaveBeenCalledWith("late");
  });

  it("https 가 아닌 옛 주소면 QR 을 만들지 않고 이유를 보인다", () => {
    const h = harness();
    draw(
      { kind: "on", address: "http://ganger.example.com", viaTailscale: false, fallbackPort: null },
      { devices: [], address: null },
      h,
    );
    expect(h.start).not.toHaveBeenCalled();
    expect(container.textContent).toContain(settings.mobile.qr.needsHttps);
  });
});

describe("모바일 페이지의 켜기·끄기(0230)", () => {
  it("켜면 결과 문장으로 포커스를 옮긴다", async () => {
    const h = harness();
    draw(OFF, { devices: [], address: null }, h);
    act(() => button(settings.mobile.turnOn).click());
    await settle();
    expect(statusText()).toBe(settings.mobile.turnedOn);
    expect(document.activeElement?.getAttribute("role")).toBe("status");
  });

  it("켜지 못하면 이유를 보이고, HTTPS 승인이 필요하면 Tailscale 링크를 건다", async () => {
    const approvalUrl = "https://login.tailscale.com/f/serve?node=abc";
    const result: MobileAccessResult = { ok: false, reason: "serve-failed", approvalUrl };
    const h = harness({ turnOn: () => Promise.resolve(result) });
    draw(OFF, { devices: [], address: null }, h);
    act(() => button(settings.mobile.turnOn).click());
    await settle();
    expect(statusText()).toContain(settings.mobile.needsHttps);
    expect(container.querySelector(`a[href="${approvalUrl}"]`)?.textContent).toBe(
      settings.mobile.approve,
    );
  });

  it("그 주소로 연 화면에서 끄면 막혀서 끄지 않았다고 알린다", async () => {
    const h = harness({ turnOff: () => Promise.resolve({ ok: false, reason: "locks-out" }) });
    draw(ON, { devices: [], address: ADDRESS }, h);
    act(() => button(settings.mobile.turnOff).click());
    await settle();
    expect(statusText()).toBe(settings.mobile.refusal["locks-out"]);
    expect(document.activeElement?.getAttribute("role")).toBe("status");
  });

  it("다시 확인해도 Tailscale 이 없으면 그렇다고 알린다", async () => {
    const h = harness({ recheck: () => Promise.resolve({ kind: "needs-tailscale" }) });
    draw({ kind: "needs-tailscale" }, { devices: [], address: null }, h);
    act(() => button(settings.mobile.needs.recheck).click());
    await settle();
    expect(statusText()).toBe(settings.mobile.needs.stillMissing);
  });
});
