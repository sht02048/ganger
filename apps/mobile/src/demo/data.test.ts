import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_WORKSPACES } from "../dashboard/model";
import { busySnapshot, emptySnapshot } from "./data";

const builtinsMissingOnDeviceHermes: readonly (readonly [object, string])[] = [
  [Array.prototype, "toSorted"],
  [Array, "fromAsync"],
  [Object, "groupBy"],
  [Map, "groupBy"],
];

const NOW = new Date(2026, 10, 25, 12, 0, 0);

describe("demo snapshots on a runtime without the builtins device Hermes lacks", () => {
  const removed: [object, string, PropertyDescriptor][] = [];

  beforeEach(() => {
    for (const [owner, name] of builtinsMissingOnDeviceHermes) {
      const descriptor = Reflect.getOwnPropertyDescriptor(owner, name);
      if (descriptor === undefined) continue;
      removed.push([owner, name, descriptor]);
      Reflect.deleteProperty(owner, name);
    }
  });

  afterEach(() => {
    for (const [owner, name, descriptor] of removed.splice(0)) {
      Reflect.defineProperty(owner, name, descriptor);
    }
  });

  it("removes the builtins before each case", () => {
    expect(Reflect.has(Array.prototype, "toSorted")).toBe(false);
  });

  it("builds the busy snapshot and every workspace dashboard", () => {
    const snapshot = busySnapshot(NOW);
    const workspaceIds = [ALL_WORKSPACES, ...snapshot.workspaces.map((workspace) => workspace.id)];
    for (const workspaceId of workspaceIds) {
      expect(snapshot.dashboardFor(workspaceId).workspace.kind).not.toBe("none");
    }
    expect(snapshot.dashboardFor(ALL_WORKSPACES).summary.inProgress).toBeGreaterThan(0);
    const highestUsage = snapshot.runners.flatMap((runner) =>
      runner.usage?.kind === "read" ? [runner.usage.highest?.window.usedPercent] : [],
    );
    expect(highestUsage).toEqual([31, 22, 100]);
  });

  it("builds the empty snapshot and its dashboards", () => {
    const snapshot = emptySnapshot();
    expect(snapshot.runners).toEqual([]);
    expect(snapshot.dashboardFor(ALL_WORKSPACES).summary.inProgress).toBe(0);
  });
});
