import {
  AdapterError,
  toFollowUpRef,
  blockedProjectsOf,
  isAssignmentBlocked,
  toAgentId,
  toMailboxRef,
  toPermissionRequestId,
  toQuestionId,
  toRunnerProjectId,
  toTicketKey,
  toWorktreeRef,
} from "@ganger/core";
import type { RunOnRunner } from "@ganger/core";
import { describe, expect, test } from "vitest";
import { OrcaRunnerConfigError } from "./config.js";
import {
  LOG_CUT_MARKER,
  LOG_MAX_PAGES,
  MAILBOX_TITLE,
  ORCA_RUNNER_KIND,
  orcaRunnerFactory,
} from "./orca-runner.js";
import { escalationQuestionId } from "./progress.js";
import { decodeAgent, decodeMailbox, encodeAgent, encodeMailbox } from "./refs.js";
import {
  ScriptedExec,
  own,
  peekOf,
  processResult,
  research,
  runnerWith,
  stdout,
} from "./test-support.js";
import type { RemoteResult } from "./ssh.js";

const MAILBOX = encodeMailbox({
  terminal: "term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7",
  runId: "run_493ebb2f403d",
});
const WORKTREE = toWorktreeRef(
  "527aed9b-0eef-4404-9d8d-9a89d7fb1dc9::<path>/workspaces/sandbox/fo-t0013-probe1",
);
const RUN: RunOnRunner = {
  mailbox: MAILBOX,
  worktree: WORKTREE,
  agentRef: encodeAgent({
    dispatchId: "ctx_a6e6a23a7132",
    taskId: "task_43a3a070dc4c",
    runId: "run_493ebb2f403d",
  }),
};

const BROKEN = stdout("Error: something went wrong before JSON\n", 1);

async function adapterError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdapterError) {
      const detail: unknown = error.detail;
      return detail;
    }
    throw error;
  }
  throw new Error("expected an AdapterError");
}

function withProjects(exec: ScriptedExec): ScriptedExec {
  return exec
    .orca("project list", stdout(own("project-list.json")))
    .orca("project setups", stdout(own("project-setups.json")));
}

function expectNoConsumingCheck(exec: ScriptedExec): void {
  const consuming = exec
    .commands()
    .filter((command) => command.includes(" orchestration check ") && !command.includes(" --peek"));
  expect(consuming).toEqual([]);
}

describe("orcaRunnerFactory", () => {
  test("creates an orca runner from stored settings", () => {
    const runner = orcaRunnerFactory.create({ sshTarget: "runner.example.com" });
    expect(runner.kind).toBe(ORCA_RUNNER_KIND);
  });

  test("rejects settings without an ssh target or with an ssh option as target", () => {
    expect(() => orcaRunnerFactory.create({})).toThrow(OrcaRunnerConfigError);
    expect(() => orcaRunnerFactory.create({ sshTarget: "-oProxyCommand=x" })).toThrow(
      OrcaRunnerConfigError,
    );
  });
});

describe("checkHealth", () => {
  const ORIGIN_ONLY = stdout("remote.origin.url https://github.com/acme/sandbox.git\n");
  const FORK = stdout(
    [
      "remote.origin.url https://github.com/someone/sandbox.git",
      "remote.origin.fetch +refs/heads/*:refs/remotes/origin/*",
      "remote.upstream.url https://github.com/acme/sandbox.git",
      "",
    ].join("\n"),
  );

  function onlineWith(...push: Parameters<ScriptedExec["on"]>[1][]): ScriptedExec {
    return withProjects(
      new ScriptedExec()
        .orca("status", stdout(own("status-ready.json")))
        .orca("serve service status", stdout(own("serve-service-status-live.json")))
        .on("git -C ", ORIGIN_ONLY)
        .on("env ", ...push),
    );
  }

  test("is online with the service and GitHub push access on every project", async () => {
    const exec = onlineWith(processResult(own("push-dry-run-ok.json")));
    const health = await runnerWith(exec).checkHealth();
    expect(health).toMatchObject({ online: true, version: "1.4.258", error: null });
    expect(health.prerequisites).toEqual([
      expect.objectContaining({ id: "orca-service", satisfied: true, blocksAssignment: false }),
      expect.objectContaining({
        id: "github-push:github:acme/sandbox",
        satisfied: true,
        blocksAssignment: false,
        project: "github:acme/sandbox",
      }),
    ]);
    expect(health.prerequisites[1]).not.toHaveProperty("failure");
    expect(isAssignmentBlocked(health)).toBe(false);
    expect(exec.commands().filter((c) => c.startsWith("git ") || c.startsWith("env "))).toEqual([
      "git -C '<path>/sandbox' config --get-regexp '^remote\\.'",
      "env 'GIT_TERMINAL_PROMPT=0' 'GIT_SSH_COMMAND=ssh -o BatchMode=yes' git -C '<path>/sandbox' push --dry-run --porcelain --no-verify origin HEAD:refs/heads/ganger/push-check",
    ]);
  });

  test("a failed push blocks only its project, with the reason and an auth kind", async () => {
    const failed = processResult(own("push-dry-run-no-credentials.json"));
    const sleeps: number[] = [];
    const exec = onlineWith(failed, failed);
    const health = await runnerWith(exec, {}, sleeps).checkHealth();
    expect(health.online).toBe(true);
    expect(health.error).toBeNull();
    expect(health.prerequisites[1]).toMatchObject({
      satisfied: false,
      blocksAssignment: false,
      project: "github:acme/sandbox",
      failure: {
        kind: "auth",
        reason:
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      },
    });
    expect(isAssignmentBlocked(health)).toBe(false);
    expect(blockedProjectsOf(health.prerequisites)).toEqual(["github:acme/sandbox"]);
    expect(sleeps).toEqual([1000]);
    expect(exec.commands().filter((c) => c.startsWith("env "))).toHaveLength(2);
  });

  test("a push that fails once and passes on the retry is satisfied", async () => {
    const exec = onlineWith(
      processResult(own("push-dry-run-no-credentials.json")),
      processResult(own("push-dry-run-ok.json")),
    );
    const health = await runnerWith(exec).checkHealth();
    expect(health.prerequisites[1]).toMatchObject({ satisfied: true });
    expect(health.prerequisites[1]).not.toHaveProperty("failure");
  });

  test("a fork checks the push remote git would use, not the project's upstream remote", async () => {
    const upstream = own("project-list.json").replace(
      '"remoteName": "origin"',
      '"remoteName": "upstream"',
    );
    expect(upstream).toContain('"remoteName": "upstream"');
    const exec = new ScriptedExec()
      .orca("status", stdout(own("status-ready.json")))
      .orca("serve service status", stdout(own("serve-service-status-live.json")))
      .orca("project list", stdout(upstream))
      .orca("project setups", stdout(own("project-setups.json")))
      .on("git -C ", FORK)
      .on("env ", processResult(own("push-dry-run-ok.json")));
    await runnerWith(exec).checkHealth();
    const push = exec.commands().find((c) => c.startsWith("env "));
    expect(push).toContain(" origin HEAD:refs/heads/ganger/push-check");
  });

  test("an ssh failure during the push check is unknown, not broken", async () => {
    const unreachable = processResult(own("ssh-unreachable.json"));
    const exec = onlineWith(unreachable, unreachable);
    const health = await runnerWith(exec).checkHealth();
    expect(health.prerequisites[1]).toMatchObject({
      satisfied: null,
      failure: { kind: "network" },
    });
    expect(blockedProjectsOf(health.prerequisites)).toEqual([]);
  });

  test("a push that times out twice is unknown with a timeout kind", async () => {
    const timedOut = { exitCode: null, stdout: "", stderr: "", timedOut: true };
    const exec = onlineWith(timedOut, timedOut);
    const health = await runnerWith(exec).checkHealth();
    expect(health.prerequisites[1]).toMatchObject({
      satisfied: null,
      failure: { kind: "timeout", reason: null },
    });
  });

  test("is offline when the runtime is off and reports a missing service", async () => {
    const exec = new ScriptedExec()
      .orca("status", stdout(research("0003/status-runtime-off.json")))
      .orca("serve service status", stdout(research("0003/serve-service-status-uninstalled.json")));
    const health = await runnerWith(exec).checkHealth();
    expect(health.online).toBe(false);
    expect(health.error).toMatchObject({ kind: "not-ready" });
    expect(health.prerequisites).toEqual([
      expect.objectContaining({ id: "orca-service", satisfied: false }),
    ]);
  });

  test("ok: false from status is reported as the runner error", async () => {
    const exec = new ScriptedExec().orca(
      "status",
      stdout(research("0003/worktree-ps-runtime-off.json"), 1),
    );
    const health = await runnerWith(exec).checkHealth();
    expect(health.online).toBe(false);
    expect(health.error).toMatchObject({ kind: "not-ready" });
  });

  test("tells an unreachable runner, a missing orca and broken output apart", async () => {
    const unreachable = new ScriptedExec().orca(
      "status",
      processResult(own("ssh-unreachable.json")),
    );
    expect((await runnerWith(unreachable).checkHealth()).error).toMatchObject({
      kind: "unreachable",
    });
    const notInstalled = new ScriptedExec().orca(
      "status",
      processResult(own("orca-not-found.json")),
    );
    expect((await runnerWith(notInstalled).checkHealth()).error).toMatchObject({
      kind: "not-installed",
    });
    const broken = new ScriptedExec().orca("status", BROKEN);
    const health = await runnerWith(broken).checkHealth();
    expect(health.online).toBe(false);
    expect(health.error).toMatchObject({ kind: "malformed-output" });
  });
});

describe("listProjects", () => {
  test("lists runner-side projects with their setup state", async () => {
    const projects = await runnerWith(withProjects(new ScriptedExec())).listProjects();
    expect(projects).toEqual([
      { id: toRunnerProjectId("github:acme/sandbox"), displayName: "sandbox", setupState: "ready" },
    ]);
  });

  test("reads the research 0004 project list", async () => {
    const exec = new ScriptedExec()
      .orca("project list", stdout(research("0004/project-list.json")))
      .orca("project setups", stdout(research("0004/project-setups.json")));
    expect(await runnerWith(exec).listProjects()).toEqual([
      { id: "github:acme/sandbox", displayName: "sandbox", setupState: "ready" },
    ]);
  });

  test("ok: false and broken output become error kinds", async () => {
    const off = new ScriptedExec().orca(
      "project list",
      stdout(research("0003/worktree-ps-runtime-off.json"), 1),
    );
    expect(await adapterError(runnerWith(off).listProjects())).toMatchObject({
      kind: "not-ready",
    });
    const broken = new ScriptedExec().orca("project list", BROKEN);
    expect(await adapterError(runnerWith(broken).listProjects())).toMatchObject({
      kind: "malformed-output",
    });
  });
});

describe("ensureMailbox", () => {
  test("creates a mailbox terminal and a Run when there is none", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal create", stdout(own("terminal-create-mailbox.json")))
        .orca("orchestration run-create", stdout(own("run-create.json"))),
    );
    const mailbox = await runnerWith(exec).ensureMailbox(null);
    expect(decodeMailbox(mailbox)).toEqual({
      terminal: "term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7",
      runId: "run_493ebb2f403d",
    });
    expect(exec.commands()).toContain(
      `/Applications/Orca.app/Contents/Resources/bin/orca terminal create --worktree 'path:<path>/sandbox' --title ${MAILBOX_TITLE} --command 'cat > /dev/null' --json`,
    );
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration run-create --objective ganger --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --json",
    );
  });

  test("keeps a live mailbox as it is", async () => {
    const exec = new ScriptedExec()
      .orca("terminal show", stdout(own("terminal-show-live.json")))
      .orca("orchestration run-current", stdout(own("run-current-bound.json")));
    expect(await runnerWith(exec).ensureMailbox(MAILBOX)).toBe(MAILBOX);
    expect(exec.commands()).toHaveLength(2);
  });

  test("binds a live mailbox terminal that lost its Run again instead of making a new one", async () => {
    const exec = new ScriptedExec()
      .orca("terminal show", stdout(own("terminal-show-live.json")))
      .orca("orchestration run-current", stdout(own("run-current-unbound.json")))
      .orca("orchestration run-use", stdout(own("run-use.json")));
    expect(await runnerWith(exec).ensureMailbox(MAILBOX)).toBe(MAILBOX);
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration run-use --id run_493ebb2f403d --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --json",
    );
    expect(exec.commands().some((c) => c.includes("terminal create"))).toBe(false);
  });

  test("recreates a closed mailbox terminal and keeps using the same Run", async () => {
    const newHandle = "term_a0b2cd2f-0a8c-4e46-9e43-f66cc1145de8";
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal show", stdout(own("terminal-show-closed.json")))
        .orca(
          "terminal create",
          stdout(JSON.stringify({ ok: true, result: { terminal: { handle: newHandle } } })),
        )
        .orca("orchestration run-use", stdout(own("run-use.json"))),
    );
    const mailbox = await runnerWith(exec).ensureMailbox(MAILBOX);
    expect(mailbox).not.toBe(MAILBOX);
    expect(decodeMailbox(mailbox)).toEqual({ terminal: newHandle, runId: "run_493ebb2f403d" });
    expect(exec.commands()).toContain(
      `/Applications/Orca.app/Contents/Resources/bin/orca orchestration run-use --id run_493ebb2f403d --from ${newHandle} --json`,
    );
  });

  test("recreates a mailbox whose handle is stale and makes a new Run when the old one is gone", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal show", stdout(own("terminal-show-stale.json"), 1))
        .orca("terminal create", stdout(own("terminal-create-mailbox.json")))
        .orca(
          "orchestration run-use",
          stdout(JSON.stringify({ ok: false, error: { code: "not_found", message: "no run" } }), 1),
        )
        .orca("orchestration run-create", stdout(own("run-create.json"))),
    );
    const mailbox = await runnerWith(exec).ensureMailbox(
      encodeMailbox({ terminal: "term_gone", runId: "run_gone" }),
    );
    expect(decodeMailbox(mailbox)).toEqual({
      terminal: "term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7",
      runId: "run_493ebb2f403d",
    });
  });

  test("treats a value it did not make as no mailbox", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal create", stdout(own("terminal-create-mailbox.json")))
        .orca("orchestration run-create", stdout(own("run-create.json"))),
    );
    const mailbox = await runnerWith(exec).ensureMailbox(toMailboxRef("fake-mailbox-1"));
    expect(decodeMailbox(mailbox)?.runId).toBe("run_493ebb2f403d");
  });

  test("closes the new terminal when no Run can be bound, and reports broken output", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal create", stdout(own("terminal-create-mailbox.json")))
        .orca("orchestration run-create", BROKEN)
        .orca("terminal close", stdout(own("terminal-close.json"))),
    );
    expect(await adapterError(runnerWith(exec).ensureMailbox(null))).toMatchObject({
      kind: "malformed-output",
    });
    expect(exec.commands().some((c) => c.includes(" terminal close --terminal "))).toBe(true);
  });
});

describe("startRun", () => {
  const input = {
    mailbox: MAILBOX,
    project: toRunnerProjectId("github:acme/sandbox"),
    worktreeName: "fo-t0013-probe1",
    agent: toAgentId("claude"),
    brief: `Fix "the bug"\nin it's $HOME \`code\``,
    ticket: { key: toTicketKey("ENG-1"), url: "https://linear.app/acme/issue/ENG-1" },
  };

  test("starts a worker with the whole agent brief on stdin and returns the runner's branch", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("orchestration worker-start", stdout(own("worker-start-spec-stdin.json")))
        .orca("worktree show", stdout(own("worktree-show.json"))),
    );
    const started = await runnerWith(exec).startRun(input);
    expect(started.worktree).toBe(WORKTREE);
    expect(started.branch).toBe("acme/fo-t0013-probe1");
    expect(decodeAgent(started.agentRef)).toEqual({
      dispatchId: "ctx_a6e6a23a7132",
      taskId: "task_43a3a070dc4c",
      runId: "run_493ebb2f403d",
    });
    const start = exec.calls.find((c) => c.command.includes("worker-start"));
    expect(start?.stdin).toBe(input.brief);
    expect(start?.command).toBe(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-start --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --run run_493ebb2f403d --spec-file - --task-title fo-t0013-probe1 --worktree new-top-level --repo id:527aed9b-0eef-4404-9d8d-9a89d7fb1dc9 --name fo-t0013-probe1 --agent claude --comment 'ENG-1 https://linear.app/acme/issue/ENG-1' --json",
    );
    expect(exec.commands()).toContain(
      `/Applications/Orca.app/Contents/Resources/bin/orca worktree show --worktree 'id:${WORKTREE}' --json`,
    );
  });

  describe("--model (0043)", () => {
    async function startCommand(
      runInput: typeof input & { model?: string },
      config: { model?: string } = {},
    ): Promise<string | undefined> {
      const exec = withProjects(
        new ScriptedExec()
          .orca("orchestration worker-start", stdout(own("worker-start-spec-stdin.json")))
          .orca("worktree show", stdout(own("worktree-show.json"))),
      );
      await runnerWith(exec, config).startRun(runInput);
      return exec.calls.find((c) => c.command.includes("worker-start"))?.command;
    }

    test("passes the run's model (the Mapping's) to worker-start", async () => {
      expect(await startCommand({ ...input, model: "sonnet" })).toContain(
        " --agent claude --model sonnet --comment ",
      );
    });

    test("the run's model wins over the runner configuration's model", async () => {
      const command = await startCommand({ ...input, model: "sonnet" }, { model: "opus" });
      expect(command).toContain(" --model sonnet ");
      expect(command).not.toContain("opus");
    });

    test("without the run's model, uses the runner configuration's model", async () => {
      expect(await startCommand(input, { model: "opus" })).toContain(" --model opus ");
    });

    test("without either, does not pass --model so the runner's Orca default applies", async () => {
      expect(await startCommand(input)).not.toContain("--model");
    });
  });

  test("a sender identity error means the mailbox is missing", async () => {
    const exec = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(research("0008/run-create-no-from-error.json"), 1),
      ),
    );
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "mailbox-missing",
    });
  });

  test("other ok: false is a runner error that left no run", async () => {
    const exec = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(research("0008/worker-stop-from-error.json"), 1),
      ),
    );
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "runner-error",
      code: "invalid_argument",
    });
  });

  test("losing the connection after sending the start is an unknown outcome", async () => {
    const exec = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        processResult(own("ssh-unreachable.json")),
      ),
    );
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "start-outcome-unknown",
    });
    const unknown = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(
          JSON.stringify({ ok: true, result: { ...startResult(), state: "outcome_unknown" } }),
          1,
        ),
      ),
    );
    expect(await adapterError(runnerWith(unknown).startRun(input))).toMatchObject({
      kind: "start-outcome-unknown",
    });
  });

  test("an unknown state or broken output after sending is an unknown outcome; failed is not", async () => {
    const odd = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(JSON.stringify({ ok: true, result: { ...startResult(), state: "setting_up" } }), 1),
      ),
    );
    expect(await adapterError(runnerWith(odd).startRun(input))).toMatchObject({
      kind: "start-outcome-unknown",
    });
    const failed = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(JSON.stringify({ ok: true, result: { ...startResult(), state: "failed" } }), 1),
      ),
    );
    expect(await adapterError(runnerWith(failed).startRun(input))).toMatchObject({
      kind: "runner-error",
      code: "worker_start_failed",
    });
  });

  test("an unreachable runner before the start is sent stays unreachable", async () => {
    const exec = new ScriptedExec().orca(
      "project list",
      processResult(own("ssh-unreachable.json")),
    );
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "unreachable",
    });
    expect(exec.commands().some((c) => c.includes("worker-start"))).toBe(false);
  });

  test("broken output after sending the start is an unknown outcome", async () => {
    const exec = withProjects(new ScriptedExec().orca("orchestration worker-start", BROKEN));
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "start-outcome-unknown",
    });
  });

  test("an unknown project is a runner error", async () => {
    const exec = withProjects(new ScriptedExec());
    expect(
      await adapterError(
        runnerWith(exec).startRun({ ...input, project: toRunnerProjectId("github:acme/other") }),
      ),
    ).toMatchObject({ kind: "runner-error", code: "project_not_found" });
  });
});

function startResult(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(own("worker-start-spec-stdin.json"));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  const result: unknown = parsed.result;
  if (typeof result !== "object" || result === null) throw new Error();
  return { ...result };
}

describe("findStartedRun", () => {
  test("finds the run started under the deterministic worktree name", async () => {
    const exec = new ScriptedExec()
      .orca("worktree show", stdout(own("worktree-show.json")))
      .orca("orchestration worker-list", stdout(own("worker-list-run.json")))
      .orca("orchestration worker-show", stdout(own("worker-show-working.json")));
    const found = await runnerWith(exec).findStartedRun({
      mailbox: MAILBOX,
      worktreeName: "fo-t0013-probe1",
    });
    expect(found).toEqual({
      worktree: WORKTREE,
      branch: "acme/fo-t0013-probe1",
      agentRef: RUN.agentRef,
    });
    expect(exec.commands().slice(0, 2)).toEqual([
      "/Applications/Orca.app/Contents/Resources/bin/orca worktree show --worktree name:fo-t0013-probe1 --json",
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-list --run run_493ebb2f403d --limit 100 --json",
    ]);
  });

  test("looks through every Run and page when the mailbox Run does not have it", async () => {
    const empty = stdout(JSON.stringify({ ok: true, result: { workers: [] } }));
    const other = stdout(
      JSON.stringify({
        ok: true,
        result: {
          workers: [{ dispatchId: "ctx_other", taskId: "task_other", workspace: "x::/y" }],
          nextCursor: "p2",
        },
      }),
    );
    const exec = new ScriptedExec()
      .orca("worktree show", stdout(own("worktree-show.json")))
      .orca("orchestration worker-list --run", empty)
      .orca("orchestration worker-list --limit 100 --json", other)
      .orca(
        "orchestration worker-list --limit 100 --cursor p2",
        stdout(own("worker-list-run.json")),
      )
      .orca("orchestration worker-show", stdout(own("worker-show-working.json")));
    const found = await runnerWith(exec).findStartedRun({
      mailbox: MAILBOX,
      worktreeName: "fo-t0013-probe1",
    });
    expect(found?.agentRef).toBe(RUN.agentRef);
  });

  test("a named worktree without an agent is an error, not 'not started'", async () => {
    const exec = new ScriptedExec()
      .orca("worktree show", stdout(own("worktree-show.json")))
      .orca(
        "orchestration worker-list",
        stdout(JSON.stringify({ ok: true, result: { workers: [] } })),
      );
    expect(
      await adapterError(
        runnerWith(exec).findStartedRun({ mailbox: MAILBOX, worktreeName: "fo-t0013-probe1" }),
      ),
    ).toMatchObject({ kind: "runner-error", code: "worktree_without_agent" });
  });

  test("is null when no worktree has that name", async () => {
    const exec = new ScriptedExec().orca(
      "worktree show",
      stdout(own("worktree-show-not-found.json"), 1),
    );
    expect(
      await runnerWith(exec).findStartedRun({ mailbox: MAILBOX, worktreeName: "fo-no-such" }),
    ).toBeNull();
  });

  test("broken output is malformed", async () => {
    const exec = new ScriptedExec().orca("worktree show", BROKEN);
    expect(
      await adapterError(runnerWith(exec).findStartedRun({ mailbox: MAILBOX, worktreeName: "x" })),
    ).toMatchObject({ kind: "malformed-output" });
  });
});

describe("pollRun", () => {
  function polling(worker: string, peek: string): ScriptedExec {
    return new ScriptedExec()
      .orca("orchestration worker-show", stdout(worker))
      .orca("orchestration check", stdout(peek))
      .orca("worktree ps", stdout(own("worktree-ps-agent-wait-working.json")));
  }

  test("with several agents in the worktree, the run's own row is found by its terminal(0120)", async () => {
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-show",
        stdout(research("0120/worker-show-unverifiable-retained.json")),
      )
      .orca("orchestration check", stdout(own("check-peek-empty.json")))
      .orca("worktree ps", stdout(research("0120/worktree-ps-two-agents.json")))
      .orca("terminal show", stdout(research("0120/terminal-show.json")));
    const progress = await runnerWith(exec).pollRun({
      ...RUN,
      worktree: toWorktreeRef(
        "20000000-0000-4000-8000-000000000001::<path>/workspaces/acme/ganger-ACME-7-1",
      ),
    });
    expect(progress).toMatchObject({
      kind: "active",
      activity: { kind: "interrupted", since: new Date(1795084992430) },
    });
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca terminal show --terminal term_30000000-0000-4000-8000-000000000001 --json",
    );
  });

  test("a working agent without mail is active", async () => {
    const exec = polling(own("worker-show-working.json"), own("check-peek-empty.json"));
    expect(await runnerWith(exec).pollRun(RUN)).toEqual({
      kind: "active",
      activity: { kind: "working", since: new Date("2026-11-17T16:08:15.671Z") },
      unreportedStop: null,
      questions: [],
      permissionWaits: [],
    });
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration check --terminal term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --peek --full --json",
    );
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca worktree ps --agent-wait --limit 500 --json",
    );
    expect(exec.commands().some((c) => c.includes("task-list"))).toBe(false);
    expectNoConsumingCheck(exec);
  });

  test("an asked question comes back with its options and time, without consuming mail", async () => {
    const exec = polling(own("worker-show-working.json"), own("check-peek-full-question.json"));
    expect(await runnerWith(exec).pollRun(RUN)).toEqual({
      kind: "active",
      activity: { kind: "working", since: new Date("2026-11-17T16:08:15.671Z") },
      unreportedStop: null,
      questions: [
        {
          id: toQuestionId("msg_49acb8390fb2"),
          body: `Pick one: A or B? (quotes ' " and $HOME stay literal)`,
          options: [],
          askedAt: new Date("2026-11-17T16:07:58Z"),
        },
      ],
      permissionWaits: [],
    });
    expectNoConsumingCheck(exec);
  });

  test("a completion report comes from the Task result", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(own("worker-show-failed-report.json")))
      .orca("orchestration task-list", stdout(own("task-list-full-brief-failed-report.json")));
    const progress = await runnerWith(exec).pollRun(RUN);
    expect(progress).toMatchObject({
      kind: "reported",
      report: { outcome: "failed", reportedAt: new Date("2026-11-17T16:08:28.349Z") },
    });
    expect(progress.kind === "reported" && progress.report.body).toContain(
      "The exact answer text received was",
    );
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration task-list --run run_493ebb2f403d --full --brief --json",
    );
  });

  test("a removed worktree is worktree-gone", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(own("worker-show-working.json")))
      .orca("orchestration check", stdout(own("check-peek-empty.json")))
      .orca(
        "worktree ps",
        stdout(JSON.stringify({ ok: true, result: { worktrees: [], totalCount: 0 } })),
      )
      .orca("worktree show", stdout(own("worktree-show-not-found.json"), 1));
    expect(await runnerWith(exec).pollRun(RUN)).toEqual({ kind: "worktree-gone" });
  });

  test("reads the research 0008 lost escalation as ended without report", async () => {
    const r3: RunOnRunner = {
      mailbox: encodeMailbox({
        terminal: "term_00000000-0000-4000-8000-000000000001",
        runId: "run_000000000001",
      }),
      worktree: toWorktreeRef(
        "10000000-0000-4000-8000-000000000004::<path>/workspaces/sandbox/fo-orch-r3",
      ),
      agentRef: encodeAgent({
        dispatchId: "ctx_000000000003",
        taskId: "task_000000000003",
        runId: "run_000000000001",
      }),
    };
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(research("0008/worker-show-lost.json")))
      .orca("orchestration task-list", stdout(research("0008/task-list-after-lost.json")))
      .orca("orchestration check", stdout(peekOf(research("0008/escalation-lost-full.json"))))
      .orca("worktree ps", stdout(JSON.stringify({ ok: true, result: { worktrees: [] } })))
      .orca("worktree show", stdout(own("worktree-show-not-found.json"), 1));
    expect(await runnerWith(exec).pollRun(r3)).toEqual({
      kind: "ended-without-report",
      detail: "lost: Worker lost without reporting",
    });
    expectNoConsumingCheck(exec);
  });

  test("ok: false and broken output become error kinds", async () => {
    const failing = new ScriptedExec().orca(
      "orchestration worker-show",
      stdout(JSON.stringify({ ok: false, error: { code: "dispatch_not_found", message: "x" } }), 1),
    );
    expect(await adapterError(runnerWith(failing).pollRun(RUN))).toMatchObject({
      kind: "runner-error",
      code: "dispatch_not_found",
    });
    const broken = polling(own("worker-show-working.json"), "{not json");
    expect(await adapterError(runnerWith(broken).pollRun(RUN))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("a mailbox that lost its Run binding is reported as missing", async () => {
    const exec = polling(own("worker-show-working.json"), own("check-peek-consumer-fenced.json"));
    expect(await adapterError(runnerWith(exec).pollRun(RUN))).toMatchObject({
      kind: "mailbox-missing",
    });
  });

  test("reads the Run inbox when the run started under another Run", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(own("worker-show-working.json")))
      .orca("orchestration inbox", stdout(own("check-peek-full-question.json")))
      .orca("worktree ps", stdout(own("worktree-ps-agent-wait-working.json")));
    const moved = { ...RUN, mailbox: encodeMailbox({ terminal: "term_new", runId: "run_new" }) };
    const progress = await runnerWith(exec).pollRun(moved);
    expect(progress.kind === "active" && progress.questions.map((q) => q.id)).toEqual([
      "msg_49acb8390fb2",
    ]);
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration inbox --terminal run:run_493ebb2f403d --limit 500 --full --json",
    );
    expectNoConsumingCheck(exec);
  });
});

describe("answerQuestion and denyPermission", () => {
  test("sends an answer with newlines, quotes and $ as one quoted argument", async () => {
    const exec = new ScriptedExec().orca("orchestration reply", stdout(own("reply.json")));
    await runnerWith(exec).answerQuestion(RUN, {
      questionId: toQuestionId("msg_49acb8390fb2"),
      answer: `A\nsecond line: it's "quoted" $HOME \`echo x\``,
    });
    expect(exec.commands()).toEqual([
      `/Applications/Orca.app/Contents/Resources/bin/orca orchestration reply --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --id msg_49acb8390fb2 --body 'A\nsecond line: it'\\''s "quoted" $HOME \`echo x\`' --json`,
    ]);
  });

  test("an answer to a blocked escalation goes to its dispatch, not as a reply(0120)", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration send",
      stdout(research("0120/send-to-dispatch.json")),
    );
    await runnerWith(exec).answerQuestion(RUN, {
      questionId: escalationQuestionId("msg_000000000122"),
      answer: "시안은 docs/login.png 에 있어요",
    });
    expect(exec.commands()).toEqual([
      `/Applications/Orca.app/Contents/Resources/bin/orca orchestration send --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --to dispatch:ctx_a6e6a23a7132 --subject 'Answer from the operator' --body '시안은 docs/login.png 에 있어요' --json`,
    ]);
  });

  test("a message from the operator goes to the run's dispatch(0147)", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration send",
      stdout(research("0120/send-to-dispatch.json")),
    );
    await runnerWith(exec).sendToAgent(RUN, { body: "끝내기 전에 push 해 주세요" });
    expect(exec.commands()).toEqual([
      `/Applications/Orca.app/Contents/Resources/bin/orca orchestration send --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --to dispatch:ctx_a6e6a23a7132 --subject 'Message from the operator (not an answer to any open question)' '--body=끝내기 전에 push 해 주세요' --json`,
    ]);
  });

  test("an operator message starting with -- stays one body argument(0147)", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration send",
      stdout(research("0120/send-to-dispatch.json")),
    );
    await runnerWith(exec).sendToAgent(RUN, {
      body: "--to=dispatch:other --no-verify 쓰지 마세요",
    });
    expect(exec.commands()[0]).toContain(
      "'--body=--to=dispatch:other --no-verify 쓰지 마세요' --json",
    );
  });

  test("a send that Orca turned into a follow-up returns its dispatch(0147)", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration send",
      stdout(
        JSON.stringify({
          ok: true,
          result: { delivery: "follow_up", followUpOf: "ctx_a6e6a23a7132", dispatchId: "ctx_new" },
        }),
      ),
    );
    expect(await runnerWith(exec).sendToAgent(RUN, { body: "x" })).toEqual({
      kind: "follow-up",
      followUpRef: "ctx_new",
    });
  });

  test("a follow-up that did not become ready still returns its dispatch(0147)", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration send",
      stdout(
        JSON.stringify({
          ok: false,
          result: { delivery: "follow_up", dispatchId: "ctx_new", state: "outcome_unknown" },
        }),
        1,
      ),
    );
    expect(await runnerWith(exec).sendToAgent(RUN, { body: "x" })).toEqual({
      kind: "follow-up",
      followUpRef: "ctx_new",
    });
  });

  test.each([
    "runtime_unavailable",
    "remote_runtime_unavailable",
    "runtime_timeout",
    "invalid_runtime_response",
  ])("%s after a send means the outcome is unknown(0147)", async (code) => {
    const exec = new ScriptedExec().orca(
      "orchestration send",
      stdout(JSON.stringify({ ok: false, error: { code, message: "cut" } }), 1),
    );
    expect(await adapterError(runnerWith(exec).sendToAgent(RUN, { body: "x" }))).toMatchObject({
      kind: "start-outcome-unknown",
    });
  });

  test("a code Orca adds later is treated as an unknown outcome, a known refusal is not(0147)", async () => {
    const later = new ScriptedExec().orca(
      "orchestration send",
      stdout(JSON.stringify({ ok: false, error: { code: "some_new_code", message: "x" } }), 1),
    );
    expect(await adapterError(runnerWith(later).sendToAgent(RUN, { body: "x" }))).toMatchObject({
      kind: "start-outcome-unknown",
    });
    const refused = new ScriptedExec().orca(
      "orchestration send",
      stdout(JSON.stringify({ ok: false, error: { code: "invalid_argument", message: "x" } }), 1),
    );
    expect(await adapterError(runnerWith(refused).sendToAgent(RUN, { body: "x" }))).toMatchObject({
      kind: "runner-error",
      code: "invalid_argument",
    });
  });

  test("stopping a follow-up stops that dispatch(0147)", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration worker-stop",
      stdout(JSON.stringify({ ok: true, result: { state: "stopped" } })),
    );
    await runnerWith(exec).stopFollowUp(toFollowUpRef("ctx_new"));
    expect(exec.commands()[0]).toContain("orchestration worker-stop --dispatch ctx_new");
  });

  test("broken send output for an operator message is malformed(0147)", async () => {
    const broken = new ScriptedExec().orca("orchestration send", BROKEN);
    expect(await adapterError(runnerWith(broken).sendToAgent(RUN, { body: "x" }))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("a second, different answer is a runner error; broken output is malformed", async () => {
    const conflict = new ScriptedExec().orca(
      "orchestration reply",
      stdout(own("reply-answer-conflict.json"), 1),
    );
    const input = { questionId: toQuestionId("msg_49acb8390fb2"), answer: "x" };
    expect(await adapterError(runnerWith(conflict).answerQuestion(RUN, input))).toMatchObject({
      kind: "runner-error",
      code: "answer_conflict",
    });
    const broken = new ScriptedExec().orca("orchestration reply", BROKEN);
    expect(await adapterError(runnerWith(broken).answerQuestion(RUN, input))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("an answer over the ssh limit is refused before anything is sent", async () => {
    const exec = new ScriptedExec();
    expect(
      await adapterError(
        runnerWith(exec).answerQuestion(RUN, {
          questionId: toQuestionId("msg_1"),
          answer: "x".repeat(210 * 1024),
        }),
      ),
    ).toMatchObject({ kind: "runner-error", code: "argument_too_long" });
    expect(exec.calls).toHaveLength(0);
  });

  test("ok: false and broken output from deny become error kinds", async () => {
    const input = { permissionId: toPermissionRequestId("apr_1"), reason: "no" };
    const off = new ScriptedExec().orca(
      "orchestration deny",
      stdout(research("0003/worktree-ps-runtime-off.json"), 1),
    );
    expect(await adapterError(runnerWith(off).denyPermission(RUN, input))).toMatchObject({
      kind: "not-ready",
    });
    const broken = new ScriptedExec().orca("orchestration deny", BROKEN);
    expect(await adapterError(runnerWith(broken).denyPermission(RUN, input))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("denies a permission prompt with a reason", async () => {
    const exec = new ScriptedExec().orca("orchestration deny", stdout(research("0008/deny.json")));
    await runnerWith(exec).denyPermission(RUN, {
      permissionId: toPermissionRequestId("apr_0000000000000001"),
      reason: "Don't touch files; skip it.",
    });
    expect(exec.commands()).toEqual([
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration deny --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --dispatch ctx_a6e6a23a7132 --prompt apr_0000000000000001 --reason 'Don'\\''t touch files; skip it.' --json",
    ]);
  });
});

describe("stopAgent, closeAgent and readLogTail", () => {
  test("stops with worker-stop and releases with worker-release", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-stop", stdout(research("0008/worker-stop.json")))
      .orca("orchestration worker-release", stdout(own("worker-release.json")));
    const runner = runnerWith(exec);
    await runner.stopAgent(RUN);
    await runner.closeAgent(RUN);
    expect(exec.commands()).toEqual([
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-stop --dispatch ctx_a6e6a23a7132 --json",
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-release --dispatch ctx_a6e6a23a7132 --json",
    ]);
  });

  test("ok: false and broken output from stop become error kinds", async () => {
    const failing = new ScriptedExec().orca(
      "orchestration worker-stop",
      stdout(research("0008/worker-stop-from-error.json"), 1),
    );
    expect(await adapterError(runnerWith(failing).stopAgent(RUN))).toMatchObject({
      kind: "runner-error",
    });
    const broken = new ScriptedExec().orca("orchestration worker-release", BROKEN);
    expect(await adapterError(runnerWith(broken).closeAgent(RUN))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("ok: false from release and log reads become error kinds", async () => {
    const release = new ScriptedExec().orca(
      "orchestration worker-release",
      stdout(JSON.stringify({ ok: false, error: { code: "release_unknown", message: "x" } }), 1),
    );
    expect(await adapterError(runnerWith(release).closeAgent(RUN))).toMatchObject({
      kind: "runner-error",
      code: "release_unknown",
    });
    const read = new ScriptedExec().orca(
      "orchestration worker-read",
      stdout(own("worker-read-terminal-released-error.json"), 1),
    );
    expect(await adapterError(runnerWith(read).readLogTail(RUN, { lines: 5 }))).toMatchObject({
      kind: "runner-error",
      code: "runtime_error",
    });
  });

  test("returns the last lines of the agent transcript", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration worker-read",
      stdout(own("worker-read-transcript.json")),
    );
    const lines = await runnerWith(exec).readLogTail(RUN, { lines: 3 });
    expect(lines).toHaveLength(3);
    expect(lines.at(-1)).toBe("I made no edits, commits, or pushes.");
    expect(exec.commands()).toEqual([
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-read --dispatch ctx_a6e6a23a7132 --limit 100 --json",
    ]);
  });

  test("reads every page to reach the end of a long transcript", async () => {
    const page = (from: number, count: number, next: string | null) =>
      stdout(
        JSON.stringify({
          ok: true,
          result: {
            source: "transcript",
            transcript: {
              messages: Array.from({ length: count }, (_, i) => ({
                role: "assistant",
                blocks: [{ type: "text", text: `line ${from + i}` }],
              })),
              nextCursor: next,
            },
          },
        }),
      );
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-read --dispatch ctx_a6e6a23a7132 --limit 100 --json",
        page(0, 100, "c1"),
      )
      .orca(
        "orchestration worker-read --dispatch ctx_a6e6a23a7132 --limit 100 --cursor c1",
        page(100, 30, "c2"),
      );
    const lines = await runnerWith(exec).readLogTail(RUN, { lines: 2 });
    expect(lines).toEqual(["[assistant] line 128", "[assistant] line 129"]);
    expect(exec.calls).toHaveLength(2);
  });

  test("marks the tail as cut when the transcript is longer than the page limit", async () => {
    let n = 0;
    const exec = new ScriptedExec().orca("orchestration worker-read", () => {
      n += 1;
      return stdout(
        JSON.stringify({
          ok: true,
          result: {
            source: "transcript",
            transcript: {
              messages: Array.from({ length: 100 }, (_, i) => ({
                role: "assistant",
                blocks: [{ type: "text", text: `page ${n} line ${i}` }],
              })),
              nextCursor: `c${n}`,
            },
          },
        }),
      );
    });
    const lines = await runnerWith(exec).readLogTail(RUN, { lines: 3 });
    expect(exec.calls).toHaveLength(LOG_MAX_PAGES);
    expect(lines).toEqual([
      LOG_CUT_MARKER,
      `[assistant] page ${LOG_MAX_PAGES} line 98`,
      `[assistant] page ${LOG_MAX_PAGES} line 99`,
    ]);
  });

  test("an archived empty terminal gives no lines; broken output is malformed", async () => {
    const empty = new ScriptedExec().orca(
      "orchestration worker-read",
      stdout(own("worker-read-terminal-empty.json")),
    );
    expect(await runnerWith(empty).readLogTail(RUN, { lines: 200 })).toEqual([]);
    const broken = new ScriptedExec().orca("orchestration worker-read", BROKEN);
    expect(await adapterError(runnerWith(broken).readLogTail(RUN, { lines: 5 }))).toMatchObject({
      kind: "malformed-output",
    });
  });
});

describe("worktreeExists and removeWorktree", () => {
  test("answers whether the worktree is still on the runner", async () => {
    const there = new ScriptedExec().orca("worktree show", stdout(own("worktree-show.json")));
    expect(await runnerWith(there).worktreeExists(WORKTREE)).toBe(true);
    const gone = new ScriptedExec().orca(
      "worktree show",
      stdout(own("worktree-show-not-found.json"), 1),
    );
    expect(await runnerWith(gone).worktreeExists(WORKTREE)).toBe(false);
    const broken = new ScriptedExec().orca("worktree show", BROKEN);
    expect(await adapterError(runnerWith(broken).worktreeExists(WORKTREE))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("removes with --force and keeps the branch", async () => {
    const exec = new ScriptedExec().orca("worktree rm", stdout(own("worktree-rm-force.json")));
    await runnerWith(exec).removeWorktree(WORKTREE);
    expect(exec.commands()).toEqual([
      `/Applications/Orca.app/Contents/Resources/bin/orca worktree rm --worktree 'id:${WORKTREE}' --force --json`,
    ]);
  });

  test("a worktree already gone is fine; a stopped runtime is not ready", async () => {
    const gone = new ScriptedExec().orca(
      "worktree rm",
      stdout(own("worktree-show-not-found.json"), 1),
    );
    await expect(runnerWith(gone).removeWorktree(WORKTREE)).resolves.toBeUndefined();
    const off = new ScriptedExec().orca(
      "worktree rm",
      stdout(research("0003/worktree-rm-runtime-off.json"), 1),
    );
    expect(await adapterError(runnerWith(off).removeWorktree(WORKTREE))).toMatchObject({
      kind: "not-ready",
    });
  });
});

describe("checkWorktreeWork", () => {
  const STATUS = "git -C '<path>/workspaces/sandbox/fo-t0013-probe1' status";
  const REV_LIST = "git -C '<path>/workspaces/sandbox/fo-t0013-probe1' rev-list";
  const REV_PARSE = "git -C '<path>/workspaces/sandbox/fo-t0013-probe1' rev-parse";
  const HEAD_COMMIT = "a".repeat(40);
  const shown = (): ScriptedExec =>
    new ScriptedExec().orca("worktree show", stdout(own("worktree-show.json")));

  test("reads git status, commits missing from every remote and HEAD in the worktree", async () => {
    const exec = shown()
      .on(STATUS, stdout(""))
      .on(REV_LIST, stdout("0\n"))
      .on(REV_PARSE, stdout(`${HEAD_COMMIT}\n`));
    expect(await runnerWith(exec).checkWorktreeWork(WORKTREE)).toEqual({
      kind: "checked",
      uncommittedChanges: false,
      unpushedCommits: false,
      headCommit: HEAD_COMMIT,
    });
    expect(exec.commands()).toEqual([
      `/Applications/Orca.app/Contents/Resources/bin/orca worktree show --worktree 'id:${WORKTREE}' --json`,
      "git -C '<path>/workspaces/sandbox/fo-t0013-probe1' status --porcelain '--untracked-files=all'",
      "git -C '<path>/workspaces/sandbox/fo-t0013-probe1' rev-list --count HEAD --not --remotes",
      "git -C '<path>/workspaces/sandbox/fo-t0013-probe1' rev-parse --verify HEAD",
    ]);
  });

  test("tracked or untracked changes and unpushed commits count as work", async () => {
    const changed = shown()
      .on(STATUS, stdout("?? notes.md\n M src/a.ts\n"))
      .on(REV_LIST, stdout("0"))
      .on(REV_PARSE, stdout(HEAD_COMMIT));
    expect(await runnerWith(changed).checkWorktreeWork(WORKTREE)).toMatchObject({
      uncommittedChanges: true,
      unpushedCommits: false,
    });
    const ahead = shown()
      .on(STATUS, stdout(""))
      .on(REV_LIST, stdout("2\n"))
      .on(REV_PARSE, stdout(HEAD_COMMIT));
    expect(await runnerWith(ahead).checkWorktreeWork(WORKTREE)).toMatchObject({
      uncommittedChanges: false,
      unpushedCommits: true,
    });
  });

  test("a worktree already gone has nothing to keep", async () => {
    const gone = new ScriptedExec().orca(
      "worktree show",
      stdout(own("worktree-show-not-found.json"), 1),
    );
    expect(await runnerWith(gone).checkWorktreeWork(WORKTREE)).toEqual({ kind: "gone" });
  });

  test("a failed git command, ssh failure or odd output is an error, not a clean worktree", async () => {
    const failed = shown().on(STATUS, {
      exitCode: 128,
      stdout: "",
      stderr: "fatal",
      timedOut: false,
    });
    expect(await adapterError(runnerWith(failed).checkWorktreeWork(WORKTREE))).toMatchObject({
      kind: "runner-error",
      code: "git_failed",
    });
    const unreachable = shown().on(STATUS, stdout("")).on(REV_LIST, stdout("", 255));
    expect(await adapterError(runnerWith(unreachable).checkWorktreeWork(WORKTREE))).toMatchObject({
      kind: "unreachable",
    });
    const odd = shown().on(STATUS, stdout("")).on(REV_LIST, stdout("many"));
    expect(await adapterError(runnerWith(odd).checkWorktreeWork(WORKTREE))).toMatchObject({
      kind: "malformed-output",
    });
    const oddHead = shown()
      .on(STATUS, stdout(""))
      .on(REV_LIST, stdout("1"))
      .on(REV_PARSE, stdout("not-a-commit"));
    expect(await adapterError(runnerWith(oddHead).checkWorktreeWork(WORKTREE))).toMatchObject({
      kind: "malformed-output",
    });
  });
});

describe("pauseAgent and resumeAgent", () => {
  const ORCA = "/Applications/Orca.app/Contents/Resources/bin/orca";
  const AGENT_TERMINAL = "term_9c1d6b7e-2f0a-4c55-9a3e-0d5f1e2b7a10";
  const shown = (fields: Record<string, string | null>) =>
    stdout(
      JSON.stringify({
        ok: true,
        result: {
          dispatchId: "ctx_a6e6a23a7132",
          taskId: "task_43a3a070dc4c",
          runId: "run_493ebb2f403d",
          state: "ready",
          ...fields,
        },
      }),
    );
  const sent = stdout(JSON.stringify({ ok: true, result: { send: { accepted: true } } }));
  const resumeInput = {
    agent: toAgentId("claude"),
    message: "Continue where you stopped.",
    restartPrompt: "ACME-1 Fix checkout\n\nPick up where the previous agent stopped.",
  };

  test("pauses by sending Escape to the live agent terminal, without stopping the worker", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "live", terminal: AGENT_TERMINAL }))
      .orca("terminal send", sent);
    await runnerWith(exec).pauseAgent(RUN);
    expect(exec.commands()).toEqual([
      `${ORCA} orchestration worker-show --dispatch ctx_a6e6a23a7132 --json`,
      `${ORCA} terminal send --terminal ${AGENT_TERMINAL} --text '\u001b' --json`,
    ]);
    expect(exec.commands().some((command) => command.includes("worker-stop"))).toBe(false);
  });

  test("pausing an agent that already exited is a runner error and sends nothing", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration worker-show",
      shown({ liveness: "exited", terminal: AGENT_TERMINAL }),
    );
    expect(await adapterError(runnerWith(exec).pauseAgent(RUN))).toMatchObject({
      kind: "runner-error",
      code: "agent_not_running",
    });
    expect(exec.commands()).toHaveLength(1);
  });

  const psRow = (agents: number) =>
    stdout(
      JSON.stringify({
        ok: true,
        result: {
          worktrees: [
            {
              worktreeId: WORKTREE,
              liveTerminalCount: 1,
              agents: Array.from({ length: agents }, () => ({ state: "idle" })),
            },
          ],
          truncated: false,
        },
      }),
    );

  test("an agent that exited and left only its shell is not paused or resumed in that shell", async () => {
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-show",
        shown({ liveness: "unverifiable", terminal: AGENT_TERMINAL }),
      )
      .orca("worktree ps", psRow(0));
    expect(await adapterError(runnerWith(exec).pauseAgent(RUN))).toMatchObject({
      kind: "runner-error",
      code: "agent_not_running",
    });
    expect(exec.commands().some((command) => command.includes("terminal send"))).toBe(false);
  });

  test("an unverifiable agent is paused only when its terminal is still connected", async () => {
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-show",
        shown({ liveness: "unverifiable", terminal: AGENT_TERMINAL }),
      )
      .orca("worktree ps", psRow(1))
      .orca(
        "terminal show",
        stdout(
          JSON.stringify({
            ok: true,
            result: { terminal: { handle: AGENT_TERMINAL, connected: true } },
          }),
        ),
      )
      .orca("terminal send", sent);
    await runnerWith(exec).pauseAgent(RUN);
    expect(exec.commands()[3]).toContain("terminal send");
  });

  test("a terminal that refuses input is a runner error", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "live", terminal: AGENT_TERMINAL }))
      .orca(
        "terminal send",
        stdout(JSON.stringify({ ok: true, result: { send: { accepted: false } } })),
      );
    expect(await adapterError(runnerWith(exec).pauseAgent(RUN))).toMatchObject({
      kind: "runner-error",
      code: "input_not_accepted",
    });
  });

  test("resumes the same conversation by typing the message into the agent terminal", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "live", terminal: AGENT_TERMINAL }))
      .orca("terminal send", sent);
    const resumed = await runnerWith(exec).resumeAgent(RUN, resumeInput);
    expect(resumed).toEqual({ agentRef: RUN.agentRef, restarted: false });
    expect(exec.commands()).toEqual([
      `${ORCA} orchestration worker-show --dispatch ctx_a6e6a23a7132 --json`,
      `${ORCA} terminal send --terminal ${AGENT_TERMINAL} --text 'Continue where you stopped.' --enter --json`,
    ]);
  });

  const onlyOldWorker = stdout(
    JSON.stringify({
      ok: true,
      result: {
        workers: [
          { dispatchId: "ctx_a6e6a23a7132", taskId: "task_43a3a070dc4c", workspace: WORKTREE },
        ],
        nextCursor: null,
      },
    }),
  );

  test("starts a new agent in the same worktree when the conversation is gone", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "exited", terminal: null }))
      .orca("orchestration worker-list", onlyOldWorker)
      .orca(
        "orchestration worker-start",
        stdout(
          JSON.stringify({
            ok: true,
            result: {
              dispatchId: "ctx_new",
              taskId: "task_new",
              runId: "run_493ebb2f403d",
              state: "ready",
            },
          }),
        ),
      );
    const resumed = await runnerWith(exec).resumeAgent(RUN, resumeInput);
    expect(resumed.restarted).toBe(true);
    expect(decodeAgent(resumed.agentRef)).toEqual({
      dispatchId: "ctx_new",
      taskId: "task_new",
      runId: "run_493ebb2f403d",
    });
    expect(exec.commands()[1]).toContain("worker-list --run run_493ebb2f403d");
    expect(exec.commands()[2]).toBe(`${ORCA} orchestration worker-list --limit 100 --json`);
    expect(exec.commands()[3]).toBe(
      `${ORCA} orchestration worker-start --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --run run_493ebb2f403d --spec-file - --task-title 'resume task_43a3a070dc4c' --worktree 'id:${WORKTREE}' --agent claude --json`,
    );
    expect(exec.calls[3]?.stdin).toBe(resumeInput.restartPrompt);
    expect(exec.commands().some((command) => command.includes("--name"))).toBe(false);
  });

  test("a restart that ends failed is a runner error", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "exited", terminal: null }))
      .orca("orchestration worker-list", onlyOldWorker)
      .orca(
        "orchestration worker-start",
        stdout(
          JSON.stringify({
            ok: true,
            result: { dispatchId: "ctx_new", taskId: "task_new", runId: "run_1", state: "failed" },
          }),
        ),
      );
    expect(await adapterError(runnerWith(exec).resumeAgent(RUN, resumeInput))).toMatchObject({
      kind: "runner-error",
      code: "worker_start_failed",
    });
  });

  test("a restart whose outcome is unknown is reported as such, and a retry adopts the started agent", async () => {
    const lost = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "exited", terminal: null }))
      .orca("orchestration worker-list", onlyOldWorker)
      .orca("orchestration worker-start", stdout("ssh: connection reset", 255));
    expect(await adapterError(runnerWith(lost).resumeAgent(RUN, resumeInput))).toMatchObject({
      kind: "start-outcome-unknown",
    });

    const retry = new ScriptedExec()
      .orca(
        "orchestration worker-show --dispatch ctx_a6e6a23a7132",
        shown({ liveness: "exited", terminal: null }),
      )
      .orca(
        "orchestration worker-list",
        stdout(
          JSON.stringify({
            ok: true,
            result: {
              workers: [
                {
                  dispatchId: "ctx_a6e6a23a7132",
                  taskId: "task_43a3a070dc4c",
                  workspace: WORKTREE,
                },
                { dispatchId: "ctx_new", taskId: "task_new", workspace: WORKTREE },
              ],
              nextCursor: null,
            },
          }),
        ),
      )
      .orca(
        "orchestration worker-show --dispatch ctx_new",
        shown({ liveness: "live", terminal: AGENT_TERMINAL }),
      );
    const resumed = await runnerWith(retry).resumeAgent(RUN, resumeInput);
    expect(resumed.restarted).toBe(true);
    expect(decodeAgent(resumed.agentRef)?.dispatchId).toBe("ctx_new");
    expect(retry.commands().some((command) => command.includes("worker-start"))).toBe(false);
  });

  test("with startIfGone false a resume only adopts and never starts a new agent", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "exited", terminal: null }))
      .orca("orchestration worker-list", onlyOldWorker);
    expect(
      await adapterError(runnerWith(exec).resumeAgent(RUN, { ...resumeInput, startIfGone: false })),
    ).toMatchObject({ kind: "runner-error", code: "agent_not_running" });
    expect(exec.commands().some((command) => command.includes("worker-start"))).toBe(false);
  });

  test("a retry adopts a worker that is still starting in the same worktree", async () => {
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-show --dispatch ctx_a6e6a23a7132",
        shown({ liveness: "exited", terminal: null }),
      )
      .orca(
        "orchestration worker-list",
        stdout(
          JSON.stringify({
            ok: true,
            result: {
              workers: [{ dispatchId: "ctx_starting", taskId: "task_s", workspace: WORKTREE }],
              nextCursor: null,
            },
          }),
        ),
      )
      .orca(
        "orchestration worker-show --dispatch ctx_starting",
        shown({ liveness: "unverifiable", terminal: null, state: "starting" }),
      );
    const resumed = await runnerWith(exec).resumeAgent(RUN, resumeInput);
    expect(decodeAgent(resumed.agentRef)?.dispatchId).toBe("ctx_starting");
    expect(exec.commands().some((command) => command.includes("worker-start"))).toBe(false);
  });

  test("an old ready session with no live terminal is not adopted", async () => {
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-show --dispatch ctx_a6e6a23a7132",
        shown({ liveness: "exited", terminal: null }),
      )
      .orca(
        "orchestration worker-list",
        stdout(
          JSON.stringify({
            ok: true,
            result: {
              workers: [{ dispatchId: "ctx_old", taskId: "task_old", workspace: WORKTREE }],
              nextCursor: null,
            },
          }),
        ),
      )
      .orca(
        "orchestration worker-show --dispatch ctx_old",
        shown({ liveness: "unverifiable", terminal: null }),
      )
      .orca(
        "orchestration worker-start",
        stdout(
          JSON.stringify({
            ok: true,
            result: { dispatchId: "ctx_new", taskId: "task_new", runId: "run_1", state: "ready" },
          }),
        ),
      );
    const resumed = await runnerWith(exec).resumeAgent(RUN, resumeInput);
    expect(decodeAgent(resumed.agentRef)?.dispatchId).toBe("ctx_new");
  });

  test("a lost reply while typing the resume message is an unknown outcome", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "live", terminal: AGENT_TERMINAL }))
      .orca("terminal send", stdout("ssh: connection reset", 255));
    expect(await adapterError(runnerWith(exec).resumeAgent(RUN, resumeInput))).toMatchObject({
      kind: "start-outcome-unknown",
    });
  });
});

describe("prepareContinuation", () => {
  const repoPath = "'<path>/sandbox'";
  const path = "/worktrees/ganger-ENG-1-1";
  const branch = "acme/ganger-ENG-1-1";
  const input = {
    project: toRunnerProjectId("github:acme/sandbox"),
    worktree: toWorktreeRef(`527aed9b-0eef-4404-9d8d-9a89d7fb1dc9::${path}`),
    branch,
  };
  const list = (...blocks: string[]) => stdout(`${blocks.join("\n\n")}\n`);
  const main = "worktree <path>/sandbox\nHEAD aaa\nbranch refs/heads/main";
  const here = (name: string) => `worktree ${path}\nHEAD bbb\nbranch refs/heads/${name}`;

  function git(exec: ScriptedExec, verb: string, ...replies: RemoteResult[]): ScriptedExec {
    return exec.on(`git -C ${repoPath} ${verb}`, ...replies);
  }

  function missingWorktree(): ScriptedExec {
    const exec = withProjects(new ScriptedExec());
    git(exec, "worktree list", list(main));
    git(exec, "worktree prune", stdout(""));
    return exec;
  }

  test("워크트리가 있으면 같은 워크트리다", async () => {
    const exec = git(withProjects(new ScriptedExec()), "worktree list", list(main, here(branch)));
    expect(await runnerWith(exec).prepareContinuation(input)).toBe("same-worktree");
    expect(exec.commands().some((c) => c.includes("worktree add"))).toBe(false);
  });

  test("에이전트가 브랜치를 바꿨어도 워크트리가 있으면 그 자리에서 이어 간다", async () => {
    const exec = git(withProjects(new ScriptedExec()), "worktree list", list(main, here("other")));
    expect(await runnerWith(exec).prepareContinuation(input)).toBe("same-worktree");
  });

  test("워크트리가 브랜치에 있지 않으면 그 자리에서 일하지 않는다", async () => {
    const detached = `worktree ${path}\nHEAD bbb\ndetached`;
    const exec = git(withProjects(new ScriptedExec()), "worktree list", list(main, detached));
    expect(await adapterError(runnerWith(exec).prepareContinuation(input))).toMatchObject({
      kind: "runner-error",
      code: "worktree_detached",
    });
  });

  const commonDir = "/repo/.git";

  function withSetupMarker(exec: ScriptedExec): ScriptedExec {
    return git(exec, "rev-parse", stdout(`${commonDir}\n`))
      .on("mkdir -p", stdout(""))
      .on("touch ", stdout(""));
  }

  test("로컬 브랜치가 있으면 표시를 먼저 남기고 같은 경로에 다시 만든다", async () => {
    const exec = withSetupMarker(missingWorktree());
    git(exec, "show-ref", stdout(""));
    git(exec, "worktree add", stdout(""));
    expect(await runnerWith(exec).prepareContinuation(input)).toBe("recreated");
    const commands = exec.commands();
    const added = commands.indexOf(`git -C ${repoPath} worktree add ${path} ${branch}`);
    const marked = commands.findIndex((command) => command.startsWith("touch "));
    expect(added).toBeGreaterThan(-1);
    expect(marked).toBeGreaterThan(-1);
    expect(marked).toBeLessThan(added);
  });

  describe("finishWorktreeSetup", () => {
    const setupInput = { project: input.project, worktree: input.worktree };
    const repoShow = (hookSettings: object) =>
      stdout(JSON.stringify({ id: "1", ok: true, result: { repo: { hookSettings } }, _meta: {} }));

    function pending(yaml: string, hookSettings: object = {}): ScriptedExec {
      return git(withProjects(new ScriptedExec()), "rev-parse", stdout(`${commonDir}\n`))
        .orca("repo show", repoShow(hookSettings))
        .on("sh -c", stdout(yaml))
        .on("rm -f ", stdout(""));
    }

    const setupCommand = (exec: ScriptedExec) =>
      exec.commands().find((command) => command.startsWith("env "));
    const cleared = (exec: ScriptedExec) =>
      exec.commands().some((command) => command.startsWith("rm -f "));

    test("표시가 있을 때만 setup이 남았다고 답한다", async () => {
      const marked = git(withProjects(new ScriptedExec()), "rev-parse", stdout(`${commonDir}\n`));
      marked.on("test -e ", stdout(""));
      expect(await runnerWith(marked).worktreeSetupPending(setupInput)).toBe(true);
      const clean = git(withProjects(new ScriptedExec()), "rev-parse", stdout(`${commonDir}\n`));
      clean.on("test -e ", stdout("", 1));
      expect(await runnerWith(clean).worktreeSetupPending(setupInput)).toBe(false);
    });

    test("모르는 명령 출처 정책이면 돌리지 않고 실패로 돌려준다", async () => {
      const exec = pending("scripts:\n  setup: pnpm install\n", {
        commandSourcePolicy: "future-policy",
      });
      expect(await runnerWith(exec).finishWorktreeSetup(setupInput)).toMatchObject({
        kind: "failed",
      });
      expect(setupCommand(exec)).toBeUndefined();
    });

    test("orca.yaml의 setup을 워크트리 경로와 함께 돌리고 표시를 지운다", async () => {
      const exec = pending("scripts:\n  setup: |\n    pnpm install\n    pnpm build\n").on(
        "env ",
        stdout("ok"),
      );
      expect(await runnerWith(exec).finishWorktreeSetup(setupInput)).toEqual({ kind: "done" });
      expect(setupCommand(exec)).toContain(`ORCA_WORKTREE_PATH=${path}`);
      expect(setupCommand(exec)).toContain("pnpm install");
      expect(cleared(exec)).toBe(true);
    });

    test("setup이 실패하면 이유를 돌려주고 표시를 남긴다", async () => {
      const exec = pending("scripts:\n  setup: pnpm install\n").on("env ", stdout("", 1));
      const result = await runnerWith(exec).finishWorktreeSetup(setupInput);
      expect(result).toMatchObject({ kind: "failed", reason: "setup exited with 1" });
      expect(cleared(exec)).toBe(false);
    });

    test("setup이 시간을 넘기면 결과를 모르는 것으로 보고 실패로 돌려준다", async () => {
      const exec = pending("scripts:\n  setup: pnpm install\n").on("env ", {
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: true,
      });
      expect(await runnerWith(exec).finishWorktreeSetup(setupInput)).toMatchObject({
        kind: "failed",
        reason: "setup timed out",
      });
    });

    test("읽을 수 없는 setup 형식은 건너뛰지 않고 실패로 돌려준다", async () => {
      const exec = pending("scripts:\n  setup: >\n    pnpm install\n");
      expect(await runnerWith(exec).finishWorktreeSetup(setupInput)).toMatchObject({
        kind: "failed",
      });
      expect(setupCommand(exec)).toBeUndefined();
    });

    test("설정한 setup이 없으면 아무것도 돌리지 않고 표시를 지운다", async () => {
      const exec = pending("");
      expect(await runnerWith(exec).finishWorktreeSetup(setupInput)).toEqual({ kind: "done" });
      expect(setupCommand(exec)).toBeUndefined();
      expect(cleared(exec)).toBe(true);
    });
  });

  test("로컬에 없고 origin에 있으면 받아서 추적 브랜치로 만든다", async () => {
    const exec = withSetupMarker(missingWorktree());
    git(exec, "show-ref", stdout("", 1));
    git(exec, "ls-remote --exit-code origin", stdout(`ccc\trefs/heads/${branch}\n`));
    git(exec, "fetch origin", stdout(""));
    git(exec, "worktree add", stdout(""));
    expect(await runnerWith(exec).prepareContinuation(input)).toBe("recreated");
    expect(exec.commands()).toContain(
      `git -C ${repoPath} worktree add --track -b ${branch} ${path} refs/remotes/origin/${branch}`,
    );
  });

  test("로컬과 origin 모두 없으면 처음부터 시작한다", async () => {
    const exec = missingWorktree();
    git(exec, "show-ref", stdout("", 1));
    git(exec, "ls-remote --exit-code origin", stdout("", 2));
    expect(await runnerWith(exec).prepareContinuation(input)).toBe("from-scratch");
    expect(exec.commands().some((c) => c.includes("worktree add"))).toBe(false);
  });

  test("origin을 읽지 못하면 처음부터 시작하지 않고 실패로 돌려준다", async () => {
    const exec = missingWorktree();
    git(exec, "show-ref", stdout("", 1));
    git(exec, "ls-remote", stdout("", 128));
    expect(await adapterError(runnerWith(exec).prepareContinuation(input))).toMatchObject({
      kind: "runner-error",
      code: "git_failed",
    });
  });

  test("origin 읽기가 시간 초과되면 러너 Offline이 아니라 시작 실패로 돌려준다", async () => {
    const exec = missingWorktree();
    git(exec, "show-ref", stdout("", 1));
    git(exec, "ls-remote", { exitCode: 124, stdout: "", stderr: "", timedOut: true });
    expect(await adapterError(runnerWith(exec).prepareContinuation(input))).toMatchObject({
      kind: "runner-error",
      code: "remote_read_timeout",
    });
  });

  test("이어서 시작하면 그 워크트리를 고르고 새 워크트리 인자를 넘기지 않는다", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("orchestration worker-start", stdout(own("worker-start-spec-stdin.json")))
        .orca("worktree show", stdout(own("worktree-show.json"))),
    );
    await runnerWith(exec).startRun({
      mailbox: MAILBOX,
      project: toRunnerProjectId("github:acme/sandbox"),
      worktreeName: "ganger-ENG-1-2",
      agent: toAgentId("claude"),
      brief: "brief",
      continueIn: WORKTREE,
    });
    const command = exec.calls.find((c) => c.command.includes("worker-start"))?.command ?? "";
    expect(command).toContain(`--worktree 'id:${WORKTREE}' --keep-open`);
    for (const flag of ["--repo", "--name", "--base-branch", "--comment"]) {
      expect(command).not.toContain(flag);
    }
  });

  describe("시작 결과를 모를 때(일반 런과 같은 복구)", () => {
    const previous = encodeAgent({ dispatchId: "ctx_old", taskId: "task_old", runId: "run_1" });
    const lookup = {
      mailbox: MAILBOX,
      worktreeName: "ganger-ENG-1-2",
      continueIn: WORKTREE,
      previousAgent: previous,
    };
    const workers = (...rows: Array<{ dispatchId: string; taskId: string }>) =>
      stdout(
        JSON.stringify({
          ok: true,
          result: { workers: rows.map((row) => ({ ...row, workspace: WORKTREE })) },
        }),
      );
    const shownWorktree = stdout(
      JSON.stringify({
        ok: true,
        result: { worktree: { id: WORKTREE, branch: "refs/heads/acme/ganger-ENG-1-1" } },
      }),
    );

    test("워크트리의 최신 에이전트가 이전 런 것이 아니면 시작한 런이다", async () => {
      const exec = new ScriptedExec()
        .orca("worktree show", shownWorktree)
        .orca(
          "orchestration worker-list",
          workers(
            { dispatchId: "ctx_new", taskId: "task_new" },
            { dispatchId: "ctx_old", taskId: "task_old" },
          ),
        )
        .orca(
          "orchestration worker-show",
          stdout(
            JSON.stringify({
              ok: true,
              result: { dispatchId: "ctx_new", taskId: "task_new", runId: "run_1", state: "ready" },
            }),
          ),
        );
      const found = await runnerWith(exec).findStartedRun(lookup);
      expect(found === null ? null : decodeAgent(found.agentRef)?.dispatchId).toBe("ctx_new");
    });

    test("워크트리의 최신 에이전트가 이전 런 것이면 시작되지 않은 것으로 본다", async () => {
      const exec = new ScriptedExec()
        .orca("worktree show", shownWorktree)
        .orca("orchestration worker-list", workers({ dispatchId: "ctx_old", taskId: "task_old" }));
      expect(await runnerWith(exec).findStartedRun(lookup)).toBeNull();
    });

    test("워크트리가 없으면 시작되지 않은 것으로 본다", async () => {
      const exec = new ScriptedExec().orca(
        "worktree show",
        stdout(
          JSON.stringify({ ok: false, error: { code: "selector_not_found", message: "gone" } }),
          1,
        ),
      );
      expect(await runnerWith(exec).findStartedRun(lookup)).toBeNull();
    });
  });

  describe("이전 에이전트가 살아 있는지", () => {
    const run = {
      worktree: WORKTREE,
      agentRef: encodeAgent({ dispatchId: "ctx_old", taskId: "task_old", runId: "run_1" }),
    };
    const shown = (liveness: string) =>
      stdout(
        JSON.stringify({
          ok: true,
          result: {
            dispatchId: "ctx_old",
            taskId: "task_old",
            runId: "run_1",
            state: "ready",
            liveness,
            terminal: "term_old",
          },
        }),
      );

    test("터미널이 살아 있으면 true다", async () => {
      const exec = new ScriptedExec().orca("orchestration worker-show", shown("live"));
      expect(await runnerWith(exec).isAgentAlive(run)).toBe(true);
    });

    test("끝났으면 false다", async () => {
      const exec = new ScriptedExec().orca("orchestration worker-show", shown("exited"));
      expect(await runnerWith(exec).isAgentAlive(run)).toBe(false);
    });

    test("Orca에 기록이 없으면 false다", async () => {
      const exec = new ScriptedExec().orca(
        "orchestration worker-show",
        stdout(
          JSON.stringify({ ok: false, error: { code: "dispatch_not_found", message: "gone" } }),
          1,
        ),
      );
      expect(await runnerWith(exec).isAgentAlive(run)).toBe(false);
    });

    test("러너에 닿지 못하면 살아 있다고도 없다고도 하지 않고 실패한다", async () => {
      const exec = new ScriptedExec().orca("orchestration worker-show", {
        exitCode: 255,
        stdout: "",
        stderr: "ssh failed",
        timedOut: false,
      });
      expect(await adapterError(runnerWith(exec).isAgentAlive(run))).toMatchObject({
        kind: "unreachable",
      });
    });
  });

  test("이어 받은 런을 재개할 때 이전 런의 끝난 에이전트를 입양하지 않고 새로 띄운다", async () => {
    const current = encodeAgent({ dispatchId: "ctx_b", taskId: "task_b", runId: "run_1" });
    const previous = encodeAgent({ dispatchId: "ctx_a", taskId: "task_a", runId: "run_1" });
    const shownB = {
      dispatchId: "ctx_b",
      taskId: "task_b",
      runId: "run_1",
      state: "failed",
      liveness: "exited",
    };
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-show --dispatch ctx_b",
        stdout(JSON.stringify({ ok: true, result: shownB })),
      )
      .orca(
        "orchestration worker-list",
        stdout(
          JSON.stringify({
            ok: true,
            result: {
              workers: [
                { dispatchId: "ctx_b", taskId: "task_b", workspace: WORKTREE },
                { dispatchId: "ctx_a", taskId: "task_a", workspace: WORKTREE },
              ],
            },
          }),
        ),
      )
      .orca("orchestration worker-start", stdout(own("worker-start-spec-stdin.json")));
    const resumed = await runnerWith(exec).resumeAgent(
      { mailbox: MAILBOX, worktree: WORKTREE, agentRef: current },
      {
        agent: toAgentId("claude"),
        message: "continue",
        restartPrompt: "brief",
        previousRunAgent: previous,
      },
    );
    expect(resumed.restarted).toBe(true);
    expect(exec.commands().some((c) => c.includes("worker-show --dispatch ctx_a"))).toBe(false);
    expect(exec.commands().some((c) => c.includes("worker-start"))).toBe(true);
  });
});
