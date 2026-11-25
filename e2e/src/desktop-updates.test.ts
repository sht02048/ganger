import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_UPDATES_GLOBAL } from "@ganger/app/updates/view";
import type { UpdateView } from "@ganger/app/updates/view";
import {
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import {
  SecretBox,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Locator, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import ds from "../../apps/web/messages/ko/ds.json" with { type: "json" };
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));
const screenshotDir = process.env["UPDATE_SCREENSHOTS"];
const SCREENSHOT_WIDTHS = [1728, 1280, 1100, 800, 400] as const;

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const encryptionKey = new Uint8Array(32).fill(7);
const NOTES = "https://github.com/acme/ganger/releases/tag/v0.2.0";

const READY: UpdateView = {
  appVersion: "0.1.0",
  server: { kind: "app", version: "0.1.0" },
  autoUpdate: true,
  lastCheckedAt: "2026-11-19T08:48:00.000Z",
  latest: { version: "0.2.0", notesUrl: NOTES },
  check: { kind: "ready", version: "0.2.0", notesUrl: NOTES },
  toast: { kind: "ready", version: "0.2.0", notesUrl: NOTES },
};

const UPDATED: UpdateView = {
  ...READY,
  appVersion: "0.2.0",
  server: { kind: "app", version: "0.2.0" },
  latest: null,
  check: { kind: "latest" },
  toast: { kind: "updated", version: "0.2.0", notesUrl: NOTES },
};

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;

const fakeAdapters: Plugin = {
  name: "e2e-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-desktop-updates-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await open(warm, "/");
  await open(warm, "/settings/server");
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("데스크톱 업데이트 토스트(브라우저, 0083)", () => {
  it("다 받으면 오른쪽 아래에 뜨고, 포커스를 빼앗지 않고, 화면 읽기에 한 번 알리고, 저절로 닫히지 않는다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withUpdates(page, READY);
    await open(page, "/");
    const toast = pinnedToast(page);
    await toast.waitFor();

    const title = `새 버전 0.2.0을 받았어요`;
    expect(await page.getByRole("region", { name: title }).count()).toBe(1);
    await expect.poll(() => toast.getByRole("status").innerText()).toBe(title);
    expect(await toast.evaluate((element) => element.contains(document.activeElement))).toBe(false);

    const box = await toast.boundingBox();
    if (box === null) throw new Error("toast has no box");
    expect(box.x + box.width).toBeGreaterThan(1280 - 64);
    expect(box.y + box.height).toBeGreaterThan(800 - 64);

    await page.waitForTimeout(8_000);
    expect(await toast.isVisible()).toBe(true);
    await shotAtWidths(page, "toast-ready");

    await page.setViewportSize({ width: 400, height: 800 });
    const settingsLink = page.getByRole("link", { name: shell.nav.settings, exact: true });
    const narrow = await toast.boundingBox();
    const link = await settingsLink.boundingBox();
    if (narrow === null || link === null) throw new Error("no box");
    expect(narrow.x).toBeGreaterThanOrEqual(link.x + link.width);
  });

  it("다른 토스트가 와도 밀려나지 않고 그 위에 다른 토스트가 쌓인다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withUpdates(page, READY);
    await page.goto("/ds");
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    const toast = pinnedToast(page);
    await toast.waitFor();
    const before = await settledBox(toast);

    await page.getByRole("button", { name: ds.toast.trigger }).click();
    const other = page.locator('[data-slot="toast-region"] li').filter({
      hasText: ds.toast.message,
    });
    await other.waitFor();
    const otherBox = await settledBox(other);
    const after = await settledBox(toast);
    if (before === null || otherBox === null || after === null) throw new Error("toast has no box");
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    expect(otherBox.y + otherBox.height).toBeLessThanOrEqual(after.y + 1);

    await other.waitFor({ state: "detached", timeout: 15_000 });
    expect(await toast.isVisible()).toBe(true);
    const settled = await settledBox(toast);
    expect(Math.abs((settled?.y ?? 0) - before.y)).toBeLessThan(1);
  });

  it("키보드로 나중에를 눌러 닫으면 토스트에 들어오기 전 자리로 포커스를 돌려준다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withUpdates(page, READY);
    await open(page, "/");
    const toast = pinnedToast(page);
    const dashboard = page.getByRole("link", { name: shell.nav.dashboard, exact: true });
    await dashboard.focus();
    await toast.getByRole("button", { name: shell.update.ready.later }).focus();
    await page.keyboard.press("Enter");
    await toast.waitFor({ state: "detached" });
    await expect
      .poll(() => dashboard.evaluate((element) => element === document.activeElement))
      .toBe(true);
  });

  it("떠 있는 동안 높이를 알려 목록이 그만큼 아래 여백을 둔다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withUpdates(page, READY);
    await open(page, "/settings/server");
    await pinnedToast(page).waitFor();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue("--pinned-toast-space"),
        ),
      )
      .toMatch(/^\d+(\.\d+)?px$/);
  });

  it("스크롤 끝의 컨트롤에 포커스가 가도 토스트 아래에 가려지지 않는다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withUpdates(page, READY);
    await open(page, "/");
    const toast = pinnedToast(page);
    await toast.waitFor();
    await page.evaluate(() => {
      const scroller = document.createElement("div");
      scroller.style.cssText = "position:fixed;inset:0;overflow:auto;z-index:1";
      const filler = document.createElement("div");
      filler.style.cssText = "position:relative;height:100vh";
      const last = document.createElement("button");
      last.textContent = "last";
      const wide = document.createElement("div");
      wide.style.cssText = "position:absolute;right:40px;bottom:20px;overflow-x:auto";
      wide.append(last);
      filler.append(wide);
      scroller.append(filler);
      document.body.append(scroller);
    });
    const last = page.getByRole("button", { name: "last", exact: true });
    await last.focus();
    const covered = await toast.boundingBox();
    if (covered === null) throw new Error("toast has no box");
    await expect
      .poll(async () => {
        const box = await last.boundingBox();
        return box === null ? Number.POSITIVE_INFINITY : box.y + box.height;
      })
      .toBeLessThanOrEqual(covered.y);
  });

  it("나중에를 누르면 닫히고, 다시 시작을 누르면 앱에 다시 시작을 보낸다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withUpdates(page, READY);
    await open(page, "/");
    const toast = pinnedToast(page);
    await toast.getByRole("button", { name: shell.update.ready.restart }).click();
    expect(await actions(page)).toEqual(["restart"]);

    await toast.getByRole("button", { name: shell.update.ready.later }).click();
    await toast.waitFor({ state: "detached" });
    expect(await actions(page)).toEqual(["restart", "later"]);
  });

  it("바꾼 뒤에는 바꾼 버전과 바뀐 내용 링크를 보이고 닫기로 닫는다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withUpdates(page, UPDATED);
    await open(page, "/");
    const toast = pinnedToast(page);
    await page.getByRole("region", { name: "0.2.0으로 바꿨어요" }).waitFor();
    expect(
      await toast.getByRole("link", { name: shell.update.updated.notes }).getAttribute("href"),
    ).toBe(NOTES);
    await shot(page, "toast-updated-1280");
    await toast.getByRole("button", { name: shell.update.updated.close }).click();
    await toast.waitFor({ state: "detached" });
    expect(await actions(page)).toEqual(["dismiss-updated"]);
  });

  it("브라우저(데스크톱 앱 밖)에서는 업데이트 토스트를 그리지 않는다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await open(page, "/");
    await page.waitForTimeout(500);
    expect(await pinnedToast(page).count()).toBe(0);
  });
});

describe("Settings 업데이트 줄(브라우저, 0083·0119)", () => {
  it("서버 페이지의 버전 묶음에 버전과 마지막 확인, 지금 확인, 자동 업데이트 스위치를 두고 앱에 보낸다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withUpdates(page, { ...READY, toast: null, check: { kind: "latest" }, latest: null });
    await open(page, "/settings/server");
    const server = page.getByRole("region", { name: settings.server.version });
    await server.getByText("0.1.0 · 앱과 서버가 같아요").waitFor();
    await server.scrollIntoViewIfNeeded();
    await shotAtWidths(page, "settings-updates");

    await server.getByRole("button", { name: settings.updates.checkNow }).click();
    await server.getByRole("switch", { name: settings.updates.auto }).click();
    expect(await actions(page)).toEqual(["check-now", "auto-off"]);
  });

  it("브라우저로 열면 자동 업데이트가 없다는 한 줄만 둔다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await open(page, "/settings/server");
    const server = page.getByRole("region", { name: settings.server.version });
    await server
      .getByText("· 이 서버는 자동으로 업데이트하지 않아요", { exact: false })
      .filter({ visible: true })
      .waitFor();
    expect(await server.getByRole("button", { name: settings.updates.checkNow }).count()).toBe(0);
  });
});

async function settledBox(locator: Locator): Promise<Awaited<ReturnType<Locator["boundingBox"]>>> {
  await locator.evaluate((element) =>
    Promise.allSettled(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    ),
  );
  return locator.boundingBox();
}

function pinnedToast(page: Page): Locator {
  return page.locator('[data-slot="pinned-toast"] > section');
}

async function withUpdates(page: Page, initial: UpdateView): Promise<void> {
  await page.addInitScript(
    ({ name, view }) => {
      let current: unknown = view;
      const acted: string[] = [];
      const listeners: Array<(value: unknown) => void> = [];
      const push = (next: unknown) => {
        current = next;
        for (const listener of listeners) listener(next);
      };
      Object.assign(globalThis, {
        updateActions: acted,
        [name]: {
          getUpdate: () => Promise.resolve(current),
          onUpdate: (listener: (value: unknown) => void) => {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
          },
          act: (action: string) => {
            acted.push(action);
            if (typeof current === "object" && current !== null) {
              if (action === "later" || action === "dismiss-updated")
                push({ ...current, toast: null });
              if (action === "auto-off") push({ ...current, autoUpdate: false });
              if (action === "auto-on") push({ ...current, autoUpdate: true });
            }
            return Promise.resolve();
          },
        },
      });
    },
    { name: DESKTOP_UPDATES_GLOBAL, view: initial },
  );
}

function actions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(globalThis, "updateActions");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  });
}

async function shot(page: Page, name: string): Promise<void> {
  if (screenshotDir === undefined) return;
  mkdirSync(screenshotDir, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
}

async function shotAtWidths(page: Page, name: string): Promise<void> {
  if (screenshotDir === undefined) return;
  for (const width of SCREENSHOT_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await shot(page, `${name}-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function newPage(
  context: TestContext,
  viewport: { width: number; height: number },
): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport,
  });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  return page;
}

async function open(page: Page, path: string, search: Record<string, string> = {}): Promise<void> {
  const query = new URLSearchParams({ ws: workspaceId, ...search });
  await page.goto(`${path}?${query.toString()}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

function seed(db: Database): void {
  saveTrackerConnection(db, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(db, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(db, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(db, { connection, trackerProject, runnerProject, agent: toAgentId("claude") });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
}
