import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  GH_MISSING_MARK,
  GH_SECTION_MARK,
  parseGhAccounts,
  READ_GH_ACCOUNTS_SCRIPT,
  splitLoadAndGhAccounts,
} from "./gh-accounts.js";

const FAKE_TOKEN = "gho_FAKEtokenFAKEtokenFAKEtoken0000";

const ONE_ACCOUNT = `github.com
  ✓ Logged in to github.com account acme-bot (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'`;

const TWO_ACCOUNTS = `github.com
  ✓ Logged in to github.com account acme-bot (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token: gho_************************************

  ✓ Logged in to github.com account acme-ci (GH_CONFIG_DIR)
  - Active account: true
  - Git operations protocol: ssh

ghe.acme.example
  X Failed to log in to ghe.acme.example account acme_corp (keyring)
  - Active account: true
  - The token in keyring is invalid.
  - To re-authenticate, run: gh auth login -h ghe.acme.example`;

const LEGACY = `github.com
  ✓ Logged in to github.com as acme-bot (/home/acme/.config/gh/hosts.yml)
  ✓ Git operations for github.com configured to use https protocol.
  ✓ Token: *******************`;

const LOGGED_OUT = "You are not logged into any GitHub hosts. To log in, run: gh auth login";
const LEGACY_LOGGED_OUT =
  "You are not logged into any GitHub hosts. Run gh auth login to authenticate.";

describe("parseGhAccounts", () => {
  test("reads one logged-in account as active", () => {
    expect(parseGhAccounts(ONE_ACCOUNT)).toEqual({
      kind: "logged-in",
      accounts: [{ host: "github.com", login: "acme-bot", active: true }],
    });
  });

  test("reads every account on every host with its active mark", () => {
    expect(parseGhAccounts(TWO_ACCOUNTS)).toEqual({
      kind: "logged-in",
      accounts: [
        { host: "github.com", login: "acme-bot", active: false },
        { host: "github.com", login: "acme-ci", active: true },
        { host: "ghe.acme.example", login: "acme_corp", active: true },
      ],
    });
  });

  test("reads the older single-account format, whose one account per host is active", () => {
    expect(parseGhAccounts(LEGACY)).toEqual({
      kind: "logged-in",
      accounts: [{ host: "github.com", login: "acme-bot", active: true }],
    });
  });

  test("a timed-out account is still listed with its own active mark", () => {
    const output = `github.com
  ✓ Logged in to github.com account acme-bot (keyring)
  - Active account: false
  X Timeout trying to log in to github.com account acme-ci (keyring)
  - Active account: true`;
    expect(parseGhAccounts(output)).toEqual({
      kind: "logged-in",
      accounts: [
        { host: "github.com", login: "acme-bot", active: false },
        { host: "github.com", login: "acme-ci", active: true },
      ],
    });
  });

  test("an account line it cannot accept never lends its active mark to the account above", () => {
    const output = `github.com
  ✓ Logged in to github.com account acme-bot (keyring)
  - Active account: false
  ? Something new about github.com account $(bad) (keyring)
  - Active account: true`;
    expect(parseGhAccounts(output)).toEqual({
      kind: "logged-in",
      accounts: [{ host: "github.com", login: "acme-bot", active: false }],
    });
  });

  test("no login is logged-out in both the current and older wording", () => {
    expect(parseGhAccounts(LOGGED_OUT)).toEqual({ kind: "logged-out" });
    expect(parseGhAccounts(LEGACY_LOGGED_OUT)).toEqual({ kind: "logged-out" });
  });

  test("the missing mark means gh is not installed", () => {
    expect(parseGhAccounts(`${GH_MISSING_MARK}\n`)).toEqual({ kind: "not-installed" });
  });

  test("anything else is unreadable", () => {
    expect(parseGhAccounts("")).toEqual({ kind: "unreadable" });
    expect(parseGhAccounts("sh: gh: Permission denied")).toEqual({ kind: "unreadable" });
    expect(parseGhAccounts("  ✓ Logged in to github.com account $(rm -rf ~) (keyring)")).toEqual({
      kind: "unreadable",
    });
  });

  test("keeps only host, login and active, never token text", () => {
    const reading = parseGhAccounts(
      `${ONE_ACCOUNT.replace("gho_************************************", FAKE_TOKEN)}`,
    );
    expect(JSON.stringify(reading)).not.toContain("gho_");
    expect(JSON.stringify(reading)).not.toContain("scopes");
  });
});

describe("splitLoadAndGhAccounts", () => {
  test("splits the gh section off the end of the load output", () => {
    expect(splitLoadAndGhAccounts(`load\n${GH_SECTION_MARK}\n${ONE_ACCOUNT}`)).toEqual({
      load: "load",
      gh: ONE_ACCOUNT,
    });
  });

  test("without the mark the whole output is load and gh was not reached", () => {
    expect(splitLoadAndGhAccounts("load")).toEqual({ load: "load", gh: null });
  });
});

describe("READ_GH_ACCOUNTS_SCRIPT", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  test("runs gh auth status without the token-showing flag and drops token lines", () => {
    dir = mkdtempSync(join(tmpdir(), "ganger-gh-"));
    const gh = join(dir, "gh");
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        'if [ "$*" != "auth status" ]; then echo "unexpected: $*" >&2; exit 2; fi',
        `printf '%s\\n' 'github.com' '  ✓ Logged in to github.com account acme-bot (keyring)' '  - Active account: true' '  - Token: ${FAKE_TOKEN}' >&2`,
        "exit 1",
      ].join("\n"),
    );
    chmodSync(gh, 0o755);
    const output = execFileSync("sh", ["-c", READ_GH_ACCOUNTS_SCRIPT], {
      encoding: "utf8",
      env: { PATH: `${dir}:/usr/bin:/bin` },
    });
    expect(output).not.toContain(FAKE_TOKEN);
    expect(output).not.toContain("unexpected");
    expect(READ_GH_ACCOUNTS_SCRIPT).not.toMatch(/show-token|-t\b/);
    const { gh: section } = splitLoadAndGhAccounts(output);
    expect(parseGhAccounts(section ?? "")).toEqual({
      kind: "logged-in",
      accounts: [{ host: "github.com", login: "acme-bot", active: true }],
    });
  });
});
