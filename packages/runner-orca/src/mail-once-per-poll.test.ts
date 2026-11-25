import { toQuestionId, toWorktreeRef } from "@ganger/core";
import type { RunOnRunner, RunProgress } from "@ganger/core";
import { memoryLogger } from "@ganger/log/testing";
import { describe, expect, test } from "vitest";
import { parseOrcaRunnerConfig } from "./config.js";
import { OrcaRunner } from "./orca-runner.js";
import { encodeAgent, encodeMailbox } from "./refs.js";
import type { OrcaAgent } from "./refs.js";
import type { RemoteResult } from "./ssh.js";
import { ScriptedExec, own, stdout } from "./test-support.js";

const SHARED_RUN = "run_shared";
const OTHER_RUN = "run_other";

const EARLY_START = Date.parse("2026-11-24T10:00:00Z");
const MID_START = Date.parse("2026-11-25T05:00:00Z");
const LATE_START = Date.parse("2026-11-25T10:00:00Z");

const EARLY: OrcaAgent = { dispatchId: "ctx_early", taskId: "task_early", runId: SHARED_RUN };
const MID: OrcaAgent = { dispatchId: "ctx_mid", taskId: "task_mid", runId: SHARED_RUN };
const LATE: OrcaAgent = { dispatchId: "ctx_late", taskId: "task_late", runId: SHARED_RUN };
const ELSEWHERE: OrcaAgent = { dispatchId: "ctx_other", taskId: "task_other", runId: OTHER_RUN };

const TASK_STARTS: ReadonlyArray<{ agent: OrcaAgent; start: number }> = [
  { agent: EARLY, start: EARLY_START },
  { agent: MID, start: MID_START },
  { agent: LATE, start: LATE_START },
  { agent: ELSEWHERE, start: MID_START },
];

interface Mail {
  id: string;
  type: string;
  body: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function orcaTime(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

function question(agent: OrcaAgent, at: number): Mail {
  return {
    id: `msg_question_${agent.dispatchId}`,
    type: "question",
    body: `Question from ${agent.dispatchId}?`,
    payload: { dispatchId: agent.dispatchId, options: ["A", "B"] },
    created_at: orcaTime(at),
  };
}

function endedRunMail(count: number, from: number): Mail[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg_ended_${from}_${String(index).padStart(4, "0")}`,
    type: "worker_done",
    body: "done",
    payload: { dispatchId: `ctx_ended_${index % 30}`, outcome: "succeeded" },
    created_at: orcaTime(from + index * 1000),
  }));
}

const HOUR = 3_600_000;

const SMALL_INBOX: Mail[] = [
  ...endedRunMail(50, EARLY_START - HOUR),
  question(EARLY, EARLY_START + HOUR),
  question(MID, MID_START + HOUR),
  question(LATE, LATE_START + HOUR),
];

const EARLY_QUESTION_BEHIND_BACKLOG: Mail[] = [
  question(EARLY, EARLY_START + HOUR),
  ...endedRunMail(300, EARLY_START + 2 * HOUR),
  question(MID, MID_START + HOUR),
  ...endedRunMail(150, LATE_START + 10_000),
  question(LATE, LATE_START + 2 * HOUR),
];

interface FakeOrca {
  inboxes: Record<string, ReadonlyArray<Mail>>;
}

function inboxReply(fake: FakeOrca, reads: string[]): (command: string) => RemoteResult {
  return (command) => {
    const orcaRunId = /--terminal run:(\S+)/.exec(command)?.[1] ?? "";
    const limit = Number(/--limit (\d+)/.exec(command)?.[1]);
    reads.push(`${orcaRunId}:${limit}`);
    const rows = [...(fake.inboxes[orcaRunId] ?? [])]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((mail) => ({
        ...mail,
        to_handle: `run:${orcaRunId}`,
        payload: JSON.stringify(mail.payload),
      }));
    return stdout(JSON.stringify({ ok: true, result: { messages: rows } }));
  };
}

function taskListReply(command: string): RemoteResult {
  const orcaRunId = /--run (\S+)/.exec(command)?.[1] ?? "";
  const tasks = TASK_STARTS.filter(({ agent }) => agent.runId === orcaRunId).map(
    ({ agent, start }) => ({
      id: agent.taskId,
      status: "dispatched",
      result: null,
      created_at: orcaTime(start),
    }),
  );
  return stdout(JSON.stringify({ ok: true, result: { tasks } }));
}

function orcaWith(fake: FakeOrca, workerState = "ready") {
  const reads: string[] = [];
  const workerShow = own("worker-show-working.json").replace(
    '"state": "ready"',
    `"state": "${workerState}"`,
  );
  const exec = new ScriptedExec()
    .orca("orchestration worker-show", stdout(workerShow))
    .orca("orchestration task-list", taskListReply)
    .orca("orchestration inbox", inboxReply(fake, reads))
    .orca("worktree ps", stdout(own("worktree-ps-agent-wait-working.json")));
  const logger = memoryLogger();
  const runner = new OrcaRunner(parseOrcaRunnerConfig({ sshTarget: "runner.example.com" }), exec, {
    sleep: () => Promise.resolve(),
    logger: () => logger,
  });
  return { runner, reads, exec, logger };
}

function runOf(agent: OrcaAgent): RunOnRunner {
  return {
    mailbox: encodeMailbox({ terminal: "term_mailbox", runId: SHARED_RUN }),
    worktree: toWorktreeRef(
      "527aed9b-0eef-4404-9d8d-9a89d7fb1dc9::<path>/workspaces/sandbox/fo-t0013-probe1",
    ),
    agentRef: encodeAgent(agent),
  };
}

async function eachAlone(
  fake: FakeOrca,
  agents: ReadonlyArray<OrcaAgent>,
  workerState = "ready",
): Promise<{ progress: RunProgress[]; reads: string[] }> {
  const progress: RunProgress[] = [];
  const reads: string[] = [];
  for (const agent of agents) {
    const alone = orcaWith(fake, workerState);
    progress.push(await alone.runner.pollRun(runOf(agent)));
    reads.push(...alone.reads);
  }
  return { progress, reads };
}

async function inOneCycle(
  runner: OrcaRunner,
  declared: ReadonlyArray<OrcaAgent>,
  polled: ReadonlyArray<OrcaAgent> = declared,
): Promise<RunProgress[]> {
  runner.beginPollCycle(declared.map((agent) => encodeAgent(agent)));
  const progress: RunProgress[] = [];
  try {
    for (const agent of polled) progress.push(await runner.pollRun(runOf(agent)));
  } finally {
    runner.endPollCycle();
  }
  return progress;
}

function questionIds(progress: RunProgress): string[] {
  return progress.kind === "active" ? progress.questions.map((q) => q.id) : [];
}

describe("one Orca inbox read per poll cycle (0232)", () => {
  test("three runs in the same Orca run read the inbox once and each gets the same mail as alone", async () => {
    const fake = { inboxes: { [SHARED_RUN]: SMALL_INBOX } };
    const { runner, reads } = orcaWith(fake);
    const shared = await inOneCycle(runner, [LATE, MID, EARLY]);
    expect(reads).toEqual([`${SHARED_RUN}:200`]);
    expect(shared).toEqual((await eachAlone(fake, [LATE, MID, EARLY])).progress);
    expect(shared.map(questionIds)).toEqual([
      [toQuestionId("msg_question_ctx_late")],
      [toQuestionId("msg_question_ctx_mid")],
      [toQuestionId("msg_question_ctx_early")],
    ]);
  });

  test("the window grows to the earliest task start of the cycle even when a later run polls first", async () => {
    const fake = { inboxes: { [SHARED_RUN]: EARLY_QUESTION_BEHIND_BACKLOG } };
    const alone = await eachAlone(fake, [LATE, MID, EARLY]);
    expect(alone.reads).toEqual([
      `${SHARED_RUN}:200`,
      `${SHARED_RUN}:200`,
      `${SHARED_RUN}:200`,
      `${SHARED_RUN}:800`,
    ]);

    const { runner, reads, exec, logger } = orcaWith(fake);
    const shared = await inOneCycle(runner, [LATE, MID, EARLY]);
    expect(reads).toEqual([`${SHARED_RUN}:200`, `${SHARED_RUN}:800`]);
    expect(exec.commands().filter((command) => command.includes("task-list"))).toHaveLength(1);
    expect(shared).toEqual(alone.progress);
    expect(shared.map(questionIds)[2]).toEqual([toQuestionId("msg_question_ctx_early")]);
    expect(logger.entries.filter((entry) => entry.level === "warn")).toEqual([]);
  });

  test("a run that was not declared still widens the shared window to its own task start", async () => {
    const fake = { inboxes: { [SHARED_RUN]: EARLY_QUESTION_BEHIND_BACKLOG } };
    const { runner, reads } = orcaWith(fake);
    const shared = await inOneCycle(runner, [LATE, MID], [LATE, MID, EARLY]);
    expect(reads).toEqual([`${SHARED_RUN}:200`, `${SHARED_RUN}:800`]);
    expect(shared).toEqual((await eachAlone(fake, [LATE, MID, EARLY])).progress);
    expect(shared.map(questionIds)[2]).toEqual([toQuestionId("msg_question_ctx_early")]);
  });

  test("runs in another Orca run read their own inbox", async () => {
    const fake = {
      inboxes: {
        [SHARED_RUN]: SMALL_INBOX,
        [OTHER_RUN]: [question(ELSEWHERE, MID_START + HOUR)],
      },
    };
    const { runner, reads } = orcaWith(fake);
    const shared = await inOneCycle(runner, [LATE, ELSEWHERE, MID]);
    expect(reads).toEqual([`${SHARED_RUN}:200`, `${OTHER_RUN}:200`]);
    expect(shared).toEqual((await eachAlone(fake, [LATE, ELSEWHERE, MID])).progress);
    expect(shared.map(questionIds)[1]).toEqual([toQuestionId("msg_question_ctx_other")]);
  });

  test("the next cycle reads the inbox again and sees mail that came between cycles", async () => {
    const inboxes: Record<string, ReadonlyArray<Mail>> = {
      [SHARED_RUN]: endedRunMail(10, EARLY_START - HOUR),
    };
    const fake = { inboxes };
    const { runner, reads } = orcaWith(fake);
    const first = await inOneCycle(runner, [LATE, MID]);
    inboxes[SHARED_RUN] = [...(inboxes[SHARED_RUN] ?? []), question(LATE, LATE_START + HOUR)];
    const second = await inOneCycle(runner, [LATE, MID]);
    expect(reads).toEqual([`${SHARED_RUN}:200`, `${SHARED_RUN}:200`]);
    expect(first.map(questionIds)).toEqual([[], []]);
    expect(second.map(questionIds)).toEqual([[toQuestionId("msg_question_ctx_late")], []]);
  });

  test("busy workers still read their task each poll but share one inbox window", async () => {
    const fake = { inboxes: { [SHARED_RUN]: EARLY_QUESTION_BEHIND_BACKLOG } };
    const { runner, reads, exec } = orcaWith(fake, "dispatched");
    const shared = await inOneCycle(runner, [LATE, MID, EARLY]);
    expect(reads).toEqual([`${SHARED_RUN}:200`, `${SHARED_RUN}:800`]);
    expect(exec.commands().filter((command) => command.includes("task-list"))).toHaveLength(3);
    expect(shared).toEqual((await eachAlone(fake, [LATE, MID, EARLY], "dispatched")).progress);
    expect(shared.map(questionIds)[2]).toEqual([toQuestionId("msg_question_ctx_early")]);
  });

  test("a shared window capped at 3200 rows is read once and warns for each run", async () => {
    const fake = {
      inboxes: {
        [SHARED_RUN]: [
          question(EARLY, EARLY_START + HOUR),
          ...endedRunMail(4000, LATE_START + HOUR),
        ],
      },
    };
    const { runner, reads, logger } = orcaWith(fake);
    const shared = await inOneCycle(runner, [LATE, MID, EARLY]);
    expect(reads).toEqual([`${SHARED_RUN}:200`, `${SHARED_RUN}:800`, `${SHARED_RUN}:3200`]);
    expect(shared).toEqual((await eachAlone(fake, [LATE, MID, EARLY])).progress);
    expect(
      logger.entries
        .filter((entry) => entry.level === "warn")
        .map(({ event, fields }) => ({ event, fields })),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        event: "runner.mail_window_short",
        fields: { orcaRunId: SHARED_RUN, count: 3200, reason: "newer mail fills the window" },
      })),
    );
  });

  test("polls outside a cycle read the inbox every time", async () => {
    const { runner, reads } = orcaWith({ inboxes: { [SHARED_RUN]: SMALL_INBOX } });
    await runner.pollRun(runOf(LATE));
    await runner.pollRun(runOf(MID));
    expect(reads).toEqual([`${SHARED_RUN}:200`, `${SHARED_RUN}:200`]);
  });
});
