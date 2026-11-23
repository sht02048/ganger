import { GitHubAuth } from "@ganger/codehost-github";

let auth: GitHubAuth | undefined;

export function getGitHubAuth(): GitHubAuth {
  auth ??= new GitHubAuth({ gh: { run: () => Promise.resolve(null) } });
  return auth;
}
