import { describe, expect, it } from "vitest";
import {
  findGhCli,
  parseGhVersion,
  parseStatusJson,
  parseStatusText,
  readGhCli,
  readGhToken,
  supportsMultiAccount,
} from "./gh-cli.js";
import type { GhRun, GhRunner } from "./gh-cli.js";

function runner(answer: (args: ReadonlyArray<string>) => GhRun | null): {
  gh: GhRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
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

const ok = (stdout: string): GhRun => ({ code: 0, stdout, stderr: "" });

const STATUS_JSON = JSON.stringify({
  hosts: {
    "github.com": [
      { state: "success", active: false, host: "github.com", login: "jane-doe" },
      { state: "success", active: true, host: "github.com", login: "acme-bot" },
      { state: "error", active: false, host: "github.com", login: "expired-one" },
    ],
    "ghe.example.com": [{ state: "success", active: true, login: "elsewhere" }],
  },
});

const STATUS_TEXT_MULTI = `github.com
  ✓ Logged in to github.com account acme-bot (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************

  ✓ Logged in to github.com account jane-doe (keyring)
  - Active account: false
  - Token: gho_************************************

  X Failed to log in to github.com account expired-one (keyring)
  - Active account: false
`;

const STATUS_TEXT_OLD = `github.com
  ✓ Logged in to github.com as acme-bot (/home/acme/.config/gh/hosts.yml)
  ✓ Git operations for github.com configured to use https protocol.
  ✓ Token: *******************
`;

describe("gh 버전 (0204)", () => {
  it("gh --version 출력에서 버전을 읽고 2.40 부터 여러 계정을 쓴다", () => {
    expect(parseGhVersion("gh version 2.103.3 (2026-10-26)\nhttps://…")).toEqual([2, 103, 3]);
    expect(parseGhVersion("nonsense")).toBeNull();
    expect(supportsMultiAccount([2, 40, 0])).toBe(true);
    expect(supportsMultiAccount([2, 39, 9])).toBe(false);
    expect(supportsMultiAccount([3, 0, 0])).toBe(true);
    expect(supportsMultiAccount(null)).toBe(false);
  });
});

describe("gh auth status 읽기 (0204)", () => {
  it("JSON 은 github.com 의 로그인된 계정만 활성 계정을 앞에 두고 읽는다", () => {
    expect(parseStatusJson(STATUS_JSON)).toEqual([
      { login: "acme-bot", active: true },
      { login: "jane-doe", active: false },
    ]);
    expect(parseStatusJson("not json")).toBeNull();
    expect(parseStatusJson(JSON.stringify({ hosts: {} }))).toEqual([]);
  });

  it("글 출력은 여러 계정 형식과 옛 형식을 모두 읽고 로그인에 실패한 계정은 뺀다", () => {
    expect(parseStatusText(STATUS_TEXT_MULTI)).toEqual([
      { login: "acme-bot", active: true },
      { login: "jane-doe", active: false },
    ]);
    expect(parseStatusText(STATUS_TEXT_OLD)).toEqual([{ login: "acme-bot", active: true }]);
    expect(parseStatusText("You are not logged into any GitHub hosts.")).toEqual([]);
  });

  it("계정 이름이 GitHub 로그인 꼴이 아니면 버린다", () => {
    expect(
      parseStatusJson(
        JSON.stringify({
          hosts: { "github.com": [{ state: "success", active: true, login: "--user" }] },
        }),
      ),
    ).toEqual([]);
  });
});

describe("gh 상태 (0204)", () => {
  it("gh 가 없으면 missing 이다", async () => {
    expect(await readGhCli(runner(() => null).gh)).toEqual({ kind: "missing" });
  });

  it("새 gh 는 고정 인자로 JSON 상태를 읽는다", async () => {
    const { gh, calls } = runner((args) =>
      args[0] === "--version" ? ok("gh version 2.60.0 (2026-01-01)") : ok(STATUS_JSON),
    );
    expect(await readGhCli(gh)).toEqual({
      kind: "logged-in",
      multiAccount: true,
      accounts: [
        { login: "acme-bot", active: true },
        { login: "jane-doe", active: false },
      ],
    });
    expect(calls).toEqual([
      ["--version"],
      ["auth", "status", "--hostname", "github.com", "--json", "hosts"],
    ]);
  });

  it("--json 이 없는 gh 는 글 출력을 읽는다", async () => {
    const { gh, calls } = runner((args) => {
      if (args[0] === "--version") return ok("gh version 2.45.0 (2024-03-04)");
      if (args.includes("--json")) return { code: 1, stdout: "", stderr: "unknown flag: --json" };
      return { code: 0, stdout: "", stderr: STATUS_TEXT_MULTI };
    });
    expect(await readGhCli(gh)).toMatchObject({ kind: "logged-in", multiAccount: true });
    expect(calls.at(-1)).toEqual(["auth", "status", "--hostname", "github.com"]);
  });

  it("2.40 보다 낮은 gh 는 활성 계정 하나만 쓴다", async () => {
    const { gh, calls } = runner((args) =>
      args[0] === "--version"
        ? ok("gh version 2.30.0 (2023-05-30)")
        : { code: 0, stdout: "", stderr: STATUS_TEXT_MULTI },
    );
    expect(await readGhCli(gh)).toEqual({
      kind: "logged-in",
      multiAccount: false,
      accounts: [{ login: "acme-bot", active: true }],
    });
    expect(calls.some((args) => args.includes("--json"))).toBe(false);
  });

  it("로그인된 계정이 없으면 logged-out 이다", async () => {
    const { gh } = runner((args) =>
      args[0] === "--version"
        ? ok("gh version 2.60.0 (2026-01-01)")
        : ok(JSON.stringify({ hosts: {} })),
    );
    expect(await readGhCli(gh)).toEqual({ kind: "logged-out", multiAccount: true });
  });
});

describe("gh auth token (0204)", () => {
  it("여러 계정 gh 는 --user 로, 낮은 gh 는 --user 없이 토큰을 받는다", async () => {
    const { gh, calls } = runner(() => ok("gho_abc123\n"));
    expect(await readGhToken(gh, { login: "acme-bot", multiAccount: true })).toBe("gho_abc123");
    expect(await readGhToken(gh, { login: "acme-bot", multiAccount: false })).toBe("gho_abc123");
    expect(calls).toEqual([
      ["auth", "token", "--hostname", "github.com", "--user", "acme-bot"],
      ["auth", "token", "--hostname", "github.com"],
    ]);
  });

  it("옵션처럼 보이는 계정 이름은 gh 에 넘기지 않고, 이상한 출력은 토큰으로 받지 않는다", async () => {
    const { gh, calls } = runner(() => ok("not a token value\n"));
    expect(await readGhToken(gh, { login: "--hostname", multiAccount: true })).toBeNull();
    expect(calls).toEqual([]);
    expect(await readGhToken(gh, { login: "acme-bot", multiAccount: true })).toBeNull();
    const failed = runner(() => ({ code: 1, stdout: "gho_leak", stderr: "no token" }));
    expect(await readGhToken(failed.gh, { login: "acme-bot", multiAccount: true })).toBeNull();
  });
});

describe("gh 찾기 (0204)", () => {
  it("GANGER_GH_CLI 가 있으면 그것만, 없으면 PATH 와 알려진 자리에서 찾는다", () => {
    const has = (paths: string[]) => (path: string) => paths.includes(path);
    expect(
      findGhCli({
        env: { GANGER_GH_CLI: "/opt/gh", PATH: "/usr/bin" },
        exists: has(["/usr/bin/gh"]),
      }),
    ).toBeNull();
    expect(findGhCli({ env: { GANGER_GH_CLI: "/opt/gh" }, exists: has(["/opt/gh"]) })).toBe(
      "/opt/gh",
    );
    expect(findGhCli({ env: { PATH: "/a:/b" }, exists: has(["/b/gh"]) })).toBe("/b/gh");
    expect(findGhCli({ env: {}, exists: has(["/opt/homebrew/bin/gh"]) })).toBe(
      "/opt/homebrew/bin/gh",
    );
    expect(findGhCli({ env: {}, exists: has([]) })).toBeNull();
  });
});
