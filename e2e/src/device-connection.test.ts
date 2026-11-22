import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_VERSION,
  V1_PATHS,
  connectResponseSchema,
  dashboardResponseSchema,
  disconnectResponseSchema,
  parseConnectionQr,
  v1ErrorSchema,
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
]);
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
    if (!source.endsWith("/adapters") && !source.endsWith("/device-connection-codes")) return null;
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

  it("알림 사건 경로는 0108 전까지 토큰을 요구하지 않는다", async () => {
    const response = await fetch(new URL("/api/notification-events", baseUrl));
    expect(response.status).toBe(200);
  });
});
