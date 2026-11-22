import { runnersSchema, workspacesSchema } from "@ganger/api";
import type { V1Runner, V1ThisDevice, V1Workspaces } from "@ganger/api";
import { listDevices, listRunners, listWorkspaces } from "@ganger/db";
import type { Database, StoredRunner } from "@ganger/db";
import { dashboardUsage } from "../home/load.js";
import { loadRunnersPage } from "../runners/load.js";
import { runnerIssueCause } from "../shell/model.js";

export function loadV1Runners(db: Database, now: Date): { runners: V1Runner[] } {
  const stored = new Map<string, StoredRunner>(
    listRunners(db).map((runner) => [runner.id, runner]),
  );
  const runners = loadRunnersPage(db, now).runners.map((runner): V1Runner => {
    const source = stored.get(runner.id);
    return {
      id: runner.id,
      name: runner.name,
      cause: runnerIssueCause(runner),
      offlineMs: runner.offlineMs,
      used: runner.occupying.length,
      capacity: runner.capacity,
      usage: runner.usage,
      limits: source === undefined ? [] : dashboardUsage(source, now).limits,
    };
  });
  return runnersSchema.parse({
    runners: runners.toSorted((a, b) => Number(a.cause === null) - Number(b.cause === null)),
  });
}

export function loadV1Workspaces(db: Database): V1Workspaces {
  return workspacesSchema.parse({
    workspaces: listWorkspaces(db).map(({ id, name }) => ({ id, name })),
  });
}

export function loadThisDevice(db: Database, deviceId: string): V1ThisDevice | null {
  const device = listDevices(db).find((candidate) => candidate.id === deviceId);
  return device === undefined
    ? null
    : { id: device.id, name: device.name, createdAt: device.createdAt.toISOString() };
}
