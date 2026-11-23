import { mentionsTicketKey, toCodeHostKind, toPullRequestId } from "@ganger/core";
import type {
  CiState,
  CodeHost,
  CodeHostErrorDetail,
  CodeHostKind,
  ConnectionCheck,
  MergeOutcome,
  MergePullRequestInput,
  MergeRejection,
  PullRequestId,
  PullRequestSignals,
  PullRequestSnapshot,
  RepoRef,
  RunnerProjectId,
  TicketKey,
} from "@ganger/core";
import { z } from "zod";
import { readCiState } from "./ci.js";
import type { GitHubAuth, GitHubCredential, RepoParts } from "./auth.js";
import { GitHubError, GitHubHttp } from "./http.js";
import type { GraphqlError } from "./http.js";
import {
  PULL_REQUEST_BY_NUMBER,
  PULL_REQUESTS_BY_BRANCH,
  PULL_REQUESTS_BY_SEARCH,
  RATE_LIMIT_ONLY,
  VIEWER,
} from "./queries.js";
import { readPullRequestSignals } from "./pr-signals.js";
import { normalizeRepo, repoOfProject, splitRepo } from "./repo.js";

export const GITHUB_KIND: CodeHostKind = toCodeHostKind("github");

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const pullRequestNode = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  state: z.string(),
  createdAt: isoDate,
  mergedAt: isoDate.nullable(),
  closedAt: isoDate.nullish(),
  headRefName: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
  headRepository: z.object({ nameWithOwner: z.string() }).nullable(),
});
type PullRequestNode = z.infer<typeof pullRequestNode>;

const rateLimit = z.object({
  limit: z.number(),
  remaining: z.number(),
  resetAt: isoDate,
});

const pullRequestNodes = z
  .array(pullRequestNode.nullable())
  .transform((nodes) => nodes.filter((node) => node !== null));

const byBranch = z.object({
  repository: z.object({ pullRequests: z.object({ nodes: pullRequestNodes }) }).nullable(),
});

const bySearch = z.object({
  search: z.object({
    nodes: z
      .array(z.looseObject({ __typename: z.string() }).nullable())
      .transform((nodes) => nodes.filter((node) => node?.__typename === "PullRequest"))
      .pipe(z.array(pullRequestNode.extend({ __typename: z.string() }))),
  }),
});

const byNumber = z.object({
  repository: z.object({ pullRequest: pullRequestNode.nullable() }).nullable(),
});

const viewer = z.object({ viewer: z.object({ login: z.string() }) });
const rateLimitOnly = z.object({ rateLimit });

export interface GitHubCodeHostOptions {
  token?: string | null;
  auth?: GitHubAuth | null;
  fetch?: typeof fetch;
  now?: () => Date;
}

export class GitHubCodeHost implements CodeHost {
  readonly kind: CodeHostKind = GITHUB_KIND;
  private readonly token: string | null;
  private readonly auth: GitHubAuth | null;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly now: (() => Date) | undefined;

  constructor(options: GitHubCodeHostOptions) {
    this.token = options.token ?? null;
    this.auth = options.auth ?? null;
    this.fetchFn = options.fetch;
    this.now = options.now;
  }

  async checkConnection(): Promise<ConnectionCheck<CodeHostErrorDetail>> {
    try {
      await this.call(null, (http) => http.graphql(VIEWER, {}, viewer));
      return { ok: true };
    } catch (error) {
      if (error instanceof GitHubError) return { ok: false, error: error.detail };
      throw error;
    }
  }

  repoOf(project: RunnerProjectId): RepoRef | null {
    return repoOfProject(project);
  }

  async findPullRequestsByBranch(
    repo: RepoRef,
    branch: string,
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    return this.call(this.split(repo), async (http, { owner, name }) => {
      const { data, errors } = await http.graphql(
        PULL_REQUESTS_BY_BRANCH,
        { owner, repo: name, branch },
        byBranch,
      );
      if (data.repository === null) throw repositoryMissing(errors);
      return snapshots(http, owner, name, data.repository.pullRequests.nodes);
    });
  }

  async findPullRequestsByTicketKey(
    repo: RepoRef,
    ticketKey: TicketKey,
    opts: { createdSince: Date },
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    return this.call(this.split(repo), async (http, { owner, name }) => {
      const { data } = await http.graphql(
        PULL_REQUESTS_BY_SEARCH,
        { q: searchQuery(owner, name, ticketKey, opts.createdSince) },
        bySearch,
      );
      const since = opts.createdSince.getTime();
      const nodes = data.search.nodes
        .filter(
          (pr) =>
            pr.createdAt.getTime() >= since &&
            (mentionsTicketKey(pr.title, ticketKey) || mentionsTicketKey(pr.body, ticketKey)),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return snapshots(http, owner, name, nodes);
    });
  }

  async getPullRequest(repo: RepoRef, id: PullRequestId): Promise<PullRequestSnapshot | null> {
    const parts = this.split(repo);
    if (!/^[1-9][0-9]*$/.test(id) || Number(id) > 2_147_483_647) return null;
    return this.call(parts, async (http, { owner, name }) => {
      const { data, errors } = await http.graphql(
        PULL_REQUEST_BY_NUMBER,
        { owner, repo: name, number: Number(id) },
        byNumber,
      );
      if (data.repository === null) throw repositoryMissing(errors);
      const node = data.repository.pullRequest;
      if (node === null) return null;
      const [snapshot] = await snapshots(http, owner, name, [node]);
      return snapshot ?? null;
    });
  }

  async mergePullRequest(
    repo: RepoRef,
    id: PullRequestId,
    input: MergePullRequestInput,
  ): Promise<MergeOutcome> {
    const parts = this.split(repo);
    if (!/^[1-9][0-9]*$/.test(id)) return { ok: false, reason: "not-found", message: null };
    return this.call(parts, async (http, { owner, name }) => {
      const res = await http.put(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${id}/merge`,
        {
          ...(input.method === null ? {} : { merge_method: input.method }),
          ...(input.expectedHead === null ? {} : { sha: input.expectedHead }),
        },
      );
      if (res.status === 200) return { ok: true };
      if (http.isRateLimitedResponse(res) || res.status === 401) throw http.httpError(res);
      const message = messageOf(res.body);
      const reason = mergeRejectionOf(res.status, message);
      if (reason === null) throw http.httpError(res);
      return { ok: false, reason, message };
    });
  }

  async rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date }> {
    return this.call(null, async (http) => {
      const { data } = await http.graphql(RATE_LIMIT_ONLY, {}, rateLimitOnly);
      return data.rateLimit;
    });
  }

  private async credential(repo: RepoParts | null): Promise<GitHubCredential | null> {
    if (this.auth === null) {
      return this.token === null ? null : { token: this.token, source: { kind: "token" } };
    }
    return this.auth.credentialFor(repo, this.token);
  }

  private async call<P extends RepoParts | null, T>(
    repo: P,
    run: (http: GitHubHttp, repo: P) => Promise<T>,
  ): Promise<T> {
    const credential = await this.credential(repo);
    if (credential === null) throw new GitHubError({ kind: "unauthorized" });
    const http = new GitHubHttp({
      token: credential.token,
      ...(this.fetchFn === undefined ? {} : { fetch: this.fetchFn }),
      ...(this.now === undefined ? {} : { now: this.now }),
    });
    try {
      return await run(http, repo);
    } catch (error) {
      if (repo !== null && this.auth !== null && losesAccess(error)) {
        this.auth.forget(repo, credential.source);
      }
      throw error;
    }
  }

  private split(repo: RepoRef): { owner: string; name: string } {
    const parts = splitRepo(repo);
    if (parts === null) throw new GitHubError({ kind: "not-found" });
    return parts;
  }
}

async function snapshots(
  http: GitHubHttp,
  owner: string,
  name: string,
  nodes: ReadonlyArray<PullRequestNode>,
): Promise<PullRequestSnapshot[]> {
  const ci = new Map<string, Promise<CiState>>();
  const ciOf = (sha: string): Promise<CiState> => {
    let state = ci.get(sha);
    if (state === undefined) {
      state = readCiState(http, owner, name, sha);
      ci.set(sha, state);
    }
    return state;
  };
  return Promise.all(
    nodes.map(async (node) => {
      const read =
        node.state === "OPEN" ? await readPullRequestSignals(http, owner, name, node) : null;
      const state = read?.ci ?? (await ciOf(node.headRefOid));
      return toSnapshot(node, state, read?.signals ?? null);
    }),
  );
}

function losesAccess(error: unknown): boolean {
  return (
    error instanceof GitHubError &&
    (error.detail.kind === "unauthorized" || error.detail.kind === "not-found")
  );
}

function toSnapshot(
  node: PullRequestNode,
  ci: CiState,
  signals: PullRequestSignals | null,
): PullRequestSnapshot {
  return {
    id: toPullRequestId(String(node.number)),
    displayId: `#${node.number}`,
    url: node.url,
    title: node.title,
    body: node.body,
    state: toState(node.state),
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    ...(node.closedAt == null ? {} : { closedAt: node.closedAt }),
    headBranch: node.headRefName,
    sourceRepo:
      node.headRepository === null ? null : normalizeRepo(node.headRepository.nameWithOwner),
    headCommit: node.headRefOid,
    baseBranch: node.baseRefName,
    ci,
    signals,
  };
}

function toState(state: string): PullRequestSnapshot["state"] {
  switch (state) {
    case "OPEN":
      return "open";
    case "CLOSED":
      return "closed";
    case "MERGED":
      return "merged";
    default:
      return state.toLowerCase();
  }
}

export function searchQuery(
  owner: string,
  name: string,
  ticketKey: TicketKey,
  createdSince: Date,
): string {
  const seconds = Math.floor(createdSince.getTime() / 1000) * 1000;
  const since = new Date(seconds).toISOString().replace(".000Z", "Z");
  const key = ticketKey.replaceAll('"', "");
  return `repo:${owner}/${name} is:pr "${key}" in:title,body created:>=${since}`;
}

const restMessage = z.object({ message: z.string() });

function messageOf(body: unknown): string | null {
  const parsed = restMessage.safeParse(body);
  return parsed.success ? parsed.data.message : null;
}

function mergeRejectionOf(status: number, message: string | null): MergeRejection | null {
  switch (status) {
    case 403:
      return "no-write-access";
    case 404:
      return "not-found";
    case 405:
      return message !== null && /not allowed on this repository/i.test(message)
        ? "method-not-allowed"
        : "blocked";
    case 409:
      return "head-changed";
    case 422:
      return "blocked";
    default:
      return null;
  }
}

function repositoryMissing(errors: ReadonlyArray<GraphqlError>): GitHubError {
  if (errors.some((e) => e.type === "FORBIDDEN")) return new GitHubError({ kind: "unauthorized" });
  return new GitHubError({ kind: "not-found" });
}
