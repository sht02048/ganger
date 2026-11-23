import type { CpuLoad, GpuLoad, MemoryLoad, RunnerLoadReading } from "@ganger/core";
import { z } from "zod";

export const LOAD_SECTION_MARK = "@@ganger-load:";
export const USAGE_SECTION_MARK = "@@ganger-usage";

export const READ_USAGE_AND_LOAD_SCRIPT = [
  `section() { printf '\\n${LOAD_SECTION_MARK}%s\\n' "$1"; }`,
  "section os; uname -s 2>/dev/null",
  'if [ "$(uname -s 2>/dev/null)" = Darwin ]; then',
  "section loadavg; sysctl -n vm.loadavg 2>/dev/null",
  "section cores; sysctl -n hw.ncpu 2>/dev/null",
  "section memsize; sysctl -n hw.memsize 2>/dev/null",
  "section pressure; sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null",
  "section vmstat; vm_stat 2>/dev/null",
  `section ioreg; ioreg -r -d 1 -w 0 -c IOAccelerator 2>/dev/null | grep -E 'PerformanceStatistics|"model"'`,
  "else",
  "section loadavg; cat /proc/loadavg 2>/dev/null",
  "section cores; nproc 2>/dev/null",
  "section meminfo; cat /proc/meminfo 2>/dev/null",
  "fi",
  "section nvidia; nvidia-smi --query-gpu=utilization.gpu,name --format=csv,noheader,nounits 2>/dev/null",
  `printf '\\n${USAGE_SECTION_MARK}\\n'`,
  '"$1" account list --json',
].join("\n");

const count = z.coerce.number().int().positive();
const percent = z.coerce.number().finite().min(0).max(100);
const loadAverage = z.coerce.number().finite().min(0);
const gpuName = z.string().trim().min(1).max(80);

export function splitUsageAndLoad(stdout: string): { load: string; usage: string } {
  const at = stdout.indexOf(`\n${USAGE_SECTION_MARK}\n`);
  if (at === -1) return { load: stdout, usage: "" };
  return { load: stdout.slice(0, at), usage: stdout.slice(at + USAGE_SECTION_MARK.length + 2) };
}

export function parseRunnerLoad(output: string): RunnerLoadReading {
  const sections = readSections(output);
  const cpu = parseCpu(sections.get("loadavg"), sections.get("cores"));
  const memory =
    sections.get("os")?.trim() === "Darwin"
      ? parseDarwinMemory(sections.get("memsize"), sections.get("vmstat"), sections.get("pressure"))
      : parseLinuxMemory(sections.get("meminfo"));
  const gpu = parseNvidia(sections.get("nvidia")) ?? parseAppleGpu(sections.get("ioreg"));
  if (cpu === null && memory === null && gpu === null) return { kind: "unreadable" };
  return { kind: "read", cpu, memory, gpu };
}

function readSections(output: string): Map<string, string> {
  const sections = new Map<string, string>();
  let name: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (name !== null) sections.set(name, lines.join("\n"));
  };
  for (const line of output.split("\n")) {
    if (line.startsWith(LOAD_SECTION_MARK)) {
      flush();
      name = line.slice(LOAD_SECTION_MARK.length).trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function parseCpu(loadText: string | undefined, coresText: string | undefined): CpuLoad | null {
  const first = /\d+(?:\.\d+)?/.exec(loadText ?? "")?.[0];
  const average = loadAverage.safeParse(first);
  const cores = count.safeParse(coresText?.trim());
  if (first === undefined || !average.success || !cores.success) return null;
  return {
    percent: roundPercent((average.data / cores.data) * 100),
    loadAverage: average.data,
    cores: cores.data,
  };
}

function parseDarwinMemory(
  memsize: string | undefined,
  vmstat: string | undefined,
  pressure: string | undefined,
): MemoryLoad | null {
  const total = count.safeParse(memsize?.trim());
  const pageSize = count.safeParse(/page size of (\d+) bytes/.exec(vmstat ?? "")?.[1]);
  if (!total.success || !pageSize.success || vmstat === undefined) return null;
  const pages = ["Pages active", "Pages wired down", "Pages occupied by compressor"].map((label) =>
    count.safeParse(new RegExp(`^${label}:\\s+(\\d+)\\.`, "m").exec(vmstat)?.[1]),
  );
  let usedPages = 0;
  for (const page of pages) {
    if (!page.success) return null;
    usedPages += page.data;
  }
  return memoryLoad(usedPages * pageSize.data, total.data, darwinPressure(pressure));
}

function darwinPressure(text: string | undefined): MemoryLoad["pressure"] {
  const level = text?.trim();
  if (level === "1") return "normal";
  if (level === "2" || level === "4") return "high";
  return null;
}

function parseLinuxMemory(meminfo: string | undefined): MemoryLoad | null {
  if (meminfo === undefined) return null;
  const kib = (label: string) =>
    count.safeParse(new RegExp(`^${label}:\\s+(\\d+) kB`, "m").exec(meminfo)?.[1]);
  const total = kib("MemTotal");
  const available = kib("MemAvailable");
  if (!total.success || !available.success || available.data > total.data) return null;
  return memoryLoad((total.data - available.data) * 1024, total.data * 1024, null);
}

function memoryLoad(
  usedBytes: number,
  totalBytes: number,
  pressure: MemoryLoad["pressure"],
): MemoryLoad {
  const used = Math.min(usedBytes, totalBytes);
  return {
    percent: roundPercent((used / totalBytes) * 100),
    usedBytes: used,
    totalBytes,
    pressure,
  };
}

function parseNvidia(text: string | undefined): GpuLoad | null {
  let busiest: GpuLoad | null = null;
  for (const line of (text ?? "").split("\n")) {
    const comma = line.indexOf(",");
    if (comma === -1) continue;
    const used = percent.safeParse(line.slice(0, comma).trim());
    const name = gpuName.safeParse(line.slice(comma + 1));
    if (!used.success) continue;
    if (busiest === null || used.data > busiest.percent) {
      busiest = { percent: used.data, name: name.success ? name.data : null };
    }
  }
  return busiest;
}

function parseAppleGpu(text: string | undefined): GpuLoad | null {
  if (text === undefined) return null;
  const used = percent.safeParse(/"Device Utilization %"\s*=\s*(\d+)/.exec(text)?.[1]);
  if (!used.success) return null;
  const name = gpuName.safeParse(/"model"\s*=\s*"([^"]*)"/.exec(text)?.[1]);
  return { percent: used.data, name: name.success ? name.data : null };
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}
