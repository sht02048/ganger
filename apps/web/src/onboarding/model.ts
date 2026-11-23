import { serviceInstallArgs } from "@ganger/runner-orca/service-install";
import type {
  BoundProject,
  RunnerSettingsView,
  SettingsPage,
  WorkspaceSettings,
} from "@ganger/app/settings/model";
import { runnerWideChecks, summarizePushChecks } from "@ganger/app/prerequisites";
import type { PushSummary } from "@ganger/app/prerequisites";

export const ONBOARDING_STEPS = ["tracker", "github", "runner", "workspace", "mapping"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_PATH = "/onboarding";

export const LINEAR_API_KEY_URL = "https://linear.app/settings/account/security";
export const LINEAR_WEBHOOK_SETTINGS_URL = "https://linear.app/settings/api";
export const CLOUDFLARE_TUNNEL_GUIDE_URL =
  "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/";
export const TAILSCALE_FUNNEL_GUIDE_URL = "https://tailscale.com/kb/1223/funnel";
export const GITHUB_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";
export const HOME_PATH = "/";

const OPEN_PATHS = [ONBOARDING_PATH, "/ds", "/api"];

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isOpenPath(pathname: string): boolean {
  return OPEN_PATHS.some((base) => isUnder(pathname, base));
}

export function onboardingRedirect(pathname: string, complete: boolean): string | null {
  return complete || isOpenPath(pathname) ? null : ONBOARDING_PATH;
}

export interface SetupCounts {
  trackerConnections: number;
  githubConnections: number;
  runners: number;
  workspaces: number;
  mappings: number;
  autoAssignReady: number;
}

export function isSetupComplete(counts: SetupCounts): boolean {
  return (
    counts.trackerConnections > 0 &&
    counts.githubConnections > 0 &&
    counts.runners > 0 &&
    counts.workspaces > 0 &&
    counts.mappings > 0 &&
    counts.autoAssignReady > 0
  );
}

export const MAPPING_PARTS = ["mapping", "progress", "label"] as const;
export type MappingPart = (typeof MAPPING_PARTS)[number];

export function missingMappingParts(workspace: WorkspaceSettings): MappingPart[] {
  const labeled = new Set(
    workspace.labels.flatMap((l) => (l.labelId === null ? [] : [l.connection.id])),
  );
  let best: MappingPart[] = [...MAPPING_PARTS];
  let bestMapped = false;
  for (const bound of workspace.bound) {
    const mapped = bound.mapping !== null;
    const missing = MAPPING_PARTS.filter(
      (part) =>
        (part === "mapping" && !mapped) ||
        (part === "progress" && bound.inProgressStateId === null) ||
        (part === "label" && !labeled.has(bound.connection.id)),
    );
    if (missing.length < best.length || (missing.length === best.length && mapped && !bestMapped)) {
      best = missing;
      bestMapped = mapped;
    }
  }
  return best;
}

export function mappingRowComplete(bound: BoundProject): boolean {
  return bound.mapping !== null && bound.inProgressStateId !== null;
}

export function runnerPassed(runner: RunnerSettingsView): boolean {
  const check = runner.check;
  return (
    check !== null &&
    check.status === "done" &&
    check.online &&
    check.error === null &&
    runnerWideChecks(check.prerequisites).every((p) => p.satisfied !== false)
  );
}

export function stepPassed(page: SettingsPage, step: OnboardingStep): boolean {
  switch (step) {
    case "tracker":
      return page.install.connections.length > 0;
    case "github":
      return page.install.githubConnected;
    case "runner":
      return page.install.runners.some(runnerPassed);
    case "workspace":
      return page.workspace !== null && page.workspace.bound.length > 0;
    case "mapping":
      return page.workspace !== null && missingMappingParts(page.workspace).length === 0;
  }
}

export function reachableIndex(page: SettingsPage): number {
  const blocked = ONBOARDING_STEPS.findIndex((step) => !stepPassed(page, step));
  return blocked === -1 ? ONBOARDING_STEPS.length - 1 : blocked;
}

export function resolveStep(page: SettingsPage, requested: number | undefined): number {
  const reachable = reachableIndex(page);
  if (requested === undefined) return reachable;
  const index = Math.trunc(requested) - 1;
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(index, reachable);
}

export function stepToPin(page: SettingsPage, requested: number | undefined): number | null {
  const shown = resolveStep(page, requested) + 1;
  return requested === shown ? null : shown;
}

export interface RunnerProblems {
  error: string | null;
  service: boolean;
  push: PushSummary | null;
}

export function runnerProblems(runner: RunnerSettingsView): RunnerProblems {
  const check = runner.check;
  if (check === null || check.status !== "done") {
    return { error: null, service: false, push: null };
  }
  return {
    error: check.online ? check.error : null,
    service: runnerWideChecks(check.prerequisites).some((p) => p.satisfied === false),
    push: check.online ? summarizePushChecks(check.prerequisites) : null,
  };
}

export function pushNeedsWarning(push: PushSummary | null): boolean {
  return push !== null && (push.total === 0 || push.passed < push.total);
}

export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function serviceInstallCommand(orcaPath: string): string {
  return serviceInstallArgs(orcaPath).map(shellQuote).join(" ");
}
