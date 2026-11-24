import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  forgetWebhookReceipt,
  getAutoAssignLabel,
  getWorkspaceBrief,
  getMapping,
  getWorkspaceTrackerProject,
  migrate,
  openDatabase,
  recordRunnerCheck,
  replaceMapping,
  saveAutoAssignLabel,
  saveCheckedWebhookAddress,
  saveCodeHostConnection,
  saveInstallAddresses,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceBrief,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
  trackerReadGeneration,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Locator, Page, Route } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed, vi } from "vitest";
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import runners from "../../apps/web/messages/ko/runners.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const settingsAdaptersModule = fileURLToPath(new URL("./settings-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

const lockedHost = "settings.example.test";
const projectPath = `/settings/projects/${connection}/${trackerProject}`;
const connectionPath = `/settings/connections/${connection}`;
const githubOpen = `${settings.github.label} ${settings.github.open}`;

const settingsAdapters: Plugin = {
  name: "e2e-settings-adapters",
  enforce: "pre",
  config: () => ({ server: { allowedHosts: true } }),
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? settingsAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-settings-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  process.env["GANGER_TAILSCALE_CLI"] = join(dir, "no-tailscale");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [settingsAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));

  browser = await chromium.launch({
    channel: "chrome",
    args: [`--host-resolver-rules=MAP ${lockedHost} 127.0.0.1`],
  });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await openSettings(warm);
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  delete process.env["GANGER_TAILSCALE_CLI"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async (context) => {
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

describe("Settings 한 페이지(브라우저, 0119)", () => {
  it("목차를 누르면 그 구역으로 옮겨 제목에 포커스를 주고 지금 구역으로 표시한다", async () => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await openSettings(page);
    const nav = page.getByRole("navigation", { name: settings.nav.label });
    expect(await current(nav)).toBe(settings.sections.workspace);
    const before = page.url();

    await nav.getByRole("link", { name: settings.sections.advanced }).click();
    await expect.poll(focused).toBe(settings.sections.advanced);
    await expect.poll(() => current(nav)).toBe(settings.sections.advanced);
    expect(page.url()).toBe(before);
    await expect.poll(() => scrollSettledAt("advanced")).toBe(true);
    expect(await page.evaluate(() => document.querySelector("main")?.scrollTop)).toBe(0);
    await page.getByRole("heading", { level: 1, name: settings.title }).waitFor();

    await nav.getByRole("link", { name: settings.sections.logs }).click();
    await expect.poll(focused).toBe(settings.sections.logs);
    await page.waitForTimeout(800);
    expect(await current(nav)).toBe(settings.sections.logs);
    await nav.getByRole("link", { name: settings.sections.advanced }).click();
    await expect.poll(() => current(nav)).toBe(settings.sections.advanced);

    await page.mouse.wheel(0, -5000);
    await expect.poll(() => current(nav)).toBe(settings.sections.workspace);

    await nav.getByRole("link", { name: settings.sections.server }).click();
    await expect.poll(() => scrollSettledAt("server")).toBe(true);
    await page.evaluate(() => {
      let node = document.querySelector("section#workspace")?.parentElement ?? null;
      while (node !== null && getComputedStyle(node).overflowY !== "auto")
        node = node.parentElement;
      node?.scrollTo({ top: 0 });
    });
    await expect.poll(() => current(nav)).toBe(settings.sections.workspace);
  });

  it("처음에 넘치지 않던 화면이 나중에 넘쳐도 목차가 스크롤을 따라간다", async () => {
    await page.setViewportSize({ width: 1280, height: 2400 });
    await openSettings(page);
    const nav = page.getByRole("navigation", { name: settings.nav.label });
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.locator("section#advanced").scrollIntoViewIfNeeded();
    await expect.poll(() => current(nav)).toBe(settings.sections.advanced);
  });

  it("최대 실행 시간은 칸을 벗어나면 바로 저장하고, 맞지 않는 값은 저장하지 않고 알린다", async () => {
    await openSettings(page);
    const workspace = section(settings.sections.workspace);
    const minutes = workspace.getByRole("textbox", { name: settings.workspace.maxRunLabel });
    expect(await minutes.getAttribute("inputmode")).toBe("numeric");

    await minutes.fill("0");
    await workspace
      .getByRole("button", { name: `${settings.workspace.name} ${settings.change}` })
      .focus();
    await workspace.getByText(settings.workspace.maxRunInvalid).waitFor();
    expect(await minutes.getAttribute("aria-invalid")).toBe("true");

    await minutes.fill("90");
    await minutes.press("Enter");
    await workspace.getByText(settings.status.saved).waitFor();
    expect(await workspace.getByText(settings.workspace.maxRunInvalid).count()).toBe(0);
    await page.reload();
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    expect(await minutes.inputValue()).toBe("90");
  });

  it("바로 저장하는 스위치는 저장하지 못하면 원래 값으로 되돌리고 이유를 보인다", async () => {
    await openSettings(page, "/settings/mcp");
    const write = page.getByRole("switch", { name: settings.mcp.writeToggle });
    expect(await write.getAttribute("aria-checked")).toBe("false");

    await page.route("**/_serverFn/**", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await write.click();
    await page.getByText(settings.status.reverted, { exact: true }).waitFor();
    await page.getByRole("alert").getByText("저장하지 못해 되돌렸어요", { exact: false }).waitFor();
    expect(await write.getAttribute("aria-checked")).toBe("false");

    await page.unrouteAll();
    await write.click();
    await page.getByText(settings.status.saved, { exact: true }).waitFor();
    expect(await write.getAttribute("aria-checked")).toBe("true");
    await page.getByRole("main").getByRole("link", { name: settings.mcp.back }).click();
    await section(settings.sections.advanced).getByText(settings.mcp.rowWrite).waitFor();
  });

  it("비밀값은 펼친 뒤에만 입력칸이 생기고, 새 비밀번호를 권하지 않고 비밀번호 관리자가 건너뛴다", async () => {
    await openSettings(page);
    expect(await page.locator('input[type="password"]').count()).toBe(0);
    const connections = section(settings.sections.connections);
    await connections.getByRole("button", { name: githubOpen }).click();
    await page.getByRole("textbox", { name: settings.github.token, exact: true }).waitFor();
    const githubSecrets = await secretAttributes();
    expect(githubSecrets.length).toBe(1);
    await connections.getByRole("link", { name: settings.github.guideLink }).waitFor();
    await connections.getByText(settings.githubAuth.tokenPermissions).waitFor();

    await openSettings(page, connectionPath);
    expect(await page.locator('input[type="password"]').count()).toBe(0);
    await page
      .getByRole("button", { name: `${settings.connection.apiKey} ${settings.change}` })
      .click();
    const keySecrets = await secretAttributes();
    expect(keySecrets.length).toBe(1);
    for (const secret of [...keySecrets, ...githubSecrets]) {
      expect(secret).toEqual({ autocomplete: "off", onePassword: true, lastPass: "true" });
    }
  });

  it("주소를 잘못 넣으면 그 줄에 이유를 보이고 저장하지 않는다", async () => {
    await openSettings(page);
    const server = section(settings.sections.server);
    await server.getByRole("button", { name: settings.addresses.set }).click();
    const address = server.getByRole("textbox", { name: settings.addresses.web, exact: true });
    await address.fill("server.example.ts.net/app");
    await server.getByRole("button", { name: settings.save }).click();
    await server
      .getByRole("alert")
      .getByText(settings.addresses.error["invalid-web-address"])
      .waitFor();
    await server.getByRole("button", { name: settings.close }).click();
    await server.getByText(settings.addresses.webNone).waitFor();
    await expect.poll(focused).toBe(settings.addresses.set);
  });

  it("지금 보는 주소가 막히는 값은 저장하지 않고 그 줄에서 경고한다", async () => {
    const port = new URL(baseUrl).port;
    saveInstallAddresses(
      db,
      { webAddress: `http://${lockedHost}:${port}`, webhookAddress: null },
      new Date(),
    );
    try {
      await page.goto(`http://${lockedHost}:${port}/settings?ws=${workspaceId}`);
      await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
      await page.waitForLoadState("networkidle");
      const server = section(settings.sections.server);
      await server.getByRole("button", { name: settings.change }).click();
      const address = server.getByRole("textbox", { name: settings.addresses.web, exact: true });
      await address.fill("https://other.example.ts.net");
      await server.getByRole("button", { name: settings.save }).click();
      await server.getByRole("alert").getByText(settings.addresses.error["locks-out"]).waitFor();
      expect(await address.inputValue()).toBe("https://other.example.ts.net");
      await shot(page, "settings-row-error-1280");
    } finally {
      saveInstallAddresses(db, { webAddress: null, webhookAddress: null }, new Date());
    }
  });

  it("고급에는 webhook 주소 줄이 없고, 연결 줄이 그 연결의 상세로 간다", async () => {
    await openSettings(page);
    const advanced = section(settings.sections.advanced);
    await advanced.getByRole("link", { name: /^MCP/ }).waitFor();
    expect(await advanced.getByText(settings.webhook.address.label).count()).toBe(0);
    expect(await advanced.getByRole("button").count()).toBe(0);
    await section(settings.sections.connections)
      .getByRole("link", { name: /^Acme/ })
      .getByText(settings.connections.rowOff)
      .waitFor();
    await section(settings.sections.connections).getByRole("link", { name: /^Acme/ }).click();
    await page.waitForURL((url) => url.pathname === connectionPath);
    await page.getByRole("heading", { level: 1, name: "Acme" }).waitFor();
  });

  it("프로젝트 상세의 선택은 고르는 즉시 저장한다", async () => {
    await openSettings(page);
    await section(settings.sections.projects).getByRole("link", { name: /^Web/ }).click();
    await page.waitForURL(/\/settings\/projects\/conn-acme\/tp-web/);
    const crumb = page.getByRole("main").getByRole("link", { name: settings.project.back });
    expect(await crumb.getAttribute("aria-current")).toBeNull();
    await shot(page, "settings-project-1280");
    const state = page.getByRole("combobox", { name: settings.project.state });
    await state.click();
    await page.getByRole("option", { name: "Todo", exact: true }).click();
    await page.getByText(settings.status.saved, { exact: true }).first().waitFor();
  });

  it("머지 때 바꿀 상태는 고른 상태와 바꾸지 않음을 저장한다", async () => {
    await openSettings(page);
    await section(settings.sections.projects).getByRole("link", { name: /^Web/ }).click();
    await page.waitForURL(/\/settings\/projects\/conn-acme\/tp-web/);
    const merged = page.getByRole("combobox", { name: settings.project.mergedState });
    expect(await merged.textContent()).toContain(settings.project.mergedStateKeep);

    await pick(page, settings.project.mergedState, "Todo");
    await vi.waitFor(() => {
      expect(getWorkspaceTrackerProject(db, connection, trackerProject)?.mergedStateId).toBe(
        "todo",
      );
    });

    await pick(page, settings.project.mergedState, settings.project.mergedStateKeep);
    await vi.waitFor(() => {
      expect(getWorkspaceTrackerProject(db, connection, trackerProject)?.mergedStateId).toBeNull();
    });
    await page.reload();
    await merged.waitFor();
    expect(await merged.textContent()).toContain(settings.project.mergedStateKeep);
  });

  it("MCP 하위 화면은 클라이언트 설정을 탭으로 바꿔 보이고 위험을 도움말로 알린다", async () => {
    await openSettings(page);
    await section(settings.sections.advanced).getByRole("link", { name: /^MCP/ }).click();
    await page.waitForURL(/\/settings\/mcp/);
    await page.getByText("mcp_servers:", { exact: false }).waitFor();
    await page.getByRole("tab", { name: settings.mcp.json }).click();
    await page.getByText('"mcpServers"', { exact: false }).waitFor();
    await page.getByRole("button", { name: settings.mcp.writeRiskLabel }).hover();
    await page.getByRole("tooltip").getByText("확인을 받는지", { exact: false }).waitFor();
    expect(
      await page.getByRole("tab", { name: settings.mcp.json }).getAttribute("aria-selected"),
    ).toBe("true");
    await shot(page, "settings-mcp-1280");
  });

  it("400px 에서는 목차가 가로 칩 줄이 되고 가로로 넘치지 않는다", async () => {
    await page.setViewportSize({ width: 400, height: 900 });
    await openSettings(page);
    const nav = page.getByRole("navigation", { name: settings.nav.label });
    const first = await nav.getByRole("link", { name: settings.sections.workspace }).boundingBox();
    const second = await nav.getByRole("link", { name: settings.sections.projects }).boundingBox();
    expect(first?.y).toBe(second?.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      400,
    );
    await shot(page, "settings-400");
  });

  it("Runners 로 가는 러너 줄은 라우터로 Workspace 를 이어 옮긴다", async () => {
    await openSettings(page);
    await page.evaluate(() => Object.assign(globalThis, { settingsPageMarker: true }));
    await section(settings.sections.connections)
      .getByRole("link", { name: new RegExp(`^${settings.runnersRow.label}`) })
      .click();
    await page.waitForURL(/\/runners\?.*ws=ws-acme/);
    expect(await page.evaluate(() => "settingsPageMarker" in globalThis)).toBe(true);
  });
});

describe("Settings 폼과 도움말(브라우저, 0119 리뷰 후속)", () => {
  it("도움말 단추는 눌러도 열리고 다시 누르면 닫힌다", async () => {
    await openSettings(page);
    const tip = page.getByRole("button", { name: "최대 실행 시간 도움말" });
    await tip.click();
    await page.getByRole("tooltip").getByText("Failed 로 끝내요", { exact: false }).waitFor();
    await tip.click();
    await expect.poll(() => page.getByRole("tooltip").filter({ visible: true }).count()).toBe(0);
  });

  it("고친 값이 남은 줄이 펼쳐져 있으면 다른 줄을 펼치지 않고 알린다", async () => {
    await openSettings(page);
    const workspace = section(settings.sections.workspace);
    await workspace
      .getByRole("button", { name: `${settings.workspace.name} ${settings.change}` })
      .click();
    const name = workspace.getByRole("textbox", { name: settings.workspace.name, exact: true });
    await name.fill("Acme Draft");
    await section(settings.sections.connections).getByRole("button", { name: githubOpen }).click();
    await page.getByRole("alert").getByText(settings.unsavedBlocked).waitFor();
    expect(await name.inputValue()).toBe("Acme Draft");
    expect(await page.getByRole("textbox", { name: settings.github.token }).count()).toBe(0);
    await workspace.getByRole("button", { name: settings.close }).click();
    await section(settings.sections.connections).getByRole("button", { name: githubOpen }).click();
    await page.getByRole("textbox", { name: settings.github.token }).waitFor();
  });

  it("비밀값을 비운 채 저장하면 버튼을 막지 않고 칸 아래에 무엇을 넣을지 알린다", async () => {
    await openSettings(page);
    const connections = section(settings.sections.connections);
    await connections.getByRole("button", { name: settings.connections.addLabel }).click();
    const submit = connections.getByRole("button", { name: settings.credentials.keyCheck });
    expect(await submit.isDisabled()).toBe(false);
    await submit.click();
    await connections.getByText(settings.credentials.keyRequired).waitFor();
    await page
      .getByRole("textbox", { name: settings.connections.apiKey, exact: true })
      .fill("lin_api");
    await connections.getByText(settings.credentials.keyRequired).waitFor({ state: "detached" });
  });

  it("GitHub 토큰을 비운 채 저장하면 칸 아래에 토큰을 넣으라고 알린다", async () => {
    await openSettings(page);
    const connections = section(settings.sections.connections);
    await connections.getByRole("button", { name: githubOpen }).click();
    await connections.getByRole("button", { name: settings.github.save }).click();
    await connections.getByText(settings.credentials.tokenRequired, { exact: true }).waitFor();
    const token = page.getByRole("textbox", { name: settings.github.token, exact: true });
    expect(await token.getAttribute("aria-invalid")).toBe("true");
  });

  it("다른 줄이 막히면 고친 값이 남은 줄을 화면에 보이고 그 칸으로 포커스를 옮긴다", async () => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await openSettings(page);
    const server = section(settings.sections.server);
    await server.getByRole("button", { name: settings.addresses.set }).click();
    const webhook = page.getByRole("textbox", { name: settings.addresses.web, exact: true });
    await webhook.fill("https://draft.example.com");
    await page
      .getByRole("navigation", { name: settings.nav.label })
      .getByRole("link", { name: settings.sections.workspace })
      .click();
    await section(settings.sections.workspace)
      .getByRole("button", { name: `${settings.workspace.name} ${settings.change}` })
      .click();
    await page.getByRole("alert").getByText(settings.unsavedBlocked).waitFor();
    await expect.poll(() => webhook.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await webhook.isVisible()).toBe(true);
    await page.keyboard.press("Escape");
  });

  it("고친 값이 남아 있으면 다른 화면으로 옮기지 않고 그 줄을 보인다", async () => {
    await openSettings(page);
    const workspace = section(settings.sections.workspace);
    await workspace
      .getByRole("button", { name: `${settings.workspace.name} ${settings.change}` })
      .click();
    const name = workspace.getByRole("textbox", { name: settings.workspace.name, exact: true });
    await name.fill("Acme Leaving");
    await section(settings.sections.advanced).getByRole("link", { name: /^MCP/ }).click();
    await page.getByRole("alert").getByText(settings.unsavedBlocked).waitFor();
    expect(new URL(page.url()).pathname).toBe("/settings");
    expect(await name.inputValue()).toBe("Acme Leaving");
    await workspace.getByRole("button", { name: settings.close }).click();
    await section(settings.sections.advanced).getByRole("link", { name: /^MCP/ }).click();
    await page.waitForURL(/\/settings\/mcp/);
  });

  it("스위치 줄의 이름을 눌러도 스위치가 바뀐다", async () => {
    await openSettings(page, "/settings/mcp");
    const write = page.getByRole("switch", { name: settings.mcp.writeToggle });
    const before = await write.getAttribute("aria-checked");
    await page.locator("label", { hasText: settings.mcp.writeToggle }).click();
    await expect.poll(() => write.getAttribute("aria-checked")).not.toBe(before);
    await page.getByText(settings.status.saved, { exact: true }).waitFor();
    await write.click();
    await expect.poll(() => write.getAttribute("aria-checked")).toBe(before);
  });
});

describe("Runners 의 러너 고치기(브라우저, 0119)", () => {
  it("상세 패널에서 고치기를 눌러 줄 안에서 고치고, 닫으면 고치기로 포커스가 돌아온다", async () => {
    await openSettings(page, "/runners");
    await page
      .getByRole("button", { name: runners.panel.editLabel.replace("{name}", "runner-a") })
      .click();
    const capacity = page.getByRole("textbox", { name: settings.runners.capacity, exact: true });
    expect(await capacity.getAttribute("inputmode")).toBe("numeric");
    await capacity.fill("");
    await page.getByRole("textbox", { name: settings.runners.name, exact: true }).focus();
    await page.getByText(settings.runners.capacityInvalid).waitFor();
    await page.keyboard.press("Escape");
    await capacity.waitFor({ state: "detached" });
    await expect
      .poll(() => page.locator(":focus").getAttribute("aria-label"))
      .toBe(runners.panel.editLabel.replace("{name}", "runner-a"));

    await page.getByRole("button", { name: runners.panel.edit }).click();
    await page.getByRole("textbox", { name: settings.runners.capacity, exact: true }).fill("4");
    await page
      .getByRole("textbox", { name: settings.runners.sshTarget, exact: true })
      .fill("ganger@runner-a.example.com");
    await page
      .getByRole("textbox", { name: settings.runners.orcaPath, exact: true })
      .fill("/opt/orca/bin/orca");
    await page.getByRole("button", { name: settings.runners.save }).click();
    await capacity.waitFor({ state: "detached" });
    await page.getByText(settings.runners.savedAndChecking).waitFor();
  });
});

describe("Runners 고치는 중 다른 러너 고르기(브라우저, 0119 리뷰 후속)", () => {
  it("고친 값을 저장하지 않았으면 다른 러너로 옮기지 않고 알리고, 한 번 더 고르면 버리고 옮긴다", async () => {
    saveRunner(db, {
      id: toRunnerId("runner-b"),
      kind: toRunnerKind("fake"),
      name: "runner-b",
      config: {},
      capacity: 2,
    });
    await page.goto(`/runners?ws=${workspaceId}&sel=runner-a`);
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", { name: runners.panel.editLabel.replace("{name}", "runner-a") })
      .click();
    const capacity = page.getByRole("textbox", { name: settings.runners.capacity, exact: true });
    await capacity.fill("5");
    await page.getByRole("option", { name: /runner-b/ }).click();
    await page.getByRole("alert").getByText(runners.panel.unsavedBlocked).waitFor();
    expect(await capacity.inputValue()).toBe("5");
    await page.getByRole("option", { name: /runner-b/ }).click();
    await page.waitForURL(/sel=runner-b/);
  });
});

async function current(nav: Locator): Promise<string | null> {
  const link = nav.locator('[aria-current="location"]');
  return (await link.count()) === 0 ? null : link.first().textContent();
}

async function scrollSettledAt(id: string): Promise<boolean> {
  return page.evaluate(async (target) => {
    const section = document.getElementById(target);
    let scroller = section?.parentElement ?? null;
    while (scroller !== null && getComputedStyle(scroller).overflowY !== "auto")
      scroller = scroller.parentElement;
    if (section === null || scroller === null) return false;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const before = scroller.scrollTop;
    await frame();
    await frame();
    if (scroller.scrollTop !== before) return false;
    const margin = Number.parseFloat(getComputedStyle(section).scrollMarginTop);
    const offset =
      section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    return Math.abs(offset) < 1 || (offset > 0 && atEnd);
  }, id);
}

function section(name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

async function shot(target: Page, name: string): Promise<void> {
  const dir = process.env["UPDATE_SCREENSHOTS"];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  await target.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}
describe("프로젝트 상세의 저장소 여러 개와 즉시 저장(브라우저, 0115·0119)", () => {
  beforeEach(() => resetMapping());

  it("저장소를 더하고 라벨을 붙이면 바로 저장하고 그 행에 저장했어요를 보인다", async () => {
    await openSettings(page, projectPath);
    await addRepo(page, "Web", "acme/api");
    await page.getByRole("status").getByText(settings.mapping.status.saved).first().waitFor();
    await expect
      .poll(() => savedRepos().map((r) => r.project))
      .toEqual(["fake:acme/web", "fake:acme/api"]);

    await pick(page, fill(settings.mapping.repoLabel, { repo: "acme/api" }), "api");
    await expect.poll(() => savedRepos()[1]?.labelId ?? null).toBe("label-api");

    await addRepo(page, "Web", "acme/infra");
    await page
      .getByRole("combobox", { name: fill(settings.mapping.repoLabel, { repo: "acme/infra" }) })
      .click();
    const used = page.getByRole("option", {
      name: fill(settings.mapping.labelUsed, { label: "api", repo: "acme/api" }),
    });
    expect(await used.getAttribute("aria-disabled")).toBe("true");
    await page.keyboard.press("Escape");

    await page
      .getByRole("button", { name: fill(settings.mapping.makeDefaultLabel, { repo: "acme/api" }) })
      .click();
    await expect
      .poll(() => savedRepos().find((r) => r.isDefault)?.project ?? null)
      .toBe("fake:acme/api");
    expect(savedRepos().find((r) => r.project === "fake:acme/api")?.labelId ?? null).toBeNull();
    await page
      .getByRole("status")
      .getByText(fill(settings.mapping.labelDropped, { repo: "acme/api", label: "api" }))
      .waitFor();
    await expect.poll(focused).toBe(settings.mapping.makeDefault);
  });

  it("저장하지 못하면 원래 값으로 되돌리고 이유를 그 행 아래에 보인다", async () => {
    await openSettings(page, projectPath);
    const fail = (route: Route) =>
      route.request().method() === "POST" ? route.abort() : route.continue();
    await page.route("**/_serverFn/**", fail);
    await addRepo(page, "Web", "acme/api");

    await page.getByRole("status").getByText(settings.mapping.status.reverted).waitFor();
    await page.getByRole("alert").getByText(settings.mapping.revertedRetry).waitFor();
    expect(
      await page
        .getByRole("button", { name: fill(settings.mapping.removeLabel, { repo: "acme/api" }) })
        .count(),
    ).toBe(0);
    expect(
      await page.evaluate(() => document.activeElement?.closest('[role="group"]') !== null),
    ).toBe(true);
    await page.unroute("**/_serverFn/**", fail);
    expect(savedRepos().map((r) => r.project)).toEqual(["fake:acme/web"]);
  });

  it("Linear에서 다시 읽으면 지금 값을 둔 채 새 값을 읽어 온다", async () => {
    await openSettings(page, projectPath);
    replaceMapping(db, {
      connection,
      trackerProject,
      agent: toAgentId("claude"),
      repos: [
        { project: toRunnerProjectId("fake:acme/web"), isDefault: true, labelId: null },
        { project: toRunnerProjectId("fake:acme/infra"), isDefault: false, labelId: null },
      ],
    });
    expect(await page.getByText("acme/infra", { exact: true }).count()).toBe(0);
    const generation = trackerReadGeneration(db, connection);
    await page.getByRole("button", { name: settings.mapping.reload }).first().click();
    await page.getByRole("status").getByText(settings.mapping.reloaded).first().waitFor();
    expect(trackerReadGeneration(db, connection)).toBeGreaterThan(generation);
    await page.getByText("acme/infra", { exact: true }).waitFor();
    await page.getByText("acme/web", { exact: true }).waitFor();
  });
});

describe("프로젝트 상세의 Auto-assign Label 만들기(브라우저, 0115·0119)", () => {
  it("고른 라벨이 Linear에 없으면 알리고, ganger 라벨을 만들어 고른 뒤 첫 줄은 고르기가 된다", async () => {
    saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
    await openSettings(page, projectPath);
    await page.getByText(fill(settings.label.gone, { name: "ganger" })).waitFor();

    const select = settings.project.label;
    await pick(page, select, fill(settings.label.create, { name: "ganger" }));
    await expect
      .poll(() => getAutoAssignLabel(db, workspaceId, connection))
      .toBe("label-created-1");
    await page
      .getByText(fill(settings.label.gone, { name: "ganger" }))
      .waitFor({ state: "detached" });

    await page.getByRole("combobox", { name: select }).click();
    await page
      .getByRole("option", { name: fill(settings.label.pickExisting, { name: "ganger" }) })
      .waitFor();
    expect(
      await page
        .getByRole("option", { name: fill(settings.label.create, { name: "ganger" }) })
        .count(),
    ).toBe(0);
    await page.keyboard.press("Escape");
  });
});

async function secretAttributes(): Promise<
  Array<{ autocomplete: string | null; onePassword: boolean; lastPass: string | null }>
> {
  return page.locator('input[type="password"]').evaluateAll((inputs) =>
    inputs.map((input) => ({
      autocomplete: input.getAttribute("autocomplete"),
      onePassword: input.hasAttribute("data-1p-ignore"),
      lastPass: input.getAttribute("data-lpignore"),
    })),
  );
}

async function openSettings(target: Page, path = "/settings"): Promise<void> {
  await target.goto(`${path}?ws=${workspaceId}`);
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}

async function focused(): Promise<string | null> {
  const active = page.locator(":focus");
  return (await active.count()) === 0 ? null : active.first().textContent();
}

function seed(target: Database): void {
  saveTrackerConnection(target, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "lin_api_example" },
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
    runnerProject: toRunnerProjectId("fake:acme/web"),
    agent: toAgentId("claude"),
  });
  saveAutoAssignLabel(target, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(target, {
    id: toRunnerId("runner-a"),
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 8,
  });
  recordRunnerCheck(target, {
    runnerId: toRunnerId("runner-a"),
    online: true,
    checkedAt: new Date(),
    error: null,
    assignmentBlocked: false,
    projects: ["web", "api", "infra"].map((name) => ({
      id: toRunnerProjectId(`fake:acme/${name}`),
      displayName: `acme/${name}`,
      setupState: "ready" as const,
    })),
  });
}

function resetMapping(): void {
  replaceMapping(db, {
    connection,
    trackerProject,
    agent: toAgentId("claude"),
    repos: [{ project: toRunnerProjectId("fake:acme/web"), isDefault: true, labelId: null }],
  });
}

function savedRepos() {
  return getMapping(db, connection, trackerProject)?.repos ?? [];
}

async function pick(target: Page, combobox: string, option: string): Promise<void> {
  await target.getByRole("combobox", { name: combobox }).click();
  await target.getByRole("option", { name: option, exact: true }).click();
}

async function addRepo(target: Page, project: string, repo: string): Promise<void> {
  await target.getByRole("button", { name: fill(settings.mapping.addLabel, { project }) }).click();
  await target.getByRole("menuitem", { name: repo, exact: true }).click();
}

function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

describe("트래커 연결 상세의 webhook 켜기(브라우저, 0130)", () => {
  const address = "https://hooks.example.com";
  const webhookUrl = `${address}/api/webhooks/tracker/${connection}`;

  const deliver = (body: string) =>
    fetch(new URL(`/api/webhooks/tracker/${connection}`, baseUrl), { method: "POST", body });

  const resetWebhook = () => {
    saveInstallAddresses(db, { webAddress: null, webhookAddress: null }, new Date());
    saveTrackerConnection(db, new SecretBox(encryptionKey), {
      id: connection,
      kind: fakeKind,
      name: "Acme",
      config: {},
      secrets: { apiKey: "lin_api_example" },
    });
    forgetWebhookReceipt(db, connection);
  };

  beforeEach(() => resetWebhook());

  it("닿을 주소를 정하기 전에는 2·3단계가 잠겨 있고, 주소 형식이 틀리면 묻지 않고 이유를 보인다", async () => {
    await openSettings(page, connectionPath);
    const steps = page.getByRole("list", { name: settings.webhook.steps });
    const current = steps.locator('[aria-current="step"]');
    await current.getByText(settings.webhook.address.label).waitFor();
    expect(await steps.getByText(settings.webhook.create.urlLabel).count()).toBe(0);
    expect(await steps.getByRole("textbox", { name: settings.webhook.secret.field }).count()).toBe(
      0,
    );
    expect(await steps.getByText(settings.webhook.stepState.locked).count()).toBe(2);
    expect(await steps.getByText(settings.webhook.address.funnelTitle).count()).toBe(0);

    const field = steps.getByRole("textbox", { name: settings.webhook.address.field });
    await field.fill("http://hooks.example.com");
    await steps.getByRole("button", { name: settings.webhook.address.check }).click();
    await steps.getByText(settings.webhook.address.error["invalid-address"]).waitFor();
    expect(await field.getAttribute("aria-invalid")).toBe("true");
    await expect.poll(() => field.evaluate((el) => el === document.activeElement)).toBe(true);
    await steps.getByRole("button", { name: settings.webhook.address.recheck }).waitFor();
  });

  it("주소를 확인한 뒤 secret 을 넣고 켜면 기다리고, 가짜 webhook 을 받으면 켜짐으로 바뀐다", async () => {
    saveCheckedWebhookAddress(db, address, new Date());
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openSettings(page, connectionPath);
    const webhook = section(settings.webhook.title);
    await webhook.getByText(settings.webhook.status.off).waitFor();
    await webhook.getByText(address, { exact: true }).waitFor();
    await webhook.getByText(webhookUrl, { exact: true }).waitFor();
    await webhook.getByRole("link", { name: new RegExp(settings.webhook.create.open) }).waitFor();
    await shot(page, "webhook-create-open-1280");

    await webhook
      .getByRole("button", { name: `${settings.webhook.address.label} ${settings.change}` })
      .click();
    const addressField = webhook.getByRole("textbox", { name: settings.webhook.address.field });
    await expect
      .poll(() => addressField.evaluate((el) => el === document.activeElement))
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(focused).toBe(settings.change);

    const secret = webhook.getByRole("textbox", { name: settings.webhook.secret.field });
    await webhook.getByRole("button", { name: settings.webhook.secret.turnOn }).click();
    await webhook.getByText(settings.webhook.secret.required).waitFor();
    await secret.fill("whsec_example");
    await webhook.getByRole("button", { name: settings.webhook.secret.turnOn }).click();
    await webhook.getByRole("status").getByText(settings.webhook.status.waiting).waitFor();
    const waiting = webhook.locator("#webhook-waiting");
    await waiting.waitFor();
    await expect
      .poll(() => waiting.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    await shot(page, "webhook-waiting-1280");

    expect((await deliver("signed:delivery-1")).status).toBe(200);
    await webhook.getByText(settings.webhook.status.receiving).waitFor({ timeout: 15_000 });
    await webhook.getByText(settings.webhook.lastReceived).waitFor();
    await shot(page, "webhook-receiving-1280");

    expect((await deliver("tampered")).status).toBe(401);
    expect((await deliver("tampered")).status).toBe(401);
    await page.reload();
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await webhook.getByText(fill(settings.webhook.rejected.title, { count: "2" })).waitFor();
    await webhook.getByText(settings.webhook.status.rejected).waitFor();
    await shot(page, "webhook-rejected-1280");

    await openSettings(page);
    const row = section(settings.sections.connections).getByRole("link", { name: /^Acme/ });
    await row.getByText("webhook 서명이 맞지 않아 받지 못해요", { exact: false }).waitFor();
    const nav = page.getByRole("navigation", { name: settings.nav.label });
    await nav
      .getByRole("link", { name: settings.sections.connections })
      .getByText(settings.nav.problem)
      .waitFor();
    await shot(page, "webhook-settings-rows-1280");

    await openSettings(page, connectionPath);
    await webhook
      .getByRole("button", { name: settings.webhook.rejected.reenter, exact: true })
      .click();
    const again = webhook.getByRole("textbox", { name: settings.webhook.secret.field });
    await expect.poll(() => again.evaluate((el) => el === document.activeElement)).toBe(true);
    await again.fill("whsec_new");
    await webhook.getByRole("button", { name: settings.webhook.secret.save }).click();
    await webhook.getByText(settings.webhook.status.waiting).waitFor();

    await webhook.getByRole("button", { name: settings.webhook.off.trigger }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: settings.webhook.off.confirm })
      .click();
    await webhook.getByText(settings.webhook.status.off).waitFor();
    await expect.poll(focused).toContain(settings.webhook.title);
    await openSettings(page);
    await section(settings.sections.connections)
      .getByRole("link", { name: /^Acme/ })
      .getByText(settings.connections.rowOff)
      .waitFor();
  });

  it("400px 에서도 단계와 주소가 가로로 넘치지 않는다", async () => {
    saveCheckedWebhookAddress(db, address, new Date());
    await page.setViewportSize({ width: 400, height: 1000 });
    await openSettings(page, connectionPath);
    await page.getByText(webhookUrl, { exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      400,
    );
    await shot(page, "webhook-400");
  });
});

describe("Workspace 앞뒤 지시(브라우저, 0146)", () => {
  const briefRow = () =>
    section(settings.sections.workspace).getByRole("button", {
      name: `${settings.brief.title} ${settings.change}`,
    });
  const field = (label: string) => page.getByRole("textbox", { name: label, exact: true });
  const preview = () => page.getByRole("region", { name: settings.brief.preview.title });

  beforeEach(() => {
    saveWorkspaceBrief(db, { id: workspaceId, brief: { before: "", after: "" } });
  });

  it("두 칸에 쓰면 미리 보기가 바로 바뀌고, 저장하면 다시 열어도 같은 값이 보인다", async () => {
    await openSettings(page);
    await section(settings.sections.workspace).getByText(settings.brief.summaryEmpty).waitFor();
    await briefRow().click();
    const before = field(settings.brief.before.label);
    await expect.poll(() => before.evaluate((el) => el === document.activeElement)).toBe(true);
    await preview().getByText(settings.brief.example.title, { exact: false }).waitFor();
    expect(await preview().getByText(settings.brief.preview.before).count()).toBe(0);

    await before.fill("Read AGENTS.md first.");
    await field(settings.brief.after.label).fill("Push the branch.\nOpen a PR to develop.");
    await preview().getByText(settings.brief.preview.before).waitFor();
    await preview().getByText("Open a PR to develop.", { exact: false }).waitFor();
    await page.getByText(settings.brief.appliesToNewRuns).waitFor();
    await shot(page, "settings-workspace-brief-1280");

    await section(settings.sections.workspace).getByRole("button", { name: settings.save }).click();
    await briefRow().waitFor();
    expect(getWorkspaceBrief(db, workspaceId)).toEqual({
      before: "Read AGENTS.md first.",
      after: "Push the branch.\nOpen a PR to develop.",
    });
    await page.reload();
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await section(settings.sections.workspace).getByText("티켓 앞 1줄 · 티켓 뒤 2줄").waitFor();
  });

  it("8,000자를 넘기면 저장하지 않고 그 칸에 이유를 보이며 포커스를 옮긴다", async () => {
    await openSettings(page);
    await briefRow().click();
    const after = field(settings.brief.after.label);
    await after.fill("a".repeat(8_001));
    await section(settings.sections.workspace).getByRole("button", { name: settings.save }).click();
    await page.getByText(settings.brief.tooLong.replace("{max, number}", "8,000")).waitFor();
    expect(await after.getAttribute("aria-invalid")).toBe("true");
    await expect.poll(() => after.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(getWorkspaceBrief(db, workspaceId)).toEqual({ before: "", after: "" });
    await page.keyboard.press("Escape");
  });

  it("400px 에서도 두 칸과 미리 보기가 가로로 넘치지 않는다", async () => {
    await page.setViewportSize({ width: 400, height: 900 });
    await openSettings(page);
    await briefRow().click();
    await field(settings.brief.after.label).fill("Push the branch and open a pull request.");
    await preview().getByText(settings.brief.preview.protocol).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      400,
    );
    await shot(page, "settings-workspace-brief-400");
  });
});
