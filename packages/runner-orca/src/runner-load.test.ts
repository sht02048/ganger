import { describe, expect, it } from "vitest";
import {
  LOAD_SECTION_MARK,
  parseRunnerLoad,
  READ_USAGE_AND_LOAD_SCRIPT,
  splitUsageAndLoad,
  USAGE_SECTION_MARK,
} from "./runner-load.js";

const section = (name: string, body: string) => `\n${LOAD_SECTION_MARK}${name}\n${body}`;

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    1000.
Pages active:                                100000.
Pages inactive:                               90000.
Pages wired down:                             50000.
Pages stored in compressor:                   80000.
Pages occupied by compressor:                 50000.`;

const IOREG = `    "PerformanceStatistics" = {"Device Utilization %"=12,"Renderer Utilization %"=9}
    "model" = "Apple M2"`;

const darwin = (pressure: string) =>
  [
    section("os", "Darwin"),
    section("loadavg", "{ 9.20 5.70 5.55 }"),
    section("cores", "10"),
    section("memsize", String(32 * 1024 ** 3)),
    section("pressure", pressure),
    section("vmstat", VM_STAT),
    section("ioreg", IOREG),
    section("nvidia", ""),
  ].join("");

const linux = (nvidia: string) =>
  [
    section("os", "Linux"),
    section("loadavg", "3.00 2.00 1.00 1/200 4242"),
    section("cores", "8"),
    section(
      "meminfo",
      "MemTotal:       16000000 kB\nMemFree: 1000 kB\nMemAvailable:    4000000 kB",
    ),
    section("nvidia", nvidia),
  ].join("");

describe("parseRunnerLoad", () => {
  it("reads CPU, memory and the Apple GPU on macOS", () => {
    expect(parseRunnerLoad(darwin("1"))).toEqual({
      kind: "read",
      cpu: { percent: 92, loadAverage: 9.2, cores: 10 },
      memory: {
        percent: 9.5,
        usedBytes: 200000 * 16384,
        totalBytes: 32 * 1024 ** 3,
        pressure: "normal",
      },
      gpu: { percent: 12, name: "Apple M2" },
    });
  });

  it.each([
    ["2", "high"],
    ["4", "high"],
    ["1", "normal"],
    ["", null],
  ])("maps macOS pressure level %j to %j", (level, pressure) => {
    const reading = parseRunnerLoad(darwin(level));
    expect(reading.kind === "read" ? reading.memory?.pressure : undefined).toBe(pressure);
  });

  it("reads Linux load and memory without pressure, and no GPU without nvidia-smi", () => {
    expect(parseRunnerLoad(linux(""))).toEqual({
      kind: "read",
      cpu: { percent: 37.5, loadAverage: 3, cores: 8 },
      memory: {
        percent: 75,
        usedBytes: 12000000 * 1024,
        totalBytes: 16000000 * 1024,
        pressure: null,
      },
      gpu: null,
    });
  });

  it("reports the busiest NVIDIA GPU", () => {
    const reading = parseRunnerLoad(linux("20, NVIDIA RTX A\n64, NVIDIA RTX B"));
    expect(reading.kind === "read" ? reading.gpu : undefined).toEqual({
      percent: 64,
      name: "NVIDIA RTX B",
    });
  });

  it("skips an NVIDIA line whose utilization is not a number", () => {
    const reading = parseRunnerLoad(linux("[N/A], NVIDIA RTX A"));
    expect(reading.kind === "read" ? reading.gpu : undefined).toBeNull();
  });

  it("keeps what it could read when one part is broken", () => {
    const reading = parseRunnerLoad(
      [
        section("os", "Linux"),
        section("loadavg", "nope"),
        section("cores", "8"),
        section("meminfo", "MemTotal: 1000 kB\nMemAvailable: 500 kB"),
      ].join(""),
    );
    expect(reading).toMatchObject({ kind: "read", cpu: null, gpu: null });
    expect(reading.kind === "read" ? reading.memory?.percent : undefined).toBe(50);
  });

  it("reads a Mac with nothing in the compressor", () => {
    const output = darwin("1").replace(
      "Pages occupied by compressor:                 50000.",
      "Pages occupied by compressor:                 0.",
    );
    const reading = parseRunnerLoad(output);
    expect(reading.kind === "read" ? reading.memory?.usedBytes : undefined).toBe(150000 * 16384);
  });

  it("reads Linux memory with nothing available as full", () => {
    const reading = parseRunnerLoad(
      [section("os", "Linux"), section("meminfo", "MemTotal: 1000 kB\nMemAvailable: 0 kB")].join(
        "",
      ),
    );
    expect(reading.kind === "read" ? reading.memory?.percent : undefined).toBe(100);
  });

  it("treats an empty NVIDIA utilization as no reading, not 0%", () => {
    const reading = parseRunnerLoad(linux(" , NVIDIA RTX A"));
    expect(reading.kind === "read" ? reading.gpu : undefined).toBeNull();
  });

  it("is unreadable when nothing could be read", () => {
    expect(parseRunnerLoad("")).toEqual({ kind: "unreadable" });
    expect(parseRunnerLoad(section("os", "Plan9"))).toEqual({ kind: "unreadable" });
  });
});

describe("splitUsageAndLoad", () => {
  it("separates the usage JSON from the load sections", () => {
    const stdout = `{"ok":true}\n${USAGE_SECTION_MARK}\n${section("cores", "8")}`;
    expect(splitUsageAndLoad(stdout)).toEqual({
      usage: '{"ok":true}',
      load: section("cores", "8"),
    });
  });

  it("has neither when the usage command never finished", () => {
    expect(splitUsageAndLoad('{"ok":')).toEqual({ usage: "", load: "" });
  });
});

describe("READ_USAGE_AND_LOAD_SCRIPT", () => {
  it("takes the orca path only as a positional argument", () => {
    expect(READ_USAGE_AND_LOAD_SCRIPT).toContain('"$1" account list --json');
  });

  it("fixes the locale for load commands only, so decimals keep a dot", () => {
    const locale = READ_USAGE_AND_LOAD_SCRIPT.indexOf("export LC_ALL=C");
    expect(locale).toBeGreaterThan(READ_USAGE_AND_LOAD_SCRIPT.indexOf("account list"));
    expect(locale).toBeLessThan(READ_USAGE_AND_LOAD_SCRIPT.indexOf("vm.loadavg"));
  });

  it("reads usage before any load command can hang", () => {
    expect(READ_USAGE_AND_LOAD_SCRIPT.indexOf("account list")).toBeLessThan(
      READ_USAGE_AND_LOAD_SCRIPT.indexOf("uname"),
    );
  });

  it("uses no command that needs administrator rights", () => {
    expect(READ_USAGE_AND_LOAD_SCRIPT).not.toMatch(/sudo|powermetrics/);
  });
});
