import { defaultGitHubAuth, usableAccountsOf } from "@ganger/codehost-github";
import type { GitHubAuth } from "@ganger/codehost-github";
import {
  clearMergeDenials,
  listCodeHostConnections,
  listRunners,
  listRunsWithRecords,
  saveCodeHostConnection,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import type { RunnerId } from "@ganger/core";
import { diagnosePrRead, serverGitHubOf } from "../pr-read-diagnosis.js";
import type { ServerGitHub } from "../pr-read-diagnosis.js";
import { toCodeHostConnectionId } from "@ganger/db";
import {
  hasPastedGitHubToken,
  pastedGitHubToken,
  remoteErrorOf,
  remoteErrorOfDetail,
} from "./load.js";
import type { SettingsContext } from "./load.js";
import type {
  GhCliView,
  GitHubAuthView,
  RemoteError,
  RunnerPrReadDiagnosis,
  SaveResult,
} from "./model.js";

function authOf(context: SettingsContext): GitHubAuth {
  return context.githubAuth ?? defaultGitHubAuth();
}

export async function loadGitHubAuthView(context: SettingsContext): Promise<GitHubAuthView> {
  const connections = listCodeHostConnections(context.db, context.secretBox);
  const tokenSaved = hasPastedGitHubToken(connections);
  let cli: GhCliView;
  try {
    cli = await authOf(context).view();
  } catch {
    cli = { kind: "missing" };
  }
  const server = serverGitHubOf(cli, connections);
  return {
    cli,
    tokenSaved,
    source: server.ghLogins.length > 0 ? "gh" : tokenSaved ? "token" : "none",
    prReadDiagnoses: runnerPrReadDiagnoses(context.db, server),
  };
}

export function runnerPrReadDiagnoses(db: Database, server: ServerGitHub): RunnerPrReadDiagnosis[] {
  const unread = new Map<RunnerId, number>();
  for (const { run, records } of listRunsWithRecords(db, { states: ["ended"] })) {
    if (records.prReadError !== "no-access" || run.runnerId === null) continue;
    unread.set(run.runnerId, (unread.get(run.runnerId) ?? 0) + 1);
  }
  if (unread.size === 0) return [];
  return listRunners(db).flatMap((runner) => {
    const runs = unread.get(runner.id);
    if (runs === undefined) return [];
    const diagnosis = diagnosePrRead(
      "no-access",
      { name: runner.name, ghAccounts: runner.ghAccounts?.reading ?? null },
      server,
    );
    return diagnosis === null ? [] : [{ runs, diagnosis }];
  });
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
  const usesCli = usableAccountsOf(status).length > 0;
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
