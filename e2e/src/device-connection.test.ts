import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_VERSION,
  V1_DESKTOP_REGISTER_PATH,
  V1_NOTIFICATION_PATHS,
  V1_PATHS,
  connectResponseSchema,
  dashboardResponseSchema,
  disconnectResponseSchema,
  notificationEventResponseSchema,
  notificationFeedResponseSchema,
  parseConnectionQr,
  v1ErrorSchema,
  v1NotificationEventPath,
} from "@ganger/api";
import { DeviceConnectionCodes, startDeviceConnection } from "@ganger/app/devices/connection";
import { ENROLLMENT_TTL_MS } from "@ganger/app/runner-setup/enrollment";
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
import {
  SecretBox,
  assignRun,
  changeRunState,
  listDevices,
  migrate,
  openDatabase,
  recordRunQuestions,
  recordRunnerCheck,
  removeDevice,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUCT_VERSION } from "../../apps/web/src/identity/identity.js";
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const replacedModules = new Map([
  [
    join(webRoot, "src/server/adapters.ts"),
    fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url)),
  ],
  [
    join(webRoot, "src/server/device-connection-codes.ts"),
    fileURLToPath(new URL("./browser/fake-device-codes.ts", import.meta.url)),
  ],
  [
    join(webRoot, "src/server/device-streams.ts"),
    fileURLToPath(new URL("./browser/fake-device-streams.ts", import.meta.url)),
  ],
]);
const removalModule = join(webRoot, "src/server/device-removal.ts");
function isRemoval(value: unknown): value is (id: string) => unknown {
  return typeof value === "function";
}
const encryptionKey = new Uint8Array(32).fill(7);
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const SERVER = "https://ganger.example.com";
const EXPO_ADDRESS = "ExponentPushToken[device-secret]";

const clock = { now: Date.now() };
const codes = new DeviceConnectionCodes({ now: () => clock.now });

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;

const replaceModules: Plugin = {
  name: "device-connection-test-modules",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined) return null;
    if (!/\/(?:adapters|device-connection-codes|device-streams)$/u.test(source)) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved === null ? null : (replacedModules.get(resolved.id) ?? null);
  },
};

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
    const result = changeRunState(target, assigned.run.id, change);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
  }
  recordRunQuestions(target, assigned.run.id, [
    { id: toQuestionId("q-1"), body: "Ship it?", options: ["Yes", "No"], askedAt: new Date() },
  ]);
}

function newCode(): string {
  const started = startDeviceConnection({ codes, webAddress: SERVER });
  if (!started.ok) throw new Error(started.reason);
  const qr = parseConnectionQr(started.qr);
  if (qr === null) throw new Error("QR을 읽지 못했다");
  return qr.code;
}

function connect(code: string, name = "Acme iPhone"): Promise<Response> {
  return fetch(new URL(V1_PATHS.connect, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
}

async function connectedDevice(): Promise<{ deviceId: string; token: string }> {
  const response = await connect(newCode());
  expect(response.status).toBe(200);
  return connectResponseSchema.parse(await response.json()).data;
}

function dashboard(token?: string): Promise<Response> {
  return fetch(new URL(V1_PATHS.dashboard, baseUrl), {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

const META = { serverVersion: PRODUCT_VERSION, contractVersion: CONTRACT_VERSION };

function refused(status: number, reason: string) {
  return { status, reason, meta: META };
}

async function refusalOf(response: Response) {
  const body = v1ErrorSchema.parse(await response.json());
  return { status: response.status, reason: body.error.reason, meta: body.meta };
}

beforeAll(async () => {
  globalThis.__gangerTestDeviceCodes = codes;
  dir = mkdtempSync(join(tmpdir(), "ganger-devices-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [replaceModules],
    cacheDir: join(dir, "vite-cache"),
  }));
  const warm = await dashboard();
  if (warm.status !== 401) throw new Error(`warm-up failed: ${warm.status}`);
}, 240_000);

afterAll(async () => {
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  globalThis.__gangerTestDeviceCodes = undefined;
  globalThis.__gangerTestDeviceStreams = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("기기 연결과 v1 Dashboard", () => {
  it("연결 코드로 토큰을 받아 Dashboard를 읽고 서버·계약 버전을 싣는다", async () => {
    const { token } = await connectedDevice();
    const response = await dashboard(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = dashboardResponseSchema.parse(await response.json());
    expect(body.meta).toEqual({
      serverVersion: PRODUCT_VERSION,
      contractVersion: CONTRACT_VERSION,
    });
    expect(body.data.summary.todo.answer).toBe(1);
    expect(body.data.columns.running.todo[0]).toMatchObject({
      ticketKey: "ACME-1",
      todoTag: "question",
      input: { kind: "question", choices: ["Yes", "No"] },
    });
  });

  it("한 번 쓴 연결 코드를 거절한다", async () => {
    const code = newCode();
    expect((await connect(code)).status).toBe(200);
    expect(await refusalOf(await connect(code))).toEqual(refused(410, "used-code"));
  });

  it("만료된 연결 코드를 거절한다", async () => {
    const code = newCode();
    clock.now += ENROLLMENT_TTL_MS;
    expect(await refusalOf(await connect(code))).toEqual(refused(410, "expired-code"));
  });

  it("모르는 연결 코드와 읽을 수 없는 본문을 거절한다", async () => {
    expect(await refusalOf(await connect("unknown-code"))).toEqual(refused(401, "unknown-code"));
    const broken = await fetch(new URL(V1_PATHS.connect, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(await refusalOf(broken)).toEqual(refused(400, "invalid-request"));
  });

  it("토큰 없는 요청과 틀린 토큰을 거절한다", async () => {
    expect(await refusalOf(await dashboard())).toEqual(refused(401, "invalid-token"));
    expect(await refusalOf(await dashboard("wrong-token"))).toEqual(refused(401, "invalid-token"));
  });

  it("목록에서 지운 기기의 토큰을 바로 거절한다", async () => {
    const { deviceId, token } = await connectedDevice();
    expect((await dashboard(token)).status).toBe(200);
    removeDevice(db, deviceId, new Date());
    expect(await refusalOf(await dashboard(token))).toEqual(refused(401, "invalid-token"));
  });

  it("기기가 스스로 연결을 끊으면 그 토큰을 거절한다", async () => {
    const { deviceId, token } = await connectedDevice();
    const response = await fetch(new URL(V1_PATHS.thisDevice, baseUrl), {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(disconnectResponseSchema.parse(await response.json()).data.disconnected).toBe(true);
    expect(listDevices(db).some((device) => device.id === deviceId)).toBe(false);
    expect(await refusalOf(await dashboard(token))).toEqual(refused(401, "invalid-token"));
  });

  it("토큰 없이 연결을 끊을 수 없다", async () => {
    const response = await fetch(new URL(V1_PATHS.thisDevice, baseUrl), { method: "DELETE" });
    expect(await refusalOf(response)).toEqual(refused(401, "invalid-token"));
  });

  it("토큰 원문은 DB와 교환 응답 밖의 응답에 없고 Expo 푸시 주소는 어느 응답에도 없다", async () => {
    const { deviceId, token } = await connectedDevice();
    db.$client
      .prepare("UPDATE devices SET expo_push_token = ? WHERE id = ?")
      .run(EXPO_ADDRESS, deviceId);
    expect(JSON.stringify(db.$client.prepare("SELECT * FROM devices").all())).not.toContain(token);
    const bodies = await Promise.all(
      [
        await dashboard(token),
        await dashboard(),
        await fetch(new URL("/api/identity", baseUrl)),
      ].map((response) => response.text()),
    );
    for (const body of bodies) {
      expect(body).not.toContain(token);
      expect(body).not.toContain(EXPO_ADDRESS);
      expect(body.toLowerCase()).not.toContain("expo");
    }
  });

  it("옛 알림 사건 경로는 v0.6.0 까지 토큰 없이 그대로 열려 있다", async () => {
    for (const path of ["/api/notification-events", "/api/attention"]) {
      expect((await fetch(new URL(path, baseUrl))).status).toBe(200);
    }
  });
});

function authorized(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function openStream(token: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch(new URL(V1_NOTIFICATION_PATHS.stream, baseUrl), {
    headers: authorized(token),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  if (response.body === null) throw new Error("스트림 본문이 없다");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("event: ready")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("ready 전에 끝났다");
    text += decoder.decode(value, { stream: true });
  }
  return reader;
}

async function endOf(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> {
  for (;;) {
    const { done } = await reader.read();
    if (done) return true;
  }
}

describe("v1 알림 사건", () => {
  it("토큰 없는 목록·스트림·사건 하나 읽기를 거절한다", async () => {
    for (const path of [
      V1_NOTIFICATION_PATHS.feed,
      V1_NOTIFICATION_PATHS.stream,
      v1NotificationEventPath(1),
    ]) {
      const response = await fetch(new URL(path, baseUrl));
      expect(await refusalOf(response)).toEqual(refused(401, "invalid-token"));
    }
  });

  it("기기 토큰으로 목록과 사건 하나를 읽고, 없는 번호는 not-found 로 거절한다", async () => {
    const { token } = await connectedDevice();
    const feedResponse = await fetch(new URL(V1_NOTIFICATION_PATHS.feed, baseUrl), {
      headers: authorized(token),
    });
    const feed = notificationFeedResponseSchema.parse(await feedResponse.json());
    expect(feed.meta).toEqual(META);
    const first = feed.data.events[0];
    if (first === undefined) throw new Error("열린 사건이 없다");

    const one = await fetch(new URL(v1NotificationEventPath(first.id), baseUrl), {
      headers: authorized(token),
    });
    expect(notificationEventResponseSchema.parse(await one.json()).data).toEqual(first);

    for (const id of ["999999", "abc"]) {
      const missing = await fetch(new URL(`${V1_NOTIFICATION_PATHS.feed}/${id}`, baseUrl), {
        headers: authorized(token),
      });
      expect(await refusalOf(missing)).toEqual(refused(404, "not-found"));
    }
  });

  it("데스크톱은 연결 코드 없이 등록해 토큰을 받는다", async () => {
    const response = await fetch(new URL(V1_DESKTOP_REGISTER_PATH, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme Mac" }),
    });
    const { deviceId, token } = connectResponseSchema.parse(await response.json()).data;
    expect(listDevices(db).find((device) => device.id === deviceId)?.name).toBe("Acme Mac");
    expect((await dashboard(token)).status).toBe(200);
  });

  it("다른 사이트의 페이지는 데스크톱 등록을 할 수 없다", async () => {
    const before = listDevices(db).length;
    const response = await fetch(new URL(V1_DESKTOP_REGISTER_PATH, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ name: "Evil" }),
    });
    expect(response.status).toBe(403);
    expect(listDevices(db)).toHaveLength(before);
  });

  it("기기가 스스로 끊으면 그 토큰으로 열린 SSE 만 닫는다", async () => {
    const leaving = await connectedDevice();
    const staying = await connectedDevice();
    const leavingStream = await openStream(leaving.token);
    const stayingStream = await openStream(staying.token);

    await fetch(new URL(V1_PATHS.thisDevice, baseUrl), {
      method: "DELETE",
      headers: authorized(leaving.token),
    });

    expect(await endOf(leavingStream)).toBe(true);
    const still = await Promise.race([
      stayingStream.read().then(() => "open"),
      new Promise((resolve) => setTimeout(() => resolve("open"), 200)),
    ]);
    expect(still).toBe("open");
    await stayingStream.cancel();
  });

  it("Settings 에서 기기를 지우면 그 토큰으로 열린 SSE 를 닫는다", async () => {
    const { deviceId, token } = await connectedDevice();
    const stream = await openStream(token);
    const removal = await web.ssrLoadModule(removalModule);
    const remove: unknown = removal["removeDeviceAndCloseStreams"];
    if (!isRemoval(remove)) throw new Error("지우기 함수를 찾지 못했다");

    expect(remove(deviceId)).toEqual({ ok: true });

    expect(await endOf(stream)).toBe(true);
    expect(await refusalOf(await dashboard(token))).toEqual(refused(401, "invalid-token"));
  });
});
