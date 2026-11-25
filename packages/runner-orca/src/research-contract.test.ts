import {
  AdapterError,
  toAgentId,
  toPermissionRequestId,
  toQuestionId,
  toRunnerProjectId,
  toWorktreeRef,
} from "@ganger/core";
import type { RunOnRunner } from "@ganger/core";
import { describe, expect, test } from "vitest";
import { decodeAgent, decodeMailbox, encodeAgent, encodeMailbox } from "./refs.js";
import { ScriptedExec, peekOf, research, runnerWith, stdout } from "./test-support.js";

const REPO = "10000000-0000-4000-8000-000000000004";
const MAILBOX = encodeMailbox({
  terminal: "term_00000000-0000-4000-8000-000000000001",
  runId: "run_000000000001",
});

function runOf(n: 1 | 2 | 3): RunOnRunner {
  return {
    mailbox: MAILBOX,
    worktree: toWorktreeRef(`${REPO}::<path>/workspaces/sandbox/fo-orch-r${n}`),
    agentRef: encodeAgent({
      dispatchId: `ctx_00000000000${n}`,
      taskId: `task_00000000000${n}`,
      runId: "run_000000000001",
    }),
  };
}

function withSandbox(exec: ScriptedExec): ScriptedExec {
  return exec
    .orca(
      "project list",
      stdout(
        JSON.stringify({
          ok: true,
          result: {
            projects: [
              {
                id: "github:acme/sandbox",
                displayName: "sandbox",
                gitRemoteIdentity: { remoteName: "origin" },
              },
            ],
          },
        }),
      ),
    )
    .orca(
      "project setups",
      stdout(
        JSON.stringify({
          ok: true,
          result: {
            setups: [
              {
                projectId: "github:acme/sandbox",
                hostId: "local",
                repoId: REPO,
                path: "<path>/sandbox",
                displayName: "sandbox",
                setupState: "ready",
              },
            ],
          },
        }),
      ),
    );
}

const R1_WORKTREE_SHOW = stdout(
  JSON.stringify({
    ok: true,
    result: {
      worktree: {
        id: `${REPO}::<path>/workspaces/sandbox/fo-orch-r1`,
        branch: "refs/heads/acme/fo-orch-r1",
      },
    },
  }),
);

function inboxRows(file: string): string[] {
  const parsed: unknown = JSON.parse(research(`0008/${file}`));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  const result: unknown = parsed.result;
  if (typeof result !== "object" || result === null || !("messages" in result)) throw new Error();
  const messages: unknown = result.messages;
  if (!Array.isArray(messages)) throw new Error();
  return messages.map((m) => JSON.stringify(m));
}

async function detailOf(promise: Promise<unknown>): Promise<unknown> {
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

describe("research 0008 contract", () => {
  test("ensureMailbox: makes the mailbox terminal and binds a Run", async () => {
    const exec = withSandbox(
      new ScriptedExec()
        .orca("terminal create", stdout(research("0008/mailbox-terminal-create.json")))
        .orca(
          "orchestration run-create",
          stdout(JSON.stringify({ ok: true, result: { runId: "run_000000000001" } })),
        ),
    );
    expect(decodeMailbox(await runnerWith(exec).ensureMailbox(null))).toEqual({
      terminal: "term_00000000-0000-4000-8000-000000000001",
      runId: "run_000000000001",
    });
  });

  test("ensureMailbox: no --from is a missing mailbox", async () => {
    const exec = withSandbox(
      new ScriptedExec()
        .orca("terminal create", stdout(research("0008/mailbox-terminal-create.json")))
        .orca("orchestration run-create", stdout(research("0008/run-create-no-from-error.json"), 1))
        .orca("terminal close", stdout(JSON.stringify({ ok: true, result: {} }))),
    );
    expect(await detailOf(runnerWith(exec).ensureMailbox(null))).toMatchObject({
      kind: "mailbox-missing",
    });
  });

  test("startRun: worker-start result and the runner's branch", async () => {
    const exec = withSandbox(
      new ScriptedExec()
        .orca("orchestration worker-start", stdout(research("0008/worker-start.json")))
        .orca("worktree show", R1_WORKTREE_SHOW),
    );
    const started = await runnerWith(exec).startRun({
      mailbox: MAILBOX,
      project: toRunnerProjectId("github:acme/sandbox"),
      worktreeName: "fo-orch-r1",
      agent: toAgentId("claude"),
      brief: "ticket body",
    });
    expect(started).toEqual({
      worktree: runOf(1).worktree,
      branch: "acme/fo-orch-r1",
      agentRef: runOf(1).agentRef,
    });
  });

  test("findStartedRun: finds R1 by its deterministic name across Runs", async () => {
    const exec = new ScriptedExec()
      .orca("worktree show", R1_WORKTREE_SHOW)
      .orca("orchestration worker-list", stdout(research("0008/worker-list-unverifiable.json")))
      .orca("orchestration worker-show", stdout(research("0008/worker-show-done.json")));
    const found = await runnerWith(exec).findStartedRun({
      mailbox: MAILBOX,
      worktreeName: "fo-orch-r1",
    });
    expect(found?.branch).toBe("acme/fo-orch-r1");
    expect(found === null ? null : decodeAgent(found.agentRef)).toEqual({
      dispatchId: "ctx_000000000001",
      taskId: "task_000000000001",
      runId: "run_000000000001",
    });
  });

  test("pollRun + answerQuestion: R1 asks, the answer goes back with reply --from the mailbox", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(research("0008/worker-show-asked.json")))
      .orca("orchestration inbox", stdout(peekOf(...inboxRows("inbox-question-full.json"))))
      .orca("worktree ps", stdout(JSON.stringify({ ok: true, result: { worktrees: [] } })))
      .orca("worktree show", R1_WORKTREE_SHOW)
      .orca("orchestration reply", stdout(research("0008/reply.json")));
    const runner = runnerWith(exec);
    const progress = await runner.pollRun(runOf(1));
    expect(progress).toEqual({
      kind: "active",
      activity: { kind: "unknown" },
      unreportedStop: null,
      questions: [
        {
          id: toQuestionId("msg_000000000001"),
          body: "Which line should I add to README.md? A: 'Verified by an orchestration run.' B: 'Orchestration check passed.'",
          options: ["A", "B"],
          askedAt: new Date("2026-11-17T14:07:35Z"),
        },
      ],
      permissionWaits: [],
    });
    await runner.answerQuestion(runOf(1), {
      questionId: toQuestionId("msg_000000000001"),
      answer: "A",
    });
    expect(exec.commands().at(-1)).toBe(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration reply --from term_00000000-0000-4000-8000-000000000001 --id msg_000000000001 --body A --json",
    );
    expect(exec.commands().filter((c) => / orchestration check (?!.*--peek)/.test(c))).toEqual([]);
  });

  test("pollRun: R1's completion report comes from the Task result", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(research("0008/worker-show-done.json")))
      .orca("orchestration task-list", stdout(research("0008/task-list-full-done.json")));
    const progress = await runnerWith(exec).pollRun(runOf(1));
    expect(progress).toMatchObject({
      kind: "reported",
      report: { outcome: "succeeded", reportedAt: new Date("2026-11-17T14:08:38.076Z") },
    });
  });

  test("pollRun + denyPermission: R2's open permission prompt, then deny", async () => {
    const asked: unknown = JSON.parse(research("0008/worker-show-asked.json"));
    if (typeof asked !== "object" || asked === null || !("result" in asked)) throw new Error();
    const r2Show = JSON.stringify({
      ok: true,
      result: {
        ...(typeof asked.result === "object" ? asked.result : {}),
        dispatchId: "ctx_000000000002",
        taskId: "task_000000000002",
        activity: "waiting",
      },
    });
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(r2Show))
      .orca(
        "orchestration inbox",
        stdout(peekOf(research("0008/escalation-needs-input-full.json"))),
      )
      .orca("worktree ps", stdout(research("0008/worktree-ps-permission.json")))
      .orca("orchestration deny", stdout(research("0008/deny.json")));
    const runner = runnerWith(exec);
    expect(await runner.pollRun(runOf(2))).toEqual({
      kind: "active",
      activity: { kind: "unknown" },
      unreportedStop: null,
      questions: [],
      permissionWaits: [
        {
          id: toPermissionRequestId("apr_0000000000000001"),
          detail: "Allow Bash?: touch perm-test.txt",
          requestedAt: new Date("2026-11-17T14:09:37Z"),
        },
      ],
    });
    await runner.denyPermission(runOf(2), {
      permissionId: toPermissionRequestId("apr_0000000000000001"),
      reason: "Skip step 1 and continue.",
    });
    expect(exec.commands().at(-1)).toBe(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration deny --from term_00000000-0000-4000-8000-000000000001 --dispatch ctx_000000000002 --prompt apr_0000000000000001 --reason 'Skip step 1 and continue.' --json",
    );
  });

  test("stopAgent: R2 is stopped and then polls as ended without report", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-stop", stdout(research("0008/worker-stop.json")))
      .orca("orchestration worker-show", stdout(research("0008/worker-show-after-stop.json")))
      .orca("orchestration task-list", stdout(research("0008/task-list-after-stop.json")))
      .orca("orchestration inbox", stdout(JSON.stringify({ ok: true, result: { messages: [] } })))
      .orca("worktree ps", stdout(JSON.stringify({ ok: true, result: { worktrees: [] } })))
      .orca(
        "worktree show",
        stdout(JSON.stringify({ ok: true, result: { worktree: { id: "x" } } })),
      );
    const runner = runnerWith(exec);
    await runner.stopAgent(runOf(2));
    expect(await runner.pollRun(runOf(2))).toEqual({
      kind: "ended-without-report",
      detail: "agent exited: process_stopped",
    });
  });

  test("stopAgent: --from is refused by worker-stop and surfaces as a runner error", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration worker-stop",
      stdout(research("0008/worker-stop-from-error.json"), 1),
    );
    expect(await detailOf(runnerWith(exec).stopAgent(runOf(2)))).toMatchObject({
      kind: "runner-error",
      code: "invalid_argument",
    });
  });

  test("pollRun: R3 lost without a report", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(research("0008/worker-show-lost.json")))
      .orca("orchestration task-list", stdout(research("0008/task-list-after-lost.json")))
      .orca("orchestration inbox", stdout(peekOf(research("0008/escalation-lost-full.json"))))
      .orca("worktree ps", stdout(JSON.stringify({ ok: true, result: { worktrees: [] } })))
      .orca("worktree show", R1_WORKTREE_SHOW);
    expect(await runnerWith(exec).pollRun(runOf(3))).toMatchObject({
      kind: "ended-without-report",
    });
  });

  test("closeAgent: releases each settled agent", async () => {
    const releases: unknown = JSON.parse(research("0008/worker-release.json"));
    if (!Array.isArray(releases)) throw new Error();
    for (const [i, release] of releases.entries()) {
      const exec = new ScriptedExec().orca(
        "orchestration worker-release",
        stdout(JSON.stringify(release)),
      );
      const n = i === 0 ? 1 : i === 1 ? 2 : 3;
      await runnerWith(exec).closeAgent(runOf(n));
      expect(exec.commands()).toEqual([
        `/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-release --dispatch ctx_00000000000${n} --json`,
      ]);
    }
  });
});

describe("research 0003 contract", () => {
  const worktree = toWorktreeRef("<repoId>::<path>/workspaces/sandbox/fo-verify-w1");

  test("removeWorktree: --force removes an agent's worktree", async () => {
    const exec = new ScriptedExec().orca(
      "worktree rm",
      stdout(research("0003/worktree-rm-force.json")),
    );
    await expect(runnerWith(exec).removeWorktree(worktree)).resolves.toBeUndefined();
  });

  test("removeWorktree: a runtime error is a runner error", async () => {
    const exec = new ScriptedExec().orca(
      "worktree rm",
      stdout(research("0003/worktree-rm-dirty-error.json"), 1),
    );
    expect(await detailOf(runnerWith(exec).removeWorktree(worktree))).toMatchObject({
      kind: "runner-error",
      code: "runtime_error",
    });
  });

  test("checkHealth and worktreeExists: a stopped runtime", async () => {
    const exec = new ScriptedExec()
      .orca("status", stdout(research("0003/status-runtime-off.json")))
      .orca("serve service status", stdout(research("0003/serve-service-status-uninstalled.json")))
      .orca("worktree show", stdout(research("0003/worktree-rm-runtime-off.json"), 1));
    const runner = runnerWith(exec);
    expect(await runner.checkHealth()).toMatchObject({
      online: false,
      error: { kind: "not-ready" },
    });
    expect(await detailOf(runner.worktreeExists(worktree))).toMatchObject({ kind: "not-ready" });
  });
});

describe("research 0004 contract", () => {
  test("listProjects: the registered sandbox project", async () => {
    const exec = new ScriptedExec()
      .orca("project list", stdout(research("0004/project-list.json")))
      .orca("project setups", stdout(research("0004/project-setups.json")));
    expect(await runnerWith(exec).listProjects()).toEqual([
      { id: "github:acme/sandbox", displayName: "sandbox", setupState: "ready" },
    ]);
  });
});
