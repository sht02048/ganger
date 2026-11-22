import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  listWorkspaces,
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
  getWorkspaceTrackerProject,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import settingsJson from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import shellJson from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { waitForScreenQuerySettled } from "./query-settled.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const freeProject = toTrackerProjectId("tp-mobile");
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const encryptionKey = new Uint8Array(32).fill(7);
const registryKey = "__gangerE2eCreateWorkspaceRegistry";
const virtualAdapters = "\0e2e-create-workspace-adapters";
const copy = shellJson.workspace.create;

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
  dir = mkdtempSync(join(tmpdir(), "ganger-create-workspace-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);
  const tracker = new FakeTracker(fakeKind);
  tracker.projects.push(
    { id: trackerProject, name: "Web", url: "https://tracker.example.com/projects/web" },
    { id: freeProject, name: "Mobile", url: "https://tracker.example.com/projects/mobile" },
    { id: toTrackerProjectId("tp-api"), name: "API", url: "https://tracker.example.com/api" },
  );
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
  await open(warm, `/settings?ws=${workspaceId}`);
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

describe("Workspace 메뉴에서 새 Workspace 만들기(브라우저, 0187)", () => {
  it("저장하지 않은 편집이 있으면 만들어도 그 자리에 남고 편집을 잃지 않는다", async (context) => {
    const page = await newPage(context);
    await open(page, `/settings?ws=${workspaceId}`);
    await page
      .locator("#workspace")
      .getByRole("button", { name: /바꾸기/u })
      .first()
      .click();
    const editor = page.locator("[data-editing] input").first();
    await editor.fill("Acme edited");

    await page.getByRole("button", { name: /Workspace 바꾸기/u }).click();
    await page.getByRole("menuitem", { name: shellJson.workspace.new }).click();
    const dialog = page.getByRole("dialog", { name: copy.title });
    await dialog.getByRole("textbox", { name: copy.name }).fill("Draft");
    await dialog.getByRole("checkbox", { name: /API/u }).click();
    await dialog.getByRole("button", { name: copy.submit, exact: true }).click();

    await page.getByText("Draft Workspace를 만들었어요").waitFor();
    await dialog.waitFor({ state: "hidden" });
    expect(listWorkspaces(db).some((workspace) => workspace.name === "Draft")).toBe(true);
    expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);
    expect(await editor.inputValue()).toBe("Acme edited");
    await expect
      .poll(() => editor.evaluate((element) => element === document.activeElement))
      .toBe(true);
  }, 120_000);

  it("메뉴에서 이름과 프로젝트를 골라 만들면 새 Workspace 의 Settings 프로젝트 구역으로 간다", async (context) => {
    const page = await newPage(context);
    await open(page, `/settings?ws=${workspaceId}`);

    await page.getByRole("button", { name: /Workspace 바꾸기/u }).click();
    await page.getByRole("menuitem", { name: shellJson.workspace.new }).click();

    const dialog = page.getByRole("dialog", { name: copy.title });
    await dialog.waitFor();
    const name = dialog.getByRole("textbox", { name: copy.name });
    await expect.poll(() => name.evaluate((el) => el === document.activeElement)).toBe(true);

    const taken = dialog.getByRole("checkbox", { name: /Web/u });
    await taken.waitFor();
    expect(await taken.getAttribute("aria-disabled")).toBe("true");
    await dialog.getByText("Acme에 있어요").waitFor();
    const submit = dialog.getByRole("button", { name: copy.submit, exact: true });
    expect(await submit.isDisabled()).toBe(true);

    await name.fill("Labs");
    expect(await submit.isDisabled()).toBe(true);
    await dialog.getByRole("checkbox", { name: /Mobile/u }).click();
    await expect.poll(() => submit.isDisabled()).toBe(false);
    await submit.click();

    await page.getByText("Labs Workspace를 만들었어요").waitFor();
    await dialog.waitFor({ state: "hidden" });
    const created = listWorkspaces(db).find((workspace) => workspace.name === "Labs");
    expect(created).toBeDefined();
    await page.waitForURL(
      (url) =>
        url.pathname === "/settings" &&
        url.searchParams.get("ws") === created?.id &&
        url.hash === "#projects",
    );
    await waitForScreenQuerySettled(page, ["settings"]);
    await page.getByRole("button", { name: /Workspace 바꾸기, 지금 Labs/u }).waitFor();
    await page.locator("#projects").getByText("Mobile", { exact: false }).first().waitFor();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id))
      .toBe("projects-heading");
    expect(getWorkspaceTrackerProject(db, connection, freeProject)?.workspaceId).toBe(created?.id);
    expect(getWorkspaceTrackerProject(db, connection, trackerProject)?.workspaceId).toBe(
      workspaceId,
    );
    expect(listWorkspaces(db).find((workspace) => workspace.id === workspaceId)?.name).toBe("Acme");

    await page.getByRole("button", { name: /Workspace 바꾸기/u }).click();
    await page.getByRole("menuitem", { name: shellJson.workspace.new }).click();
    const again = page.getByRole("dialog", { name: copy.title });
    await again.getByText(/모든 트래커 프로젝트가 다른 Workspace에 있어요/u).waitFor();
    await again.getByRole("textbox", { name: copy.name }).fill("Empty");
    expect(await again.getByRole("button", { name: copy.submit, exact: true }).isDisabled()).toBe(
      true,
    );
    await again.getByRole("link", { name: "Settings" }).waitFor();
    await again.getByRole("button", { name: copy.close, exact: true }).click();
    await again.waitFor({ state: "hidden" });
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""))
      .toContain("Workspace 바꾸기");
    expect(settingsJson.workspace.create).toBe("Workspace 만들기");
  }, 120_000);
});

async function newPage(context: TestContext): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 900 },
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

function seed(target: Database): void {
  saveTrackerConnection(target, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Linear",
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
  saveMapping(target, {
    connection,
    trackerProject,
    runnerProject,
    agent: toAgentId("claude"),
  });
  saveAutoAssignLabel(target, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(target, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 1,
  });
  recordRunnerCheck(target, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
}
