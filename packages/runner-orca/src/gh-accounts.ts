import type { GhAccount, GhAccountsReading } from "@ganger/core";
import { z } from "zod";

export const GH_SECTION_MARK = "@@ganger-gh";
export const GH_MISSING_MARK = "@@ganger-gh-missing";

export const READ_GH_ACCOUNTS_SCRIPT = [
  `printf '\\n${GH_SECTION_MARK}\\n'`,
  "gh_bin=$(command -v gh 2>/dev/null)",
  "for candidate in /opt/homebrew/bin/gh /usr/local/bin/gh /home/linuxbrew/.linuxbrew/bin/gh; do",
  '  if [ -z "$gh_bin" ] && [ -x "$candidate" ]; then gh_bin=$candidate; fi',
  "done",
  'if [ -z "$gh_bin" ]; then',
  `  printf '%s\\n' '${GH_MISSING_MARK}'`,
  "else",
  `  "$gh_bin" auth status 2>&1 | grep -v 'Token:'`,
  "fi",
].join("\n");

const host = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})(?::\d{1,5})?$/)
  .max(260);
const login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/);

const ACCOUNT_LINE = /(?:Logged in to|log in to) (\S+) account (\S+) \(/;
const ANY_ACCOUNT_LINE = / account \S+ \(| as \S+ \(/;
const LEGACY_ACCOUNT_LINE = /Logged in to (\S+) as (\S+) \(/;
const ACTIVE_LINE = /^\s*-\s*Active account:\s*(true|false)\s*$/;
const LOGGED_OUT_LINE = /not logged in(?:to)? (?:to )?any GitHub hosts/i;

export function splitLoadAndGhAccounts(output: string): { load: string; gh: string | null } {
  const mark = `\n${GH_SECTION_MARK}\n`;
  const at = output.indexOf(mark);
  if (at === -1) return { load: output, gh: null };
  return { load: output.slice(0, at), gh: output.slice(at + mark.length) };
}

export function parseGhAccounts(output: string): GhAccountsReading {
  const lines = output.split("\n");
  if (lines.some((line) => line.trim() === GH_MISSING_MARK)) return { kind: "not-installed" };
  const accounts: GhAccount[] = [];
  let activeKnown = false;
  let current: GhAccount | null = null;
  for (const line of lines) {
    const account = accountOf(line);
    if (account !== null) {
      accounts.push(account);
      current = account;
      continue;
    }
    if (ANY_ACCOUNT_LINE.test(line)) {
      current = null;
      continue;
    }
    const active = ACTIVE_LINE.exec(line)?.[1];
    if (active !== undefined && current !== null) {
      current.active = active === "true";
      activeKnown = true;
    }
  }
  if (accounts.length > 0) {
    return {
      kind: "logged-in",
      accounts: activeKnown ? accounts : accounts.map((a) => ({ ...a, active: true })),
    };
  }
  if (lines.some((line) => LOGGED_OUT_LINE.test(line))) return { kind: "logged-out" };
  return { kind: "unreadable" };
}

function accountOf(line: string): GhAccount | null {
  const match = ACCOUNT_LINE.exec(line) ?? LEGACY_ACCOUNT_LINE.exec(line);
  if (match === null) return null;
  const parsedHost = host.safeParse(match[1]);
  const parsedLogin = login.safeParse(match[2]);
  if (!parsedHost.success || !parsedLogin.success) return null;
  return { host: parsedHost.data, login: parsedLogin.data, active: false };
}
