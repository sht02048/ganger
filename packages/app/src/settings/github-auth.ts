import { defaultGitHubAuth } from "@ganger/codehost-github";
import type { GitHubAuth } from "@ganger/codehost-github";
import { clearMergeDenials, listCodeHostConnections, saveCodeHostConnection } from "@ganger/db";
import { toCodeHostConnectionId } from "@ganger/db";
import {
  hasPastedGitHubToken,
  pastedGitHubToken,
  remoteErrorOf,
  remoteErrorOfDetail,
} from "./load.js";
import type { SettingsContext } from "./load.js";
import type { GhCliView, GitHubAuthView, RemoteError, SaveResult } from "./model.js";

function authOf(context: SettingsContext): GitHubAuth {
  return context.githubAuth ?? defaultGitHubAuth();
}

export async function loadGitHubAuthView(context: SettingsContext): Promise<GitHubAuthView> {
  const tokenSaved = hasPastedGitHubToken(listCodeHostConnections(context.db, context.secretBox));
  let cli: GhCliView;
  try {
    cli = await authOf(context).view();
  } catch {
    cli = { kind: "missing" };
  }
  return {
    cli,
    tokenSaved,
    source: cli.kind === "logged-in" ? "gh" : tokenSaved ? "token" : "none",
  };
}

export type GitHubCheckFailure = RemoteError | "no-credentials";

export async function checkGitHubConnection(
  context: SettingsContext,
  now: Date,
): Promise<SaveResult<GitHubCheckFailure>> {
  const auth = authOf(context);
  auth.refresh();
  const existing = listCodeHostConnections(context.db, context.secretBox)[0];
  const status = await auth.cli().catch(() => ({ kind: "missing" as const }));
  const usesCli = status.kind === "logged-in";
  if (!usesCli && pastedGitHubToken(existing?.secrets) === null) {
    return { ok: false, reason: "no-credentials" };
  }
  const kind = existing?.kind ?? context.registry.kinds().codeHosts[0];
  if (kind === undefined) return { ok: false, reason: "invalid" };
  const config = existing?.config ?? {};
  const secrets = existing?.secrets ?? {};
  let check: SaveResult<RemoteError>;
  try {
    const result = await context.registry
      .createCodeHost(kind, { config, secrets })
      .checkConnection();
    check = result.ok ? { ok: true } : { ok: false, reason: remoteErrorOfDetail(result.error) };
  } catch (error) {
    check = { ok: false, reason: remoteErrorOf(error) };
  }
  if (!check.ok) return check;
  if (existing === undefined) {
    saveCodeHostConnection(
      context.db,
      context.secretBox,
      { id: toCodeHostConnectionId(kind), kind, name: kind, config, secrets },
      now,
    );
  }
  clearMergeDenials(context.db);
  return { ok: true };
}
