import type { PullRequestSignals, PullRequestSnapshot } from "./adapters.js";

export function pullRequestRecord(
  pr: PullRequestSnapshot,
  checkedAt: Date,
  extra: Pick<PullRequestSignals, "operatorMergedAt"> = {},
) {
  const { id, displayId, url, ci, signals, headCommit } = pr;
  const read = signals ?? (isSettledPr(pr) ? settledSignals(pr) : null);
  return {
    id,
    displayId,
    url,
    ci,
    checkedAt,
    headCommit,
    signals: read === null ? null : { ...read, ...extra },
  };
}

function isSettledPr(pr: PullRequestSnapshot): boolean {
  return pr.state === "merged" || pr.state === "closed";
}

function settledSignals(pr: PullRequestSnapshot): PullRequestSignals {
  const merged = pr.state === "merged";
  return {
    open: false,
    headCommit: pr.headCommit,
    ciFailed: false,
    checkTotal: null,
    failedCount: 0,
    failedChecks: [],
    checksTruncated: false,
    conflict: null,
    behindBy: null,
    title: pr.title,
    baseBranch: pr.baseBranch,
    settled: {
      state: merged ? "merged" : "closed",
      at: ((merged ? pr.mergedAt : pr.closedAt) ?? null)?.toISOString() ?? null,
    },
  };
}
