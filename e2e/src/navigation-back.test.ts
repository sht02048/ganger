import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterRegistry,
  toAgentId,
  toAgentRef,
  toCodeHostKind,
  toLabelId,
  toQuestionId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
  toWorktreeRef,
} from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  assignRun,
  changeRunState,
  migrate,
  openDatabase,
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
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import homeJson from "../../apps/web/messages/ko/home.json" with { type: "json" };
import onboardingJson from "../../apps/web/messages/ko/onboarding.json" with { type: "json" };
import runJson from "../../apps/web/messages/ko/run.json" with { type: "json" };
import settingsJson from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import ticketsJson from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { waitForScreenQuerySettled } from "./query-settled.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const questionKey = "ACME-ASK";
const fillerTickets = 30;
const fillerKeys = Array.from({ length: fillerTickets }, (_, index) => `ACME-Q${index}`);
const registryKey = "__gangerE2eNavigationBackRegistry";
const virtualAdapters = "\0e2e-navigation-back-adapters";

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let questionRun: string;
const fillerRuns = new Map<string, string>();

const fakeAdapters: Plugin = {
  name: "e2e-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? virtualAdapters : null;
  },
  load(id) {
    if (id !== virtualAdapters) return null;
    return [
      `export * from ${JSON.stringify(fakeAdaptersModule)};`,
      `export function getAdapterRegistry() { return globalThis[${JSON.stringify(registryKey)}]; }`,
    ].join("\n");
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-navigation-back-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  questionRun = seed(db);
  const tracker = new FakeTracker(fakeKind);
  for (const key of [questionKey, ...fillerKeys]) {
    tracker.addTicket({
      key: toTicketKey(key),
      title: `Ticket ${key}`,
      body: "",
      url: `https://tracker.example.com/${key}`,
      labels: [],
      project: { id: trackerProject, name: "Web" },
      state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
      updatedAt: new Date("2026-11-17T09:00:00Z"),
    });
  }
  tracker.projects.push({
    id: trackerProject,
    name: "Web",
    url: "https://tracker.example.com/projects/web",
  });
  Object.assign(globalThis, {
    [registryKey]: new AdapterRegistry().registerTracker({
      kind: fakeKind,
      create: () => tracker,
    }),
  });
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });
  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await open(warm, `/runs/${questionRun}?ws=${workspaceId}`);
  await backLink(warm, runJson.backTo.runs).waitFor();
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  Reflect.deleteProperty(globalThis, registryKey);
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("앱 안 이동과 돌아가기(브라우저, 0181)", () => {
  it("Tickets 에서 답하기로 간 런 상세의 ‹ 는 거르기·고른 줄·스크롤을 그대로 돌려준다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 480 });
    const key = "ACME-Q6";
    await open(page, `/tickets?ws=${workspaceId}&f=todo&sel=${ticketSel(key)}`);
    const list = page.getByRole("list", { name: ticketsJson.listLabel });
    const row = list.getByRole("listitem").filter({ hasText: key });
    await row.waitFor();
    const run = fillerRuns.get(key) ?? "";
    expect(run).not.toBe("");
    const panel = page.getByRole("region", { name: ticketsJson.panel.label });
    await panel.getByRole("heading", { name: `Ticket ${key}`, exact: true }).waitFor();
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toContain(key);
    await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const before = await listScrollTop(page, key);
    expect(before).toBeGreaterThan(0);
    const urlBefore = page.url();
    await markDocument(page);

    await row.getByRole("button", { name: ticketsJson.row.answer }).click();
    await page.waitForURL((url) => url.pathname === `/runs/${run}`);
    expect(new URL(page.url()).hash).toBe("#answer");
    await waitForScreenQuerySettled(page, ["runs", "detail", run]);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          return active !== null && active !== document.body && active.closest("#answer") !== null;
        }),
      )
      .toBe(true);

    await backLink(page, runJson.backTo.tickets).click();
    await page.waitForURL((url) => url.pathname === "/tickets");
    await panel.getByRole("heading", { name: `Ticket ${key}`, exact: true }).waitFor();

    expect(page.url()).toBe(urlBefore);
    await expect.poll(() => listScrollTop(page, key)).toBe(before);
    expect(await documentKept(page)).toBe(true);
  });

  it("Dashboard 시트에서 간 런 상세의 ‹ 는 Dashboard 로 돌아간다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await open(page, `/?ws=${workspaceId}`);
    await markDocument(page);
    const card = page.locator("li[data-run]").first();
    const shownRun = (await card.getAttribute("data-run")) ?? "";
    await card.locator('button[aria-haspopup="dialog"]').first().click();
    await page.getByRole("dialog").getByRole("link", { name: homeJson.sheet.runDetail }).click();
    await page.waitForURL((url) => url.pathname === `/runs/${shownRun}`);

    await backLink(page, runJson.backTo.dashboard).click();
    await page.waitForURL((url) => url.pathname === "/");

    expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);
    expect(await documentKept(page)).toBe(true);
  });

  it("주소를 바로 연 런 상세의 ‹ 는 Runs 로 간다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await open(page, `/runs/${questionRun}?ws=${workspaceId}`);

    await backLink(page, runJson.backTo.runs).click();
    await page.waitForURL((url) => url.pathname === "/runs");

    expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);
  });

  it("앱 안에서 간 런 상세도 새로고침한 뒤에는 ‹ 가 Runs 로 간다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await open(page, `/tickets?ws=${workspaceId}&sel=${ticketSel(questionKey)}`);
    await page
      .getByRole("region", { name: ticketsJson.panel.label })
      .getByRole("button", { name: ticketsJson.panel.openRun })
      .click();
    await backLink(page, runJson.backTo.tickets).waitFor();

    await page.reload();
    await waitForScreenQuerySettled(page, []);

    await backLink(page, runJson.backTo.runs).click();
    await page.waitForURL((url) => url.pathname === "/runs");

    expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);
  });

  it.each([
    { width: 1280, height: 420 },
    { width: 700, height: 500 },
    { width: 390, height: 600 },
  ])(
    "Settings 하위의 ‹ 는 Settings 로 돌아가 그 프로젝트 줄을 가리지 않고 보여 준다($width)",
    async ({ width, height }) => {
      const browserContext = await browser.newContext({
        baseURL: baseUrl,
        locale: "ko-KR",
        timezoneId: "UTC",
        viewport: { width, height },
      });
      const page = await browserContext.newPage();
      page.setDefaultTimeout(30_000);
      await open(page, `/settings/projects/${connection}/${trackerProject}?ws=${workspaceId}`);

      await backLink(page, settingsJson.project.back).click();
      await page.waitForURL((url) => url.pathname === "/settings");

      const rowId = `project-${connection}-${trackerProject}`;
      expect(decodeURIComponent(new URL(page.url()).hash)).toBe(`#${rowId}`);
      await expect
        .poll(() =>
          page.evaluate((id) => {
            const row = document.getElementById(id);
            if (row === null) return false;
            const box = row.getBoundingClientRect();
            const x = box.left + box.width / 2;
            return [box.top + 2, box.bottom - 2].every((y) =>
              row.contains(document.elementFromPoint(x, y)),
            );
          }, rowId),
        )
        .toBe(true);
      await browserContext.close();
    },
  );

  it("Settings 에서 들어간 온보딩에만 Settings 돌아가기가 있다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openOnboarding(page, "/onboarding?step=4");
    await page.getByRole("main").waitFor();
    expect(await backLink(page, onboardingJson.backToSettings).count()).toBe(0);

    await openOnboarding(page, `/onboarding?step=4&from=settings&ws=${workspaceId}`);
    await backLink(page, onboardingJson.backToSettings).click();
    await page.waitForURL((url) => url.pathname === "/settings");

    expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);
  });
});

function backLink(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).first();
}

function ticketSel(key: string): string {
  return encodeURIComponent(JSON.stringify(JSON.stringify([connection, key])));
}

async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.assign(globalThis, { navigationBackMarker: true });
  });
}

function documentKept(page: Page): Promise<boolean> {
  return page.evaluate(() => "navigationBackMarker" in globalThis);
}

function listScrollTop(page: Page, key: string): Promise<number> {
  return page.evaluate((text) => {
    const row = [...document.querySelectorAll('[role="listitem"]')].find((item) =>
      item.textContent?.includes(text),
    );
    let box = row?.parentElement ?? null;
    while (box !== null && box.scrollHeight <= box.clientHeight) box = box.parentElement;
    return box?.scrollTop ?? 0;
  }, key);
}

async function newPage(context: TestContext, viewport: { width: number; height: number }) {
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
  await page.goto(path);
  await waitForScreenQuerySettled(page, []);
}

async function openOnboarding(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

function seed(target: Database): string {
  saveTrackerConnection(target, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(target, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(target, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(target, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(target, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(target, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(target, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: fillerTickets + 1,
  });
  recordRunnerCheck(target, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
  const asked = askQuestion(target, questionKey, new Date(Date.now() - 60_000));
  for (const key of fillerKeys) fillerRuns.set(key, askQuestion(target, key, new Date()));
  return asked;
}

function askQuestion(target: Database, key: string, now: Date) {
  const run = assign(target, key, now);
  must(
    changeRunState(target, run, {
      to: "running",
      started: {
        worktree: toWorktreeRef(`wt-${key}`),
        branch: `acme/wt-${key}`,
        agentRef: toAgentRef(`agent-${key}`),
      },
    }),
  );
  must(changeRunState(target, run, { to: "waiting-for-input" }));
  recordRunQuestions(target, run, [
    { id: toQuestionId(`q-${key}`), body: "Which policy?", options: [], askedAt: now },
  ]);
  return run;
}

function assign(target: Database, key: string, now: Date) {
  const assigned = assignRun(target, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
    now,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  return assigned.run.id;
}

function must(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}
