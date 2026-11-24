import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const settingsAdaptersModule = fileURLToPath(new URL("./settings-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);
const SSH_TARGET = "builder@build-box.tail1234.ts.net";
const SECRET = "lin_api_0123456789abcdefABCDEF";

let dir: string;
let home: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

const settingsAdapters: Plugin = {
  name: "e2e-log-settings-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? settingsAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-log-settings-"));
  home = join(dir, "home");
  mkdirSync(join(home, "logs"), { recursive: true });
  writeFileSync(
    join(home, "logs", "worker.jsonl"),
    `${JSON.stringify({
      t: new Date().toISOString(),
      level: "warn",
      proc: "worker",
      pid: 7,
      v: "0.1.0",
      event: "runner.check_failed",
      msg: "could not check runner",
      reason: `ssh ${SSH_TARGET} said ${SECRET}`,
    })}\n`,
  );
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  process.env["GANGER_TAILSCALE_CLI"] = join(dir, "no-tailscale");
  process.env["GANGER_HOME"] = home;
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [settingsAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });
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
  delete process.env["GANGER_HOME"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async (context) => {
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR", acceptDownloads: true });
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

describe("Settings 로그와 진단(브라우저, 0134)", () => {
  it("로그 크기와 폴더를 보이고, 자세한 로그를 켜면 다시 열어도 켜져 있으며 설치 설정 파일에 남는다", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSettings(page);
    const logs = page.locator("section#logs");
    await logs.getByText(join(home, "logs"), { exact: true }).waitFor();
    await logs.getByRole("button", { name: settings.logs.copyPath }).waitFor();
    expect(await logs.getByRole("button", { name: settings.logs.openFolder }).count()).toBe(0);

    const debug = logs.getByRole("switch", { name: settings.logs.debug });
    expect(await debug.isChecked()).toBe(false);
    await debug.click();
    await logs.getByText(settings.status.saved).waitFor();
    expect(JSON.parse(readFileSync(join(home, "logging.json"), "utf8"))).toEqual({ debug: true });

    await page.reload();
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await expect.poll(() => debug.isChecked()).toBe(true);
    await debug.click();
    await logs.getByText(settings.status.saved).waitFor();
    expect(JSON.parse(readFileSync(join(home, "logging.json"), "utf8"))).toEqual({ debug: false });
  });

  it("진단 묶음을 펼쳐 만들면 가린 zip을 내려받고 결과를 알린다", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSettings(page);
    const logs = page.locator("section#logs");
    await logs.getByRole("button", { name: "진단 묶음 만들기", exact: true }).click();
    await logs.getByText(settings.logs.review).waitFor();
    const anonymize = logs.getByRole("checkbox", { name: settings.logs.anonymize });
    expect(await anonymize.isChecked()).toBe(true);

    const download = page.waitForEvent("download");
    await logs.getByRole("button", { name: settings.logs.make, exact: true }).click();
    const file = await download;
    const name = file.suggestedFilename();
    expect(name).toMatch(/^ganger-diagnostics-\d{8}-\d{4}-[0-9a-f]{6}\.zip$/);
    const status = logs.getByRole("status").filter({ hasText: name });
    await status.waitFor();

    const saved = join(dir, name);
    await file.saveAs(saved);
    const text = zipText(readFileSync(saved));
    expect(text).toContain("server-logs.jsonl");
    expect(text).toContain("ssh-target-1");
    expect(text).not.toContain(SSH_TARGET);
    expect(text).not.toContain(SECRET);

    await page.keyboard.press("Escape");
    await logs.getByText(settings.logs.review).waitFor({ state: "detached" });
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent ?? null))
      .toBe(settings.logs.make);
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null),
    ).toBe("진단 묶음 만들기");
  });
});

async function openSettings(target: Page): Promise<void> {
  await target.goto(`/settings/server?ws=${workspaceId}`);
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}

function zipText(zip: Buffer): string {
  const parts: string[] = [];
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    const packedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const localAt = zip.readUInt32LE(at + 42);
    parts.push(zip.toString("utf8", at + 46, at + 46 + nameLength));
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    parts.push(inflateRawSync(zip.subarray(dataAt, dataAt + packedSize)).toString("utf8"));
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return parts.join("\n");
}

function seed(target: Database): void {
  saveTrackerConnection(target, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: SECRET },
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
    name: "build-box",
    config: { sshTarget: SSH_TARGET },
    capacity: 2,
  });
  recordRunnerCheck(target, {
    runnerId: toRunnerId("runner-a"),
    online: true,
    checkedAt: new Date(),
    error: null,
    assignmentBlocked: false,
    projects: [
      {
        id: toRunnerProjectId("fake:acme/web"),
        displayName: "acme/web",
        setupState: "ready",
      },
    ],
  });
}
