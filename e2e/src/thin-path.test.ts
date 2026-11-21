import { silentLogger } from "@ganger/log/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toPullRequestId,
  toRepoRef,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { AgentResult, PrState, RunId, SummaryOutcome, TicketKey } from "@ganger/core";
import { FakeCodeHost, FakeRunner, FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  assignRun,
  getMapping,
  getRun,
  getRunWithRecords,
  listRunStateChanges,
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
  toWorkspaceId,
} from "@ganger/db";
import type { Database, StoredRun } from "@ganger/db";
import { startWorker } from "@ganger/worker";
import type { RunningWorker } from "@ganger/worker";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import domain from "../../apps/web/messages/ko/domain.json" with { type: "json" };
import runsJson from "../../apps/web/messages/ko/runs.json" with { type: "json" };
import { startWebServer } from "./web-server.js";

const fakeKind = "fake";
const connection = toTrackerConnectionId("conn-acme");
const workspaceId = toWorkspaceId("ws-acme");
const trackerProject = toTrackerProjectId("tp-web");
const runnerProject = toRunnerProjectId("fake:acme/web");
const repo = toRepoRef("acme/web");
const runnerId = toRunnerId("runner-a");
const encryptionKey = new Uint8Array(32).fill(7);

interface Scenario {
  key: TicketKey;
  report: "succeeded" | "failed";
  pr: "open" | "merged" | "closed" | null;
  agentResult: AgentResult;
  prState: PrState;
  summary: SummaryOutcome;
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    key: toTicketKey("ACME-1"),
    report: "succeeded",
    pr: "merged",
    agentResult: "reported-success",
    prState: "merged",
    summary: "succeeded",
  },
  {
    key: toTicketKey("ACME-2"),
    report: "failed",
    pr: "open",
    agentResult: "reported-failure",
    prState: "open",
    summary: "failed",
  },
  {
    key: toTicketKey("ACME-3"),
    report: "succeeded",
    pr: null,
    agentResult: "reported-success",
    prState: "none",
    summary: "succeeded",
  },
];

let dir: string;
let db: Database;
let worker: RunningWorker;
let web: ViteDevServer;
let baseUrl: string;
const tracker = new FakeTracker(toTrackerKind(fakeKind));
const codeHost = new FakeCodeHost(toCodeHostKind(fakeKind));
const runner = new FakeRunner(toRunnerKind(fakeKind));
const warnings: unknown[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-e2e-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  worker = startWorker({
    dbPath,
    registry: new AdapterRegistry()
      .registerTracker({ kind: toTrackerKind(fakeKind), create: () => tracker })
      .registerCodeHost({ kind: toCodeHostKind(fakeKind), create: () => codeHost })
      .registerRunner({ kind: toRunnerKind(fakeKind), create: () => runner }),
    secretBox: new SecretBox(encryptionKey),
    pollIntervalMs: 20,
    logger: { ...silentLogger, warn: (event, fields) => warnings.push({ event, fields }) },
  });

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [],
    cacheDir: join(dir, "vite-cache"),
  }));
}, 120_000);

afterAll(async () => {
  await web?.close();
  await worker?.stop();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("끝에서 끝까지 얇은 경로", () => {
  for (const scenario of scenarios) {
    it(`할당한 런이 끝나 ${scenario.summary} 로 Runs 화면에 보인다`, async () => {
      const assigned = assign(scenario.key);
      expect(assigned.state).toBe("queued");

      const running = await waitForRun(assigned.id, (run) => run.state === "running");
      if (running.state !== "running") throw new Error("unreachable");

      if (scenario.pr !== null) putPullRequest(running, scenario.pr);
      runner.report(running.worktree, { outcome: scenario.report, body: "done" });

      const ended = await waitForRun(assigned.id, (run) => run.state === "ended");
      if (ended.state !== "ended") throw new Error("unreachable");
      expect([ended.agentResult, ended.prState]).toEqual([scenario.agentResult, scenario.prState]);
      expect(listRunStateChanges(db, assigned.id).map((change) => change.to)).toEqual([
        "queued",
        "running",
        "ended",
      ]);
      const records = getRunWithRecords(db, assigned.id)?.records;
      expect(records?.pullRequest?.displayId ?? null).toBe(scenario.pr === null ? null : "#pr");

      const html = await fetchRuns(assigned.id);
      const [title, meta, pill] = rowCells(html, scenario.key) ?? [];
      expect(title).toBe(`Ticket ${scenario.key}`);
      expect(pill).toBe(domain.summary[scenario.summary]);
      expect(meta).toContain(domain.agentResult[scenario.agentResult]);
      expect(meta?.includes(domain.prState[scenario.prState])).toBe(
        scenario.pr !== null || scenario.prState !== "none",
      );
      const panel = panelText(html);
      expect(panel).toContain(scenario.key);
      expect(panel).toContain(domain.summary[scenario.summary]);
      expect(panel).toContain(domain.agentResult[scenario.agentResult]);
      expect(panel).toContain(
        scenario.prState === "none"
          ? runsJson.panel.prSection.none
          : runsJson.panel.prSection.state[scenario.prState],
      );
      expect(panel.includes("#pr")).toBe(scenario.pr !== null);
    });
  }

  it("worker 가 경고 없이 돌았다", () => {
    expect(warnings).toEqual([]);
  });
});

function seed(db: Database): void {
  const secretBox = new SecretBox(encryptionKey);
  saveTrackerConnection(db, secretBox, {
    id: connection,
    kind: toTrackerKind(fakeKind),
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(db, secretBox, {
    id: toCodeHostConnectionId("code-acme"),
    kind: toCodeHostKind(fakeKind),
    name: "Acme",
    config: {},
    secrets: { token: "secret" },
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

  const projects = [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }];
  runner.setProjects(projects);
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind(fakeKind),
    name: "runner-a",
    config: {},
    capacity: 1,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects,
    assignmentBlocked: false,
  });
}

function assign(ticketKey: TicketKey): StoredRun {
  tracker.addTicket({
    key: ticketKey,
    title: `Ticket ${ticketKey}`,
    body: "Do the thing.",
    url: `https://tracker.example.com/${ticketKey}`,
    labels: [],
    project: { id: trackerProject, name: "Web" },
    state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
    updatedAt: new Date(),
  });
  const mapping = getMapping(db, connection, trackerProject);
  if (mapping === null) throw new Error("mapping is missing");
  const result = assignRun(db, {
    ticket: { connection, key: ticketKey },
    trackerProject,
    runnerProject: mapping.defaultRepo,
    agent: mapping.agent,
  });
  if (!result.ok) throw new Error(`assign ${ticketKey} failed: ${result.reason}`);
  return result.run;
}

function putPullRequest(run: StoredRun, state: "open" | "merged" | "closed"): void {
  if (run.state === "queued" || run.branch === null) throw new Error("run has not started");
  const now = new Date();
  codeHost.putPullRequest(repo, {
    id: toPullRequestId(`pr-${run.ticket.key}`),
    displayId: "#pr",
    url: "https://code.example.com/acme/web/pull/1",
    title: `${run.ticket.key}: change`,
    body: "",
    state,
    createdAt: now,
    mergedAt: state === "merged" ? now : null,
    headBranch: run.branch,
    sourceRepo: repo,
    headCommit: "abc123",
    baseBranch: "main",
    ci: "success",
  });
}

async function waitForRun(
  id: RunId,
  done: (run: StoredRun) => boolean,
  timeoutMs = 10_000,
): Promise<StoredRun> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = getRun(db, id);
    if (run !== null && done(run)) return run;
    if (Date.now() > deadline) {
      throw new Error(`run ${id} did not reach the expected state: ${JSON.stringify(run)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function fetchRuns(selected: RunId): Promise<string> {
  const url = new URL("/runs", baseUrl);
  url.searchParams.set("ws", workspaceId);
  url.searchParams.set("sel", selected);
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.text();
}

function withoutFoldedOnly(html: string): string {
  const marker = "<span data-folded-only=";
  let out = html;
  for (let start = out.indexOf(marker); start !== -1; start = out.indexOf(marker)) {
    let depth = 0;
    let at = start;
    do {
      const open = out.indexOf("<span", at + 1);
      const close = out.indexOf("</span>", at + 1);
      if (close === -1) throw new Error("unclosed span");
      if (open !== -1 && open < close) {
        depth += 1;
        at = open;
      } else {
        depth -= 1;
        at = close;
      }
    } while (depth >= 0);
    out = out.slice(0, start) + out.slice(at + "</span>".length);
  }
  return out;
}

function rowCells(html: string, key: string): string[] | undefined {
  for (const chunk of withoutFoldedOnly(html).split('role="option"').slice(1)) {
    const cells = chunk
      .split(/<[^>]+>/)
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.includes("="));
    if (cells[0] === key) return [cells[1] ?? "", cells[3] ?? "", cells[4] ?? ""];
  }
  return undefined;
}

function panelText(html: string): string {
  const panel = html.split("<aside").at(-1)?.split("</aside>")[0] ?? "";
  return panel.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}
