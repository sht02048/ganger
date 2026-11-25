import { randomBytes } from "node:crypto";
import { hashToken } from "@ganger/app/runner-setup/enrollment";
import {
  SecretBox,
  addDevice,
  listDevices,
  listTrackerConnections,
  migrate,
  openDatabase,
  removeDevice,
} from "@ganger/db";
import { startWorker } from "@ganger/worker";
import { hydrateWorld } from "./hydrate.js";
import { DemoLife } from "./life.js";
import { seedDemo } from "./seed.js";
import { demoWorld } from "./world.js";

const DEV_POLL_INTERVAL_MS = 2_000;
const LIFE_INTERVAL_MS = 2_000;

export type DevMode = "seeded" | "onboarding";

export interface DevStartOptions {
  mode: DevMode;
  databasePath: string;
  encryptionKey: Uint8Array;
  life: boolean;
}

export interface DevRuntime {
  seeded: boolean;
  life: DemoLife;
  wake(): void;
  issueDeviceToken(name: string): string;
  stop(): Promise<void>;
}

declare global {
  var __gangerDev:
    | { start(options: DevStartOptions): Promise<DevRuntime>; runtime?: DevRuntime }
    | undefined;
}

async function start(options: DevStartOptions): Promise<DevRuntime> {
  const secretBox = new SecretBox(options.encryptionKey);
  const world = demoWorld();
  const db = openDatabase(options.databasePath);
  migrate(db);
  let seeded = false;
  if (options.mode === "seeded" && listTrackerConnections(db, secretBox).length === 0) {
    await seedDemo(db, secretBox, world, new Date());
    seeded = true;
  }
  hydrateWorld(db, world);

  const worker = startWorker({
    dbPath: options.databasePath,
    registry: world.registry(),
    secretBox,
    pollIntervalMs: DEV_POLL_INTERVAL_MS,
  });
  const life = new DemoLife({ db, secretBox, world });
  life.enabled = options.life;
  const timer = setInterval(() => {
    try {
      life.tick();
    } catch (error) {
      console.warn("[dev] fake runner step failed", error);
    }
  }, LIFE_INTERVAL_MS);

  const runtime: DevRuntime = {
    seeded,
    life,
    wake: () => worker.wake(),
    issueDeviceToken: (name) => {
      const now = new Date();
      for (const device of listDevices(db)) {
        if (device.name === name) removeDevice(db, device.id, now);
      }
      const token = randomBytes(32).toString("base64url");
      addDevice(db, { name, kind: "phone", tokenHash: hashToken(token) }, now);
      return token;
    },
    stop: async () => {
      clearInterval(timer);
      await worker.stop();
      db.$client.close();
    },
  };
  if (globalThis.__gangerDev !== undefined) globalThis.__gangerDev.runtime = runtime;
  return runtime;
}

globalThis.__gangerDev ??= { start };
