import { randomUUID } from "node:crypto";
import {
  DEVICE_NAME_MAX_LENGTH,
  V1_DESKTOP_REGISTER_PATH,
  connectResponseSchema,
} from "@ganger/api";
import type { AppSettings, SettingsStore } from "./settings.js";

export type FeedConnection =
  | { kind: "token"; token: string }
  | { kind: "unsupported" }
  | { kind: "rejected" }
  | { kind: "unavailable" };

export type StoredDeviceToken =
  | { kind: "none" }
  | { kind: "token"; token: string }
  | { kind: "unreadable" };

export interface DeviceTokenStore {
  read(instanceId: string): StoredDeviceToken;
  write(instanceId: string, token: string): void;
}

export interface TokenCipher {
  isAvailable(): boolean;
  encrypt(text: string): string;
  decrypt(sealed: string): string;
}

export function deviceTokenStore(
  settings: SettingsStore,
  cipher: TokenCipher | null,
): DeviceTokenStore {
  const memory = new Map<string, string>();
  const sealedTokens = (current: AppSettings) => current.deviceTokens ?? {};
  return {
    read: (instanceId) => {
      const held = memory.get(instanceId);
      if (held !== undefined) return { kind: "token", token: held };
      const sealed = sealedTokens(settings.read())[instanceId];
      if (sealed === undefined) return { kind: "none" };
      if (cipher === null || !cipher.isAvailable()) return { kind: "unreadable" };
      try {
        return { kind: "token", token: cipher.decrypt(sealed) };
      } catch {
        return { kind: "unreadable" };
      }
    },
    write: (instanceId, token) => {
      memory.set(instanceId, token);
      if (cipher === null || !cipher.isAvailable()) return;
      try {
        const current = settings.read();
        settings.write({
          ...current,
          deviceTokens: { ...sealedTokens(current), [instanceId]: cipher.encrypt(token) },
        });
        memory.delete(instanceId);
      } catch {
        return;
      }
    },
  };
}

export type RegisterResult =
  | { kind: "registered"; token: string }
  | { kind: "unsupported" }
  | { kind: "failed" };

export async function registerDesktop(
  origin: string,
  name: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<RegisterResult> {
  try {
    const response = await fetchImpl(new URL(V1_DESKTOP_REGISTER_PATH, origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim().slice(0, DEVICE_NAME_MAX_LENGTH), requestId }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (response.status === 404 || response.status === 405) return { kind: "unsupported" };
    if (!response.ok) return { kind: "failed" };
    const parsed = connectResponseSchema.safeParse(await response.json().catch(() => null));
    return parsed.success
      ? { kind: "registered", token: parsed.data.data.token }
      : { kind: "unsupported" };
  } catch {
    return { kind: "failed" };
  }
}

export interface DeviceLinkOptions {
  store: DeviceTokenStore;
  identify: (origin: string) => Promise<string | null>;
  register: (origin: string, requestId: string) => Promise<RegisterResult>;
}

export class DeviceLink {
  private readonly options: DeviceLinkOptions;
  private readonly registering = new Map<string, Promise<RegisterResult>>();
  private readonly unfinishedRequests = new Map<string, string>();

  constructor(options: DeviceLinkOptions) {
    this.options = options;
  }

  async connection(origin: string): Promise<FeedConnection> {
    const instanceId = await this.options.identify(origin);
    if (instanceId === null) return { kind: "unavailable" };
    const stored = this.options.store.read(instanceId);
    if (stored.kind === "token") return { kind: "token", token: stored.token };
    if (stored.kind === "unreadable") return { kind: "rejected" };
    return toConnection(await this.registerOnce(origin, instanceId));
  }

  async reconnect(origin: string): Promise<RegisterResult["kind"]> {
    const instanceId = await this.options.identify(origin);
    if (instanceId === null) return "failed";
    const result = await this.registerOnce(origin, instanceId);
    return result.kind;
  }

  private registerOnce(origin: string, instanceId: string): Promise<RegisterResult> {
    const running = this.registering.get(instanceId);
    if (running !== undefined) return running;
    const requestId = this.unfinishedRequests.get(instanceId) ?? randomUUID();
    this.unfinishedRequests.set(instanceId, requestId);
    const started = this.options
      .register(origin, requestId)
      .then((result) => {
        if (result.kind === "registered") {
          this.options.store.write(instanceId, result.token);
          this.unfinishedRequests.delete(instanceId);
        }
        return result;
      })
      .finally(() => this.registering.delete(instanceId));
    this.registering.set(instanceId, started);
    return started;
  }
}

function toConnection(result: RegisterResult): FeedConnection {
  switch (result.kind) {
    case "registered":
      return { kind: "token", token: result.token };
    case "unsupported":
      return { kind: "unsupported" };
    case "failed":
      return { kind: "unavailable" };
  }
}
