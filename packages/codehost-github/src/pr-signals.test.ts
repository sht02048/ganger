import { toPullRequestId, toRepoRef } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GitHubCodeHost } from "./github.js";
import { pullRequestSignalsResponse, toSignalsRead } from "./pr-signals.js";
import { fakeFetch, fixture, route } from "./test-support.js";
import type { Recorded, SentRequest } from "./test-support.js";

const HEAD = "head-sha";
const passedCheck = { __typename: "CheckRun", name: "build", conclusion: "SUCCESS" };
const failedCheck = { __typename: "CheckRun", name: "lint", conclusion: "FAILURE" };
const runningCheck = { __typename: "CheckRun", name: "e2e", conclusion: null };
const failedStatus = { __typename: "StatusContext", context: "deploy", state: "ERROR" };

function response(input: {
  rollup?: {
    state: string;
    nodes: unknown[];
    totalCount?: number;
    hasNextPage?: boolean;
  } | null;
  state?: string;
  mergeable?: string;
  behindBy?: number | null;
  baseRefGone?: boolean;
  head?: string;
  history?: ReturnType<typeof historyPage>;
}) {
  const rollup = input.rollup ?? null;
  return {
    repository: {
      pullRequest: {
        state: input.state ?? "OPEN",
        mergeable: input.mergeable ?? "MERGEABLE",
        title: "Add login",
        baseRefName: "develop",
        history: input.history ?? historyPage([commitNode(input.head ?? HEAD, 0)]),
        baseRef:
          input.baseRefGone === true
            ? null
            : {
                compare: input.behindBy === null ? null : { behindBy: input.behindBy ?? 0 },
              },
        commits: {
          nodes: [
            {
              commit: {
                oid: input.head ?? HEAD,
                statusCheckRollup:
                  rollup === null
                    ? null
                    : {
                        state: rollup.state,
                        contexts: {
                          totalCount: rollup.totalCount ?? rollup.nodes.length,
                          pageInfo: { hasNextPage: rollup.hasNextPage ?? false },
                          nodes: rollup.nodes,
                        },
                      },
              },
            },
          ],
        },
      },
    },
  };
}

type CommitAuthor = { name: string | null; user: { login: string } | null } | null;

function commitNode(
  oid: string,
  minute: number,
  message = `commit ${oid}`,
  author: CommitAuthor = { name: "Kim", user: { login: "kim" } },
) {
  return {
    commit: {
      oid,
      url: `https://github.com/acme/app/commit/${oid}`,
      message,
      committedDate: new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString(),
      author,
    },
  };
}

function historyPage(
  nodes: ReadonlyArray<ReturnType<typeof commitNode> | null>,
  next: { cursor: string; totalCount: number } | null = null,
) {
  return {
    totalCount: next?.totalCount ?? nodes.length,
    pageInfo: { hasNextPage: next !== null, endCursor: next?.cursor ?? null },
    nodes,
  };
}

const headCommitEntry = {
  oid: HEAD,
  url: `https://github.com/acme/app/commit/${HEAD}`,
  headline: `commit ${HEAD}`,
  author: "kim",
  committedAt: "2026-11-01T00:00:00.000Z",
};

function read(input: Parameters<typeof response>[0]) {
  const parsed = toSignalsRead(pullRequestSignalsResponse.parse(response(input)), HEAD);
  if (parsed === null) throw new Error("head differs");
  return parsed;
}

describe("PR 정보 응답 파싱 (0150)", () => {
  it("모두 통과하면 CI 성공과 검사 수를 준다", () => {
    expect(read({ rollup: { state: "SUCCESS", nodes: [passedCheck] } })).toEqual({
      ci: "success",
      signals: {
        open: true,
        headCommit: HEAD,
        ciFailed: false,
        checkTotal: 1,
        failedCount: 0,
        failedChecks: [],
        checksTruncated: false,
        conflict: false,
        behindBy: 0,
        title: "Add login",
        baseBranch: "develop",
        commits: [headCommitEntry],
      },
    });
  });

  it("실패하면 check run 과 status 의 실패한 이름을 중복 없이 준다", () => {
    const { ci, signals } = read({
      rollup: {
        state: "FAILURE",
        nodes: [passedCheck, failedCheck, failedCheck, failedStatus, null],
        totalCount: 120,
      },
    });
    expect(ci).toBe("failure");
    expect(signals.checkTotal).toBe(120);
    expect(signals.failedChecks).toEqual(["lint", "deploy"]);
    expect(signals.failedCount).toBe(3);
  });

  it("읽는 사이 head 가 바뀌면 그 응답을 버린다", () => {
    const data = pullRequestSignalsResponse.parse(response({ head: "newer-sha" }));
    expect(toSignalsRead(data, HEAD)).toBeNull();
  });

  it("검사가 100개를 넘으면 일부만 읽었다고 알린다", () => {
    const { signals } = read({
      rollup: { state: "FAILURE", nodes: [passedCheck], totalCount: 150, hasNextPage: true },
    });
    expect(signals).toMatchObject({ checkTotal: 150, failedCount: 0, checksTruncated: true });
  });

  it("모르는 검사 종류가 와도 응답을 읽고 실패 이름에서만 뺀다", () => {
    const { signals } = read({
      rollup: { state: "FAILURE", nodes: [{ __typename: "NewContext" }, failedCheck] },
    });
    expect(signals.failedChecks).toEqual(["lint"]);
  });

  it.each(["PENDING", "EXPECTED"])("%s 는 대기다", (state) => {
    const { ci, signals } = read({ rollup: { state, nodes: [runningCheck] } });
    expect(ci).toBe("pending");
    expect(signals.failedChecks).toEqual([]);
  });

  it("검사가 없으면 CI 를 정하지 않고 검사 수도 비운다", () => {
    expect(read({ rollup: null })).toEqual({
      ci: null,
      signals: {
        open: true,
        headCommit: HEAD,
        ciFailed: false,
        checkTotal: null,
        failedCount: 0,
        failedChecks: [],
        checksTruncated: false,
        conflict: false,
        behindBy: 0,
        title: "Add login",
        baseBranch: "develop",
        commits: [headCommitEntry],
      },
    });
  });

  it.each([
    ["CONFLICTING", true],
    ["MERGEABLE", false],
    ["UNKNOWN", null],
  ])("mergeable %s 는 충돌 %s 다", (mergeable, conflict) => {
    expect(read({ mergeable }).signals.conflict).toBe(conflict);
  });

  it("base 보다 뒤처진 커밋 수를 주고, base 를 읽지 못하면 비운다", () => {
    expect(read({ behindBy: 3 }).signals.behindBy).toBe(3);
    expect(read({ behindBy: null }).signals.behindBy).toBeNull();
    expect(read({ baseRefGone: true }).signals.behindBy).toBeNull();
  });

  it("PR 제목과 base 브랜치 이름을 준다 (0200)", () => {
    expect(read({}).signals).toMatchObject({ title: "Add login", baseBranch: "develop" });
  });

  it("커밋은 최근 것이 위이고 메시지 첫 줄만 남긴다 (0200)", () => {
    const history = historyPage([
      commitNode("first", 1, "Start\r\n\nbody"),
      null,
      commitNode("second", 2, "Fix tests\nmore"),
      commitNode(HEAD, 3, "Head line"),
    ]);
    const commits = read({ history }).signals.commits ?? [];
    expect(commits.map((c) => [c.oid, c.headline])).toEqual([
      [HEAD, "Head line"],
      ["second", "Fix tests"],
      ["first", "Start"],
    ]);
  });

  it("작성자는 GitHub 계정 이름, 없으면 git 이름, 둘 다 없으면 비운다 (0200)", () => {
    const history = historyPage([
      commitNode("named", 1, "named", { name: "Lee", user: null }),
      commitNode(HEAD, 2, "nobody", null),
    ]);
    const commits = read({ history }).signals.commits ?? [];
    expect(commits.map((c) => c.author)).toEqual([null, "Lee"]);
  });

  it.each(["MERGED", "CLOSED"])("%s PR 은 충돌과 뒤처짐을 보지 않는다", (state) => {
    const { signals } = read({ state, mergeable: "CONFLICTING", behindBy: 4 });
    expect(signals.conflict).toBeNull();
    expect(signals.behindBy).toBeNull();
  });
});

describe("PR 을 읽을 때 PR 정보 함께 읽기 (0150)", () => {
  const repo = toRepoRef("acme/app");
  const id = toPullRequestId("42");
  const ok = (body: unknown): Recorded => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body,
  });
  const headOf = (req: SentRequest) => z.string().parse(req.graphql?.variables["head"]);
  const isSignals = (req: SentRequest) =>
    req.graphql?.query.includes("query PullRequestSignals") === true;

  it("읽은 값을 스냅샷에 담고 Actions 는 부르지 않는다", async () => {
    const { fetch, sent } = fakeFetch(
      route({
        graphql: (req) =>
          isSignals(req)
            ? ok({
                data: response({
                  rollup: { state: "FAILURE", nodes: [failedCheck] },
                  mergeable: "CONFLICTING",
                  behindBy: 2,
                  head: headOf(req),
                }),
              })
            : fixture("by-number"),
      }),
    );
    const pr = await new GitHubCodeHost({ token: "t", fetch }).getPullRequest(repo, id);
    expect(pr?.ci).toBe("failure");
    expect(pr?.signals).toEqual({
      open: true,
      headCommit: pr?.headCommit,
      ciFailed: true,
      checkTotal: 1,
      failedCount: 1,
      failedChecks: ["lint"],
      checksTruncated: false,
      conflict: true,
      behindBy: 2,
      title: "Add login",
      baseBranch: "develop",
      commits: [expect.objectContaining({ oid: pr?.headCommit })],
    });
    expect(sent.filter((req) => req.url.includes("/actions/runs"))).toHaveLength(0);
  });

  it("PR 정보를 읽지 못해도 PR 은 읽고 CI 는 Actions 로 읽는다", async () => {
    const { fetch } = fakeFetch(
      route({
        graphql: (req) =>
          isSignals(req)
            ? ok({ data: null, errors: [{ type: "FORBIDDEN", message: "no" }] })
            : fixture("by-number"),
        actions: fixture("actions-runs-success"),
      }),
    );
    const pr = await new GitHubCodeHost({ token: "t", fetch }).getPullRequest(repo, id);
    expect(pr?.ci).toBe("success");
    expect(pr?.signals).toBeNull();
  });

  it("PR 정보만 rate limit 에 걸려도 PR 은 읽는다", async () => {
    const { fetch } = fakeFetch(
      route({
        graphql: (req) =>
          isSignals(req)
            ? ok({ data: null, errors: [{ type: "RATE_LIMITED", message: "slow" }] })
            : fixture("by-number"),
        actions: fixture("actions-runs-success"),
      }),
    );
    const pr = await new GitHubCodeHost({ token: "t", fetch }).getPullRequest(repo, id);
    expect(pr?.state).toBe("open");
    expect(pr?.signals).toBeNull();
  });

  it("열리지 않은 PR 은 PR 정보를 읽지 않는다", async () => {
    const { fetch, sent } = fakeFetch(
      route({ graphql: fixture("by-number-merged"), actions: fixture("actions-runs-none") }),
    );
    const pr = await new GitHubCodeHost({ token: "t", fetch }).getPullRequest(repo, id);
    expect(pr?.state).toBe("merged");
    expect(pr?.signals).toBeNull();
    expect(sent.filter(isSignals)).toHaveLength(0);
  });

  it("검사가 없다고 오면 Actions 로 CI 를 다시 본다", async () => {
    const { fetch, sent } = fakeFetch(
      route({
        graphql: (req) =>
          isSignals(req)
            ? ok({ data: response({ rollup: null, head: headOf(req) }) })
            : fixture("by-number"),
        actions: fixture("actions-runs-none"),
      }),
    );
    const pr = await new GitHubCodeHost({ token: "t", fetch }).getPullRequest(repo, id);
    expect(pr?.ci).toBe("none");
    expect(sent.filter((req) => req.url.includes("/actions/runs"))).toHaveLength(1);
  });

  it("커밋이 100개를 넘으면 다음 페이지를 이어 읽어 모두 담는다 (0200)", async () => {
    const isPage = (req: SentRequest) =>
      req.graphql?.query.includes("query PullRequestCommitsPage") === true;
    const nodesFrom = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => commitNode(`c${start + i}`, start + i));
    const { fetch, sent } = fakeFetch(
      route({
        graphql: (req) => {
          if (isSignals(req)) {
            return ok({
              data: response({
                head: headOf(req),
                history: historyPage(nodesFrom(0, 100), { cursor: "p1", totalCount: 230 }),
              }),
            });
          }
          if (isPage(req)) {
            const after = z.string().parse(req.graphql?.variables["after"]);
            const page =
              after === "p1"
                ? historyPage(nodesFrom(100, 100), { cursor: "p2", totalCount: 230 })
                : historyPage(nodesFrom(200, 30));
            return ok({ data: { repository: { pullRequest: { history: page } } } });
          }
          return fixture("by-number");
        },
      }),
    );
    const pr = await new GitHubCodeHost({ token: "t", fetch }).getPullRequest(repo, id);
    const commits = pr?.signals?.commits ?? [];
    expect(commits).toHaveLength(230);
    expect(commits.at(0)?.oid).toBe("c229");
    expect(commits.at(-1)?.oid).toBe("c0");
    expect(sent.filter(isPage).map((req) => req.graphql?.variables["after"])).toEqual(["p1", "p2"]);
  });

  it("커밋이 100개 이하면 PR 정보 조회 한 번으로 끝낸다 (0200)", async () => {
    const { fetch, sent } = fakeFetch(
      route({
        graphql: (req) =>
          isSignals(req) ? ok({ data: response({ head: headOf(req) }) }) : fixture("by-number"),
      }),
    );
    const pr = await new GitHubCodeHost({ token: "t", fetch }).getPullRequest(repo, id);
    expect(pr?.signals?.commits).toHaveLength(1);
    expect(sent.filter((req) => req.url.endsWith("/graphql"))).toHaveLength(2);
  });

  it("다음 커밋 페이지를 읽지 못하면 그 회차의 PR 정보를 버린다 (0200)", async () => {
    const { fetch } = fakeFetch(
      route({
        graphql: (req) => {
          if (isSignals(req)) {
            return ok({
              data: response({
                head: headOf(req),
                history: historyPage([commitNode("a", 1)], { cursor: "p1", totalCount: 101 }),
              }),
            });
          }
          if (req.graphql?.query.includes("query PullRequestCommitsPage") === true) {
            return ok({ data: null, errors: [{ type: "RATE_LIMITED", message: "slow" }] });
          }
          return fixture("by-number");
        },
        actions: fixture("actions-runs-success"),
      }),
    );
    const pr = await new GitHubCodeHost({ token: "t", fetch }).getPullRequest(repo, id);
    expect(pr?.state).toBe("open");
    expect(pr?.signals).toBeNull();
  });
});
