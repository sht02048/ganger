import { describe, expect, it } from "vitest";
import {
  CPU_HIGH_AFTER_MS,
  isCpuLoadHigh,
  isLoadReadingFresh,
  isMemoryLoadHigh,
  LOAD_READING_FRESH_MS,
  nextCpuHighSince,
} from "./runner-load.js";
import type { RunnerLoadReading } from "./runner-load.js";

const start = new Date("2026-11-23T00:00:00.000Z");
const after = (ms: number) => new Date(start.getTime() + ms);

function cpuAt(percent: number): RunnerLoadReading {
  return {
    kind: "read",
    cpu: { percent, loadAverage: percent / 10, cores: 10 },
    memory: null,
    gpu: null,
  };
}

describe("nextCpuHighSince", () => {
  it("starts the streak at the first reading at or above 90%", () => {
    expect(nextCpuHighSince(null, cpuAt(90), start)).toEqual(start);
  });

  it("keeps the streak start while readings stay high", () => {
    const previous = { readAt: after(CPU_HIGH_AFTER_MS), cpuHighSince: start };
    expect(nextCpuHighSince(previous, cpuAt(95), after(2 * CPU_HIGH_AFTER_MS))).toEqual(start);
  });

  it("clears the streak when a reading drops below 90%", () => {
    const previous = { readAt: start, cpuHighSince: start };
    expect(nextCpuHighSince(previous, cpuAt(89.9), after(CPU_HIGH_AFTER_MS))).toBeNull();
  });

  it("clears the streak when CPU could not be read", () => {
    const previous = { readAt: start, cpuHighSince: start };
    expect(nextCpuHighSince(previous, { kind: "unreadable" }, after(60_000))).toBeNull();
  });

  it("restarts the streak after a gap too long to call continuous", () => {
    const previous = { readAt: start, cpuHighSince: start };
    const now = after(LOAD_READING_FRESH_MS + 1);
    expect(nextCpuHighSince(previous, cpuAt(95), now)).toEqual(now);
  });
});

describe("isCpuLoadHigh", () => {
  it("is not high before the streak has lasted five minutes", () => {
    expect(isCpuLoadHigh(start, after(CPU_HIGH_AFTER_MS - 1))).toBe(false);
  });

  it("is high once the streak has lasted five minutes", () => {
    expect(isCpuLoadHigh(start, after(CPU_HIGH_AFTER_MS))).toBe(true);
  });

  it("is not high without a streak", () => {
    expect(isCpuLoadHigh(null, start)).toBe(false);
  });
});

describe("isMemoryLoadHigh", () => {
  const memory = { usedBytes: 95, totalBytes: 100 };

  it("follows macOS memory pressure over the used percent", () => {
    expect(isMemoryLoadHigh({ ...memory, percent: 95, pressure: "normal" })).toBe(false);
    expect(isMemoryLoadHigh({ ...memory, percent: 40, pressure: "high" })).toBe(true);
  });

  it("uses 90% when the runner reports no pressure", () => {
    expect(isMemoryLoadHigh({ ...memory, percent: 90, pressure: null })).toBe(true);
    expect(isMemoryLoadHigh({ ...memory, percent: 89, pressure: null })).toBe(false);
  });

  it("is not high when memory could not be read", () => {
    expect(isMemoryLoadHigh(null)).toBe(false);
  });
});

describe("isLoadReadingFresh", () => {
  it("treats a reading older than ten minutes as stale", () => {
    expect(isLoadReadingFresh(start, after(LOAD_READING_FRESH_MS))).toBe(true);
    expect(isLoadReadingFresh(start, after(LOAD_READING_FRESH_MS + 1))).toBe(false);
  });
});
