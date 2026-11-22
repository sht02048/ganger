import type { DevicesView } from "@ganger/app/devices/connection";
import { describe, expect, it } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { DevicesSection } from "./devices-section";
import type { DeviceActions } from "./devices-section";
import { settingsMessages } from "./messages";
import { WEB_ADDRESS_ROW_ID } from "./settings-page";

const actions: DeviceActions = {
  start: () => Promise.resolve({ ok: false, reason: "no-https-address" }),
  cancel: () => Promise.resolve(),
  remove: () => Promise.resolve({ ok: true }),
};

const device = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme iPhone",
  createdAt: "2026-11-22T00:00:00.000Z",
  createdAgoMs: 2 * 60 * 60_000,
  lastSeenAt: null,
  lastSeenAgoMs: null,
};

function render(view: DevicesView): string {
  return renderWithMessages(<DevicesSection view={view} actions={actions} />, settingsMessages);
}

describe("Settings 기기 연결 구역(0104)", () => {
  it("https 주소가 있으면 QR 띄우기 버튼을 보인다", () => {
    const html = render({ connectable: true, devices: [] });
    expect(html).toContain(settings.devices.showQr);
    expect(html).toContain(settings.devices.empty);
    expect(html).not.toContain(settings.devices.needsHttps);
  });

  it("https 주소가 없으면 QR 대신 주소 칸으로 안내한다", () => {
    const html = render({ connectable: false, devices: [] });
    expect(html).not.toContain(settings.devices.showQr);
    expect(html).toContain(settings.devices.needsHttps);
    expect(html).toContain(`href="#${WEB_ADDRESS_ROW_ID}"`);
  });

  it("기기마다 이름, 마지막 접속, 이름 붙은 지우기 버튼을 보인다", () => {
    const html = render({ connectable: true, devices: [device] });
    expect(html).toContain("Acme iPhone");
    expect(html).toContain(settings.devices.neverSeen);
    expect(html).toContain("Acme iPhone 기기 지우기");
  });
});
