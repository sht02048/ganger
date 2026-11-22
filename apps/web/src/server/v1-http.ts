import { CONTRACT_VERSION } from "@ganger/api";
import type { V1ErrorReason, V1Meta } from "@ganger/api";
import { authenticateDevice, connectDevice, registerDesktop } from "@ganger/app/devices/connection";
import { toV1Dashboard } from "@ganger/app/devices/dashboard";
import { loadThisDevice, loadV1Runners, loadV1Workspaces } from "@ganger/app/devices/runners";
import { loadHomePage } from "@ganger/app/home/load";
import { parseAfter, toNotificationRecord } from "@ganger/app/notifications/feed";
import { parseTimeZone } from "@ganger/app/time-zone";
import { getNotificationEvent } from "@ganger/db";
import { z } from "zod";
import { changeStream } from "../change-events/feed";
import { PRODUCT_VERSION } from "../identity/identity";
import { readNotificationFeed } from "../notifications/notifications";
import { notificationSync } from "../notifications/server";
import {
  lastEventId,
  notificationStream,
  notificationStreamResponse,
} from "../notifications/stream";
import { changeSourceOf, getChangeFeed } from "./change-events";
import { getDatabase } from "./database";
import { getDesktopRegistrations } from "./desktop-registrations";
import { getDeviceConnectionCodes } from "./device-connection-codes";
import { removeDeviceAndCloseStreams } from "./device-removal";
import { getDeviceStreams } from "./device-streams";
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
  removeDeviceAndCloseStreams(deviceId);
  return v1Data({ disconnected: true });
}

export async function serveV1RegisterDesktop(request: Request): Promise<Response> {
  const reply = registerDesktop(
    { db: getDatabase(), registrations: getDesktopRegistrations() },
    await readJson(request),
    new Date(),
  );
  return reply.status === 200 ? v1Data(reply.result) : v1Error(reply.status, reply.reason);
}

export function serveV1NotificationFeed(request: Request): Response {
  if (requestDevice(request) === null) return v1Error(401, "invalid-token");
  notificationSync();
  const after = parseAfter(new URL(request.url).searchParams.get("after"));
  return v1Data(readNotificationFeed(getDatabase(), after));
}

export function serveV1NotificationStream(request: Request): Response {
  const deviceId = requestDevice(request);
  if (deviceId === null) return v1Error(401, "invalid-token");
  const source = notificationStream({
    after: parseAfter(lastEventId(request)),
    sync: notificationSync,
    read: (after) => readNotificationFeed(getDatabase(), after),
  });
  return notificationStreamResponse(getDeviceStreams().track(deviceId, source));
}

const notificationEventId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export function serveV1NotificationEvent(request: Request, id: string): Response {
  if (requestDevice(request) === null) return v1Error(401, "invalid-token");
  const parsed = notificationEventId.safeParse(id);
  const event = parsed.success ? getNotificationEvent(getDatabase(), parsed.data) : null;
  if (event === null) return v1Error(404, "not-found");
  return v1Data(toNotificationRecord(event));
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

export function serveV1ChangeStream(request: Request): Response {
  const deviceId = requestDevice(request);
  if (deviceId === null) return v1Error(401, "invalid-token");
  const source = changeStream({
    after: parseAfter(lastEventId(request)),
    feed: getChangeFeed(),
    source: changeSourceOf(getDatabase()),
  });
  return notificationStreamResponse(getDeviceStreams().track(deviceId, source));
}
