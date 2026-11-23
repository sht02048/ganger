import type { CodeHostFactory } from "@ganger/core";
import { z } from "zod";
import { defaultGitHubAuth } from "./auth.js";
import type { GitHubAuth } from "./auth.js";
import { GITHUB_KIND, GitHubCodeHost } from "./github.js";

export { GITHUB_KIND, GitHubCodeHost, searchQuery } from "./github.js";
export type { GitHubCodeHostOptions } from "./github.js";
export { GitHubError } from "./http.js";
export { summarizeRuns } from "./ci.js";
export { GitHubAuth, defaultGitHubAuth } from "./auth.js";
export type {
  CredentialSource,
  GhAccountView,
  GhCliView,
  GitHubAuthOptions,
  GitHubCredential,
} from "./auth.js";
export { GH_CLI_ENV, localGhRunner } from "./gh-cli.js";
export type { GhAccount, GhCliStatus, GhRun, GhRunner } from "./gh-cli.js";

export const TOKEN_ONLY = "token";

const settings = z.object({
  config: z.looseObject({ credentials: z.literal(TOKEN_ONLY).optional() }).optional(),
  secrets: z.looseObject({ token: z.string().min(1).optional() }),
});

export interface GitHubCodeHostFactoryOptions {
  auth?: GitHubAuth;
  fetch?: typeof fetch;
  now?: () => Date;
}

export function createGitHubCodeHostFactory(
  options: GitHubCodeHostFactoryOptions = {},
): CodeHostFactory {
  return {
    kind: GITHUB_KIND,
    create(config: unknown) {
      const parsed = settings.parse(config);
      const token = parsed.secrets.token ?? null;
      const tokenOnly = parsed.config?.credentials === TOKEN_ONLY;
      if (tokenOnly && token === null) throw new Error("GitHub token is required");
      return new GitHubCodeHost({
        token,
        auth: tokenOnly ? null : (options.auth ?? defaultGitHubAuth()),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
    },
  };
}

export const githubCodeHostFactory: CodeHostFactory = createGitHubCodeHostFactory();
