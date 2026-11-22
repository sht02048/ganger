import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toAgentRef, toWorktreeRef } from "@ganger/core";
import type { RunId } from "@ganger/core";
import { changeRunState, markAllTrackersChanged } from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import { TRACKER_DELAY_MS } from "./browser/slow-tracker-adapters.js";
import { navigationWorkspace, startNavigationWorld, watchedTicket } from "./navigation-world.js";
import type { NavigationWorld } from "./navigation-world.js";
import {
  PENDING_BAR_SELECTOR,
  navigateByRail,
  serverFnName,
  watchPendingBar,
  waitForScreen,
} from "./navigation-timing.js";

const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

let world: NavigationWorld;
let browser: Browser;

beforeAll(async () => {
  world = await startNavigationWorld();
  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: world.baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  for (const path of ["/runs", "/tickets", "/"]) {
    await warm.goto(`${path}?ws=${navigationWorkspace}`);
    await warm.waitForLoadState("networkidle");
  }
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await world?.close();
});

describe("레일로 화면 옮기기(브라우저, 0117)", () => {
  it("레일 링크에 포인터를 올리면 그 화면을 미리 읽어, 누를 때 느린 트래커를 기다리지 않는다", async (context) => {
    const page = await newPage(context);
    await open(page, "/runs", "runs");

    const preloaded = page.waitForResponse(
      (response) => serverFnName(response.url()) === "getTrackerTickets",
    );
    await page.getByRole("link", { name: /^Tickets/ }).hover();
    await (await preloaded).finished();

    const sample = await navigateByRail(page, "tickets", "first");
    expect(sample.ms).toBeLessThan(TRACKER_DELAY_MS);
  });

  it("한 번 본 화면은 다시 들어갈 때 지난 내용을 바로 그리고 뒤에서 새로 읽는다", async (context) => {
    const page = await newPage(context);
    await open(page, "/tickets", "tickets");
    await navigateByRail(page, "runs", "first");
    await page.mouse.move(0, 0);

    const again = await navigateByRail(page, "tickets", "again");
    expect(again.ms).toBeLessThan(TRACKER_DELAY_MS);
    expect(again.serverCalls.map((call) => call.name)).toContain("getTicketRuns");
  });

  it("다시 들어간 화면은 그사이 바뀐 런 상태를 반영한다", async (context) => {
    const page = await newPage(context);
    await open(page, "/runs", "runs");
    await page
      .locator("[data-waiting-card]")
      .getByRole("button")
      .filter({ hasText: watchedTicket })
      .waitFor();

    await navigateByRail(page, "dashboard", "first");
    start(world.db, world.watchedRun);
    await navigateByRail(page, "runs", "again");

    const running = page
      .locator("[data-runner-cards]")
      .getByRole("button")
      .filter({ hasText: watchedTicket });
    await running.waitFor();
    expect(await running.count()).toBe(1);
  });
});

describe("원격에서 화면 옮기기(브라우저, 0122)", () => {
  it("서버에 담아 둔 트래커 읽기 덕에 바로 누른 Tickets 첫 방문도 트래커를 기다리지 않는다", async (context) => {
    const page = await newPage(context);
    await open(page, "/runs", "runs");
    await page.mouse.move(0, 0);

    const sample = await navigateByRail(page, "tickets", "first");
    expect(sample.ms).toBeLessThan(TRACKER_DELAY_MS);
  });

  it("첫 클라이언트 이동은 온보딩 완료를 다시 묻지 않아, 화면 이동 한 번에 서버 왕복이 한 번이다", async (context) => {
    const page = await newPage(context);
    await open(page, "/runs", "runs");
    await page.mouse.move(0, 0);

    const dashboard = await navigateByRail(page, "dashboard", "first");
    expect(dashboard.serverCalls.map((call) => call.name)).toEqual(["getHomePage"]);
    const stats = await navigateByRail(page, "stats", "first");
    expect(stats.serverCalls.map((call) => call.name)).toEqual(["getStatsPage"]);
  });

  it("빨리 끝나는 이동에는 진행 표시가 나타나지 않는다", async (context) => {
    const page = await newPage(context);
    await open(page, "/runs", "runs");
    await page.mouse.move(0, 0);

    const seen = await watchPendingBar(page);
    await navigateByRail(page, "dashboard", "first");
    expect(await seen()).toBe(false);
  });

  it("화면 이동이 아닌 다시 읽기(Linear에서 다시 읽기)에는 진행 줄을 켜지 않는다", async (context) => {
    const page = await newPage(context);
    await open(page, "/tickets", "tickets");

    const seen = await watchPendingBar(page);
    const started = Date.now();
    await page.getByRole("button", { name: tickets.reread.action }).click();
    await page.getByText(tickets.reread.done).first().waitFor();
    expect(Date.now() - started).toBeGreaterThanOrEqual(TRACKER_DELAY_MS);
    expect(await seen()).toBe(false);
  });

  it("트래커를 기다리는 늦은 이동은 본문 맨 위에 진행 표시와 상태 문장을 두고, 끝나면 걷는다", async (context) => {
    const page = await newPage(context);
    await open(page, "/runs", "runs");
    await page.mouse.move(0, 0);
    markAllTrackersChanged(world.db);

    const navigation = navigateByRail(page, "tickets", "first");
    await page.locator(PENDING_BAR_SELECTOR).waitFor({ state: "visible" });
    await expect.poll(() => page.locator("main").getAttribute("aria-busy")).toBe("true");
    await expect.poll(() => page.getByRole("status").first().innerText()).not.toBe("");
    const sample = await navigation;

    expect(sample.ms).toBeGreaterThanOrEqual(TRACKER_DELAY_MS);
    await page.locator(PENDING_BAR_SELECTOR).waitFor({ state: "detached" });
    expect(await page.locator("main").getAttribute("aria-busy")).toBeNull();
  });
});

function start(database: Database, id: RunId): void {
  const change = changeRunState(
    database,
    id,
    {
      to: "running",
      started: {
        worktree: toWorktreeRef("wt-acme-7"),
        branch: "acme/acme-7",
        agentRef: toAgentRef("agent-acme-7"),
      },
    },
    new Date(),
  );
  if (!change.ok) throw new Error(JSON.stringify(change));
}

async function newPage(context: TestContext): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: world.baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 800 },
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

async function open(page: Page, path: string, screen: "runs" | "tickets"): Promise<void> {
  await page.goto(`${path}?ws=${navigationWorkspace}`);
  await waitForScreen(page, screen);
  await page.waitForLoadState("networkidle");
}
