import { isCpuLoadHigh, isLoadReadingFresh, isMemoryLoadHigh } from "@ganger/core";
import type { StoredRunnerLoad } from "@ganger/db";
import type { RunnerLoadView } from "./model.js";

export function runnerLoadView(
  stored: StoredRunnerLoad | null,
  online: boolean,
  now: Date,
): RunnerLoadView | null {
  if (stored === null) return null;
  const base = {
    readAt: stored.readAt.toISOString(),
    agoMs: Math.max(0, now.getTime() - stored.readAt.getTime()),
  };
  if (stored.reading.kind === "unreadable") return { ...base, kind: "unreadable" };
  const current = online && isLoadReadingFresh(stored.readAt, now);
  const { cpu, memory, gpu } = stored.reading;
  return {
    ...base,
    kind: "read",
    cpu:
      cpu === null
        ? null
        : { ...cpu, high: current && isCpuLoadHigh(stored.cpuHighSince, stored.readAt) },
    memory: memory === null ? null : { ...memory, high: current && isMemoryLoadHigh(memory) },
    gpu,
  };
}
