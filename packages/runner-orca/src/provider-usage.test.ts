import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { DEFAULT_ORCA_PATH } from "./config.js";
import { parseProviderUsage } from "./provider-usage.js";
import {
  LOAD_SECTION_MARK,
  parseRunnerLoad,
  READ_USAGE_AND_LOAD_SCRIPT,
  splitUsageAndLoad,
  USAGE_SECTION_MARK,
} from "./runner-load.js";
import { toRemoteCommand } from "./shell.js";
import { ScriptedExec, own, runnerWith, stdout } from "./test-support.js";

function accountList(rateLimits: unknown): string {
  return JSON.stringify({ ok: true, result: { rateLimits } });
}

describe("parseProviderUsage", () => {
  test("reads each known provider's status and windows from rateLimits", () => {
    expect(parseProviderUsage(own("account-list.json"))).toEqual({
      kind: "read",
      providers: [
        {
          provider: "claude",
          status: "ok",
          windows: [
            { kind: "session", usedPercent: 100, resetsAt: new Date(1795051437328) },
            { kind: "weekly", usedPercent: 72, resetsAt: new Date(1795291200240) },
            { kind: "fableWeekly", usedPercent: 9, resetsAt: new Date(1795291200241) },
          ],
        },
        { provider: "codex", status: "signed-out", windows: [] },
        { provider: "gemini", status: "unavailable", windows: [] },
        { provider: "cursor", status: "signed-out", windows: [] },
      ],
    });
  });

  test("keeps no account details: emails, organization names, paths or other accounts", () => {
    const stored = JSON.stringify(parseProviderUsage(own("account-list.json")));
    expect(stored).not.toMatch(/example\.com|Acme|Other Org|<path>|homePath|email/);
    expect(stored).not.toMatch(/inactive|organization/i);
  });

  test("ignores unknown providers and unknown fields", () => {
    const reading = parseProviderUsage(
      accountList({
        newProvider: { status: "ok", weekly: { usedPercent: 50 } },
        claude: {
          status: "ok",
          brandNewField: { nested: true },
          session: { usedPercent: 40, windowMinutes: 300, somethingElse: "x" },
          weekly: null,
        },
      }),
    );
    expect(reading).toEqual({
      kind: "read",
      providers: [
        {
          provider: "claude",
          status: "ok",
          windows: [{ kind: "session", usedPercent: 40, resetsAt: null }],
        },
      ],
    });
  });

  test("drops a malformed window or provider without failing the rest", () => {
    const reading = parseProviderUsage(
      accountList({
        claude: { status: "ok", session: { usedPercent: "a lot" }, weekly: { usedPercent: 91 } },
        codex: { notStatus: true },
        gemini: { status: "rate-limited" },
      }),
    );
    expect(reading).toEqual({
      kind: "read",
      providers: [
        {
          provider: "claude",
          status: "ok",
          windows: [{ kind: "weekly", usedPercent: 91, resetsAt: null }],
        },
        { provider: "gemini", status: "error", windows: [] },
      ],
    });
  });

  test("broken JSON or an error envelope is unreadable", () => {
    expect(parseProviderUsage("not json {")).toEqual({ kind: "unreadable" });
    expect(parseProviderUsage("")).toEqual({ kind: "unreadable" });
    expect(
      parseProviderUsage(JSON.stringify({ ok: false, error: { code: "runtime_unavailable" } })),
    ).toEqual({ kind: "unreadable" });
    expect(parseProviderUsage(JSON.stringify({ ok: true, result: {} }))).toEqual({
      kind: "unreadable",
    });
  });
});

describe("OrcaRunner.readProviderUsage", () => {
  test("runs orca account list over ssh and parses rateLimits", async () => {
    const exec = new ScriptedExec().orca("account list", stdout(own("account-list.json")));
    const reading = await runnerWith(exec).readProviderUsage();
    expect(exec.commands()).toEqual([`${DEFAULT_ORCA_PATH} account list --json`]);
    expect(reading.kind).toBe("read");
  });

  test("an unreachable runner or a timeout is unreadable, not an error", async () => {
    const unreachable = new ScriptedExec();
    expect(await runnerWith(unreachable).readProviderUsage()).toEqual({ kind: "unreadable" });

    const timedOut = new ScriptedExec().orca("account list", {
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    });
    expect(await runnerWith(timedOut).readProviderUsage()).toEqual({ kind: "unreadable" });
  });
});

describe("OrcaRunner.readUsageAndLoad", () => {
  const loadOutput = `\n${LOAD_SECTION_MARK}os\nLinux\n${LOAD_SECTION_MARK}loadavg\n4.00 1 1 1/1 1\n${LOAD_SECTION_MARK}cores\n8\n`;

  test("reads usage and load over one ssh command", async () => {
    const exec = new ScriptedExec().on(
      "sh -c",
      stdout(`${loadOutput}\n${USAGE_SECTION_MARK}\n${own("account-list.json")}`),
    );
    const { usage, load } = await runnerWith(exec).readUsageAndLoad();
    expect(exec.commands()).toHaveLength(1);
    expect(exec.commands()[0]?.endsWith(` sh ${DEFAULT_ORCA_PATH}`)).toBe(true);
    expect(usage.kind).toBe("read");
    expect(load).toMatchObject({ kind: "read", cpu: { percent: 50, cores: 8 } });
  });

  test("keeps the load when the usage command times out", async () => {
    const exec = new ScriptedExec().on("sh -c", {
      exitCode: null,
      stdout: `${loadOutput}\n${USAGE_SECTION_MARK}\n{"ok":`,
      stderr: "",
      timedOut: true,
    });
    const { usage, load } = await runnerWith(exec).readUsageAndLoad();
    expect(usage).toEqual({ kind: "unreadable" });
    expect(load.kind).toBe("read");
  });

  test("an unreachable runner reads as unreadable for both", async () => {
    expect(await runnerWith(new ScriptedExec()).readUsageAndLoad()).toEqual({
      usage: { kind: "unreadable" },
      load: { kind: "unreadable" },
    });
  });

  test("the quoted script runs in a real shell and reaches the orca command", () => {
    const command = toRemoteCommand(["sh", "-c", READ_USAGE_AND_LOAD_SCRIPT, "sh", "/bin/echo"]);
    const output = execFileSync("sh", ["-c", command], { encoding: "utf8" });
    expect(splitUsageAndLoad(output).usage.trim()).toBe("account list --json");
    expect(parseRunnerLoad(splitUsageAndLoad(output).load).kind).toBe("read");
  });
});
