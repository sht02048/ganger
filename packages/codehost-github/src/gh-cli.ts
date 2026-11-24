import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { z } from "zod";

export const GH_CLI_ENV = "GANGER_GH_CLI";
export const GH_HOST = "github.com";
export const GH_MULTI_ACCOUNT_VERSION = [2, 40, 0] as const;

const GH_CLI_CANDIDATES = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"] as const;
const GH_TIMEOUT_MS = 10_000;

export interface GhRun {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GhRunner {
  run(args: ReadonlyArray<string>): Promise<GhRun | null>;
}

export interface GhAccount {
  login: string;
  active: boolean;
  expired: boolean;
}

export function usableAccounts<T extends GhAccount>(accounts: ReadonlyArray<T>): T[] {
  return accounts.filter((account) => !account.expired);
}

export type GhCliStatus =
  | { kind: "missing" }
  | { kind: "logged-out"; multiAccount: boolean }
  | { kind: "logged-in"; multiAccount: boolean; accounts: GhAccount[] };

export const githubLogin = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u);

const ghToken = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{1,1000}$/u);

const statusJson = z.object({
  hosts: z.record(
    z.string(),
    z.array(
      z.object({
        state: z.string(),
        active: z.boolean(),
        login: z.string(),
      }),
    ),
  ),
});

export function parseGhVersion(output: string): readonly [number, number, number] | null {
  const match = /gh version (\d+)\.(\d+)\.(\d+)/u.exec(output);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function supportsMultiAccount(version: readonly [number, number, number] | null): boolean {
  if (version === null) return false;
  for (let i = 0; i < 3; i += 1) {
    const have = version[i] ?? 0;
    const need = GH_MULTI_ACCOUNT_VERSION[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

export function parseStatusJson(output: string): GhAccount[] | null {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    return null;
  }
  const parsed = statusJson.safeParse(json);
  if (!parsed.success) return null;
  return uniqueAccounts(
    (parsed.data.hosts[GH_HOST] ?? []).flatMap((entry) => {
      if (entry.state !== "success" && entry.state !== "error") return [];
      const login = githubLogin.safeParse(entry.login);
      return login.success
        ? [{ login: login.data, active: entry.active, expired: entry.state === "error" }]
        : [];
    }),
  );
}

export function parseStatusText(output: string): GhAccount[] {
  const accounts: GhAccount[] = [];
  let current: GhAccount | null = null;
  for (const line of output.split(/\r?\n/u)) {
    const account = /(Logged in|Failed to log in) to github\.com (?:account|as) (\S+)/u.exec(line);
    if (account !== null) {
      const login = githubLogin.safeParse(account[2]);
      current = login.success
        ? { login: login.data, active: false, expired: account[1] === "Failed to log in" }
        : null;
      if (current !== null) accounts.push(current);
      continue;
    }
    if (
      /(?:Failed to log in|Timeout trying to log in|not logged in|token .* (?:is )?invalid)/iu.test(
        line,
      )
    ) {
      current = null;
      continue;
    }
    const active = /Active account: (true|false)/u.exec(line);
    if (active !== null && current !== null) current.active = active[1] === "true";
  }
  if (accounts.length > 0 && !accounts.some((account) => account.active)) {
    const [first] = accounts;
    if (first !== undefined) first.active = true;
  }
  return uniqueAccounts(accounts);
}

function uniqueAccounts(accounts: GhAccount[]): GhAccount[] {
  const seen = new Set<string>();
  return accounts
    .filter((account) => {
      const key = account.login.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(a.expired) - Number(b.expired) || Number(b.active) - Number(a.active));
}

export async function readGhCli(runner: GhRunner): Promise<GhCliStatus> {
  const version = await runner.run(["--version"]);
  if (version === null) return { kind: "missing" };
  const multiAccount = supportsMultiAccount(parseGhVersion(version.stdout));
  const accounts = multiAccount ? await accountsFromJson(runner) : null;
  const found = accounts ?? (await accountsFromText(runner, multiAccount));
  if (found === null) return { kind: "missing" };
  if (found.length === 0) return { kind: "logged-out", multiAccount };
  return { kind: "logged-in", multiAccount, accounts: found };
}

async function accountsFromJson(runner: GhRunner): Promise<GhAccount[] | null> {
  const run = await runner.run(["auth", "status", "--hostname", GH_HOST, "--json", "hosts"]);
  if (run === null || run.code !== 0) return null;
  return parseStatusJson(run.stdout);
}

async function accountsFromText(
  runner: GhRunner,
  multiAccount: boolean,
): Promise<GhAccount[] | null> {
  const run = await runner.run(["auth", "status", "--hostname", GH_HOST]);
  if (run === null) return null;
  const accounts = parseStatusText(`${run.stdout}\n${run.stderr}`);
  return multiAccount ? accounts : accounts.filter((account) => account.active).slice(0, 1);
}

export async function readGhToken(
  runner: GhRunner,
  account: { login: string; multiAccount: boolean },
): Promise<string | null> {
  const login = githubLogin.safeParse(account.login);
  if (!login.success) return null;
  const run = await runner.run([
    "auth",
    "token",
    "--hostname",
    GH_HOST,
    ...(account.multiAccount ? ["--user", login.data] : []),
  ]);
  if (run === null || run.code !== 0) return null;
  const token = ghToken.safeParse(run.stdout);
  return token.success ? token.data : null;
}

export interface LocalGhDeps {
  env: Readonly<Record<string, string | undefined>>;
  exists(path: string): boolean;
}

export function findGhCli(deps: LocalGhDeps): string | null {
  const override = deps.env[GH_CLI_ENV]?.trim();
  if (override !== undefined && override.length > 0) {
    return deps.exists(override) ? override : null;
  }
  const fromPath = (deps.env["PATH"] ?? "")
    .split(delimiter)
    .filter((dir) => isAbsolute(dir))
    .map((dir) => join(dir, "gh"));
  return [...fromPath, ...GH_CLI_CANDIDATES].find((path) => deps.exists(path)) ?? null;
}

const SERVER_SECRETS = new Set(["ENCRYPTION_KEY", "DATABASE_PATH"]);

export function ghEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([name]) => !SERVER_SECRETS.has(name))),
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  };
}

export function localGhRunner(
  deps: LocalGhDeps = { env: process.env, exists: existsSync },
): GhRunner {
  return {
    run(args) {
      const cli = findGhCli(deps);
      if (cli === null) return Promise.resolve(null);
      return new Promise((resolve) => {
        execFile(
          cli,
          [...args],
          {
            timeout: GH_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
            encoding: "utf8",
            env: ghEnv(deps.env),
          },
          (error, stdout, stderr) => {
            if (error === null) {
              resolve({ code: 0, stdout, stderr });
              return;
            }
            if (typeof error.code === "number") resolve({ code: error.code, stdout, stderr });
            else resolve(error.killed === true ? { code: -1, stdout: "", stderr: "" } : null);
          },
        );
      });
    },
  };
}
