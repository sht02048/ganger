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
  toTicketKey,
  toTrackerStateId,
} from "@ganger/core";
import type { RunId, TicketBlocker, TicketKey } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  getRunBlockerState,
  migrate,
  openDatabase,
  recordRunRelations,
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
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import run from "../../apps/web/messages/ko/run.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import {
  connection,
  fakeKind,
  trackerProject,
  unassignedTicket,
  workspaceId,
} from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
let ticketNumber = 200;

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
  dir = mkdtempSync(join(tmpdir(), "ganger-browser-"));
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
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
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

describe("먼저 끝나야 하는 티켓 화면(0160)", () => {
  it("런이 없는 티켓은 버튼을 눌러야 관계를 읽고, 읽은 뒤에는 다시 읽기를 따른다", async () => {
    let reads = 0;
    page.on("request", (request) => {
      const url = decodeURIComponent(request.url());
      if (url.includes("_serverFn") && url.includes(unassignedTicket.key)) reads += 1;
    });
    await open(`/tickets?ws=${workspaceId}`);
    const panel = page.getByRole("region", { name: tickets.panel.label });
    const readButton = panel.getByRole("button", { name: tickets.panel.blockersRead });
    await readButton.waitFor();
    expect(reads).toBe(0);

    await readButton.click();
    await panel
      .getByRole("group", { name: tickets.panel.blockers })
      .getByText(tickets.panel.blockersNone)
      .waitFor();
    expect(reads).toBe(1);
    await panel.getByRole("button", { name: tickets.panel.blockersReread }).waitFor();

    await page.getByRole("button", { name: tickets.reread.action }).click();
    await expect.poll(() => reads).toBe(2);
  });

  it("Dashboard 카드는 기다림, 멈춘 기다림, 끝난 선행 티켓을 구분한다", async () => {
    const waiting = queuedRun(nextKey(), [
      blocker("ACME-11", "In Progress", "started"),
      blocker("ACME-9", "Done", "completed"),
    ]);
    const stuck = queuedRun(nextKey(), [blocker("ACME-10", "Canceled", "canceled")]);

    await open(`/?ws=${workspaceId}`);
    const waitingCard = page.locator(`li[data-run="${waiting}"]`);
    const stuckCard = page.locator(`li[data-run="${stuck}"]`);
    await waitingCard.locator('[data-blocker-state="active"]').waitFor();

    const done = waitingCard.locator('[data-blocker-state="done"]').getByText("ACME-9");
    expect(await done.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe(
      "line-through",
    );
    await stuckCard.locator('[data-blocker-state="canceled"]').getByText("취소").waitFor();
    await waitingCard.getByText(home.card.blockerLine.waiting, { exact: true }).waitFor();
    await stuckCard.getByText(home.card.blockerLine.canceled, { exact: true }).waitFor();
    expect(await waitingCard.getByText("ACME-11을 기다려요").count()).toBe(0);
    expect(await stuckCard.getByText("선행 티켓 ACME-10이 취소됐어요").count()).toBe(0);
    const ringOf = (card: typeof waitingCard) =>
      card
        .getByRole("button")
        .first()
        .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(await ringOf(stuckCard)).not.toBe(await ringOf(waitingCard));
  });

  it("Tickets는 우선순위와 기다림을 보이고 패널에 양쪽 관계를 보인다", async () => {
    queuedRun(unassignedTicket.key, [blocker("ACME-50", "In Progress", "started")]);
    const waiter = nextKey();
    queuedRun(waiter, [
      {
        key: unassignedTicket.key,
        title: unassignedTicket.title,
        state: unassignedTicket.state,
      },
    ]);

    await open(`/tickets?ws=${workspaceId}`);
    const row = page
      .getByRole("list", { name: tickets.listLabel })
      .getByRole("listitem")
      .filter({ hasText: unassignedTicket.key });
    await row.locator('[data-blocker-state="active"]').waitFor();
    await row.getByRole("button", { name: new RegExp(`^${unassignedTicket.key} `) }).click();

    const panel = page.getByRole("region", { name: tickets.panel.label });
    await panel.getByRole("heading", { name: tickets.panel.relations }).waitFor();
    await panel
      .getByRole("group", { name: tickets.panel.blockers })
      .getByText("ACME-50", { exact: true })
      .waitFor();
    await panel
      .getByRole("group", { name: tickets.panel.waiting })
      .getByText(waiter, { exact: true })
      .waitFor();
    await panel.getByRole("button", { name: tickets.panel.relationsInfo }).waitFor();
    expect(await panel.getByText(tickets.panel.relationsNote).isVisible()).toBe(false);
  });

  it("기다리지 않고 시작은 확인을 받고 보내는 동안 버튼을 막는다", async () => {
    const id = queuedRun(nextKey(), [blocker("ACME-10", "Canceled", "canceled")]);
    await open(`/runs/${id}?ws=${workspaceId}`);
    const held = await holdActionRequests();
    const trigger = page.getByRole("button", { name: run.blockerWait.trigger });

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: run.blockerWait.confirmTitle });
    await dialog.getByRole("button", { name: run.blockerWait.dismiss }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    expect(held.count()).toBe(0);

    await trigger.click();
    await page
      .getByRole("dialog", { name: run.blockerWait.confirmTitle })
      .getByRole("button", { name: run.blockerWait.confirm })
      .click();
    await held.arrived(1);
    await page.getByRole("dialog").waitFor({ state: "detached" });

    const sending = page.getByRole("button", { name: run.blockerWait.sending });
    await expect.poll(() => sending.getAttribute("aria-disabled")).toBe("true");
    expect(await sending.getAttribute("aria-busy")).toBe("true");
    await sending.click({ force: true });
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(held.count()).toBe(1);

    await held.release();
    await page.getByRole("region", { name: run.blockerWait.title }).waitFor({ state: "detached" });
    expect(getRunBlockerState(db, id)?.skipped).toBe(true);
  });
});

async function open(path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

async function holdActionRequests() {
  let seen = 0;
  let letGo = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  await page.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.postData()?.includes("requestId")) {
      seen += 1;
      await gate;
    }
    await route.continue();
  });
  return {
    count: () => seen,
    arrived: async (count: number) => {
      await expect.poll(() => seen).toBe(count);
    },
    release: async () => {
      letGo();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  };
}

function nextKey(): TicketKey {
  ticketNumber += 1;
  return toTicketKey(`ACME-${ticketNumber}`);
}

function blocker(key: string, name: string, category: string): TicketBlocker {
  return {
    key: toTicketKey(key),
    title: `${key} 제목`,
    state: { id: toTrackerStateId(name), name, category },
  };
}

function queuedRun(key: TicketKey, blockers: ReadonlyArray<TicketBlocker>): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  recordRunRelations(
    db,
    assigned.run.id,
    { priority: "high", blockers, inCycle: new Set() },
    new Date(),
  );
  return assigned.run.id;
}

function seed(database: Database): void {
  saveTrackerConnection(database, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(database, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(database, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(database, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(database, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(database, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(database, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 20,
  });
  recordRunnerCheck(database, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
}
