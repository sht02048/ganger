import { TOKEN_ONLY } from "@ganger/codehost-github";
import type { GhCliStatus, GitHubAuth } from "@ganger/codehost-github";
import type { GhAccountsReading, PrReadError } from "@ganger/core";
import { z } from "zod";

export const RUNNER_GH_HOST = "github.com";

export interface ServerGitHub {
  ghLogins: string[];
  tokenSaved: boolean;
  tokenOnly: boolean;
}

export type ServerReader = { kind: "gh"; logins: string[] } | { kind: "token" };

export type PrReadDiagnosis =
  | { kind: "different"; runner: string; runnerLogin: string; server: ServerReader }
  | { kind: "runner-unknown"; runner: string; server: ServerReader };

export interface DiagnosedRunner {
  name: string;
  ghAccounts: GhAccountsReading | null;
}

const tokenOnlyConfig = z.object({ credentials: z.literal(TOKEN_ONLY) });
const pastedSecrets = z.object({ token: z.string().min(1) });

export interface CodeHostConnectionLike {
  config: unknown;
  secrets: unknown;
}

export type GhStatusLike =
  | { kind: "missing" | "logged-out" }
  | { kind: "logged-in"; accounts: ReadonlyArray<{ login: string; expired?: boolean }> };

export function serverGitHubOf(
  status: GhStatusLike,
  connections: ReadonlyArray<CodeHostConnectionLike>,
): ServerGitHub {
  const accounts = status.kind === "logged-in" ? status.accounts : [];
  return {
    ghLogins: accounts.filter((account) => account.expired !== true).map((a) => a.login),
    tokenSaved: connections.some((c) => pastedSecrets.safeParse(c.secrets).success),
    tokenOnly: connections.some((c) => tokenOnlyConfig.safeParse(c.config).success),
  };
}

export async function loadServerGitHub(
  auth: GitHubAuth,
  connections: ReadonlyArray<CodeHostConnectionLike>,
): Promise<ServerGitHub> {
  const status = await auth.cli().catch((): GhCliStatus => ({ kind: "missing" }));
  return serverGitHubOf(status, connections);
}

export function serverReaderOf(server: ServerGitHub): ServerReader | null {
  if (!server.tokenOnly && server.ghLogins.length > 0) {
    return { kind: "gh", logins: server.ghLogins };
  }
  return server.tokenSaved ? { kind: "token" } : null;
}

export function runnerGitHubLogin(reading: GhAccountsReading | null): string | null {
  if (reading?.kind !== "logged-in") return null;
  const active = reading.accounts.find(
    (account) => account.host === RUNNER_GH_HOST && account.active && !account.expired,
  );
  return active?.login ?? null;
}

export function diagnosePrRead(
  error: PrReadError | null,
  runner: DiagnosedRunner | null,
  server: ServerGitHub | null,
): PrReadDiagnosis | null {
  if (error !== "no-access" || runner === null || server === null) return null;
  const reader = serverReaderOf(server);
  if (reader === null) return null;
  const runnerLogin = runnerGitHubLogin(runner.ghAccounts);
  if (runnerLogin === null) return { kind: "runner-unknown", runner: runner.name, server: reader };
  const sameAccount =
    reader.kind === "gh" &&
    reader.logins.some((login) => login.toLowerCase() === runnerLogin.toLowerCase());
  if (sameAccount) return null;
  return { kind: "different", runner: runner.name, runnerLogin, server: reader };
}
