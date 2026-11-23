import { SecretBox, migrate, openDatabase, parseBootConfig } from "@ganger/db";
import { isWorkerWakeEnabled } from "@ganger/core";
import type { AdapterRegistry } from "@ganger/core";
import { log } from "@ganger/log";
import { z } from "zod";
import { createAdapterRegistry } from "./registry.js";
import { startWorker } from "./worker.js";
import type { RunningWorker, WorkerLogger } from "./worker.js";

export const POLL_INTERVAL_MS = 10_000;
export const EXPO_PUSH_URL_ENV = "GANGER_EXPO_PUSH_URL";

const pushUrlSchema = z.url({ protocol: /^https?$/u });

export interface BootOptions {
  env: Readonly<Record<string, string | undefined>>;
  registry?: AdapterRegistry;
  pollIntervalMs?: number;
  logger?: WorkerLogger;
}

export function bootWorker(options: BootOptions): { migrated: string[]; worker: RunningWorker } {
  const config = parseBootConfig(options.env);
  const configuredPushUrl = options.env[EXPO_PUSH_URL_ENV];
  const parsedPushUrl = pushUrlSchema.safeParse(configuredPushUrl);
  const pushUrl = parsedPushUrl.success ? parsedPushUrl.data : undefined;
  if (configuredPushUrl && pushUrl === undefined) {
    (options.logger ?? log()).warn("push.url_invalid");
  }
  const db = openDatabase(config.databasePath);
  let migrated: string[];
  try {
    migrated = migrate(db);
  } finally {
    db.$client.close();
  }
  const worker = startWorker({
    dbPath: config.databasePath,
    registry: options.registry ?? createAdapterRegistry(),
    secretBox: new SecretBox(config.encryptionKey),
    pollIntervalMs: options.pollIntervalMs ?? POLL_INTERVAL_MS,
    receivesDeviceReports: isWorkerWakeEnabled(options.env),
    ...(pushUrl === undefined ? {} : { push: { url: pushUrl } }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return { migrated, worker };
}
