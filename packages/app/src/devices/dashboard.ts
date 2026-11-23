import { dashboardSchema } from "@ganger/api";
import type { V1Dashboard, V1DashboardRun, V1QueuedReason } from "@ganger/api";
import {
  dashboardBoard,
  limitedRunners,
  prProblemsOf,
  readyAgainInMs,
  runnerIssues,
  todoGroups,
  todoTagOf,
} from "../home/model.js";
import type { HomePage, HomeRun, InputWait, TodoGroupKind } from "../home/model.js";
import { questionSummary } from "../question.js";
import type { QueuedReason } from "../runs/model.js";

type V1Input = Extract<V1DashboardRun, { state: "waiting-for-input" }>["input"];

function toQueuedReason(reason: QueuedReason): V1QueuedReason {
  return reason.kind === "blockers-waiting"
    ? { ...reason, finished: reason.finished ?? [] }
    : reason;
}

function toInput(input: InputWait | null): V1Input | null {
  return input?.kind === "question"
    ? { ...input, summary: questionSummary(input.body, input.choices) }
    : input;
}

function toRun(run: HomeRun): V1DashboardRun {
  const base = {
    id: run.id,
    ticketId: run.ticketId,
    ticketKey: run.ticketKey,
    ticketTitle: run.ticketTitle,
    trackerProject: run.trackerProject,
    workspace: run.workspace,
    runner: run.runner,
    agent: run.agent,
    waitMs: run.waitMs,
    executionMs: run.executionMs,
    pullRequest:
      run.pullRequest === null
        ? null
        : {
            displayId: run.pullRequest.displayId,
            url: run.pullRequest.url,
            problems: prProblemsOf(run.pullRequest.signals),
          },
    cancelling: run.cancelling,
    control: run.control,
    todoTag: todoTagOf(run),
  };
  switch (run.state) {
    case "queued":
      return { ...base, state: run.state, queuedReason: toQueuedReason(run.queuedReason) };
    case "running":
      return { ...base, state: run.state };
    case "paused":
      return { ...base, state: run.state, pausedMs: run.pausedMs, pauseSource: run.pauseSource };
    case "waiting-for-input":
      return { ...base, state: run.state, input: toInput(run.input), waitingMs: run.waitingMs };
    case "disconnected":
      return { ...base, state: run.state, unreachableMs: run.unreachableMs };
    case "ended":
      return {
        ...base,
        state: run.state,
        summary: run.summary,
        agentResult: run.agentResult,
        prState: run.prState,
        prReadError: run.prReadError,
        endedAt: run.endedAt,
        endedAgoMs: run.endedAgoMs,
      };
  }
}

function soonestLimitReset(page: HomePage): number | null {
  const times = limitedRunners(page.runners).flatMap((runner) => {
    const ms = readyAgainInMs(runner);
    return ms === null ? [] : [ms];
  });
  return times.length === 0 ? null : Math.min(...times);
}

export function toV1Dashboard(page: HomePage): V1Dashboard {
  const board = dashboardBoard(page);
  const groups = todoGroups(page.attention);
  const todoCount = (kind: TodoGroupKind) =>
    groups.find((group) => group.kind === kind)?.runs.length ?? 0;
  return dashboardSchema.parse({
    workspace: page.workspace,
    summary: {
      todo: {
        check: todoCount("check"),
        answer: todoCount("answer"),
        stopped: todoCount("stopped"),
      },
      inProgress: page.running.length + page.queued.length,
      limitedRunners: limitedRunners(page.runners).length,
      soonestLimitResetMs: soonestLimitReset(page),
      runnerIssues: runnerIssues(page.runners).length,
    },
    columns: {
      queued: board.queued.map(toRun),
      running: { todo: board.running.todo.map(toRun), rest: board.running.rest.map(toRun) },
      done: { todo: board.done.todo.map(toRun), rest: board.done.rest.map(toRun) },
    },
  });
}
