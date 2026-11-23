import { GitHubAuth } from "@ganger/codehost-github";
import type { GhRun, GhRunner } from "@ganger/codehost-github";

import { demoGhSwitch } from "./gh-state.js";

export const DEMO_GH_ACCOUNTS = [
  { login: "acme-bot", active: true, orgs: ["acme"] },
  { login: "jane-doe", active: false, orgs: ["jane-labs"] },
] as const;

const TOKEN_PREFIX = "gho_demo_";

function ok(stdout: string): GhRun {
  return { code: 0, stdout, stderr: "" };
}

export class DemoGh {
  readonly auth: GitHubAuth;

  constructor() {
    this.auth = new GitHubAuth({ gh: this.runner(), fetch: demoGitHubFetch });
    demoGhSwitch().listeners.add(() => this.auth.refresh());
  }

  private runner(): GhRunner {
    return {
      run: (args) => Promise.resolve(this.answer(args)),
    };
  }

  private answer(args: ReadonlyArray<string>): GhRun | null {
    const state = demoGhSwitch().state;
    if (state === "missing") return null;
    if (args[0] === "--version") return ok("gh version 2.60.0 (2026-01-01)\n");
    const accounts = state === "connected" ? DEMO_GH_ACCOUNTS : [];
    if (args[0] === "auth" && args[1] === "status") {
      return ok(
        JSON.stringify({
          hosts: {
            "github.com": accounts.map((account) => ({
              state: "success",
              active: account.active,
              host: "github.com",
              login: account.login,
            })),
          },
        }),
      );
    }
    if (args[0] === "auth" && args[1] === "token") {
      const login = args[args.indexOf("--user") + 1];
      const account = accounts.find((candidate) => candidate.login === login);
      return account === undefined
        ? { code: 1, stdout: "", stderr: "no token" }
        : ok(`${TOKEN_PREFIX}${account.login.replaceAll("-", "_")}\n`);
    }
    return { code: 1, stdout: "", stderr: "unknown command" };
  }
}

function accountOfRequest(init: RequestInit | undefined) {
  const headers = new Headers(init?.headers);
  const token = (headers.get("authorization") ?? "").replace(/^bearer /iu, "");
  return DEMO_GH_ACCOUNTS.find(
    (account) => `${TOKEN_PREFIX}${account.login.replaceAll("-", "_")}` === token,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const demoGitHubFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const account = accountOfRequest(init);
  if (account === undefined) return Promise.resolve(json({ message: "Bad credentials" }, 401));
  if (url.pathname === "/user") return Promise.resolve(json({ login: account.login }));
  if (url.pathname === "/user/orgs") {
    return Promise.resolve(json(account.orgs.map((login) => ({ login }))));
  }
  const repo = /^\/repos\/([^/]+)\/[^/]+$/u.exec(url.pathname);
  if (repo !== null) {
    const owner = decodeURIComponent(repo[1] ?? "");
    const owners: ReadonlyArray<string> = [account.login, ...account.orgs];
    return Promise.resolve(owners.includes(owner) ? json({}) : json({ message: "Not Found" }, 404));
  }
  return Promise.resolve(json({ message: "Not Found" }, 404));
};

declare global {
  var __gangerDemoGh: DemoGh | undefined;
}

export function demoGh(): DemoGh {
  globalThis.__gangerDemoGh ??= new DemoGh();
  return globalThis.__gangerDemoGh;
}
