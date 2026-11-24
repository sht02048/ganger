import { DESKTOP_NOTIFICATIONS_GLOBAL } from "@ganger/app/notifications/desktop";
import type { DesktopNotificationSummary } from "@ganger/app/notifications/desktop";
import { describe, expect, it, vi } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { desktopNotifications } from "../shell/desktop-notifications";
import { renderWithMessages } from "../testing/render";
import { settingsMessages } from "./messages";
import { BrowserNotificationsRow, DesktopNotificationsRow } from "./notifications-row";

const t = settings.notifications;

function summary(overrides: Partial<DesktopNotificationSummary> = {}): DesktopNotificationSummary {
  return { permission: "allowed", enabled: true, groupsOn: 4, groupsTotal: 5, ...overrides };
}

function text(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function detailClass(html: string, detail: string): string | undefined {
  return html.match(new RegExp(`class="([^"]*)"[^>]*>${detail}`))?.[1];
}

function render(value: DesktopNotificationSummary | null): string {
  return renderWithMessages(
    <DesktopNotificationsRow summary={value} open={() => {}} />,
    settingsMessages,
  );
}

describe("Settings 알림 줄(0211, 데스크톱 앱 안)", () => {
  it("허용했으면 지금 상태 한 줄과 알림 설정 열기를 보인다", () => {
    const html = render(summary());
    expect(text(html)).toContain("허용했어요 · 5개 중 4개 받아요");
    expect(html).toMatch(/data-variant="secondary"[^>]*>알림 설정 열기</);
    expect(html).not.toContain('data-tone="problem"');
  });

  it("알림 받기를 껐으면 껐다고 보인다", () => {
    expect(text(render(summary({ enabled: false })))).toContain(
      `${t.permission.allowed} · ${t.off}`,
    );
  });

  it("macOS 에서 꺼져 있으면 그 사실만 빨간 글로 보인다", () => {
    const html = render(summary({ permission: "denied" }));
    expect(text(html)).toContain(t.permission.denied);
    expect(text(html)).not.toContain("받아요");
    const allowed = render(summary());
    expect(detailClass(html, t.permission.denied)).toBeDefined();
    expect(detailClass(html, t.permission.denied)).not.toBe(
      detailClass(allowed, `${t.permission.allowed} · 5개 중 4개 받아요`),
    );
  });

  it("아직 허용하지 않았으면 그 사실을 보인다", () => {
    expect(text(render(summary({ permission: "not-asked" })))).toContain(t.permission["not-asked"]);
  });

  it("상태를 아직 받지 못해도 알림 설정 열기는 보인다", () => {
    expect(text(render(null))).toContain(t.open);
  });
});

describe("Settings 알림 줄(0211, 브라우저)", () => {
  it("데스크톱 앱에서 받는다고 한 줄로 안내하고 버튼은 없다", () => {
    const html = renderWithMessages(<BrowserNotificationsRow />, settingsMessages);
    expect(text(html)).toContain(t.browser);
    expect(html).not.toContain("<button");
  });
});

describe("데스크톱 알림 브리지(0211)", () => {
  it("브리지가 없으면 브라우저로 본다", () => {
    expect(desktopNotifications({})).toBeNull();
    expect(desktopNotifications({ [DESKTOP_NOTIFICATIONS_GLOBAL]: { getSummary: 1 } })).toBeNull();
  });

  it("요약을 검증하고, 열기를 앱에 보낸다", async () => {
    const openSettings = vi.fn<() => void>();
    const listeners: Array<(value: unknown) => void> = [];
    const bridge = desktopNotifications({
      [DESKTOP_NOTIFICATIONS_GLOBAL]: {
        getSummary: () => Promise.resolve(summary()),
        onSummary: (listener: (value: unknown) => void) => {
          listeners.push(listener);
          return () => undefined;
        },
        openSettings,
      },
    });
    expect(await bridge?.current()).toEqual(summary());
    const seen: DesktopNotificationSummary[] = [];
    bridge?.subscribe((value) => seen.push(value));
    for (const listener of listeners) {
      listener({ permission: "nope" });
      listener(summary({ permission: "denied" }));
    }
    expect(seen).toEqual([summary({ permission: "denied" })]);
    bridge?.openSettings();
    await vi.waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
  });

  it("앱이 요약을 주지 못하면 null 이다", async () => {
    const bridge = desktopNotifications({
      [DESKTOP_NOTIFICATIONS_GLOBAL]: {
        getSummary: () => Promise.reject(new Error("no")),
        onSummary: () => () => undefined,
        openSettings: () => undefined,
      },
    });
    expect(await bridge?.current()).toBeNull();
  });
});
