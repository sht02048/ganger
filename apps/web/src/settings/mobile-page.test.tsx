import type { DevicesView } from "@ganger/app/devices/connection";
import type { MobileAccessView } from "@ganger/app/mobile-access";
import { describe, expect, it } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { settingsMessages } from "./messages";
import { MobileScreen, TAILSCALE_DOWNLOAD_URL } from "./mobile-page";
import type { MobileActions } from "./mobile-page";
import { remainingText, type DeviceActions } from "./mobile-phones";

const HOST = "studio.example.ts.net";

const deviceActions: DeviceActions = {
  start: () => new Promise(() => undefined),
  cancel: () => Promise.resolve(),
  remove: () => Promise.resolve({ ok: true }),
};

const actions: MobileActions = {
  turnOn: () => Promise.resolve({ ok: true }),
  turnOff: () => Promise.resolve({ ok: true }),
  recheck: () => Promise.resolve(null),
};

const phone = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme iPhone",
  createdAt: "2026-11-22T00:00:00.000Z",
  createdAgoMs: 3 * 24 * 60 * 60_000,
  lastSeenAt: null,
  lastSeenAgoMs: null,
};

function render(access: MobileAccessView, devices: DevicesView = { devices: [], address: null }) {
  return renderWithMessages(
    <MobileScreen
      access={access}
      devices={devices}
      deviceActions={deviceActions}
      actions={actions}
      nav={null}
    />,
    settingsMessages,
  );
}

function textOf(html: string): string {
  return html
    .replace(/<div[^>]*role="tooltip"[^>]*>.*?<\/div>/gs, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const primaryButtons = (html: string) => html.match(/data-variant="primary"/g)?.length ?? 0;

describe("Settings › 모바일(0230)", () => {
  it("제목은 모바일이고 구역 제목이나 컴퓨터 구역은 없다", () => {
    const html = render({ kind: "off", host: HOST, portInUse: null });
    expect(html.match(/<h1[^>]*>([^<]*)</)?.[1]).toBe(settings.pages.mobile);
    expect(html).not.toMatch(/<h2/);
    expect(textOf(html)).not.toContain("컴퓨터");
  });

  it("켜기 전에는 이 Mac 이름과 Tailscale 연결됨, 노란 켜기 하나를 보인다", () => {
    const html = render({ kind: "off", host: HOST, portInUse: null });
    const text = textOf(html);
    expect(text).toContain(settings.mobile.open);
    expect(text).toContain(`Tailscale 연결됨 · ${HOST}`);
    expect(html).toContain('data-detail-tone="pass"');
    expect(html).toMatch(/data-variant="primary"[^>]*>(?:<[^>]+>)*켜기/);
    expect(primaryButtons(html)).toBe(1);
    expect(html).toContain(`aria-label="${settings.mobile.open} 도움말"`);
    expect(html).toContain(settings.mobile.offInfo);
    expect(html).not.toContain('type="url"');
  });

  it("443 을 다른 곳에서 쓰면 켜기를 막고 쓰는 곳을 보인다", () => {
    const html = render({
      kind: "off",
      host: HOST,
      portInUse: { uses: ["/ → http://127.0.0.1:8080"], isPublic: false },
    });
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-variant="primary"|data-variant="primary"[^>]*disabled=""/,
    );
    expect(textOf(html)).toContain("쓰는 곳: / → http://127.0.0.1:8080");
  });

  it("켠 뒤에는 모노 주소 · 켜짐과 끄기, 페이지 안 QR 묶음, 휴대폰 목록을 보인다", () => {
    const html = render(
      { kind: "on", address: `https://${HOST}`, viaTailscale: true },
      { devices: [phone], address: `https://${HOST}` },
    );
    const text = textOf(html);
    expect(text).toContain(`https://${HOST}${settings.mobile.onDetail}`);
    expect(html).toContain(">끄기<");
    expect(html).toContain(settings.mobile.onInfo);
    expect(html).toContain(`role="group" aria-label="${settings.mobile.qr.label}"`);
    expect(html).not.toContain('role="dialog"');
    expect(text).toContain(settings.mobile.qr.starting);
    expect(text).toContain("Acme iPhone");
    expect(text).toContain(`11월 22일 연결 · ${settings.mobile.phone.neverSeen}`);
    expect(text).toContain("Acme iPhone 연결 끊기");
    expect(primaryButtons(html)).toBe(0);
  });

  it("Tailscale 이 아닌 옛 열 주소도 켠 상태로 보이고 끄기를 둔다", () => {
    const html = render(
      { kind: "on", address: "https://ganger.example.com", viaTailscale: false },
      { devices: [], address: "https://ganger.example.com" },
    );
    expect(textOf(html)).toContain("https://ganger.example.com · 켜짐");
    expect(html).toContain(settings.mobile.savedInfo);
    expect(html).toContain(">끄기<");
  });

  it("Tailscale 이 없으면 안내, 두 단계, 공식 다운로드 링크와 다시 확인을 보인다", () => {
    const html = render({ kind: "needs-tailscale" });
    const text = textOf(html);
    expect(text).toContain(settings.mobile.needs.title);
    expect(text).toContain(settings.mobile.needs.body);
    expect(html).toMatch(
      new RegExp(
        `<ol[^>]*><li[^>]*><span aria-hidden="true"[^>]*>1<.*${settings.mobile.needs.step1}.*<li[^>]*><span aria-hidden="true"[^>]*>2<.*${settings.mobile.needs.step2}`,
        "s",
      ),
    );
    expect(html).toContain(`href="${TAILSCALE_DOWNLOAD_URL}"`);
    expect(html).toMatch(
      /href="https:\/\/tailscale\.com\/download" target="_blank" rel="noreferrer"/,
    );
    expect(text).toContain(settings.mobile.needs.recheck);
    expect(text).not.toContain(settings.mobile.turnOn);
    expect(primaryButtons(html)).toBe(1);
  });

  it("남은 시간은 분:초로 보인다", () => {
    expect(remainingText(600_000)).toBe("10:00");
    expect(remainingText(582_400)).toBe("9:43");
    expect(remainingText(0)).toBe("0:00");
    expect(remainingText(-5)).toBe("0:00");
  });
});
