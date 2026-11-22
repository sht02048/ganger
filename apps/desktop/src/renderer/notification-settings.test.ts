/// <reference lib="dom" />

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import screens from "../../messages/ko/screens.json" with { type: "json" };
import type { NotificationSettingsApi, NotificationSettingsView } from "../shared/view.js";

const desktopRoot = fileURLToPath(new URL("../..", import.meta.url));
const t = screens.notificationSettings;

let dir: string;
let server: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

const allOn: NotificationSettingsView = {
  enabled: true,
  groups: {
    question: true,
    permission: true,
    humanCheckRequest: true,
    failedDisconnected: true,
    runnerIssue: true,
  },
  permission: "allowed",
  deviceLink: "connected",
};

function installFakeNotifications(first: NotificationSettingsView) {
  const calls: unknown[] = [];
  const viewListeners = new Set<(view: NotificationSettingsView) => void>();
  Object.assign(window, { notificationCalls: calls });
  const api: NotificationSettingsApi = {
    getNotificationSettings: () => Promise.resolve(first),
    onNotificationSettings: (listener) => {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    setNotificationSettings: (settings) => {
      calls.push({ set: settings });
      return Reflect.get(window, "failSave") === true
        ? Promise.reject(new Error("save failed"))
        : Promise.resolve();
    },
    reconnectDevice: () => {
      calls.push("reconnect");
      for (const listener of viewListeners) listener({ ...first, deviceLink: "reconnected" });
      return Promise.resolve();
    },
    openSystemNotificationSettings: () => {
      calls.push("open-system");
      return Promise.resolve();
    },
  };
  window.desktopNotifications = api;
}

async function openSettings(first: NotificationSettingsView): Promise<void> {
  await page.addInitScript(installFakeNotifications, first);
  await page.goto(`${baseUrl}?window=notifications`);
  await page.getByRole("heading", { level: 1, name: t.title }).waitFor();
}

async function calls(): Promise<unknown[]> {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, "notificationCalls");
    return Array.isArray(value) ? value.map((item: unknown): unknown => item) : [];
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desktop-notification-settings-"));
  server = await createServer({
    configFile: join(desktopRoot, "vite.renderer.config.ts"),
    root: join(desktopRoot, "src/renderer"),
    cacheDir: join(dir, "vite-cache"),
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
  });
  await server.listen();
  const address = server.resolvedUrls?.local[0];
  if (address === undefined) throw new Error("renderer dev server has no address");
  baseUrl = address;
  browser = await chromium.launch({ channel: "chrome" });
  const warm = await browser.newPage();
  await warm.goto(baseUrl, { waitUntil: "networkidle", timeout: 110_000 });
  await warm.close();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  page = await browser.newPage({ locale: "ko-KR", viewport: { width: 560, height: 760 } });
  page.setDefaultTimeout(30_000);
});

afterEach(async (test) => {
  const shots = process.env["NOTIFICATION_SETTINGS_SCREENSHOTS"];
  if (shots !== undefined && shots.length > 0) {
    mkdirSync(shots, { recursive: true });
    const name = test.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  }
  await page.close();
});

describe("알림 설정 창(브라우저, 0103)", () => {
  it("알림 전체와 종류별 다섯 줄을 보이고, 권한이 켜져 있으면 안내를 보이지 않는다", async () => {
    await openSettings(allOn);
    expect(await page.getByText(t.permissionOff.title).count()).toBe(0);
    for (const group of Object.values(t.groups)) {
      expect(
        await page.getByRole("checkbox", { name: group.label }).getAttribute("aria-checked"),
      ).toBe("true");
    }
    expect(
      await page.getByRole("checkbox", { name: t.enabled.label }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(await page.evaluate(() => document.activeElement?.tagName === "H1")).toBe(true);
  });

  it("기기가 지워지면 다시 연결 안내를 보이고, 누르기 전에는 등록하지 않는다", async () => {
    await openSettings({ ...allOn, deviceLink: "rejected" });
    const callout = page.getByRole("region", { name: t.deviceLink.title });
    await callout.waitFor();
    await callout.getByRole("button", { name: t.deviceLink.action }).waitFor();
    expect(await calls()).toEqual([]);
  });

  it("다시 연결에 실패하면 이유를 보이고 다시 누를 수 있다", async () => {
    await openSettings({ ...allOn, deviceLink: "failed" });
    const callout = page.getByRole("region", { name: t.deviceLink.title });
    await callout.getByText(t.deviceLink.failed).waitFor();
    expect(await callout.getByRole("button", { name: t.deviceLink.action }).isEnabled()).toBe(true);
    expect(await page.getByText(t.deviceLink.done).count()).toBe(0);
  });

  it("다시 연결하지 않고 연결 상태가 되면 성공 문구를 보이지 않는다", async () => {
    await openSettings(allOn);
    await page.getByRole("heading", { name: t.title }).waitFor();
    expect(await page.getByText(t.deviceLink.done).count()).toBe(0);
  });

  it("다시 연결을 누르면 등록하고, 안내가 사라져도 포커스를 지킨다", async () => {
    await openSettings({ ...allOn, deviceLink: "rejected" });
    const callout = page.getByRole("region", { name: t.deviceLink.title });
    await callout.getByRole("button", { name: t.deviceLink.action }).click();

    await page.getByRole("status").getByText(t.deviceLink.done).waitFor();
    expect(await calls()).toEqual(["reconnect"]);
    expect(await callout.count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.tagName === "H1")).toBe(true);
  });

  it("macOS 에서 알림이 꺼져 있으면 맨 위에 안내와 시스템 설정 버튼을 보인다", async () => {
    await openSettings({ ...allOn, permission: "denied" });
    const callout = page.getByRole("region", { name: t.permissionOff.title });
    await callout.waitFor();
    const top = await callout.evaluate((el) => {
      const main = el.closest("main");
      const h1 = main?.querySelector("h1");
      const checkbox = main?.querySelector('[role="checkbox"]');
      return {
        afterTitle:
          h1 !== null &&
          h1 !== undefined &&
          el.getBoundingClientRect().top > h1.getBoundingClientRect().top,
        beforeControls:
          checkbox !== null &&
          checkbox !== undefined &&
          el.getBoundingClientRect().top < checkbox.getBoundingClientRect().top,
      };
    });
    expect(top).toEqual({ afterTitle: true, beforeControls: true });
    await callout.getByRole("button", { name: t.permissionOff.action }).click();
    await expect.poll(calls).toContain("open-system");
  });

  it("종류 하나를 끄면 그 값만 저장하고, 전체를 끄면 종류는 고를 수 없다", async () => {
    await openSettings(allOn);
    await page.getByRole("checkbox", { name: t.groups.failedDisconnected.label }).click();
    await expect.poll(calls).toContainEqual({
      set: { enabled: true, groups: { ...allOn.groups, failedDisconnected: false } },
    });
    await page.getByRole("checkbox", { name: t.enabled.label }).click();
    await expect.poll(calls).toContainEqual({
      set: { enabled: false, groups: { ...allOn.groups, failedDisconnected: false } },
    });
    await page.getByText(t.groupsOff).waitFor();
    expect(
      await page
        .getByRole("checkbox", { name: t.groups.question.label })
        .evaluate(
          (el) => el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
        ),
    ).toBe(true);
  });

  it("저장에 실패하면 바꾸기 전 값으로 되돌린다", async () => {
    await openSettings(allOn);
    await page.evaluate(() => Reflect.set(window, "failSave", true));
    const question = page.getByRole("checkbox", { name: t.groups.question.label });
    await question.click();
    await expect.poll(calls).toHaveLength(1);
    await expect.poll(() => question.getAttribute("aria-checked")).toBe("true");
  });

  it("좁은 창에서도 가로로 넘치지 않는다", async () => {
    await page.setViewportSize({ width: 400, height: 760 });
    await openSettings({ ...allOn, permission: "denied" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
