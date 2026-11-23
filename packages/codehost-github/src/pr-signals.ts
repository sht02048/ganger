import type {
  CiState,
  MergeBlock,
  MergeMethod,
  PullRequestCommit,
  PullRequestMergeInfo,
  PullRequestSignals,
} from "@ganger/core";
import { z } from "zod";
import type { GitHubHttp } from "./http.js";
import { PULL_REQUEST_COMMITS_PAGE, PULL_REQUEST_SIGNALS } from "./queries.js";

const checkContext = z.object({
  __typename: z.string(),
  name: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  context: z.string().optional(),
  state: z.string().optional(),
});
type CheckContext = z.infer<typeof checkContext>;

const rollup = z.object({
  state: z.string(),
  contexts: z.object({
    totalCount: z.number().int().nonnegative(),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    nodes: z.array(checkContext.nullable()),
  }),
});

const historyCommit = z.object({
  oid: z.string(),
  url: z.string(),
  message: z.string(),
  committedDate: z.iso.datetime({ offset: true }),
  author: z
    .object({
      name: z.string().nullable(),
      user: z.object({ login: z.string() }).nullable(),
    })
    .nullable(),
});
type HistoryCommit = z.infer<typeof historyCommit>;

const commitHistory = z.object({
  totalCount: z.number().int().nonnegative(),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  nodes: z.array(z.object({ commit: historyCommit }).nullable()),
});
type CommitHistory = z.infer<typeof commitHistory>;

export const pullRequestCommitsPageResponse = z.object({
  repository: z.object({ pullRequest: z.object({ history: commitHistory }) }),
});

export const pullRequestSignalsResponse = z.object({
  repository: z.object({
    mergeCommitAllowed: z.boolean().optional(),
    squashMergeAllowed: z.boolean().optional(),
    rebaseMergeAllowed: z.boolean().optional(),
    viewerDefaultMergeMethod: z.string().optional(),
    viewerPermission: z.string().nullish(),
    pullRequest: z.object({
      state: z.string(),
      mergeable: z.string(),
      mergeStateStatus: z.string().optional(),
      isDraft: z.boolean().optional(),
      title: z.string(),
      baseRefName: z.string(),
      history: commitHistory,
      baseRef: z
        .object({
          compare: z.object({ behindBy: z.number().int().nonnegative() }).nullable(),
        })
        .nullable(),
      commits: z.object({
        nodes: z.array(
          z
            .object({ commit: z.object({ oid: z.string(), statusCheckRollup: rollup.nullable() }) })
            .nullable(),
        ),
      }),
    }),
  }),
});
type SignalsResponse = z.infer<typeof pullRequestSignalsResponse>;

export interface PullRequestSignalsRead {
  ci: CiState | null;
  signals: PullRequestSignals;
}

const FAILED_CHECK_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
const FAILED_STATUS_STATES = new Set(["FAILURE", "ERROR"]);
const MAX_LATER_COMMIT_PAGES = 9;

export async function readPullRequestSignals(
  http: GitHubHttp,
  owner: string,
  name: string,
  pr: { number: number; headRefOid: string },
): Promise<PullRequestSignalsRead | null> {
  try {
    const { data } = await http.graphql(
      PULL_REQUEST_SIGNALS,
      { owner, repo: name, number: pr.number, head: pr.headRefOid },
      pullRequestSignalsResponse,
    );
    if (!headMatches(data, pr.headRefOid)) return null;
    const laterPages = await readLaterCommitPages(
      http,
      { owner, name, number: pr.number },
      data.repository.pullRequest.history,
    );
    return toSignalsRead(data, pr.headRefOid, laterPages);
  } catch {
    return null;
  }
}

async function readLaterCommitPages(
  http: GitHubHttp,
  pr: { owner: string; name: string; number: number },
  first: CommitHistory,
): Promise<CommitHistory[] | null> {
  const pages: CommitHistory[] = [];
  let pageInfo = first.pageInfo;
  while (pageInfo.hasNextPage && pageInfo.endCursor !== null) {
    if (pages.length >= MAX_LATER_COMMIT_PAGES) break;
    const read = await http
      .graphql(
        PULL_REQUEST_COMMITS_PAGE,
        { owner: pr.owner, repo: pr.name, number: pr.number, after: pageInfo.endCursor },
        pullRequestCommitsPageResponse,
      )
      .catch(() => null);
    if (read === null) return null;
    const page = read.data.repository.pullRequest.history;
    pages.push(page);
    pageInfo = page.pageInfo;
  }
  return pages;
}

function headMatches(data: SignalsResponse, headCommit: string): boolean {
  return data.repository.pullRequest.commits.nodes.at(-1)?.commit.oid === headCommit;
}

export function toSignalsRead(
  data: SignalsResponse,
  headCommit: string,
  laterPages: ReadonlyArray<CommitHistory> | null = [],
): PullRequestSignalsRead | null {
  const pr = data.repository.pullRequest;
  const commit = pr.commits.nodes.at(-1)?.commit;
  if (commit?.oid !== headCommit) return null;
  const checks = commit.statusCheckRollup;
  const open = pr.state === "OPEN";
  const failed = checks === null ? [] : failedNames(checks.contexts.nodes);
  const ci = checks === null ? null : ciOfRollup(checks.state);
  return {
    ci,
    signals: {
      open,
      headCommit,
      ciFailed: ci === "failure" || failed.length > 0,
      checkTotal: checks?.contexts.totalCount ?? null,
      failedCount: failed.length,
      failedChecks: [...new Set(failed)],
      checksTruncated: checks?.contexts.pageInfo.hasNextPage ?? false,
      conflict: open ? conflictOf(pr.mergeable) : null,
      behindBy: open ? (pr.baseRef?.compare?.behindBy ?? null) : null,
      title: pr.title,
      baseBranch: pr.baseRefName,
      ...(laterPages === null ? {} : { commits: newestFirst([pr.history, ...laterPages]) }),
      ...mergeInfoOf(data.repository),
    },
  };
}

const MERGE_METHOD_NAMES: Record<string, MergeMethod> = {
  SQUASH: "squash",
  MERGE: "merge",
  REBASE: "rebase",
};

const WRITE_PERMISSIONS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);
const READ_PERMISSIONS = new Set(["READ", "TRIAGE"]);

function mergeInfoOf(
  repo: SignalsResponse["repository"],
): { merge: PullRequestMergeInfo } | Record<string, never> {
  if (
    repo.squashMergeAllowed === undefined ||
    repo.mergeCommitAllowed === undefined ||
    repo.rebaseMergeAllowed === undefined
  ) {
    return {};
  }
  const methods: MergeMethod[] = [
    ...(repo.squashMergeAllowed ? (["squash"] as const) : []),
    ...(repo.mergeCommitAllowed ? (["merge"] as const) : []),
    ...(repo.rebaseMergeAllowed ? (["rebase"] as const) : []),
  ];
  const named = MERGE_METHOD_NAMES[repo.viewerDefaultMergeMethod ?? ""];
  const defaultMethod =
    named !== undefined && methods.includes(named) ? named : (methods[0] ?? null);
  return {
    merge: {
      methods,
      defaultMethod,
      blocked: mergeBlockOf(repo.pullRequest),
      canWrite: canWriteOf(repo.viewerPermission ?? null),
    },
  };
}

function mergeBlockOf(pr: SignalsResponse["repository"]["pullRequest"]): MergeBlock | null {
  if (pr.state !== "OPEN") return null;
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") return "conflict";
  if (pr.isDraft === true || pr.mergeStateStatus === "DRAFT") return "draft";
  if (pr.mergeStateStatus === "BEHIND") return "behind";
  if (pr.mergeStateStatus === "BLOCKED") return "rules";
  return null;
}

function canWriteOf(permission: string | null): boolean | null {
  if (permission === null) return null;
  if (WRITE_PERMISSIONS.has(permission)) return true;
  return READ_PERMISSIONS.has(permission) ? false : null;
}

function newestFirst(pages: ReadonlyArray<CommitHistory>): PullRequestCommit[] {
  return pages
    .flatMap((page) => page.nodes)
    .flatMap((node) => (node === null ? [] : [toCommit(node.commit)]))
    .reverse();
}

function toCommit(commit: HistoryCommit): PullRequestCommit {
  return {
    oid: commit.oid,
    url: commit.url,
    headline: commit.message.split(/\r?\n/, 1)[0] ?? "",
    author: commit.author?.user?.login ?? commit.author?.name ?? null,
    committedAt: commit.committedDate,
  };
}

function ciOfRollup(state: string): CiState {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "unavailable";
  }
}

function conflictOf(mergeable: string): boolean | null {
  if (mergeable === "CONFLICTING") return true;
  return mergeable === "MERGEABLE" ? false : null;
}

function failedNames(nodes: ReadonlyArray<CheckContext | null>): string[] {
  return nodes.flatMap((node) => {
    if (node?.__typename === "CheckRun" && node.name !== undefined) {
      return FAILED_CHECK_CONCLUSIONS.has(node.conclusion ?? "") ? [node.name] : [];
    }
    if (node?.__typename === "StatusContext" && node.context !== undefined) {
      return FAILED_STATUS_STATES.has(node.state ?? "") ? [node.context] : [];
    }
    return [];
  });
}
