import {
  AdapterRegistry,
  decidePrState,
  toCodeHostKind,
  toPullRequestId,
  toRepoRef,
  toRunnerProjectId,
  toTicketKey,
} from "@ganger/core";
import { describe, expect, it } from "vitest";
import { summarizeRuns } from "./ci.js";
import { GitHubCodeHost, searchQuery } from "./github.js";
import { GitHubError } from "./http.js";
import { createGitHubCodeHostFactory } from "./index.js";
import { fakeFetch, fixture, researchFixture, route } from "./test-support.js";
import type { Recorded, SentRequest } from "./test-support.js";

const repo = toRepoRef("acme/app");
const NOW = new Date("2026-11-17T16:00:00Z");

function host(handler: (req: SentRequest) => Recorded | Error) {
  const fake = fakeFetch(handler);
  return {
    codeHost: new GitHubCodeHost({ token: "test-token", fetch: fake.fetch, now: () => NOW }),
    sent: fake.sent,
  };
}

function actionsRequests(sent: ReadonlyArray<SentRequest>): SentRequest[] {
  return sent.filter((r) => r.url.includes("/actions/runs"));
}

function withRuns(runs: Array<{ status: string | null; conclusion: string | null }>): Recorded {
  const base = fixture("actions-runs-success");
  return { ...base, body: { total_count: runs.length, workflow_runs: runs } };
}

function addFields(
  recorded: Recorded,
  pick: (body: unknown) => Array<Record<string, unknown>>,
  extra: (node: Record<string, unknown>) => Record<string, unknown>,
): Recorded {
  const body: unknown = structuredClone(recorded.body);
  for (const node of pick(body)) Object.assign(node, extra(node));
  return { ...recorded, body };
}

function nodesAt(...path: string[]): (body: unknown) => Array<Record<string, unknown>> {
  return (body) => {
    let cur: unknown = body;
    for (const key of path) {
      cur = typeof cur === "object" && cur !== null ? Reflect.get(cur, key) : undefined;
    }
    return Array.isArray(cur)
      ? cur.filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
      : [];
  };
}

describe("브랜치로 PR 찾기", () => {
  it("PR이 없으면 빈 목록이고 CI를 읽지 않는다", async () => {
    const { codeHost, sent } = host(route({ graphql: fixture("by-branch-none") }));

    expect(await codeHost.findPullRequestsByBranch(repo, "factory/ENG-999-1")).toEqual([]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers["authorization"]).toBe("bearer test-token");
    expect(sent[0]?.graphql?.variables).toEqual({
      owner: "acme",
      repo: "app",
      branch: "factory/ENG-999-1",
    });
  });

  it("같은 브랜치의 PR이 여럿이면 최신순으로 모두 돌려주고, 같은 커밋의 CI는 한 번만 읽는다", async () => {
    const { codeHost, sent } = host(
      route({ graphql: fixture("by-branch-multiple"), actions: fixture("actions-runs-success") }),
    );

    const prs = await codeHost.findPullRequestsByBranch(repo, "factory/ENG-130-1");

    expect(prs.map((p) => [p.displayId, p.state])).toEqual([
      ["#19", "open"],
      ["#18", "closed"],
    ]);
    expect(prs[0]).toEqual({
      id: toPullRequestId("19"),
      displayId: "#19",
      url: "https://github.com/acme/app/pull/19",
      title: "ENG-130: second attempt",
      body: "Second PR on the same branch after closing the first.",
      state: "open",
      createdAt: new Date("2026-11-17T16:06:25Z"),
      mergedAt: null,
      headBranch: "factory/ENG-130-1",
      sourceRepo: repo,
      headCommit: "3333333333333333333333333333333333333333",
      baseBranch: "main",
      ci: "success",
      signals: null,
    });
    const actions = actionsRequests(sent);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.url).toBe(
      "https://api.github.com/repos/acme/app/actions/runs?head_sha=3333333333333333333333333333333333333333&per_page=100",
    );
  });

  it("브랜치 이름을 바꿔 닫힌 PR을 닫힘으로 돌려준다(0012 응답)", async () => {
    const renamed = addFields(
      researchFixture("pr-by-branch-after-rename"),
      nodesAt("data", "repository", "pullRequests", "nodes"),
      () => ({ title: "ENG-126: add g", body: "", createdAt: "2026-11-17T12:39:00Z" }),
    );
    const { codeHost } = host(route({ graphql: renamed, actions: fixture("actions-runs-none") }));

    const prs = await codeHost.findPullRequestsByBranch(repo, "factory/ENG-126-1");

    expect(prs.map((p) => [p.displayId, p.state, p.headBranch, p.ci])).toEqual([
      ["#7", "closed", "factory/ENG-126-1", "none"],
    ]);
  });

  it("head 저장소 이름을 소문자로 맞추고, 포크에서 온 PR은 core가 거른다", async () => {
    const fork = addFields(
      fixture("by-branch-multiple"),
      nodesAt("data", "repository", "pullRequests", "nodes"),
      (node) =>
        node["number"] === 19
          ? { isCrossRepository: true, headRepository: { nameWithOwner: "Someone/App" } }
          : { headRepository: { nameWithOwner: "Acme/App" } },
    );
    const { codeHost } = host(route({ graphql: fork, actions: fixture("actions-runs-success") }));

    const prs = await codeHost.findPullRequestsByBranch(repo, "factory/ENG-130-1");

    expect(prs.map((p) => p.sourceRepo)).toEqual([toRepoRef("someone/app"), repo]);
    const decision = decidePrState({
      repo,
      ticketKey: toTicketKey("ENG-130"),
      runStartedAt: new Date("2026-11-17T16:00:00Z"),
      byBranch: prs,
      byTicketKey: [],
    });
    expect(decision.pr?.displayId).toBe("#18");
  });
});

describe("티켓 키로 PR 찾기", () => {
  const key = toTicketKey("ENG-123");

  it("ISSUE_ADVANCED 검색에 따옴표 친 키와 초 단위 시각을 보낸다", async () => {
    const { codeHost, sent } = host(
      route({ graphql: fixture("by-search"), actions: fixture("actions-runs-none") }),
    );

    await codeHost.findPullRequestsByTicketKey(repo, key, {
      createdSince: new Date("2026-11-17T12:37:10.500Z"),
    });

    expect(sent[0]?.graphql?.query).toContain("type: ISSUE_ADVANCED");
    expect(sent[0]?.graphql?.variables).toEqual({
      q: 'repo:acme/app is:pr "ENG-123" in:title,body created:>=2026-11-17T12:37:10Z',
    });
  });

  it("키가 제목이나 본문에 있는 PR을 최신순으로 돌려주고, createdSince 전에 만든 PR은 뺀다", async () => {
    const { codeHost } = host(
      route({ graphql: fixture("by-search"), actions: fixture("actions-runs-none") }),
    );

    const all = await codeHost.findPullRequestsByTicketKey(repo, key, {
      createdSince: new Date("2026-11-17T00:00:00Z"),
    });
    const late = await codeHost.findPullRequestsByTicketKey(repo, key, {
      createdSince: new Date("2026-11-17T12:37:10Z"),
    });

    expect(all.map((p) => p.displayId)).toEqual(["#6", "#1"]);
    expect(late.map((p) => p.displayId)).toEqual(["#6"]);
  });

  it("검색이 낱말로 쪼개 잡은 거짓 양성을 낱말 경계로 다시 걸러 낸다(0012 ISSUE 응답)", async () => {
    const tokenMatch = addFields(
      researchFixture("search-by-key-issue-token-match"),
      nodesAt("data", "search", "nodes"),
      () => ({ __typename: "PullRequest", headRefOid: "7".repeat(40), mergedAt: null }),
    );
    const { codeHost } = host(
      route({ graphql: tokenMatch, actions: fixture("actions-runs-none") }),
    );

    const prs = await codeHost.findPullRequestsByTicketKey(repo, key, {
      createdSince: new Date("2026-11-17T00:00:00Z"),
    });

    expect(prs.map((p) => p.displayId)).toEqual(["#6", "#1"]);
  });

  it("0012의 ISSUE_ADVANCED 응답에서 본문에만 키가 있는 PR도 돌려주고, core가 제목의 키를 먼저 고른다", async () => {
    const advanced = addFields(
      researchFixture("search-by-key-advanced"),
      nodesAt("data", "search", "nodes"),
      () => ({ __typename: "PullRequest", headRefOid: "7".repeat(40), mergedAt: null }),
    );
    const { codeHost } = host(route({ graphql: advanced, actions: fixture("actions-runs-none") }));
    const runStartedAt = new Date("2026-11-17T12:37:00Z");

    const prs = await codeHost.findPullRequestsByTicketKey(repo, key, {
      createdSince: runStartedAt,
    });

    expect(prs.map((p) => p.displayId)).toEqual(["#6", "#1"]);
    expect(
      decidePrState({ repo, ticketKey: key, runStartedAt, byBranch: [], byTicketKey: prs }).pr
        ?.displayId,
    ).toBe("#1");
  });

  it("목록의 null 노드는 버린다", async () => {
    const withNull = fixture("by-branch-multiple");
    const nodes: unknown = Reflect.get(
      Reflect.get(
        Reflect.get(Reflect.get(Object(withNull.body), "data"), "repository"),
        "pullRequests",
      ),
      "nodes",
    );
    if (!Array.isArray(nodes)) throw new Error("fixture shape");
    nodes.push(null);
    const { codeHost } = host(route({ graphql: withNull, actions: fixture("actions-runs-none") }));

    expect(await codeHost.findPullRequestsByBranch(repo, "factory/ENG-130-1")).toHaveLength(2);
  });

  it("PR이 아닌 검색 노드는 버린다", async () => {
    const withIssue = fixture("by-search");
    const search: unknown = Reflect.get(Reflect.get(Object(withIssue.body), "data"), "search");
    const nodes: unknown = Reflect.get(Object(search), "nodes");
    if (!Array.isArray(nodes)) throw new Error("fixture shape");
    expect(nodes).toHaveLength(2);
    nodes.push({ __typename: "Issue", number: 99, title: "ENG-123 issue" }, null);
    const { codeHost } = host(route({ graphql: withIssue, actions: fixture("actions-runs-none") }));

    const prs = await codeHost.findPullRequestsByTicketKey(repo, key, {
      createdSince: new Date("2026-11-17T00:00:00Z"),
    });

    expect(prs).toHaveLength(2);
  });

  it("키의 따옴표는 검색 문법을 깨지 않게 뺀다", () => {
    expect(
      searchQuery("acme", "app", toTicketKey('EN"G-1'), new Date("2026-11-17T00:00:00Z")),
    ).toBe('repo:acme/app is:pr "ENG-1" in:title,body created:>=2026-11-17T00:00:00Z');
  });
});

describe("PR 번호로 조회", () => {
  it("병합된 PR을 병합됨으로 돌려준다", async () => {
    const { codeHost, sent } = host(
      route({ graphql: fixture("by-number-merged"), actions: fixture("actions-runs-none") }),
    );

    const pr = await codeHost.getPullRequest(repo, toPullRequestId("16"));

    expect(pr).toMatchObject({
      id: "16",
      state: "merged",
      mergedAt: new Date("2026-11-17T13:16:55Z"),
      headBranch: "factory/ENG-131-2",
      headCommit: "4".repeat(40),
    });
    expect(sent[0]?.graphql?.variables).toEqual({ owner: "acme", repo: "app", number: 16 });
  });

  it("열린 PR을 열림으로 돌려준다", async () => {
    const { codeHost } = host(
      route({ graphql: fixture("by-number"), actions: fixture("actions-runs-success") }),
    );

    expect(await codeHost.getPullRequest(repo, toPullRequestId("19"))).toMatchObject({
      state: "open",
      ci: "success",
    });
  });

  it("그 번호의 PR이 없으면 null이다", async () => {
    const { codeHost } = host(route({ graphql: fixture("by-number-missing") }));

    expect(await codeHost.getPullRequest(repo, toPullRequestId("99999"))).toBeNull();
  });

  it("PR 번호가 아닌 ID는 요청하지 않고 null이다", async () => {
    const { codeHost, sent } = host(route({ graphql: fixture("by-number") }));

    expect(await codeHost.getPullRequest(repo, toPullRequestId("PR_kwDO"))).toBeNull();
    expect(await codeHost.getPullRequest(repo, toPullRequestId("99999999999"))).toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe("CI 상태", () => {
  async function ciWith(actions: Recorded | Error) {
    const { codeHost } = host(route({ graphql: fixture("by-number"), actions }));
    return codeHost.getPullRequest(repo, toPullRequestId("19"));
  }

  it("Actions 읽기 권한이 없어 404가 오면 볼 수 없음이고, PR 상태는 그대로 정해진다", async () => {
    const pr = await ciWith(fixture("actions-runs-private-fine"));

    expect(pr?.ci).toBe("unavailable");
    expect(pr?.state).toBe("open");
    expect(
      decidePrState({
        repo,
        ticketKey: toTicketKey("ENG-130"),
        runStartedAt: new Date("2026-11-17T16:00:00Z"),
        byBranch: pr === null ? [] : [pr],
        byTicketKey: [],
      }).prState,
    ).toBe("open");
  });

  it("권한 오류(403), rate limit, 연결 실패도 볼 수 없음으로 돌려주고 던지지 않는다", async () => {
    const forbidden: Recorded = {
      status: 403,
      headers: { "x-accepted-github-permissions": "actions=read" },
      body: { message: "Resource not accessible by personal access token" },
    };
    expect((await ciWith(forbidden))?.ci).toBe("unavailable");
    expect((await ciWith(fixture("rest-rate-limited")))?.ci).toBe("unavailable");
    expect((await ciWith(new TypeError("fetch failed")))?.ci).toBe("unavailable");
  });

  it("워크플로 런이 없으면 CI 없음이다", async () => {
    expect((await ciWith(fixture("actions-runs-none")))?.ci).toBe("none");
  });

  it("끝나지 않은 런이 있으면 pending, 통과하지 못한 런이 있으면 failure다", async () => {
    expect((await ciWith(withRuns([{ status: "in_progress", conclusion: null }])))?.ci).toBe(
      "pending",
    );
    expect(
      (
        await ciWith(
          withRuns([
            { status: "completed", conclusion: "success" },
            { status: "completed", conclusion: "failure" },
          ]),
        )
      )?.ci,
    ).toBe("failure");
  });

  it.each([
    [[], "none"],
    [[{ status: "completed", conclusion: "success" }], "success"],
    [
      [
        { status: "completed", conclusion: "skipped" },
        { status: "completed", conclusion: "neutral" },
      ],
      "success",
    ],
    [[{ status: "queued", conclusion: null }], "pending"],
    [[{ status: "waiting", conclusion: null }], "pending"],
    [[{ status: "some_new_status", conclusion: null }], "pending"],
    [[{ status: "completed", conclusion: "stale" }], "pending"],
    [[{ status: "completed", conclusion: "some_new_conclusion" }], "pending"],
    [[{ status: "completed", conclusion: "timed_out" }], "failure"],
    [[{ status: "completed", conclusion: "cancelled" }], "failure"],
    [
      [
        { status: "completed", conclusion: "startup_failure" },
        { status: "queued", conclusion: null },
      ],
      "failure",
    ],
  ])("summarizeRuns(%j) = %s", (runs, expected) => {
    expect(summarizeRuns(runs)).toBe(expected);
  });
});

describe("오류", () => {
  async function errorOf(answer: Recorded | Error): Promise<unknown> {
    const { codeHost } = host(route({ graphql: answer }));
    return codeHost.findPullRequestsByBranch(repo, "factory/ENG-1-1").then(
      () => null,
      (error: unknown) => error,
    );
  }

  it("잘못된 토큰(401)은 unauthorized다", async () => {
    const error = await errorOf(fixture("unauthorized"));
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ detail: { kind: "unauthorized" } });
  });

  it("한도를 넘은 403은 x-ratelimit-reset 시각과 함께 rate-limited다", async () => {
    expect(await errorOf(fixture("rest-rate-limited"))).toMatchObject({
      detail: { kind: "rate-limited", resetAt: new Date(1794931676 * 1000) },
    });
  });

  it("헤더 없는 429와 본문으로만 알리는 secondary limit 403도 rate-limited다", async () => {
    expect(
      await errorOf({ status: 429, headers: {}, body: { message: "Too Many Requests" } }),
    ).toMatchObject({
      detail: { kind: "rate-limited", resetAt: null },
    });
    expect(
      await errorOf({
        status: 403,
        headers: {},
        body: {
          message:
            "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
        },
      }),
    ).toMatchObject({ detail: { kind: "rate-limited", resetAt: null } });
    expect(
      await errorOf({
        status: 403,
        headers: {},
        body: { message: "Resource not accessible by personal access token" },
      }),
    ).toMatchObject({ detail: { kind: "unauthorized" } });
  });

  it("retry-after가 있으면 그만큼 뒤를 푸는 시각으로 쓴다", async () => {
    const secondary: Recorded = {
      status: 403,
      headers: { "retry-after": "60" },
      body: { message: "You have exceeded a secondary rate limit." },
    };
    expect(await errorOf(secondary)).toMatchObject({
      detail: { kind: "rate-limited", resetAt: new Date(NOW.getTime() + 60_000) },
    });
  });

  it("GraphQL이 200에 RATE_LIMITED 오류를 주면 rate-limited다", async () => {
    const limited: Recorded = {
      status: 200,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794931676" },
      body: {
        errors: [
          { type: "RATE_LIMITED", message: "API rate limit already exceeded for user ID 1." },
        ],
      },
    };
    expect(await errorOf(limited)).toMatchObject({
      detail: { kind: "rate-limited", resetAt: new Date(1794931676 * 1000) },
    });
  });

  it("토큰이 닿지 않는 저장소는 not-found다", async () => {
    expect(await errorOf(fixture("repo-not-found"))).toMatchObject({
      detail: { kind: "not-found" },
    });
  });

  it("연결 실패, 5xx, 읽을 수 없는 응답은 network다", async () => {
    expect(await errorOf(new TypeError("fetch failed"))).toMatchObject({
      detail: { kind: "network" },
    });
    expect(
      await errorOf({ status: 502, headers: {}, body: { message: "Bad Gateway" } }),
    ).toMatchObject({
      detail: { kind: "network" },
    });
    expect(
      await errorOf({
        status: 200,
        headers: {},
        body: { data: { repository: { pullRequests: {} } } },
      }),
    ).toMatchObject({ detail: { kind: "network" } });
  });

  it("이 어댑터가 만들지 않은 RepoRef는 요청하지 않고 not-found다", async () => {
    const { codeHost, sent } = host(route({ graphql: fixture("by-branch-none") }));
    await expect(
      codeHost.findPullRequestsByBranch(toRepoRef("not a repo"), "b"),
    ).rejects.toMatchObject({
      detail: { kind: "not-found" },
    });
    expect(sent).toHaveLength(0);
  });
});

describe("연결 확인과 rate limit", () => {
  const viewer: Recorded = {
    status: 200,
    headers: {},
    body: {
      data: {
        viewer: { login: "acme-bot" },
        rateLimit: { limit: 5000, cost: 1, remaining: 4990, resetAt: "2026-11-17T17:00:00Z" },
      },
    },
  };

  it("토큰이 맞으면 ok다", async () => {
    const { codeHost } = host(route({ graphql: viewer }));
    expect(await codeHost.checkConnection()).toEqual({ ok: true });
  });

  it("토큰이 틀리면 unauthorized를 돌려주고 던지지 않는다", async () => {
    const { codeHost } = host(route({ graphql: fixture("unauthorized") }));
    expect(await codeHost.checkConnection()).toEqual({
      ok: false,
      error: { kind: "unauthorized" },
    });
  });

  it("rate limit은 응답의 limit·remaining·resetAt이다", async () => {
    const { codeHost } = host(route({ graphql: viewer }));
    expect(await codeHost.rateLimit()).toEqual({
      limit: 5000,
      remaining: 4990,
      resetAt: new Date("2026-11-17T17:00:00Z"),
    });
  });
});

describe("저장소와 factory", () => {
  it("러너 쪽 프로젝트 github:<owner>/<repo>를 소문자 RepoRef로 읽는다", () => {
    const { codeHost } = host(() => new Error("no request"));
    expect(codeHost.repoOf(toRunnerProjectId("github:Acme/App.js"))).toBe("acme/app.js");
    expect(codeHost.repoOf(toRunnerProjectId("gitlab:acme/app"))).toBeNull();
    expect(codeHost.repoOf(toRunnerProjectId("github:acme"))).toBeNull();
    expect(codeHost.repoOf(toRunnerProjectId("github:acme/app/extra"))).toBeNull();
  });

  it("레지스트리에 github 종류로 등록하고 저장한 토큰으로 만든다", async () => {
    const { fetch, sent } = fakeFetch(route({ graphql: fixture("by-branch-none") }));
    const registry = new AdapterRegistry().registerCodeHost(createGitHubCodeHostFactory({ fetch }));

    const codeHost = registry.createCodeHost(toCodeHostKind("github"), {
      config: {},
      secrets: { token: "stored-token" },
    });
    await codeHost.findPullRequestsByBranch(repo, "b");

    expect(codeHost.kind).toBe("github");
    expect(sent[0]?.headers["authorization"]).toBe("bearer stored-token");
  });

  it("토큰이 없는 설정은 거부한다", () => {
    expect(() => createGitHubCodeHostFactory().create({ config: {}, secrets: {} })).toThrow(
      /token/,
    );
  });
});
