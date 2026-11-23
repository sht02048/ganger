export const CPU_HIGH_PERCENT = 90;
export const MEMORY_HIGH_PERCENT = 90;
export const CPU_HIGH_AFTER_MS = 5 * 60_000;
export const LOAD_READING_FRESH_MS = 10 * 60_000;

export type MemoryPressure = "normal" | "high";

export interface CpuLoad {
  percent: number;
  loadAverage: number;
  cores: number;
}

export interface MemoryLoad {
  percent: number;
  usedBytes: number;
  totalBytes: number;
  pressure: MemoryPressure | null;
}

export interface GpuLoad {
  percent: number;
  name: string | null;
}

export interface RunnerLoad {
  cpu: CpuLoad | null;
  memory: MemoryLoad | null;
  gpu: GpuLoad | null;
}

export type RunnerLoadReading = ({ kind: "read" } & RunnerLoad) | { kind: "unreadable" };

export interface PreviousLoadStreak {
  readAt: Date;
  cpuHighSince: Date | null;
}

export function nextCpuHighSince(
  previous: PreviousLoadStreak | null,
  reading: RunnerLoadReading,
  now: Date,
): Date | null {
  if (reading.kind !== "read" || reading.cpu === null) return null;
  if (reading.cpu.percent < CPU_HIGH_PERCENT) return null;
  if (previous?.cpuHighSince === null || previous === null) return now;
  const continuous = now.getTime() - previous.readAt.getTime() <= LOAD_READING_FRESH_MS;
  return continuous ? previous.cpuHighSince : now;
}

export function isCpuLoadHigh(cpuHighSince: Date | null, readAt: Date): boolean {
  return cpuHighSince !== null && readAt.getTime() - cpuHighSince.getTime() > CPU_HIGH_AFTER_MS;
}

export function isMemoryLoadHigh(memory: MemoryLoad | null): boolean {
  if (memory === null) return false;
  if (memory.pressure !== null) return memory.pressure === "high";
  return memory.percent >= MEMORY_HIGH_PERCENT;
}

export function isLoadReadingFresh(readAt: Date, now: Date): boolean {
  return now.getTime() - readAt.getTime() <= LOAD_READING_FRESH_MS;
}
