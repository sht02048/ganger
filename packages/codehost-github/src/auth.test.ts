import { toPullRequestId, toRepoRef } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { GitHubAuth, REPO_PICK_TTL_MS } from "./auth.js";
import type { GhRun, GhRunner } from "./gh-cli.js";
import { GitHubCodeHost } from "./github.js";
import { GitHubError } from "./http.js";
import { fakeFetch, fixture } from "./test-support.js";
import type { Recorded, SentRequest } from "./test-support.js";

const PASTED = "github_pat_PASTED_secret_1";
const TOKENS: Record<string, string> = {
  "acme-bot": "gho_ACMEsecret1",
  "jane-doe": "gho_JANEsecret2",
};

type GhScene =
  | { kind: "missing" }
  | { kind: "logged-out" }
  | {
      kind: "logged-in";
      version?: string;
      accounts: Array<{ login: string; active: boolean; expired?: boolean }>;
    };

function fakeGh(scene: () => GhScene): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const answer = (args: ReadonlyArray<string>): GhRun | null => {
    const now = scene();
    if (now.kind === "missing") return null;
    if (args[0] === "--version") {
      const version = now.kind === "logged-in" ? (now.version ?? "2.60.0") : "2.60.0";
      return { code: 0, stdout: `gh version ${version} (2026-01-01)\n`, stderr: "" };
    }
    const accounts = now.kind === "logged-in" ? now.accounts : [];
    if (args[1] === "status" && args.includes("--json")) {
      const hosts = {
        "github.com": accounts.map((a) => ({
          state: a.expired === true ? "error" : "success",
          active: a.active,
          login: a.login,
        })),
      };
      return { code: 0, stdout: JSON.stringify({ hosts }), stderr: "" };
    }
    if (args[1] === "status") {
      const active = accounts.find((a) => a.active);
      return active === undefined
        ? { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts." }
        : { code: 0, stdout: "", stderr: `  ✓ Logged in to github.com as ${active.login} (x)\n` };
    }
    if (args[1] === "token") {
      const userAt = args.indexOf("--user");
      const login = userAt === -1 ? accounts.find((a) => a.active)?.login : args[userAt + 1];
      const token = login === undefined ? undefined : TOKENS[login];
      return token === undefined
        ? { code: 1, stdout: "", stderr: "no oauth token" }
        : { code: 0, stdout: `${token}\n`, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unknown" };
  };
  return {
    gh: {
      run: (args) => {
        calls.push([...args]);
        return Promise.resolve(answer(args));
      },
    },
    calls,
  };
}

const json = (status: number, body: unknown): Recorded => ({ status, headers: {}, body });

function tokenOf(req: SentRequest): string {
  return (req.headers["authorization"] ?? "").replace(/^bearer /u, "");
}

function github(
  visible: Record<string, ReadonlyArray<string>>,
  extra?: (req: SentRequest) => Recorded | null,
) {
  return fakeFetch((req) => {
    const own = extra?.(req);
    if (own !== null && own !== undefined) return own;
    const url = new URL(req.url);
    const owners = visible[tokenOf(req)] ?? [];
    const repo = /^\/repos\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (repo !== null) {
      return owners.includes(repo[1] ?? "") ? json(200, {}) : json(404, { message: "Not Found" });
    }
    if (url.pathname === "/user") {
      const login = Object.entries(TOKENS).find(([, token]) => token === tokenOf(req))?.[0];
      return login === undefined ? json(401, {}) : json(200, { login });
    }
    if (url.pathname === "/user/orgs") {
      return json(
        200,
        owners.filter((o) => !Object.keys(TOKENS).includes(o)).map((login) => ({ login })),
      );
    }
    if (url.pathname === "/graphql") return fixture("by-branch-none");
    return json(404, {});
  });
}

const TWO_ACCOUNTS: GhScene = {
  kind: "logged-in",
  accounts: [
    { login: "acme-bot", active: true },
    { login: "jane-doe", active: false },
  ],
};

const acme = { owner: "acme", name: "app" };
const jane = { owner: "jane-labs", name: "site" };

describe("GitHub 인증 출처 순서 (0204)", () => {
  it("gh 계정이 저장소를 볼 수 있으면 붙여 넣은 토큰보다 gh 를 쓴다", async () => {
    const { fetch } = github({ [TOKENS["acme-bot"] ?? ""]: ["acme-bot", "acme"] });
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch });
    const credential = await auth.credentialFor(acme, PASTED);
    expect(credential?.source).toEqual({ kind: "gh", login: "acme-bot" });
    expect(credential?.token).toBe(TOKENS["acme-bot"]);
  });

  it("gh 에 로그인돼 있지 않거나 gh 가 없으면 붙여 넣은 토큰을 쓰고, 둘 다 없으면 없다", async () => {
    const { fetch } = github({});
    for (const scene of [{ kind: "logged-out" }, { kind: "missing" }] as const) {
      const auth = new GitHubAuth({ gh: fakeGh(() => scene).gh, fetch });
      expect(await auth.credentialFor(acme, PASTED)).toEqual({
        token: PASTED,
        source: { kind: "token" },
      });
      expect(await auth.credentialFor(acme, null)).toBeNull();
      expect(await auth.credentialFor(null, null)).toBeNull();
    }
  });

  it("어느 gh 계정도 저장소를 볼 수 없으면 붙여 넣은 토큰으로 넘어간다", async () => {
    const { fetch } = github({ [TOKENS["acme-bot"] ?? ""]: ["acme-bot"] });
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch });
    expect((await auth.credentialFor(acme, PASTED))?.source).toEqual({ kind: "token" });
  });

  it("볼 수 있는 계정도 토큰도 없으면 활성 계정을 써서 PR 을 읽을 수 없다고 드러낸다", async () => {
    const { fetch } = github({});
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch });
    expect((await auth.credentialFor(acme, null))?.source).toEqual({
      kind: "gh",
      login: "acme-bot",
    });
  });
});

describe("gh 계정 자동 고르기 (0204)", () => {
  it("두 계정 가운데 저장소 주인을 볼 수 있는 계정을 고르고, 고른 결과를 캐시한다", async () => {
    const { fetch, sent } = github({
      [TOKENS["acme-bot"] ?? ""]: ["acme-bot", "acme"],
      [TOKENS["jane-doe"] ?? ""]: ["jane-doe", "jane-labs"],
    });
    const { gh, calls } = fakeGh(() => TWO_ACCOUNTS);
    const auth = new GitHubAuth({ gh, fetch });
    expect((await auth.credentialFor(jane, null))?.source).toEqual({
      kind: "gh",
      login: "jane-doe",
    });
    expect((await auth.credentialFor(acme, null))?.source).toEqual({
      kind: "gh",
      login: "acme-bot",
    });
    const probes = sent.length;
    const ghCalls = calls.length;
    expect((await auth.credentialFor(jane, null))?.source).toEqual({
      kind: "gh",
      login: "jane-doe",
    });
    expect(sent.length).toBe(probes);
    expect(calls.length).toBe(ghCalls);
  });

  it("고른 계정이 실패하면 잊고 다시 고른다", async () => {
    let visible: Record<string, ReadonlyArray<string>> = {
      [TOKENS["acme-bot"] ?? ""]: ["acme"],
    };
    const fetch: typeof globalThis.fetch = (input, init) => github(visible).fetch(input, init);
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch });
    expect((await auth.credentialFor(acme, null))?.source).toMatchObject({ login: "acme-bot" });
    visible = { [TOKENS["jane-doe"] ?? ""]: ["acme"] };
    auth.forget(acme, { kind: "gh", login: "acme-bot" });
    expect((await auth.credentialFor(acme, null))?.source).toMatchObject({ login: "jane-doe" });
  });

  it("캐시는 시간이 지나면 다시 고른다", async () => {
    let now = new Date("2026-11-23T00:00:00Z");
    const { fetch, sent } = github({ [TOKENS["acme-bot"] ?? ""]: ["acme"] });
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch, now: () => now });
    await auth.credentialFor(acme, null);
    const before = sent.length;
    now = new Date(now.getTime() + REPO_PICK_TTL_MS + 1);
    await auth.credentialFor(acme, null);
    expect(sent.length).toBeGreaterThan(before);
  });

  it("낮은 gh 는 활성 계정 하나만 --user 없이 쓰고, 화면에 그 사실을 알린다", async () => {
    const scene: GhScene = { ...TWO_ACCOUNTS, version: "2.30.0" };
    const { fetch } = github({ [TOKENS["acme-bot"] ?? ""]: ["acme-bot", "acme"] });
    const { gh, calls } = fakeGh(() => scene);
    const auth = new GitHubAuth({ gh, fetch });
    expect((await auth.credentialFor(jane, PASTED))?.source).toEqual({ kind: "token" });
    expect(calls.filter((args) => args[1] === "token")).toEqual([
      ["auth", "token", "--hostname", "github.com"],
    ]);
    expect(await auth.view()).toEqual({
      kind: "logged-in",
      multiAccount: false,
      accounts: [{ login: "acme-bot", active: true, expired: false, owners: ["acme-bot", "acme"] }],
    });
  });

  it("화면용 상태는 계정마다 볼 수 있는 곳을 담고 토큰은 담지 않는다", async () => {
    const { fetch } = github({
      [TOKENS["acme-bot"] ?? ""]: ["acme-bot", "acme"],
      [TOKENS["jane-doe"] ?? ""]: ["jane-doe", "jane-labs"],
    });
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch });
    const view = await auth.view();
    expect(view).toEqual({
      kind: "logged-in",
      multiAccount: true,
      accounts: [
        { login: "acme-bot", active: true, expired: false, owners: ["acme-bot", "acme"] },
        { login: "jane-doe", active: false, expired: false, owners: ["jane-doe", "jane-labs"] },
      ],
    });
    const shown = JSON.stringify(view);
    for (const token of Object.values(TOKENS)) expect(shown).not.toContain(token);
  });

  it("다시 확인은 캐시를 비워 바뀐 gh 로그인을 바로 읽는다", async () => {
    let scene: GhScene = { kind: "logged-out" };
    const auth = new GitHubAuth({ gh: fakeGh(() => scene).gh, fetch: github({}).fetch });
    expect((await auth.cli()).kind).toBe("logged-out");
    scene = TWO_ACCOUNTS;
    expect((await auth.cli()).kind).toBe("logged-out");
    auth.refresh();
    expect((await auth.cli()).kind).toBe("logged-in");
  });
});

describe("만료된 gh 계정 (0207)", () => {
  const EXPIRED_ACTIVE: GhScene = {
    kind: "logged-in",
    accounts: [
      { login: "acme-bot", active: true, expired: true },
      { login: "jane-doe", active: false },
    ],
  };

  it("만료된 계정은 저장소를 볼 수 있어도 자동 고르기에서 빠지고 토큰도 읽지 않는다", async () => {
    const { fetch, sent } = github({
      [TOKENS["acme-bot"] ?? ""]: ["acme"],
      [TOKENS["jane-doe"] ?? ""]: ["jane-labs"],
    });
    const { gh, calls } = fakeGh(() => EXPIRED_ACTIVE);
    const auth = new GitHubAuth({ gh, fetch });
    expect((await auth.credentialFor(acme, PASTED))?.source).toEqual({ kind: "token" });
    expect((await auth.credentialFor(acme, null))?.source).toEqual({
      kind: "gh",
      login: "jane-doe",
    });
    expect((await auth.credentialFor(null, null))?.source).toEqual({
      kind: "gh",
      login: "jane-doe",
    });
    expect(calls.some((args) => args.includes("acme-bot"))).toBe(false);
    expect(sent.some((req) => tokenOf(req) === TOKENS["acme-bot"])).toBe(false);
  });

  it("모든 계정이 만료됐으면 gh 계정을 쓰지 않는다", async () => {
    const { fetch } = github({ [TOKENS["acme-bot"] ?? ""]: ["acme"] });
    const scene: GhScene = {
      kind: "logged-in",
      accounts: [{ login: "acme-bot", active: true, expired: true }],
    };
    const auth = new GitHubAuth({ gh: fakeGh(() => scene).gh, fetch });
    expect(await auth.credentialFor(acme, null)).toBeNull();
    expect(await auth.credentialFor(null, PASTED)).toEqual({
      token: PASTED,
      source: { kind: "token" },
    });
  });

  it("화면용 상태는 만료된 계정을 뒤에 두고 볼 수 있는 곳을 읽지 않는다", async () => {
    const { fetch } = github({ [TOKENS["jane-doe"] ?? ""]: ["jane-doe", "jane-labs"] });
    const auth = new GitHubAuth({ gh: fakeGh(() => EXPIRED_ACTIVE).gh, fetch });
    expect(await auth.view()).toEqual({
      kind: "logged-in",
      multiAccount: true,
      accounts: [
        { login: "jane-doe", active: false, expired: false, owners: ["jane-doe", "jane-labs"] },
        { login: "acme-bot", active: true, expired: true, owners: null },
      ],
    });
  });
});

describe("GitHubCodeHost 와 gh (0204)", () => {
  it("PR 을 읽을 때 고른 gh 계정의 토큰을 보낸다", async () => {
    const { fetch, sent } = github({ [TOKENS["jane-doe"] ?? ""]: ["jane-labs"] });
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch });
    const host = new GitHubCodeHost({ token: PASTED, auth, fetch });
    await host.findPullRequestsByBranch(toRepoRef("jane-labs/site"), "b");
    const graphql = sent.filter((req) => req.url.endsWith("/graphql"));
    expect(graphql.map(tokenOf)).toEqual([TOKENS["jane-doe"]]);
  });

  it("gh 계정에 머지 권한이 없으면 붙여 넣은 토큰으로 넘어가지 않는다", async () => {
    const { fetch, sent } = github({ [TOKENS["acme-bot"] ?? ""]: ["acme"] }, (req) =>
      req.method === "PUT"
        ? json(403, { message: "Resource not accessible by integration" })
        : null,
    );
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch });
    const host = new GitHubCodeHost({ token: PASTED, auth, fetch });
    const outcome = await host.mergePullRequest(toRepoRef("acme/app"), toPullRequestId("7"), {
      method: null,
      expectedHead: null,
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "no-write-access",
      message: "Resource not accessible by integration",
    });
    const puts = sent.filter((req) => req.method === "PUT");
    expect(puts.map(tokenOf)).toEqual([TOKENS["acme-bot"]]);
    expect(sent.some((req) => tokenOf(req) === PASTED)).toBe(false);
  });

  it("gh 도 토큰도 없으면 unauthorized 로 실패하고, 오류에 토큰이 들어가지 않는다", async () => {
    const { fetch } = github({});
    const auth = new GitHubAuth({ gh: fakeGh(() => ({ kind: "missing" })).gh, fetch });
    const host = new GitHubCodeHost({ auth, fetch });
    const failure = await host.getPullRequest(toRepoRef("acme/app"), toPullRequestId("1")).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(GitHubError);
    expect(await host.checkConnection()).toEqual({ ok: false, error: { kind: "unauthorized" } });
  });

  it("gh 토큰이 거절돼 실패하면 그 계정의 고른 결과를 잊어 다음 호출에서 다시 고른다", async () => {
    let refuse = true;
    const { fetch, sent } = github({ [TOKENS["acme-bot"] ?? ""]: ["acme"] }, (req) =>
      refuse && req.url.endsWith("/graphql") ? json(401, { message: "Bad credentials" }) : null,
    );
    const auth = new GitHubAuth({ gh: fakeGh(() => TWO_ACCOUNTS).gh, fetch });
    const host = new GitHubCodeHost({ token: PASTED, auth, fetch });
    const error = await host.findPullRequestsByBranch(toRepoRef("acme/app"), "b").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitHubError);
    expect(String(error)).not.toContain(TOKENS["acme-bot"]);
    expect(JSON.stringify(error)).not.toContain(TOKENS["acme-bot"]);
    refuse = false;
    const probesBefore = sent.filter((req) => req.url.includes("/repos/")).length;
    await host.findPullRequestsByBranch(toRepoRef("acme/app"), "b");
    expect(sent.filter((req) => req.url.includes("/repos/")).length).toBeGreaterThan(probesBefore);
  });
});
