import type { AppRunDetail, AppRunRefusal, V1HumanCheckDecision } from "@ganger/api";

import type { V1Failure, V1RunActionBody, V1RunFailure, V1RunsClient } from "../connection/client";
import type { DashboardRun } from "../dashboard/model";
import { RunRequestIds } from "./request-ids";

export type RunWrite =
  | { action: "answer"; questionId: string; answer: string }
  | { action: "human-check"; questionId: string; decision: V1HumanCheckDecision; note: string }
  | { action: "deny"; promptId: string; reason: string }
  | { action: "resume" }
  | { action: "cancel" }
  | { action: "retry" }
  | { action: "continue"; message: string };

export type RunWriteOutcome =
  | { kind: "sent" }
  | { kind: "demo" }
  | { kind: "refused"; reason: AppRunRefusal }
  | { kind: "unconfirmed" }
  | { kind: "failed"; cause: "unreachable" | "invalid-request" | "other" };

export const LOST_WRITE_RETRY_MS = 3_000;

export type RunRead<Value> =
  | { kind: "ok"; value: Value }
  | { kind: "demo" }
  | { kind: "not-found" }
  | { kind: "unavailable" };

export interface CachedRunDetail {
  data: AppRunDetail;
  fetchedAt: number;
}

export interface RunPort {
  detail(run: DashboardRun): Promise<RunRead<AppRunDetail>>;
  cachedDetail?(run: DashboardRun): CachedRunDetail | null;
  ticketLink(run: DashboardRun): Promise<RunRead<string>>;
  write(run: DashboardRun, write: RunWrite, onConfirming?: () => void): Promise<RunWriteOutcome>;
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
    case "retry":
    case "continue":
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
    case "retry":
      return { action: write.action, body: { requestId } };
    case "continue":
      return { action: "continue", body: { requestId, message: write.message } };
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

function writeFailure(failure: V1RunFailure): RunWriteOutcome {
  if (failure.kind === "refused") return { kind: "refused", reason: failure.reason };
  if (failure.kind === "invalid-request") return { kind: "failed", cause: "invalid-request" };
  return { kind: "failed", cause: failure.kind === "unreachable" ? "unreachable" : "other" };
}

export interface RunPortSession {
  refresh(): Promise<void>;
  noteFailure(failure: V1Failure): void;
}

function waitBeforeResend(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LOST_WRITE_RETRY_MS));
}

function isDefiniteAnswer(failure: V1RunFailure): boolean {
  return failure.kind === "refused" || failure.kind === "invalid-request";
}

export interface RunDetailCache {
  cachedRun(runId: string): CachedRunDetail | null;
  saveRun(detail: AppRunDetail, fetchedAt: number): void;
  forgetRun(runId: string): void;
}

export function createLiveRunPort(
  client: V1RunsClient,
  session: RunPortSession,
  wait: () => Promise<void> = waitBeforeResend,
  cache: RunDetailCache | null = null,
): RunPort {
  const ids = new RunRequestIds();
  const note = (failure: V1RunFailure) => {
    const relevant = sessionFailure(failure);
    if (relevant !== null) session.noteFailure(relevant);
  };
  return {
    detail: async (run) => {
      const reply = await client.runDetail(run.id);
      if (reply.ok) {
        cache?.saveRun(reply.data, Date.now());
        return { kind: "ok", value: reply.data };
      }
      note(reply.failure);
      const read = readFailure<AppRunDetail>(reply.failure);
      if (read.kind === "not-found") cache?.forgetRun(run.id);
      return read;
    },
    cachedDetail: (run) => cache?.cachedRun(run.id) ?? null,
    ticketLink: async (run) => {
      const reply = await client.ticketLink(run.id);
      if (reply.ok) return { kind: "ok", value: reply.data.url };
      if (reply.failure.kind === "token-rejected") session.noteFailure(reply.failure);
      return readFailure(reply.failure);
    },
    write: async (run, write, onConfirming) => {
      const slot = slotOf(run.id, write);
      let content = JSON.stringify(write);
      if (write.action === "resume") {
        const current = await client.runDetail(run.id);
        if (!current.ok) {
          note(current.failure);
          return writeFailure(current.failure);
        }
        content = JSON.stringify([write, current.data.pausedSince]);
      }
      const requestId = ids.idFor(slot, content);
      const request = requestOf(write, requestId);
      let reply = await client.runAction(run.id, request);
      const lostFirstReply = !reply.ok && reply.failure.kind === "unreachable";
      if (lostFirstReply) {
        onConfirming?.();
        await wait();
        reply = await client.runAction(run.id, request);
      }
      if (reply.ok) {
        ids.forget(slot);
        void session.refresh();
        return { kind: "sent" };
      }
      const { failure } = reply;
      note(failure);
      if (isDefiniteAnswer(failure)) ids.forget(slot);
      if (failure.kind === "refused") void session.refresh();
      if (failure.kind === "incompatible" || (lostFirstReply && !isDefiniteAnswer(failure))) {
        return { kind: "unconfirmed" };
      }
      return writeFailure(failure);
    },
  };
}

function demoInput(run: DashboardRun): AppRunDetail["input"] {
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
    case "unknown":
      return { kind: "unknown" };
  }
}

function demoNextStep(run: DashboardRun): AppRunDetail["nextStep"] {
  switch (run.todoTag) {
    case "question":
    case "permission":
    case "human-check":
    case "disconnected":
    case "failed":
    case "unknown":
      return run.todoTag;
    case "waiting-for-input":
      return "waiting-input";
    case null:
      return run.state === "paused" ? "paused" : "none";
  }
}

export function demoRunDetail(run: DashboardRun): AppRunDetail {
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
    pausedSince: null,
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
    nextActions:
      run.todoTag === "failed"
        ? { retry: "available", continue: "available" }
        : { retry: "not-offered", continue: "not-offered" },
  };
}

export const demoRunPort: RunPort = {
  detail: (run) => Promise.resolve({ kind: "ok", value: demoRunDetail(run) }),
  ticketLink: () => Promise.resolve({ kind: "demo" }),
  write: () => Promise.resolve({ kind: "demo" }),
};
