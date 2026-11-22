import type { V1HumanCheckDecision, V1RunDetail, V1RunRefusal } from "@ganger/api";

import type { V1Failure, V1RunActionBody, V1RunFailure, V1RunsClient } from "../connection/client";
import type { DashboardRun } from "../dashboard/model";
import { RunRequestIds } from "./request-ids";

export type RunWrite =
  | { action: "answer"; questionId: string; answer: string }
  | { action: "human-check"; questionId: string; decision: V1HumanCheckDecision; note: string }
  | { action: "deny"; promptId: string; reason: string }
  | { action: "resume" }
  | { action: "cancel" };

export type RunWriteOutcome =
  | { kind: "sent" }
  | { kind: "demo" }
  | { kind: "refused"; reason: V1RunRefusal }
  | { kind: "failed"; cause: "unreachable" | "invalid-request" | "other" };

export type RunRead<Value> =
  | { kind: "ok"; value: Value }
  | { kind: "demo" }
  | { kind: "not-found" }
  | { kind: "unavailable" };

export interface RunPort {
  detail(run: DashboardRun): Promise<RunRead<V1RunDetail>>;
  ticketLink(run: DashboardRun): Promise<RunRead<string>>;
  write(run: DashboardRun, write: RunWrite): Promise<RunWriteOutcome>;
}

function slotOf(runId: string, write: RunWrite): string {
  switch (write.action) {
    case "answer":
    case "human-check":
      return `${runId}:${write.action}:${write.questionId}`;
    case "deny":
      return `${runId}:deny:${write.promptId}`;
    case "resume":
    case "cancel":
      return `${runId}:${write.action}`;
  }
}

function requestOf(write: RunWrite, requestId: string): V1RunActionBody {
  switch (write.action) {
    case "answer":
      return {
        action: "answer",
        body: { requestId, questionId: write.questionId, answer: write.answer },
      };
    case "human-check":
      return {
        action: "human-check",
        body: {
          requestId,
          questionId: write.questionId,
          decision: write.decision,
          note: write.note,
        },
      };
    case "deny":
      return {
        action: "deny",
        body: { requestId, promptId: write.promptId, reason: write.reason },
      };
    case "resume":
    case "cancel":
      return { action: write.action, body: { requestId } };
  }
}

function sessionFailure(failure: V1RunFailure): V1Failure | null {
  return failure.kind === "refused" || failure.kind === "invalid-request" ? null : failure;
}

function readFailure<Value>(failure: V1RunFailure): RunRead<Value> {
  return failure.kind === "refused" && failure.reason === "not-found"
    ? { kind: "not-found" }
    : { kind: "unavailable" };
}

export interface RunPortSession {
  refresh(): Promise<void>;
  noteFailure(failure: V1Failure): void;
}

export function createLiveRunPort(client: V1RunsClient, session: RunPortSession): RunPort {
  const ids = new RunRequestIds();
  const note = (failure: V1RunFailure) => {
    const relevant = sessionFailure(failure);
    if (relevant !== null) session.noteFailure(relevant);
  };
  return {
    detail: async (run) => {
      const reply = await client.runDetail(run.id);
      if (reply.ok) return { kind: "ok", value: reply.data };
      note(reply.failure);
      return readFailure(reply.failure);
    },
    ticketLink: async (run) => {
      const reply = await client.ticketLink(run.id);
      if (reply.ok) return { kind: "ok", value: reply.data.url };
      note(reply.failure);
      return readFailure(reply.failure);
    },
    write: async (run, write) => {
      const slot = slotOf(run.id, write);
      const requestId = ids.idFor(slot, JSON.stringify(write));
      const reply = await client.runAction(run.id, requestOf(write, requestId));
      if (reply.ok) {
        ids.forget(slot);
        void session.refresh();
        return { kind: "sent" };
      }
      const { failure } = reply;
      note(failure);
      if (failure.kind === "refused") {
        ids.forget(slot);
        void session.refresh();
        return { kind: "refused", reason: failure.reason };
      }
      if (failure.kind === "invalid-request") {
        ids.forget(slot);
        return { kind: "failed", cause: "invalid-request" };
      }
      return { kind: "failed", cause: failure.kind === "unreachable" ? "unreachable" : "other" };
    },
  };
}

function demoInput(run: DashboardRun): V1RunDetail["input"] {
  if (run.state !== "waiting-for-input" || run.input === null) return null;
  const { input } = run;
  switch (input.kind) {
    case "question":
      return {
        kind: "question",
        questionId: input.questionId,
        lead: [input.summary],
        choices: input.choices.map((choice) => ({ text: choice, answer: choice })),
        after: [],
        answered: input.answered,
      };
    case "human-check":
    case "permission":
      return input;
  }
}

function demoNextStep(run: DashboardRun): V1RunDetail["nextStep"] {
  switch (run.todoTag) {
    case "question":
    case "permission":
    case "human-check":
    case "disconnected":
    case "failed":
      return run.todoTag;
    case "waiting-for-input":
      return "waiting-input";
    case null:
      return run.state === "paused" ? "paused" : "none";
  }
}

export function demoRunDetail(run: DashboardRun): V1RunDetail {
  const ended = run.state === "ended" ? run : null;
  return {
    id: run.id,
    ticketKey: run.ticketKey,
    ticketTitle: run.ticketTitle,
    workspace: run.workspace,
    runner: run.runner,
    agent: run.agent,
    state: run.state,
    nextStep: demoNextStep(run),
    cancelling: run.cancelling,
    summary: {
      outcome: ended?.summary ?? null,
      agentResult: ended?.agentResult ?? null,
      report: null,
      startError: null,
    },
    pullRequest:
      run.pullRequest === null
        ? null
        : {
            displayId: run.pullRequest.displayId,
            url: run.pullRequest.url,
            ci: run.pullRequest.problems.some((problem) => problem.kind === "ci-failed")
              ? "failure"
              : "success",
            problems: run.pullRequest.problems,
          },
    input: demoInput(run),
  };
}

export const demoRunPort: RunPort = {
  detail: (run) => Promise.resolve({ kind: "ok", value: demoRunDetail(run) }),
  ticketLink: () => Promise.resolve({ kind: "demo" }),
  write: () => Promise.resolve({ kind: "demo" }),
};
