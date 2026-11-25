import { toPermissionRequestId, toQuestionId, toWorktreeRef } from "@ganger/core";
import type { RunOnRunner } from "@ganger/core";
import { memoryLogger } from "@ganger/log/testing";
import { describe, expect, test } from "vitest";
import { parseOrcaRunnerConfig } from "./config.js";
import { OrcaRunner } from "./orca-runner.js";
import { escalationQuestionId } from "./progress.js";
import { encodeAgent, encodeMailbox } from "./refs.js";
import type { RemoteResult } from "./ssh.js";
import { ScriptedExec, own, stdout } from "./test-support.js";

const ORCA_RUN = "run_493ebb2f403d";
const DISPATCH = "ctx_a6e6a23a7132";
const TASK_CREATED = Date.parse("2026-11-17T16:07:46Z");

const SAME_RUN_MAILBOX = encodeMailbox({ terminal: "term_mailbox", runId: ORCA_RUN });
const OTHER_RUN_MAILBOX = encodeMailbox({ terminal: "term_mailbox", runId: "run_newer" });

function runOn(mailbox: RunOnRunner["mailbox"]): RunOnRunner {
  return {
    mailbox,
    worktree: toWorktreeRef(
      "527aed9b-0eef-4404-9d8d-9a89d7fb1dc9::<path>/workspaces/sandbox/fo-t0013-probe1",
    ),
    agentRef: encodeAgent({ dispatchId: DISPATCH, taskId: "task_43a3a070dc4c", runId: ORCA_RUN }),
  };
}

const MAILBOXES = [
  { path: "mailbox bound to the run's Orca run", mailbox: SAME_RUN_MAILBOX },
  { path: "mailbox rebound to a newer Orca run", mailbox: OTHER_RUN_MAILBOX },
];

interface Mail {
  id: string;
  type: string;
  subject?: string;
  body?: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function at(secondsAfterTask: number): string {
  return new Date(TASK_CREATED + secondsAfterTask * 1000).toISOString().replace(".000Z", "Z");
}

function endedRunMail(index: number, secondsAfterTask: number): Mail {
  const types = ["worker_done", "question", "escalation", "decision_gate", "status"];
  return {
    id: `msg_old_${String(index).padStart(4, "0")}`,
    type: types[index % types.length] ?? "worker_done",
    body: `mail ${index} of an ended run`,
    payload: { dispatchId: `ctx_ended_${index % 40}`, outcome: "succeeded" },
    created_at: at(secondsAfterTask),
  };
}

function backlog(count: number, firstSecond: number): Mail[] {
  return Array.from({ length: count }, (_, index) => endedRunMail(index, firstSecond + index));
}

const NEW_QUESTION: Mail = {
  id: "msg_new_question",
  type: "question",
  body: "A or B?",
  payload: { dispatchId: DISPATCH, options: ["A", "B"] },
  created_at: at(9000),
};
const NEW_HUMAN_CHECK: Mail = {
  id: "msg_new_gate",
  type: "decision_gate",
  subject: "Human Check",
  body: "Look at the login screen.",
  payload: { dispatchId: DISPATCH },
  created_at: at(9001),
};
const NEW_BLOCKED: Mail = {
  id: "msg_new_blocked",
  type: "escalation",
  subject: "Blocked",
  body: "Need the design file.",
  payload: { dispatchId: DISPATCH },
  created_at: at(9002),
};
const NEW_PERMISSION: Mail = {
  id: "msg_stop_new_permission",
  type: "escalation",
  subject: "Worker is waiting for permission",
  body: "Allow Bash?",
  payload: {
    dispatchId: DISPATCH,
    stopReason: "needs-input",
    approval: {
      approvalId: "apr_new",
      state: "open",
      summary: { title: "Allow Bash?", detail: "touch x" },
    },
  },
  created_at: at(9003),
};
const LOST: Mail = {
  id: "msg_stop_lost",
  type: "escalation",
  subject: "Worker lost without reporting",
  payload: { dispatchId: DISPATCH, stopReason: "lost" },
  created_at: at(9004),
};

function newestFirst(mails: ReadonlyArray<Mail>): Mail[] {
  return [...mails].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function orcaInbox(
  mails: ReadonlyArray<Mail>,
  limits: number[],
): (command: string) => RemoteResult {
  const rows = newestFirst(mails).map((mail) => ({
    ...mail,
    to_handle: `run:${ORCA_RUN}`,
    payload: JSON.stringify(mail.payload),
  }));
  return (command) => {
    const limit = Number(/--limit (\d+)/.exec(command)?.[1]);
    limits.push(limit);
    return stdout(JSON.stringify({ ok: true, result: { messages: rows.slice(0, limit) } }));
  };
}

function polling(mails: ReadonlyArray<Mail>) {
  const limits: number[] = [];
  const exec = new ScriptedExec()
    .orca("orchestration worker-show", stdout(own("worker-show-working.json")))
    .orca("orchestration task-list", stdout(own("task-list-full-dispatched.json")))
    .orca("orchestration inbox", orcaInbox(mails, limits))
    .orca("worktree ps", stdout(own("worktree-ps-agent-wait-working.json")));
  const logger = memoryLogger();
  const runner = new OrcaRunner(parseOrcaRunnerConfig({ sshTarget: "runner.example.com" }), exec, {
    sleep: () => Promise.resolve(),
    logger: () => logger,
  });
  return { exec, runner, logger, limits };
}

function consumingChecks(exec: ScriptedExec): string[] {
  return exec
    .commands()
    .filter((command) => command.includes(" orchestration check ") || command.includes("--ack"));
}

describe.each(MAILBOXES)("mail behind an unread backlog over 100 ($path, 0231)", ({ mailbox }) => {
  test("a new question, Human Check, blocked escalation and permission wait all show", async () => {
    const { exec, runner, limits } = polling([
      ...backlog(104, -86_400),
      ...backlog(150, 60),
      NEW_QUESTION,
      NEW_HUMAN_CHECK,
      NEW_BLOCKED,
      NEW_PERMISSION,
    ]);
    const progress = await runner.pollRun(runOn(mailbox));
    expect(progress).toMatchObject({
      kind: "active",
      questions: [
        { id: escalationQuestionId("msg_new_blocked"), body: "Need the design file." },
        { id: toQuestionId("msg_new_gate"), kind: "human-check" },
        { id: toQuestionId("msg_new_question"), options: ["A", "B"] },
      ],
      permissionWaits: [{ id: toPermissionRequestId("apr_new"), detail: "Allow Bash?: touch x" }],
    });
    expect(limits).toEqual([200]);
    expect(consumingChecks(exec)).toEqual([]);
  });

  test("a question older than the first window is still found, so the run keeps waiting", async () => {
    const { runner, limits, logger } = polling([
      ...backlog(120, -86_400),
      NEW_QUESTION,
      ...backlog(600, 10_000),
    ]);
    const progress = await runner.pollRun(runOn(mailbox));
    expect(progress.kind === "active" && progress.questions.map((q) => q.id)).toEqual([
      toQuestionId("msg_new_question"),
    ]);
    expect(limits).toEqual([200, 800]);
    expect(logger.entries.filter((entry) => entry.level === "warn")).toEqual([]);
  });

  test("a lost escalation behind the backlog ends the run without a report", async () => {
    const { runner } = polling([...backlog(300, -86_400), LOST]);
    expect(await runner.pollRun(runOn(mailbox))).toEqual({
      kind: "ended-without-report",
      detail: "lost: Worker lost without reporting",
    });
  });

  test("a window shorter than its limit is the whole inbox, so the task start is not read", async () => {
    const { exec, runner, limits } = polling([...backlog(150, 60), NEW_QUESTION]);
    const progress = await runner.pollRun(runOn(mailbox));
    expect(progress.kind === "active" && progress.questions.map((q) => q.id)).toEqual([
      toQuestionId("msg_new_question"),
    ]);
    expect(limits).toEqual([200]);
    expect(exec.commands().some((command) => command.includes("task-list"))).toBe(false);
  });

  test("mail that fills the largest window warns instead of missing it quietly", async () => {
    const { runner, limits, logger } = polling([NEW_QUESTION, ...backlog(4000, 10_000)]);
    const progress = await runner.pollRun(runOn(mailbox));
    expect(progress.kind === "active" && progress.questions).toEqual([]);
    expect(limits).toEqual([200, 800, 3200]);
    const warnings = logger.entries.filter((entry) => entry.level === "warn");
    expect(warnings.map(({ event, fields }) => ({ event, fields }))).toEqual([
      {
        event: "runner.mail_window_short",
        fields: { orcaRunId: ORCA_RUN, count: 3200, reason: "newer mail fills the window" },
      },
    ]);
  });
});
