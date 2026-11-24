import { z } from "zod";
import { localGhRunner, readGhCli, readGhToken, usableAccounts } from "./gh-cli.js";
import type { GhAccount, GhCliStatus, GhRunner } from "./gh-cli.js";
import { GitHubHttp } from "./http.js";

export type CredentialSource = { kind: "gh"; login: string } | { kind: "token" };

export interface GitHubCredential {
  token: string;
  source: CredentialSource;
}

export interface RepoParts {
  owner: string;
  name: string;
}

export interface GhAccountView extends GhAccount {
  owners: string[] | null;
}

export type GhCliView =
  | { kind: "missing" }
  | { kind: "logged-out"; multiAccount: boolean }
  | { kind: "logged-in"; multiAccount: boolean; accounts: GhAccountView[] };

export interface GitHubAuthOptions {
  gh: GhRunner;
  fetch?: typeof fetch;
  now?: () => Date;
}

export const GH_STATUS_TTL_MS = 60_000;
export const GH_TOKEN_TTL_MS = 5 * 60_000;
export const REPO_PICK_TTL_MS = 10 * 60_000;

interface Timed<T> {
  value: Promise<T>;
  at: number;
}

const orgList = z.array(z.object({ login: z.string() }));
const userLogin = z.object({ login: z.string() });

export class GitHubAuth {
  private readonly gh: GhRunner;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly now: () => Date;
  private status: Timed<GhCliStatus> | null = null;
  private readonly tokens = new Map<string, Timed<string | null>>();
  private readonly picks = new Map<string, Timed<CredentialSource | null>>();
  private readonly owners = new Map<string, Timed<string[] | null>>();

  constructor(options: GitHubAuthOptions) {
    this.gh = options.gh;
    this.fetchFn = options.fetch;
    this.now = options.now ?? (() => new Date());
  }

  refresh(): void {
    this.status = null;
    this.tokens.clear();
    this.picks.clear();
    this.owners.clear();
  }

  cli(): Promise<GhCliStatus> {
    const at = this.now().getTime();
    if (this.status === null || at - this.status.at >= GH_STATUS_TTL_MS) {
      this.status = { value: readGhCli(this.gh), at };
    }
    return this.status.value;
  }

  async view(): Promise<GhCliView> {
    const status = await this.cli();
    if (status.kind !== "logged-in") return status;
    const accounts = await Promise.all(
      status.accounts.map(async (account) => ({
        ...account,
        owners: account.expired ? null : await this.ownersOf(account, status.multiAccount),
      })),
    );
    return { kind: "logged-in", multiAccount: status.multiAccount, accounts };
  }

  async credentialFor(
    repo: RepoParts | null,
    pastedToken: string | null,
  ): Promise<GitHubCredential | null> {
    const status = await this.cli();
    if (repo === null) {
      const active = usableAccountsOf(status)[0];
      if (active !== undefined) {
        const token = await this.tokenOf(active.login, multiAccountOf(status));
        if (token !== null) return { token, source: { kind: "gh", login: active.login } };
      }
      return pastedToken === null ? null : { token: pastedToken, source: { kind: "token" } };
    }
    const source = await this.pick(repo, pastedToken !== null);
    if (source === null) return null;
    if (source.kind === "token") {
      return pastedToken === null ? null : { token: pastedToken, source };
    }
    const token = await this.tokenOf(source.login, multiAccountOf(status));
    if (token === null) {
      this.forget(repo);
      return pastedToken === null ? null : { token: pastedToken, source: { kind: "token" } };
    }
    return { token, source };
  }

  forget(repo: RepoParts, source?: CredentialSource): void {
    this.picks.delete(repoKey(repo, true));
    this.picks.delete(repoKey(repo, false));
    if (source?.kind === "gh") this.tokens.delete(source.login.toLowerCase());
  }

  private pick(repo: RepoParts, hasPasted: boolean): Promise<CredentialSource | null> {
    const key = repoKey(repo, hasPasted);
    const at = this.now().getTime();
    const cached = this.picks.get(key);
    if (cached !== undefined && at - cached.at < REPO_PICK_TTL_MS) return cached.value;
    const value = this.choose(repo, hasPasted);
    this.picks.set(key, { value, at });
    value.catch(() => {
      if (this.picks.get(key)?.value === value) this.picks.delete(key);
    });
    return value;
  }

  private async choose(repo: RepoParts, hasPasted: boolean): Promise<CredentialSource | null> {
    const status = await this.cli();
    const accounts = usableAccountsOf(status);
    for (const account of accounts) {
      const token = await this.tokenOf(account.login, multiAccountOf(status));
      if (token === null) continue;
      if (await this.canSee(token, repo)) return { kind: "gh", login: account.login };
    }
    if (hasPasted) return { kind: "token" };
    const active = accounts[0];
    return active === undefined ? null : { kind: "gh", login: active.login };
  }

  private async canSee(token: string, repo: RepoParts): Promise<boolean> {
    const http = this.http(token);
    const res = await http.get(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
    );
    if (res.status === 200) return true;
    if (http.isRateLimitedResponse(res)) throw http.httpError(res);
    if (res.status === 401 || res.status === 403 || res.status === 404) return false;
    throw http.httpError(res);
  }

  private tokenOf(login: string, multiAccount: boolean): Promise<string | null> {
    const key = login.toLowerCase();
    const at = this.now().getTime();
    const cached = this.tokens.get(key);
    if (cached !== undefined && at - cached.at < GH_TOKEN_TTL_MS) return cached.value;
    const value = readGhToken(this.gh, { login, multiAccount });
    this.tokens.set(key, { value, at });
    return value;
  }

  private ownersOf(account: GhAccount, multiAccount: boolean): Promise<string[] | null> {
    const key = account.login.toLowerCase();
    const at = this.now().getTime();
    const cached = this.owners.get(key);
    if (cached !== undefined && at - cached.at < GH_STATUS_TTL_MS) return cached.value;
    const value = this.readOwners(account, multiAccount).catch(() => null);
    this.owners.set(key, { value, at });
    return value;
  }

  private async readOwners(account: GhAccount, multiAccount: boolean): Promise<string[] | null> {
    const token = await this.tokenOf(account.login, multiAccount);
    if (token === null) return null;
    const http = this.http(token);
    const [user, orgs] = await Promise.all([
      http.get("/user"),
      http.get("/user/orgs?per_page=100"),
    ]);
    const login = user.status === 200 ? userLogin.safeParse(user.body) : null;
    const list = orgs.status === 200 ? orgList.safeParse(orgs.body) : null;
    if (login?.success !== true) return null;
    return [login.data.login, ...(list?.success === true ? list.data.map((org) => org.login) : [])];
  }

  private http(token: string): GitHubHttp {
    return new GitHubHttp({
      token,
      now: this.now,
      ...(this.fetchFn === undefined ? {} : { fetch: this.fetchFn }),
    });
  }
}

export function usableAccountsOf(status: GhCliStatus): GhAccount[] {
  return status.kind === "logged-in" ? usableAccounts(status.accounts) : [];
}

function multiAccountOf(status: GhCliStatus): boolean {
  return status.kind === "missing" ? false : status.multiAccount;
}

function repoKey(repo: RepoParts, hasPasted: boolean): string {
  return `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}#${hasPasted ? "token" : "gh"}`;
}

let shared: GitHubAuth | undefined;

export function defaultGitHubAuth(): GitHubAuth {
  shared ??= new GitHubAuth({ gh: localGhRunner() });
  return shared;
}
