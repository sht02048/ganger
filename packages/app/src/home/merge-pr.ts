import {
  AdapterError,
  MERGE_METHODS,
  MERGE_REJECTIONS,
  pullRequestRecord,
  toRunActionRequestId,
  toRunId,
} from "@ganger/core";
import type {
  AdapterRegistry,
  CodeHost,
  MergeMethod,
  PullRequestId,
  PullRequestSnapshot,
  RepoRef,
  RunId,
  RunnerProjectId,
} from "@ganger/core";
import {
  getRunWithRecords,
  listCodeHostConnections,
  listRunQuestions,
  recordMergeDenied,
  recordRunActionRequest,
  runActionRequestStatus,
  updateRunRecords,
} from "@ganger/db";
import type { Database, RunActionRequest, RunRecords, SecretBox } from "@ganger/db";
import { z } from "zod";
import { AnswerRejectedError, submitHumanCheckAnswer } from "./actions.js";

export const MERGE_PR_ACTION = "merge-pr";

export const HUMAN_CHECK_MERGED_NOTE = "운영자가 PR을 머지했어요";

export const MERGE_PR_REJECTIONS = [
  ...MERGE_REJECTIONS,
  "no-pull-request",
  "no-code-host",
  "unauthorized",
  "rate-limited",
  "network",
  "request-reused",
] as const;

export type MergePrRejection = (typeof MERGE_PR_REJECTIONS)[number];

export type MergePrResult =
  | { ok: true; method: MergeMethod | null; replayed: boolean }
  | { ok: false; reason: MergePrRejection; message: string | null };

export const mergePrInput = z.object({
  runId: z.string().min(1).max(200),
  method: z.enum(MERGE_METHODS).nullable(),
  requestId: z.string().min(16).max(64),
});

export type MergePrInput = z.infer<typeof mergePrInput>;

export interface MergePrContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
}

const inFlight = new Map<string, Promise<MergePrResult>>();

export function mergeRunPullRequest(
  context: MergePrContext,
  input: MergePrInput,
  now: () => Date,
): Promise<MergePrResult> {
  const key = JSON.stringify([input.runId, input.requestId, input.method]);
  const running = inFlight.get(key);
  if (running !== undefined) return running;
  const merging = mergeOnce(context, input, now).finally(() => inFlight.delete(key));
  inFlight.set(key, merging);
  return merging;
}

function rejected(reason: MergePrRejection, message: string | null = null): MergePrResult {
  return { ok: false, reason, message };
}

async function mergeOnce(
  context: MergePrContext,
  input: MergePrInput,
  now: () => Date,
): Promise<MergePrResult> {
  const { db } = context;
  const runId = toRunId(input.runId);
  const found = getRunWithRecords(db, runId);
  if (found === null) return rejected("not-found");
  const request: RunActionRequest = {
    runId,
    requestId: toRunActionRequestId(input.requestId),
    action: MERGE_PR_ACTION,
    payload: [input.method ?? ""],
  };
  const status = runActionRequestStatus(db, request);
  if (status === "reused") return rejected("request-reused");
  if (status === "handled") return { ok: true, method: input.method, replayed: true };

  const pr = found.records.pullRequest;
  if (pr === null) return rejected("no-pull-request");
  const signals = pr.signals ?? null;
  if (signals !== null && !signals.open) return rejected("not-open");
  const method = input.method ?? signals?.merge?.defaultMethod ?? null;
  const allowed = signals?.merge?.methods;
  if (method !== null && allowed !== undefined && !allowed.includes(method)) {
    return rejected("method-not-allowed");
  }
  const host = codeHostFor(context, found.run.runnerProject);
  if (host === null) return rejected("no-code-host");

  let outcome;
  try {
    outcome = await host.codeHost.mergePullRequest(host.repo, pr.id, {
      method,
      expectedHead: signals?.headCommit ?? null,
    });
  } catch (error) {
    return rejected(remoteFailureOf(error));
  }
  const at = now();
  if (!outcome.ok) {
    if (outcome.reason === "no-write-access") recordMergeDenied(db, runId, at);
    await rereadPullRequest(context, host, runId, pr.id, at, null);
    return rejected(outcome.reason, outcome.message);
  }
  recordRunActionRequest(db, request, at);
  await rereadPullRequest(context, host, runId, pr.id, at, pr);
  answerWaitingHumanCheck(db, runId, at);
  return { ok: true, method, replayed: false };
}

interface FoundCodeHost {
  codeHost: CodeHost;
  repo: RepoRef;
}

function codeHostFor(context: MergePrContext, project: RunnerProjectId): FoundCodeHost | null {
  for (const connection of listCodeHostConnections(context.db, context.secretBox)) {
    let codeHost: CodeHost;
    try {
      codeHost = context.registry.createCodeHost(connection.kind, {
        config: connection.config,
        secrets: connection.secrets,
      });
    } catch {
      continue;
    }
    const repo = codeHost.repoOf(project);
    if (repo !== null) return { codeHost, repo };
  }
  return null;
}

const remoteDetail = z.object({ kind: z.enum(["unauthorized", "rate-limited", "not-found"]) });

function remoteFailureOf(error: unknown): MergePrRejection {
  if (!(error instanceof AdapterError)) return "network";
  const detail = remoteDetail.safeParse(error.detail);
  return detail.success ? detail.data.kind : "network";
}

async function rereadPullRequest(
  context: MergePrContext,
  host: FoundCodeHost,
  runId: RunId,
  prId: PullRequestId,
  at: Date,
  merged: NonNullable<RunRecords["pullRequest"]> | null,
): Promise<void> {
  const operatorMerged = merged === null ? {} : { operatorMergedAt: at.toISOString() };
  const read = await host.codeHost.getPullRequest(host.repo, prId).catch(() => null);
  if (read !== null) {
    updateRunRecords(context.db, runId, {
      pullRequest: pullRequestRecord(read, at, operatorMerged),
    });
    return;
  }
  if (merged === null) return;
  updateRunRecords(context.db, runId, {
    pullRequest: pullRequestRecord(assumedMerged(merged, at), at, operatorMerged),
  });
}

function assumedMerged(
  stored: NonNullable<RunRecords["pullRequest"]>,
  at: Date,
): PullRequestSnapshot {
  const signals = stored.signals ?? null;
  return {
    id: stored.id,
    displayId: stored.displayId,
    url: stored.url,
    title: signals?.title ?? "",
    body: "",
    state: "merged",
    createdAt: at,
    mergedAt: at,
    headBranch: "",
    sourceRepo: null,
    headCommit: signals?.headCommit ?? stored.headCommit ?? "",
    baseBranch: signals?.baseBranch ?? "",
    ci: stored.ci,
    signals: null,
  };
}

function answerWaitingHumanCheck(db: Database, runId: RunId, at: Date): void {
  const waiting = listRunQuestions(db, runId).filter(
    (question) => question.kind === "human-check" && question.answer === null,
  );
  for (const check of waiting) {
    try {
      submitHumanCheckAnswer(
        db,
        { runId, questionId: check.id, decision: "confirmed", note: HUMAN_CHECK_MERGED_NOTE },
        at,
      );
    } catch (error) {
      if (!(error instanceof AnswerRejectedError)) throw error;
    }
  }
}
