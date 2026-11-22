import { CONTRACT_VERSION } from "@ganger/api";
import type { V1ErrorReason, V1Meta } from "@ganger/api";
import { authenticateDevice, connectDevice } from "@ganger/app/devices/connection";
import { toV1Dashboard } from "@ganger/app/devices/dashboard";
import { loadThisDevice, loadV1Runners, loadV1Workspaces } from "@ganger/app/devices/runners";
import { loadHomePage } from "@ganger/app/home/load";
import { parseAfter } from "@ganger/app/notifications/feed";
import { parseTimeZone } from "@ganger/app/time-zone";
import { removeDevice } from "@ganger/db";
import { changeStream } from "../change-events/feed";
import { PRODUCT_VERSION } from "../identity/identity";
import { lastEventId, notificationStreamResponse } from "../notifications/stream";
import { changeSourceOf, getChangeFeed } from "./change-events";
import { getDatabase } from "./database";
import { getDeviceConnectionCodes } from "./device-connection-codes";
import { readLimited } from "./runner-enrollment-http";

const NO_STORE = { "cache-control": "no-store" };
const META: V1Meta = { serverVersion: PRODUCT_VERSION, contractVersion: CONTRACT_VERSION };

function v1Data(data: unknown): Response {
  return Response.json({ meta: META, data }, { headers: NO_STORE });
}

function v1Error(status: number, reason: V1ErrorReason): Response {
  return Response.json({ meta: META, error: { reason } }, { status, headers: NO_STORE });
}

function requestDevice(request: Request): string | null {
  return authenticateDevice(getDatabase(), request.headers.get("authorization"), new Date());
}

async function readJson(request: Request): Promise<unknown> {
  const text = await readLimited(request);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

export async function serveV1Connect(request: Request): Promise<Response> {
  const reply = connectDevice(
    { db: getDatabase(), codes: getDeviceConnectionCodes() },
    await readJson(request),
    new Date(),
  );
  return reply.status === 200 ? v1Data(reply.result) : v1Error(reply.status, reply.reason);
}

export function serveV1Disconnect(request: Request): Response {
  const deviceId = requestDevice(request);
  if (deviceId === null) return v1Error(401, "invalid-token");
  removeDevice(getDatabase(), deviceId, new Date());
  return v1Data({ disconnected: true });
}

export function serveV1Dashboard(request: Request): Response {
  if (requestDevice(request) === null) return v1Error(401, "invalid-token");
  const params = new URL(request.url).searchParams;
  const page = loadHomePage(
    getDatabase(),
    params.get("ws") ?? undefined,
    new Date(),
    parseTimeZone(params.get("timeZone")),
  );
  return v1Data(toV1Dashboard(page));
}

export function serveV1Runners(request: Request): Response {
  if (requestDevice(request) === null) return v1Error(401, "invalid-token");
  return v1Data(loadV1Runners(getDatabase(), new Date()));
}

export function serveV1Workspaces(request: Request): Response {
  if (requestDevice(request) === null) return v1Error(401, "invalid-token");
  return v1Data(loadV1Workspaces(getDatabase()));
}

export function serveV1ThisDevice(request: Request): Response {
  const deviceId = requestDevice(request);
  const device = deviceId === null ? null : loadThisDevice(getDatabase(), deviceId);
  return device === null ? v1Error(401, "invalid-token") : v1Data(device);
}

function openChangeStream(request: Request): ReadableStream<Uint8Array> {
  return changeStream({
    after: parseAfter(lastEventId(request)),
    feed: getChangeFeed(),
    source: changeSourceOf(getDatabase()),
  });
}

export function serveV1ChangeStream(request: Request): Response {
  if (requestDevice(request) === null) return v1Error(401, "invalid-token");
  return notificationStreamResponse(openChangeStream(request));
}
