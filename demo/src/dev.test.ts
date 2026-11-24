import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import onboarding from "../../apps/web/messages/ko/onboarding.json" with { type: "json" };
import runnerSetup from "../../apps/web/messages/ko/runnerSetup.json" with { type: "json" };
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const main = join(repoRoot, "demo/src/main.ts");
const resultsDir = join(repoRoot, "e2e/test-results");
const STARTUP_TIMEOUT_MS = 90_000;

interface Dev {
  url: string;
  output: () => string;
  stop: () => Promise<number | null>;
}

let devRoot: string;
let browser: Browser;

beforeAll(async () => {
  devRoot = mkdtempSync(join(tmpdir(), "ganger-dev-"));
  browser = await chromium.launch({ channel: "chrome" });
});

afterAll(async () => {
  await browser?.close();
  if (devRoot !== undefined) rmSync(devRoot, { recursive: true, force: true });
});

describe("pnpm dev:web", () => {
  it("dev:web 은 웹 개발 서버만, dev 는 같은 서버에 데스크톱 앱을 붙여 띄운다", () => {
    const pkg: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const scripts = typeof pkg === "object" && pkg !== null && "scripts" in pkg ? pkg.scripts : {};
    expect(scripts).toMatchObject({
      "dev:web": "node demo/src/main.ts",
      dev: "node demo/src/desktop.ts",
    });
  });

  it("미리 채운 모드: 홈이 온보딩으로 보내지 않고 200 이고, SIGTERM 에 포트를 닫는다", async () => {
    const dev = await startDev([]);
    let code: number | null;
    try {
      for (const path of ["/", "/runs", "/runners", "/stats", "/tickets"]) {
        const response = await fetch(dev.url + path, { redirect: "manual" });
        expect([path, response.status]).toEqual([path, 200]);
      }
      const home = await (await fetch(dev.url + "/")).text();
      expect(home).toContain("ACME-2");
      for (const file of [".env.example"]) {
        const response = await fetch(`${dev.url}/@fs${join(repoRoot, file)}`);
        expect([file, response.status]).toEqual([file, 403]);
      }
    } finally {
      code = await dev.stop();
    }
    expect(code).toBe(0);
    await expect(fetch(dev.url + "/")).rejects.toThrow("fetch failed");
  });

  it("Query devtools 는 기본으로 그리지 않고, 개발 도구 페이지에서 켜고 끄며, 열린 앱 탭이 모두 같은 상태다(0139)", async () => {
    const dev = await startDev(["--static"], { NODE_ENV: "development" });
    const context = await browser.newContext({ baseURL: dev.url, locale: "ko-KR" });
    context.setDefaultTimeout(30_000);
    try {
      const app = await context.newPage();
      await app.goto("/");
      await hydrated(app);
      const panel = app.locator(".tsqd-parent-container");
      const floatingButton = app.locator(".tsqd-open-btn");
      expect(await panel.count()).toBe(0);
      expect(await app.locator("#ganger-dev-tools > *").count()).toBe(2);

      const tools = await context.newPage();
      await tools.goto("/__dev");
      const toggle = tools.getByRole("button", { name: "Query devtools 켜기·끄기" });
      await expect.poll(() => toggle.getAttribute("aria-pressed")).toBe("false");

      await expect
        .poll(
          async () => {
            if ((await toggle.getAttribute("aria-pressed")) === "false") await toggle.click();
            return panel.count();
          },
          { timeout: 30_000 },
        )
        .toBe(1);
      await expect.poll(() => toggle.getAttribute("aria-pressed")).toBe("true");
      expect(await floatingButton.count()).toBe(0);

      const second = await context.newPage();
      await second.goto("/runs");
      await hydrated(second);
      const secondPanel = second.locator(".tsqd-parent-container");
      await secondPanel.waitFor({ state: "attached" });

      await second.getByRole("button", { name: /close/i }).first().click();
      await secondPanel.waitFor({ state: "detached" });
      await panel.waitFor({ state: "detached" });
      await expect.poll(() => toggle.getAttribute("aria-pressed")).toBe("false");
      expect(await floatingButton.count()).toBe(0);

      await toggle.click();
      await panel.waitFor({ state: "attached" });
      await secondPanel.waitFor({ state: "attached" });
      await expect.poll(() => toggle.getAttribute("aria-pressed")).toBe("true");
      expect(await second.locator(".tsqd-open-btn").count()).toBe(0);

      await tools.close();
      const third = await context.newPage();
      await third.goto("/stats");
      await hydrated(third);
      await third.locator(".tsqd-parent-container").waitFor({ state: "attached" });
    } finally {
      await context.close();
      await dev.stop();
    }
  });

  it("온보딩 모드: 가짜 값으로 5단계를 마치면 홈이 열린다", async () => {
    const dev = await startDev(["--onboarding", "--static"]);
    const page = await browser.newPage({ baseURL: dev.url, locale: "ko-KR" });
    page.setDefaultTimeout(30_000);
    try {
      const first = await fetch(dev.url + "/", { redirect: "manual" });
      expect(first.status).toBe(307);
      expect(first.headers.get("location")).toContain("/onboarding");

      await page.goto("/");
      await hydrated(page);
      const main = page.locator("main");
      const fill = page.getByRole("button", { name: "가짜 값 채우기" });
      const next = page.getByRole("button", { name: onboarding.next });

      const openStep = async (title: string) => {
        await next.click();
        await main.getByText(title, { exact: true }).waitFor();
      };

      await main.getByText(onboarding.steps.tracker.title, { exact: true }).waitFor();
      await fill.click();
      await page.getByRole("button", { name: settings.credentials.keyCheck }).click();
      await main.getByText(onboarding.tracker.checked).waitFor();
      await openStep(onboarding.steps.github.title);
      await main.getByText(settings.githubAuth.connectedTitle, { exact: true }).waitFor();
      await page.getByRole("button", { name: settings.githubAuth.connect }).click();
      await enabled(next);
      await openStep(onboarding.steps.runner.title);
      await page.getByRole("link", { name: runnerSetup.choose.directLink }).click();
      await main.getByRole("textbox", { name: settings.runners.sshTarget }).waitFor();
      await fill.click();
      await page.getByRole("button", { name: settings.runners.direct.submit }).click();
      await main.getByText(onboarding.runner.ready.replace("{name}", "runner-a")).waitFor();
      await openStep(onboarding.steps.workspace.title);
      await fill.click();
      await page.getByRole("checkbox", { name: "Web" }).click();
      await page.getByRole("button", { name: onboarding.workspace.create }).click();
      await enabled(next);
      await openStep(onboarding.steps.mapping.title);
      const settled = async (popup: "listbox" | "menu") => {
        await page.getByRole(popup).waitFor({ state: "detached" });
        await expect
          .poll(() => main.getByText(settings.mapping.status.saving, { exact: true }).count(), {
            timeout: 30_000,
          })
          .toBe(0);
      };
      const choose = async (index: number, option: string) => {
        await main.getByRole("combobox").nth(index).click();
        await page.getByRole("option", { name: option, exact: true }).click();
        await settled("listbox");
      };
      await main.getByRole("button", { name: "Web의 기본 저장소 고르기" }).click();
      await page.getByRole("menuitem", { name: "acme/web", exact: true }).click();
      await settled("menu");
      await choose(0, "Claude Code");
      await choose(1, "In Progress");
      await choose(2, "factory");
      const finish = page.getByRole("button", { name: onboarding.finish });
      await enabled(finish);
      await finish.click();
      await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"));

      const home = await fetch(dev.url + "/", { redirect: "manual" });
      expect(home.status).toBe(200);
    } catch (error) {
      mkdirSync(resultsDir, { recursive: true });
      await page.screenshot({ path: join(resultsDir, "dev-onboarding.png"), fullPage: true });
      throw error;
    } finally {
      await page.close();
      await dev.stop();
    }
  });
});

async function startDev(args: string[], extraEnv: Record<string, string> = {}): Promise<Dev> {
  const port = await freePort();
  const env: Record<string, string | undefined> = {
    ...process.env,
    GANGER_DEV_DIR: devRoot,
    WEB_HOST: "127.0.0.1",
    WEB_PORT: String(port),
    ...extraEnv,
  };
  delete env["DATABASE_PATH"];
  delete env["ENCRYPTION_KEY"];
  const child: ChildProcess = spawn(process.execPath, [main, "--reset", ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  let exitCode: number | null | undefined;
  void exited.then((code) => (exitCode = code));

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (!output.includes("Web is listening at")) {
    if (exitCode !== undefined) throw new Error(`pnpm dev:web exited with ${exitCode}\n${output}`);
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`pnpm dev:web did not start\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    url: `http://127.0.0.1:${port}`,
    output: () => output,
    stop: async () => {
      if (exitCode === undefined) child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      const code = await exited;
      clearTimeout(timer);
      return code;
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function enabled(locator: ReturnType<Page["getByRole"]>): Promise<void> {
  await locator.and(locator.page().locator(":enabled")).waitFor();
}

async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}
