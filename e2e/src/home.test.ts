/// <reference lib="dom" />

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toAgentRef,
  toCodeHostKind,
  toLabelId,
  toPermissionRequestId,
  toQuestionId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
  toWorktreeRef,
} from "@ganger/core";
import type { RunId, TicketKey } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  listRunQuestions,
  migrate,
  openDatabase,
  recordPermissionWaits,
  recordRunQuestions,
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
import type { Browser, BrowserContext, Locator, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import questionJson from "../../apps/web/messages/ko/question.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerKind = toRunnerKind("fake");
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let context: BrowserContext;
let page: Page;
const runIds = new Map<string, RunId>();

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
  dir = mkdtempSync(join(tmpdir(), "ganger-home-"));
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
  await openHome(warm);
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

beforeEach(async (test) => {
  context = await browser.newContext({ baseURL: baseUrl, locale: "ko-KR" });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = test.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

const longChoice =
  "Keep the cache in SQLite so that it survives restarts, and add a nightly job that removes entries older than thirty days from every table";

const settledKeys = ["ACME-50", "ACME-51", "ACME-52", "ACME-53", "ACME-54", "ACME-55"];

function doneHeadLink(target: Page): Locator {
  const name = new RegExp(
    `^${home.board.doneLink.replace("{column}", home.column.done).replace("{count}", "\\d+")}$`,
  );
  return target.getByRole("region", { name: home.column.done }).getByRole("link", { name });
}

function settledCards(target: Page): Locator {
  return target
    .getByRole("region", { name: home.column.done })
    .locator("[data-settled] li[data-run]");
}

describe("Done 칸 머리 링크(브라우저, 0186)", () => {
  it("머리를 누르면 문서를 다시 불러오지 않고 끝난 런 모두를 보여 주는 Runs 로 간다", async () => {
    await openHome(page);
    await page.evaluate(() => {
      Object.assign(globalThis, { doneHeadMarker: true });
    });
    await doneHeadLink(page).click();
    await page.waitForURL((url) => url.pathname === "/runs");
    const url = new URL(page.url());
    expect(url.searchParams.get("ws")).toBe(workspaceId);
    expect(url.searchParams.get("view")).toBe("all");
    expect(await page.evaluate(() => "doneHeadMarker" in globalThis)).toBe(true);
  });

  it("수정 키로 누르면 Dashboard 를 그대로 두고 새 탭으로 연다", async () => {
    await openHome(page);
    const opened = context.waitForEvent("page");
    await doneHeadLink(page).click({ modifiers: ["ControlOrMeta"] });
    const tab = await opened;
    try {
      await tab.waitForURL((url) => url.pathname === "/runs");
      expect(new URL(page.url()).pathname).toBe("/");
    } finally {
      await tab.close();
    }
  });

  it("처리할 일 없이 끝난 카드는 5장만 보이고, 숨은 카드를 패널로 열면 그 카드도 보인다", async () => {
    await openHome(page);
    expect(await settledCards(page).count()).toBe(5);
    const shown = await settledCards(page).allInnerTexts();
    const hidden = settledKeys.find((key) => !shown.some((text) => text.includes(key)));
    if (hidden === undefined) throw new Error("no hidden settled card");
    await page.goto(`/?ws=${workspaceId}&run=${runIds.get(hidden)}`);
    await hydrated(page);
    const panel = page.getByRole("dialog");
    await panel.getByRole("heading", { name: new RegExp(hidden) }).waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    expect(await settledCards(page).count()).toBe(6);
    expect(await focusedSoon(cardButton(page, hidden))).toBe(true);
  });
});

describe("알림에서 Dashboard 열기(브라우저, 0103)", () => {
  it("주소의 run 으로 그 카드 상세 패널을 연 채로 열고, 주소에서 run 을 지운다", async () => {
    await page.goto(`/?ws=${workspaceId}&run=${runIds.get("ACME-34")}`);
    await hydrated(page);
    const panel = page.getByRole("dialog");
    await panel.getByRole("heading", { name: /ACME-34/ }).waitFor();
    await page.waitForURL((url) => !url.searchParams.has("run"));
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    expect(await focusedSoon(cardButton(page, "ACME-34"))).toBe(true);
  });

  it("접힌 칸의 카드도 펼쳐 그린 뒤 패널을 열고, 닫으면 그 카드로 포커스가 돌아온다", async () => {
    for (const key of ["ACME-30", "ACME-31", "ACME-32", "ACME-33", "ACME-34"]) {
      await page.goto(`/?ws=${workspaceId}&run=${runIds.get(key)}`);
      await hydrated(page);
      const panel = page.getByRole("dialog");
      await panel.getByRole("heading", { name: new RegExp(key) }).waitFor();
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      expect(await focusedSoon(cardButton(page, key))).toBe(true);
    }
  });

  it("Question 런은 답하기 상태로 열어 첫 선택지에 포커스를 준다", async () => {
    await page.goto(`/?ws=${workspaceId}&run=${runIds.get("ACME-1")}`);
    await hydrated(page);
    expect(await focusedSoon(page.getByRole("dialog").getByRole("radio", { name: "SQLite" }))).toBe(
      true,
    );
  });
});

describe("Dashboard 상세 패널(브라우저, 0100)", () => {
  it("카드를 누르면 패널이 열리고 닫기·Escape·바깥 누르기로 닫으면 포커스가 카드로 돌아온다", async () => {
    await openHome(page);
    const open = cardButton(page, "ACME-34");
    const panel = page.getByRole("dialog");

    await open.click();
    await panel.getByRole("heading", { name: /ACME-34/ }).waitFor();
    expect(await panel.getByRole("link", { name: home.sheet.runDetail }).getAttribute("href")).toBe(
      `/runs/${runIds.get("ACME-34")}?ws=${workspaceId}`,
    );
    await panel.getByRole("button", { name: home.sheet.close }).click();
    await panel.waitFor({ state: "hidden" });
    expect(await focusedSoon(open)).toBe(true);

    await page.keyboard.press("Enter");
    await panel.waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    expect(await focusedSoon(open)).toBe(true);

    await open.click();
    await panel.waitFor();
    await page.mouse.click(20, 400);
    await panel.waitFor({ state: "hidden" });
    expect(await focusedSoon(open)).toBe(true);
  });

  it("답하기는 패널을 Question 상태로 열고 첫 선택지에 포커스를 준다", async () => {
    await openHome(page);
    await card(page, "ACME-1").getByRole("button", { name: home.card.answer }).click();
    const panel = page.getByRole("dialog");
    expect(await focusedSoon(panel.getByRole("radio", { name: "SQLite" }))).toBe(true);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    expect(await focusedSoon(cardButton(page, "ACME-1"))).toBe(true);
  });

  it("고르기 전 보내기는 고르라고 알리고, 골라도 보내지 않으며, 보내기를 눌러야 보낸 뒤 결과를 status 로 알린다", async () => {
    await openHome(page);
    await card(page, "ACME-4").getByRole("button", { name: home.card.answer }).click();
    const panel = page.getByRole("dialog");
    const send = panel.getByRole("button", { name: questionJson.send });
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await send.click();
    await panel.getByRole("alert").getByText(questionJson.pick).waitFor();
    expect(await panel.getByText(questionJson.pick).count()).toBe(1);
    expect(await focusedSoon(panel.getByRole("radio", { name: "Yes" }))).toBe(true);
    await panel.getByRole("radio", { name: "No" }).check();
    await panel.getByRole("radio", { name: "Yes" }).check();
    expect(await panel.getByText(questionJson.pick).count()).toBe(0);
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
    expect(unansweredQuestions("ACME-4")).toEqual(["q-4"]);

    await send.click();
    const status = panel.getByRole("status");
    await status.getByText(home.question.answered).waitFor();
    expect(await focusedSoon(status)).toBe(true);
    expect(answerOf("ACME-4")).toBe("Yes");
    await card(page, "ACME-4").getByText(home.card.answered).waitFor();
  });

  it("화살표로 직접 쓰기에 닿으면 포커스는 라디오에 남고, Enter 로 고르면 글쓰기 칸으로 간다(0116)", async () => {
    await openHome(page);
    await card(page, "ACME-3").getByRole("button", { name: home.card.answer }).click();
    const panel = page.getByRole("dialog");
    const other = panel.getByRole("radio", { name: questionJson.other });
    expect(await focusedSoon(panel.getByRole("radio").first())).toBe(true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await other.isChecked()).toBe(true);
    expect(await focusedSoon(other)).toBe(true);
    await page.keyboard.press("Enter");
    expect(await focusedSoon(panel.getByLabel(questionJson.otherLabel))).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await panel.getByRole("button", { name: questionJson.send }).click();
    await panel.getByRole("alert").getByText(questionJson.empty).waitFor();
    expect(await focusedSoon(panel.getByLabel(questionJson.otherLabel))).toBe(true);
    await page.keyboard.press("Escape");
  });

  it("나눌 선택지가 없는 질문은 라디오 없이 답 칸에 바로 쓰고 ⌘ Enter 로 보낸다(0116)", async () => {
    await openHome(page);
    await card(page, "ACME-6").getByRole("button", { name: home.card.answer }).click();
    const panel = page.getByRole("dialog");
    const input = panel.getByLabel(questionJson.answerLabel);
    expect(await focusedSoon(input)).toBe(true);
    expect(await panel.getByRole("radio").count()).toBe(0);
    await page.keyboard.press("ControlOrMeta+Enter");
    await panel.getByRole("alert").getByText(questionJson.empty).waitFor();
    expect(unansweredQuestions("ACME-6")).toEqual(["q-6"]);
    await input.fill("Ship it on Friday.");
    await page.keyboard.press("ControlOrMeta+Enter");
    await panel.getByRole("status").getByText(home.question.answered).waitFor();
    expect(answerOf("ACME-6")).toBe("Ship it on Friday.");
  });

  it("선택지에서 Enter 를 누르면 고르기만 하고 보내지 않는다(0066)", async () => {
    await openHome(page);
    await card(page, "ACME-1").getByRole("button", { name: home.card.answer }).click();
    const panel = page.getByRole("dialog");
    expect(await focusedSoon(panel.getByRole("radio", { name: "SQLite" }))).toBe(true);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
    expect(await panel.getByRole("radio", { name: "In memory" }).isChecked()).toBe(true);
    expect(unansweredQuestions("ACME-1")).toEqual(["q-1"]);
  });

  it("패널이 열린 화면에서 노란 주 버튼은 패널 안의 보내기 하나뿐이다(ADR 0010 6번)", async () => {
    await openHome(page);
    await card(page, "ACME-1").getByRole("button", { name: home.card.answer }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "SQLite" }).waitFor();
    const primary = await page
      .locator('[data-variant="primary"]')
      .evaluateAll((els) =>
        els.filter((el) => el.getClientRects().length > 0).map((el) => el.textContent),
      );
    expect(primary).toEqual([questionJson.send]);
  });

  it("긴 선택지 문구는 패널 안에서 줄을 바꿔 다 보인다", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openHome(page);
    await card(page, "ACME-3").getByRole("button", { name: home.card.answer }).click();
    const text = page.getByRole("dialog").getByText(longChoice, { exact: true });
    await page.getByRole("dialog").evaluate(async (dialog) => {
      while (dialog.hasAttribute("data-starting-style")) {
        await new Promise(requestAnimationFrame);
      }
      await new Promise(requestAnimationFrame);
      await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
    });
    const box = await text.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      const dialog = el.closest('[role="dialog"]')?.getBoundingClientRect();
      return {
        clipped: el.scrollWidth > el.clientWidth,
        lines: Math.round(rect.height / lineHeight),
        inside: dialog !== undefined && rect.left >= dialog.left && rect.right <= dialog.right,
        viewport: rect.right <= window.innerWidth,
      };
    });
    expect(box).toMatchObject({ clipped: false, inside: true, viewport: true });
    expect(box.lines).toBeGreaterThan(1);
  });

  it("보내기에 실패한 뒤 패널을 닫았다 다시 열면 예전 오류가 없다(0066)", async () => {
    await openHome(page);
    await page.route("**/_serverFn/**", async (route) => {
      if (route.request().method() === "POST") await route.abort();
      else await route.continue();
    });
    const panel = page.getByRole("dialog");
    const answer = card(page, "ACME-1").getByRole("button", { name: home.card.answer });
    await answer.click();
    await panel.getByRole("radio", { name: "SQLite" }).check();
    await panel.getByRole("button", { name: questionJson.send }).click();
    await panel.getByRole("alert").getByText(questionJson.failed).waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    await answer.click();
    await panel.getByRole("radio", { name: "SQLite" }).waitFor();
    expect(await panel.getByText(questionJson.failed).count()).toBe(0);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    await page.unroute("**/_serverFn/**");
  });

  it("Permission 카드의 패널은 러너에서 허용하라고 안내하고, 거절을 보내면 결과를 status 로 알린다", async () => {
    await openHome(page);
    await cardButton(page, "ACME-5").click();
    const panel = page.getByRole("dialog");
    await panel.getByText(home.permission.allowOnRunner).waitFor();
    await panel.getByText("rm -rf build").waitFor();
    await panel.getByLabel(home.permission.reasonLabel).fill("Keep the build folder.");
    await panel.getByRole("button", { name: home.permission.send }).click();
    const status = panel.getByRole("status");
    await status.getByText(home.permission.denied).waitFor();
    expect(await focusedSoon(status)).toBe(true);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    expect(await focusedSoon(cardButton(page, "ACME-5"))).toBe(true);
  });

  it("Failed 카드의 패널은 두 축의 이유와 Tickets 에서 다시 맡기기 링크를 보인다", async () => {
    await openHome(page);
    await cardButton(page, "ACME-34").click();
    const panel = page.getByRole("dialog");
    await panel.getByText(home.sheet.agentResult).waitFor();
    await panel.getByText(home.sheet.prState).waitFor();
    const retry = await panel.getByRole("link", { name: home.sheet.retry }).getAttribute("href");
    const url = new URL(retry ?? "", baseUrl);
    expect(url.pathname).toBe("/tickets");
    expect(url.searchParams.get("ws")).toBe(workspaceId);
    expect(url.searchParams.get("sel")).toBe(
      JSON.stringify(JSON.stringify([connection, "ACME-34"])),
    );

    await panel.getByRole("link", { name: home.sheet.retry }).click();
    await page.waitForURL(/\/tickets/);
    await hydrated(page);
    const search = await page.evaluate(() => {
      const router: unknown = Reflect.get(globalThis, "__TSR_ROUTER__");
      const state: unknown =
        router === undefined ? undefined : Reflect.get(Object(router), "state");
      const location: unknown =
        state === undefined ? undefined : Reflect.get(Object(state), "location");
      return location === undefined
        ? undefined
        : JSON.stringify(Reflect.get(Object(location), "search"));
    });
    expect(JSON.parse(search ?? "{}")).toMatchObject({
      ws: workspaceId,
      sel: JSON.stringify([connection, "ACME-34"]),
    });
    await page.getByRole("heading", { level: 1, name: "Tickets" }).waitFor();
  });
});

describe("Dashboard 칸반 배치(브라우저, 0100)", () => {
  it("처리할 일만 보기는 꼬리표 카드만 남기고 새로 고침 뒤에도 남는다", async () => {
    await openHome(page);
    const running = page.getByRole("region", { name: home.column.running });
    const count = running.locator("h2 + span");
    expect(await count.textContent()).toBe("7");
    await page.getByRole("tab", { name: new RegExp(`^${home.view.todo}`) }).click();
    await page.waitForURL(/view=todo/);
    await expect.poll(() => count.textContent()).toBe("6");
    expect(await running.locator("li:not([data-tag])").count()).toBe(0);
    await card(page, "ACME-40").waitFor({ state: "detached" });
    await page.reload();
    await hydrated(page);
    expect(page.url()).toContain("view=todo");
    expect(
      await page
        .getByRole("tab", { name: new RegExp(`^${home.view.todo}`) })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      await page
        .getByRole("region", { name: home.column.running })
        .locator("li:not([data-tag])")
        .count(),
    ).toBe(0);
  });

  it("폭마다 가로 스크롤이 없고, 넓으면 Runners 열이 칸반 오른쪽, 좁으면 아래에 있다", async () => {
    for (const width of [1728, 1280, 900, 400, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      const layout = await page.evaluate(() => {
        const rect = (name: string) =>
          document.querySelector(`section[aria-label="${name}"]`)?.getBoundingClientRect();
        const done = rect("Done");
        const runners = rect("Runners");
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          clipped: [...document.querySelectorAll("li")]
            .filter((li) => li.getBoundingClientRect().right > window.innerWidth + 1)
            .map((li) => li.textContent),
          runnersRight: done !== undefined && runners !== undefined && runners.left >= done.right,
          runnersBelow: done !== undefined && runners !== undefined && runners.top >= done.bottom,
        };
      });
      expect({
        width,
        page: layout.page,
        clipped: layout.clipped,
        runners: layout.runnersRight ? "right" : layout.runnersBelow ? "below" : "other",
      }).toEqual({ width, page: 0, clipped: [], runners: width >= 1440 ? "right" : "below" });
    }
  });

  it("행동이 있는 카드의 바닥 줄은 좁은 칸에서도 낱말을 끊지 않고 행동 버튼과 겹치지 않는다", async () => {
    for (const width of [960, 1100, 1440, 1728, 400]) {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page);
      const foot = await cardButton(page, "ACME-3").evaluate((button) => {
        const footId = button.getAttribute("aria-describedby")?.split(" ").at(-1) ?? "";
        const footEl = document.getElementById(footId);
        const meta = footEl?.firstElementChild;
        const action = button.nextElementSibling;
        if (footEl === null || !(meta instanceof HTMLElement) || action === null) return null;
        const metaRect = meta.getBoundingClientRect();
        const actionRect = action.getBoundingClientRect();
        const lineHeight = Number.parseFloat(getComputedStyle(meta).lineHeight);
        return {
          metaLines: Math.round(metaRect.height / lineHeight),
          overlaps:
            actionRect.top < metaRect.bottom &&
            actionRect.left < metaRect.right &&
            actionRect.right > metaRect.left,
        };
      });
      expect({ width, foot }).toEqual({ width, foot: { metaLines: 1, overlaps: false } });
    }
  });

  it("러너 문제는 Runners 열의 러너 행과 빨간 상자로 보인다(0069)", async () => {
    await openHome(page);
    const runners = page.getByRole("region", { name: home.section.runners });
    const offline = runners.locator(`a[href="/runners?ws=${workspaceId}&sel=runner-b"]`);
    await offline.getByText("runner-b", { exact: true }).waitFor();
    const capacity = home.runners.capacity.replace("{total}", "1").replace("{used}", "0");
    await offline.getByRole("img", { name: capacity, exact: true }).waitFor();
    const problem = runners.getByRole("region", {
      name: home.runners.problemTitle.replace("{count}", "1"),
    });
    expect(await problem.getByRole("link", { name: home.runners.fix }).getAttribute("href")).toBe(
      `/runners?ws=${workspaceId}`,
    );
  });

  it("Done 꼬리표 카드는 4장만 보이고 더 보기를 누르면 펼치고 처음 숨었던 카드로 포커스를 옮긴다", async () => {
    await openHome(page);
    const done = page.getByRole("region", { name: home.column.done });
    expect(await done.locator("li[data-tag]").count()).toBe(4);
    const more = done.getByRole("button", { name: home.board.more.replace("{count}", "1") });
    await more.click();
    await done.locator("li[data-tag]").nth(4).waitFor();
    expect(await more.count()).toBe(0);
    expect(
      await focusedSoon(done.locator("li[data-tag]").nth(4).locator("button[aria-haspopup]")),
    ).toBe(true);
  });

  it("모든 Workspace 보기에서도 칸과 Runners 열을 보이고 카드에 Workspace 이름을 붙인다(0066)", async () => {
    await page.goto("/?ws=all");
    await hydrated(page);
    for (const name of Object.values(home.column))
      await page.getByRole("region", { name }).waitFor();
    await page.getByRole("region", { name: home.section.runners }).waitFor();
    expect(await card(page, "ACME-1").getByText(/Acme/).count()).toBeGreaterThan(0);
  });

  it("글쓰기 칸 글자 크기는 폭이 아니라 포인터로 바뀐다(정밀 14px, 터치 16px)", async () => {
    const fontSizeAt = async (target: Page, width: number) => {
      await target.setViewportSize({ width, height: 900 });
      await openHome(target);
      await card(target, "ACME-3").getByRole("button", { name: home.card.answer }).click();
      const panel = target.getByRole("dialog");
      await panel.getByRole("radio", { name: questionJson.other }).check();
      const size = await panel
        .getByLabel(questionJson.otherLabel)
        .evaluate((input) => getComputedStyle(input).fontSize);
      await target.keyboard.press("Escape");
      return size;
    };
    expect(await fontSizeAt(page, 1280)).toBe("14px");
    expect(await fontSizeAt(page, 375)).toBe("14px");

    const touch = await browser.newContext({ baseURL: baseUrl, locale: "ko-KR", hasTouch: true });
    try {
      const tablet = await touch.newPage();
      tablet.setDefaultTimeout(30_000);
      expect(await fontSizeAt(tablet, 1180)).toBe("16px");
    } finally {
      await touch.close();
    }
  });

  it("카드 버튼은 보이는 높이 32px 그대로, 터치에서만 누르는 영역을 44×44px 로 넓힌다", async () => {
    const hitArea = async (target: Page) => {
      await openHome(target);
      const button = card(target, "ACME-3").getByRole("button", { name: home.card.answer });
      return button.evaluate((el) => {
        const before = getComputedStyle(el, "::before");
        return {
          height: el.getBoundingClientRect().height,
          content: before.content,
          before: [before.width, before.height],
        };
      });
    };
    const mouse = await hitArea(page);
    expect(mouse.height).toBe(32);
    expect(mouse.content).toBe("none");

    const touch = await browser.newContext({ baseURL: baseUrl, locale: "ko-KR", hasTouch: true });
    try {
      const tablet = await touch.newPage();
      tablet.setDefaultTimeout(30_000);
      const coarse = await hitArea(tablet);
      expect(coarse.content).not.toBe("none");
      const [width, height] = coarse.before.map((v) => Number.parseFloat(v ?? "0"));
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBe(44);
    } finally {
      await touch.close();
    }
  });

  it("새로 고치지 않아도 새 Question 카드가 보인다", async () => {
    await openHome(page);
    expect(await card(page, "ACME-9").count()).toBe(0);
    const run = startRun(toTicketKey("ACME-9"));
    ok(changeRunState(db, run, { to: "waiting-for-input" }));
    recordRunQuestions(db, run, [
      { id: toQuestionId("q-9"), body: "Ship it?", options: [], askedAt: new Date() },
    ]);
    await card(page, "ACME-9").getByText("Ship it?").waitFor({ timeout: 25_000 });
  });

  it("다시 읽기가 실패해도 열린 패널과 쓰던 답을 그대로 둔다", async () => {
    await openHome(page);
    await card(page, "ACME-3").getByRole("button", { name: home.card.answer }).click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("radio", { name: questionJson.other }).check();
    const input = panel.getByLabel(questionJson.otherLabel);
    await input.fill("half-written answer");

    let failed = 0;
    await page.route("**/_serverFn/**", async (route) => {
      failed += 1;
      await route.abort();
    });
    ok(changeRunState(db, startRun(toTicketKey("ACME-10")), { to: "waiting-for-input" }));
    await expect.poll(() => failed, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    await page.unroute("**/_serverFn/**");

    expect(await input.inputValue()).toBe("half-written answer");
  });
});

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
  saveMapping(db, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });

  const projects = [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }];
  saveRunner(db, { id: runnerId, kind: runnerKind, name: "runner-a", config: {}, capacity: 8 });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects,
    assignmentBlocked: false,
  });

  saveRunner(db, {
    id: toRunnerId("runner-b"),
    kind: runnerKind,
    name: "runner-b",
    config: {},
    capacity: 1,
  });
  recordRunnerCheck(db, {
    runnerId: toRunnerId("runner-b"),
    online: false,
    checkedAt: new Date(),
    error: null,
    projects: null,
    assignmentBlocked: false,
  });

  const question = (key: string, id: string, body: string, options: string[]) => {
    const run = startRun(toTicketKey(key));
    ok(changeRunState(db, run, { to: "waiting-for-input" }));
    recordRunQuestions(db, run, [{ id: toQuestionId(id), body, options, askedAt: new Date() }]);
  };
  question("ACME-1", "q-1", "Which database should the cache use?", ["SQLite", "In memory"]);
  question("ACME-3", "q-3", "Rename the module?", [longChoice, "Keep the name"]);
  question("ACME-4", "q-4", "Add a retry?", ["Yes", "No"]);
  question("ACME-6", "q-6", "When should it ship?", []);

  const denyRun = startRun(toTicketKey("ACME-5"));
  ok(changeRunState(db, denyRun, { to: "waiting-for-input" }));
  recordPermissionWaits(db, denyRun, [
    { id: toPermissionRequestId("p-5"), detail: "rm -rf build", requestedAt: new Date() },
  ]);

  for (const key of ["ACME-30", "ACME-31", "ACME-32", "ACME-33", "ACME-34"]) {
    ok(
      changeRunState(db, startRun(toTicketKey(key)), {
        to: "ended",
        agentResult: "timed-out",
        prState: "none",
      }),
    );
  }

  for (const key of settledKeys) {
    ok(
      changeRunState(db, startRun(toTicketKey(key)), {
        to: "ended",
        agentResult: "reported-success",
        prState: "merged",
      }),
    );
  }

  startRun(toTicketKey("ACME-40"));

  const permissionRun = startRun(toTicketKey("ACME-2"));
  ok(changeRunState(db, permissionRun, { to: "waiting-for-input" }));
  recordPermissionWaits(db, permissionRun, [
    { id: toPermissionRequestId("p-1"), detail: "git push --force", requestedAt: new Date() },
  ]);
}

function startRun(key: TicketKey): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  const worktree = `wt-${key}`;
  ok(
    changeRunState(db, assigned.run.id, {
      to: "running",
      started: {
        worktree: toWorktreeRef(worktree),
        branch: `acme/${worktree}`,
        agentRef: toAgentRef(`agent-${worktree}`),
      },
    }),
  );
  runIds.set(key, assigned.run.id);
  return assigned.run.id;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}

function card(target: Page, key: string): Locator {
  return target.locator("li[data-run]").filter({ has: target.getByText(key, { exact: true }) });
}

function cardButton(target: Page, key: string): Locator {
  return card(target, key).locator('button[aria-haspopup="dialog"]');
}

function questionsOf(key: string) {
  const run = runIds.get(key);
  if (run === undefined) throw new Error(`no run for ${key}`);
  return listRunQuestions(db, run);
}

function unansweredQuestions(key: string): string[] {
  return questionsOf(key)
    .filter((q) => q.answer === null)
    .map((q) => q.id);
}

function answerOf(key: string): string | undefined {
  return questionsOf(key).find((q) => q.answer !== null)?.answer?.text;
}

async function openHome(target: Page): Promise<void> {
  await target.goto(`/?ws=${workspaceId}`);
  await hydrated(target);
}

async function focusedSoon(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (el) =>
      new Promise<boolean>((resolve) => {
        const started = Date.now();
        const check = () => {
          if (document.activeElement === el) resolve(true);
          else if (Date.now() - started > 5_000) resolve(false);
          else requestAnimationFrame(check);
        };
        check();
      }),
  );
}

async function hydrated(target: Page): Promise<void> {
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}
