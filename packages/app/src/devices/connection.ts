import { randomBytes, randomUUID } from "node:crypto";
import { connectRequestSchema, connectionQrText, isConnectableAddress } from "@ganger/api";
import type { ConnectResult, V1ErrorReason } from "@ganger/api";
import { addDevice, listDevices, removeDevice, seeDeviceByTokenHash } from "@ganger/db";
import type { Database } from "@ganger/db";
import { z } from "zod";
import {
  ENROLLMENT_TOKEN_BYTES,
  ENROLLMENT_TTL_MS,
  hashToken,
} from "../runner-setup/enrollment.js";

const DEVICE_TOKEN_BYTES = 32;
const FORGET_AFTER_MS = 60 * 60_000;
const BEARER = /^Bearer ([A-Za-z0-9_-]{1,200})$/iu;

export type CodeRefusal = "unknown" | "expired" | "used";

interface CodeEntry {
  id: string;
  codeHash: string;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export interface DeviceConnectionCodesOptions {
  now?: () => number;
  ttlMs?: number;
  newCode?: () => string;
}

export class DeviceConnectionCodes {
  private readonly byHash = new Map<string, CodeEntry>();
  private readonly byId = new Map<string, CodeEntry>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly newCode: () => string;

  constructor(options: DeviceConnectionCodesOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? ENROLLMENT_TTL_MS;
    this.newCode =
      options.newCode ?? (() => randomBytes(ENROLLMENT_TOKEN_BYTES).toString("base64url"));
  }

  issue(): { id: string; code: string; expiresInMs: number } {
    const now = this.now();
    this.forgetOld(now);
    const code = this.newCode();
    const entry: CodeEntry = {
      id: randomUUID(),
      codeHash: hashToken(code),
      issuedAt: now,
      expiresAt: now + this.ttlMs,
      used: false,
    };
    this.byHash.set(entry.codeHash, entry);
    this.byId.set(entry.id, entry);
    return { id: entry.id, code, expiresInMs: this.ttlMs };
  }

  claim(code: string): { ok: true } | { ok: false; refusal: CodeRefusal } {
    const entry = this.byHash.get(hashToken(code));
    if (entry === undefined) return { ok: false, refusal: "unknown" };
    if (entry.used) return { ok: false, refusal: "used" };
    if (this.now() >= entry.expiresAt) return { ok: false, refusal: "expired" };
    entry.used = true;
    return { ok: true };
  }

  revoke(id: string): void {
    const entry = this.byId.get(id);
    if (entry === undefined) return;
    this.byId.delete(id);
    this.byHash.delete(entry.codeHash);
  }

  private forgetOld(now: number): void {
    for (const entry of this.byId.values()) {
      if (now - entry.issuedAt > FORGET_AFTER_MS) this.revoke(entry.id);
    }
  }
}

export type StartDeviceConnectionResult =
  | { ok: true; id: string; qr: string; expiresInMs: number }
  | { ok: false; reason: "no-https-address" };

export function startDeviceConnection(input: {
  codes: DeviceConnectionCodes;
  webAddress: string | null;
  replacing?: string | undefined;
}): StartDeviceConnectionResult {
  if (input.replacing !== undefined) input.codes.revoke(input.replacing);
  if (!isConnectableAddress(input.webAddress)) return { ok: false, reason: "no-https-address" };
  const issued = input.codes.issue();
  return {
    ok: true,
    id: issued.id,
    qr: connectionQrText({ server: input.webAddress, code: issued.code }),
    expiresInMs: issued.expiresInMs,
  };
}

export type ConnectDeviceReply =
  | { status: 200; result: ConnectResult }
  | { status: 400 | 401 | 410; reason: V1ErrorReason };

const REFUSALS = {
  unknown: { status: 401, reason: "unknown-code" },
  expired: { status: 410, reason: "expired-code" },
  used: { status: 410, reason: "used-code" },
} as const satisfies Record<CodeRefusal, { status: 401 | 410; reason: V1ErrorReason }>;

export function connectDevice(
  context: { db: Database; codes: DeviceConnectionCodes },
  body: unknown,
  now: Date,
): ConnectDeviceReply {
  const request = connectRequestSchema.safeParse(body);
  if (!request.success) return { status: 400, reason: "invalid-request" };
  const claimed = context.codes.claim(request.data.code);
  if (!claimed.ok) return REFUSALS[claimed.refusal];
  const token = randomBytes(DEVICE_TOKEN_BYTES).toString("base64url");
  const device = addDevice(
    context.db,
    { name: request.data.name, tokenHash: hashToken(token) },
    now,
  );
  return { status: 200, result: { deviceId: device.id, token } };
}

export function authenticateDevice(
  db: Database,
  authorization: string | null,
  now: Date,
): string | null {
  const token = authorization === null ? undefined : BEARER.exec(authorization.trim())?.[1];
  return token === undefined ? null : seeDeviceByTokenHash(db, hashToken(token), now);
}

export interface DeviceRow {
  id: string;
  name: string;
  createdAt: string;
  createdAgoMs: number;
  lastSeenAt: string | null;
  lastSeenAgoMs: number | null;
}

export interface DevicesView {
  devices: DeviceRow[];
  address: string | null;
}

export function loadDevicesView(db: Database, webAddress: string | null, now: Date): DevicesView {
  const agoMs = (at: Date) => Math.max(0, now.getTime() - at.getTime());
  return {
    address: isConnectableAddress(webAddress) ? webAddress : null,
    devices: listDevices(db).map((device) => ({
      id: device.id,
      name: device.name,
      createdAt: device.createdAt.toISOString(),
      createdAgoMs: agoMs(device.createdAt),
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      lastSeenAgoMs: device.lastSeenAt === null ? null : agoMs(device.lastSeenAt),
    })),
  };
}

export const deviceIdInput = z.object({ id: z.uuid() });
export const startConnectionInput = z.object({ replacing: z.uuid().optional() });

export function removeDeviceById(db: Database, id: string, now: Date): { ok: boolean } {
  return { ok: removeDevice(db, id, now) };
}
