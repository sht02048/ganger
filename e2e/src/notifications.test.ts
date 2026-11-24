import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toAgentRef,
  toQuestionId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
  toWorktreeRef,
} from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  SecretBox,
  answerRunQuestion,
  assignRun,
  changeRunState,
  migrate,
  openDatabase,
  recordRunQuestions,
  recordRunnerCheck,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import {
  V1_DESKTOP_REGISTER_PATH,
  V1_NOTIFICATION_PATHS,
  connectResponseSchema,
  notificationFeedResponseSchema,
} from "@ganger/api";
import { notificationRecordSchema } from "@ganger/app/notifications/feed";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const encryptionKey = new Uint8Array(32).fill(7);
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let questionRun: RunId;
let deviceToken: string;

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
  dir = mkdtempSync(join(tmpdir(), "ganger-notifications-"));
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
  const registered = await fetch(new URL(V1_DESKTOP_REGISTER_PATH, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Acme Mac", requestId: "e2e-notifications-000001" }),
  });
  if (registered.status !== 200) throw new Error(`warm-up failed: ${registered.status}`);
  deviceToken = connectResponseSchema.parse(await registered.json()).data.token;
}, 240_000);

afterAll(async () => {
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function seed(target: Database): void {
  saveTrackerConnection(target, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveWorkspace(target, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(target, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  const agent = toAgentId("claude");
  saveMapping(target, { connection, trackerProject, runnerProject, agent });
  saveRunner(target, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
  recordRunnerCheck(target, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
    assignmentBlocked: false,
  });
  const assigned = assignRun(target, {
    ticket: { connection, key: toTicketKey("ACME-1") },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  questionRun = assigned.run.id;
  for (const change of [
    {
      to: "running" as const,
      started: {
        worktree: toWorktreeRef("wt-1"),
        branch: "acme/wt-1",
        agentRef: toAgentRef("agent-1"),
      },
    },
    { to: "waiting-for-input" as const },
  ]) {
    const result = changeRunState(target, questionRun, change);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
  }
  recordRunQuestions(target, questionRun, [
    { id: toQuestionId("q-1"), body: "Ship it?", options: ["Yes", "No"], askedAt: new Date() },
  ]);
}

interface StreamMessage {
  event: string;
  id: string | null;
  data: unknown;
}

async function readStream(
  headers: Record<string, string>,
  until: (messages: StreamMessage[]) => boolean,
): Promise<StreamMessage[]> {
  const abort = new AbortController();
  const response = await fetch(new URL(V1_NOTIFICATION_PATHS.stream, baseUrl), {
    headers: { ...headers, authorization: `Bearer ${deviceToken}` },
    signal: abort.signal,
  });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const messages: StreamMessage[] = [];
  let buffer = "";
  const deadline = Date.now() + 20_000;
  while (!until(messages)) {
    if (Date.now() > deadline) throw new Error(`stream timed out: ${JSON.stringify(messages)}`);
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const fields = new Map<string, string>();
      for (const line of block.split("\n")) {
        const at = line.indexOf(": ");
        if (at > 0) fields.set(line.slice(0, at), line.slice(at + 2));
      }
      const data = fields.get("data");
      if (data !== undefined) {
        messages.push({
          event: fields.get("event") ?? "message",
          id: fields.get("id") ?? null,
          data: JSON.parse(data),
        });
      }
      end = buffer.indexOf("\n\n");
    }
  }
  abort.abort();
  return messages;
}

const notifications = (messages: StreamMessage[]) =>
  messages.flatMap((message) => {
    if (message.event !== "notification") return [];
    const parsed = notificationRecordSchema.safeParse(message.data);
    return parsed.success ? [parsed.data] : [];
  });

describe("알림 사건 전달(서버, 0103)", () => {
  it("SSE 로 열린 사건을 바로 받고, 다른 곳에서 답하면 해결을 이어서 받는다", async () => {
    const first = await readStream({}, (messages) =>
      messages.some((message) => message.event === "ready"),
    );
    const question = notifications(first).find((record) => record.kind === "question");
    expect(question).toMatchObject({
      subject: "ACME-1",
      target: { kind: "run", runId: questionRun, workspaceId },
      resolvedAt: null,
    });
    const ready = first.find((message) => message.event === "ready");
    const cursor = ready?.id ?? "0";

    answerRunQuestion(db, { runId: questionRun, questionId: toQuestionId("q-1"), answer: "Yes" });
    const resumed = await readStream({ "last-event-id": cursor }, (messages) =>
      notifications(messages).some((record) => record.resolvedAt !== null),
    );
    const resolved = notifications(resumed);
    expect(resolved.map((record) => [record.id, record.resolvedAt !== null])).toEqual([
      [question?.id, true],
    ]);
    expect(Number(resolved[0]?.seq)).toBeGreaterThan(Number(cursor));
  });

  it("폴링 경로는 같은 저장소에서 같은 사건과 번호를 준다", async () => {
    const url = new URL(V1_NOTIFICATION_PATHS.feed, baseUrl);
    url.searchParams.set("after", "0");
    const response = await fetch(url, { headers: { authorization: `Bearer ${deviceToken}` } });
    const feed = notificationFeedResponseSchema.parse(await response.json()).data;
    expect(feed.events.some((record) => record.kind === "question")).toBe(true);
    expect(feed.cursor).toBeGreaterThan(0);
  });

  it("허용하지 않은 Host 로 온 SSE 요청은 요청 가드가 막는다", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(V1_NOTIFICATION_PATHS.stream, baseUrl);
      const req = httpRequest(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          headers: { host: "evil.example.com" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
