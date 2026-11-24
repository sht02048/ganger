import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_NAVIGATION_GLOBAL, navShortcuts } from "@ganger/app/shell/nav-shortcuts";
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
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { waitForRouterIdle } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));
const screenshotDir = process.env["NAV_SHORTCUTS_SCREENSHOTS"];

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const encryptionKey = new Uint8Array(32).fill(7);

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
  dir = mkdtempSync(join(tmpdir(), "ganger-nav-shortcuts-"));
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

describe("화면 이동 단축키(브라우저, 0102)", () => {
  it("웹 브라우저에서는 Mod+1~5, Mod+, 를 등록하지 않아 화면을 옮기지 않고, 보이는 이름을 되풀이하는 툴팁도 없다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await open(page, "/runs");
    await markDocument(page);

    for (const item of navShortcuts) await page.keyboard.press(playwrightKey(item.shortcut));
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe("/runs");
    expect(await documentMarked(page)).toBe(true);

    for (const item of navShortcuts) {
      const link = page.getByRole("link", { name: shell.nav[item.screen], exact: true });
      expect(await link.getAttribute("aria-keyshortcuts")).toBeNull();
    }
    await page.getByRole("link", { name: shell.nav.runs, exact: true }).hover();
    await page.waitForTimeout(1_000);
    expect(await page.getByRole("tooltip").filter({ visible: true }).count()).toBe(0);
  });

  it("데스크톱 앱 안에서는 툴팁에 이름과 키를 함께 보이고 aria-keyshortcuts 로 알린다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withDesktopBridge(page);
    await open(page, "/");
    const isMac = await page.evaluate(() => /Mac/.test(navigator.platform));
    for (const item of navShortcuts) {
      const link = page.getByRole("link", { name: shell.nav[item.screen], exact: true });
      await expect
        .poll(() => link.getAttribute("aria-keyshortcuts"))
        .toBe(item.shortcut.replace("Mod", isMac ? "Meta" : "Control"));
    }

    await page.getByRole("link", { name: shell.nav.runs, exact: true }).hover();
    const tooltip = page.getByRole("tooltip").filter({ hasText: shell.nav.runs });
    await tooltip.waitFor();
    expect((await tooltip.innerText()).replace(/[\u2066\u2069\s]/g, "")).toBe(
      `${shell.nav.runs}${isMac ? "⌘3" : "Ctrl+3"}`,
    );
    if (screenshotDir !== undefined) {
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, "rail-tooltip-desktop-1280.png") });
    }
  });

  it("데스크톱 메뉴가 보낸 화면으로 입력칸에 포커스가 있어도 문서를 다시 읽지 않고 옮기고, 그 화면의 레일 링크에 포커스를 두고 Workspace 를 지킨다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await withDesktopBridge(page);
    await open(page, "/tickets");
    await markDocument(page);
    const search = page.getByRole("searchbox", { name: tickets.search.label });
    await search.fill("ACME");
    await search.focus();

    const menuSends = (screen: string) =>
      page.evaluate((detail) => dispatchEvent(new CustomEvent("menu-sends", { detail })), screen);
    for (const item of navShortcuts) {
      await menuSends(item.screen);
      await waitForRouterIdle(page, item.screen === "settings" ? "/settings/general" : item.path);
      const link = page.getByRole("link", { name: shell.nav[item.screen], exact: true });
      expect(await link.getAttribute("aria-current")).toBe("page");
      await expect
        .poll(() => link.evaluate((element) => element === document.activeElement))
        .toBe(true);
      expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);
    }
    await menuSends("onboarding");
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 1_000 })
      .toBe("/settings/general");
    expect(await documentMarked(page)).toBe(true);
  });

  it.for(["/tickets", "/onboarding"])(
    "트레이의 알림 설정은 %s 에서도 문서를 다시 읽지 않고 Settings 알림 페이지로 옮긴다(0214)",
    async (path, context) => {
      const page = await newPage(context, { width: 1280, height: 800 });
      await withDesktopBridge(page);
      await open(page, path);
      await markDocument(page);
      await page.evaluate(() =>
        dispatchEvent(new CustomEvent("page-sends", { detail: "notifications" })),
      );
      await page.waitForURL((url) => url.pathname === "/settings/notifications");
      expect(await documentMarked(page)).toBe(true);
    },
  );
});

async function withDesktopBridge(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    const listeners: Array<(screen: unknown) => void> = [];
    const pageListeners: Array<(page: unknown) => void> = [];
    Object.assign(globalThis, {
      [name]: {
        onNavigate: (listener: (screen: unknown) => void) => {
          listeners.push(listener);
          return () => listeners.splice(listeners.indexOf(listener), 1);
        },
        onOpenPage: (listener: (page: unknown) => void) => {
          pageListeners.push(listener);
          return () => pageListeners.splice(pageListeners.indexOf(listener), 1);
        },
      },
    });
    addEventListener("menu-sends", (event) => {
      if (event instanceof CustomEvent) for (const listener of listeners) listener(event.detail);
    });
    addEventListener("page-sends", (event) => {
      if (event instanceof CustomEvent)
        for (const listener of pageListeners) listener(event.detail);
    });
  }, DESKTOP_NAVIGATION_GLOBAL);
}

function playwrightKey(shortcut: string): string {
  return shortcut.replace(/^Mod\+/, "ControlOrMeta+");
}

async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.assign(globalThis, { navShortcutsDocumentMarker: true });
  });
}

function documentMarked(page: Page): Promise<boolean> {
  return page.evaluate(() => "navShortcutsDocumentMarker" in globalThis);
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

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${path}?ws=${workspaceId}`);
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
