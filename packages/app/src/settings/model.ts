import type { PrReadError, WorkspaceBrief } from "@ganger/core";
import type { WorkspaceId } from "@ganger/db";
import type { McpActionView } from "../mcp/actions.js";
import type { CheckFailure } from "../prerequisites.js";
import type { McpLaunch } from "./mcp-launch.js";

export type RemoteError = "unauthorized" | "rate-limited" | "not-found" | "network" | "invalid";

export type Remote<T> = { ok: true; items: T[] } | { ok: false; error: RemoteError };

export interface Choice {
  id: string;
  name: string;
}

export interface WorkspaceGeneral {
  id: WorkspaceId;
  name: string;
  maxRunMinutes: number;
  brief: WorkspaceBrief;
  agentProtocol: string;
}

export type ProjectOwner =
  | { kind: "free" }
  | { kind: "this" }
  | { kind: "other"; workspace: Choice };

export interface TrackerProjectChoice {
  id: string;
  name: string;
  owner: ProjectOwner;
  mappings: number;
  queuedRuns: number;
}

export interface ConnectionProjects {
  connection: Choice;
  error: RemoteError | null;
  projects: TrackerProjectChoice[];
}

export interface MappingRepoView {
  id: string;
  isDefault: boolean;
  labelId: string | null;
}

export interface MappingView {
  agent: string;
  model: string | null;
  repos: MappingRepoView[];
}

export interface BoundProject {
  connection: Choice;
  trackerKind: string | null;
  project: Choice;
  mapping: MappingView | null;
  inProgressStateId: string | null;
  mergedStateId: string | null;
  states: Remote<Choice>;
  labels: Remote<Choice>;
}

export interface RepoLabelUse {
  labelId: string;
  repo: string;
  project: string;
}

export interface ConnectionLabel {
  connection: Choice;
  labelId: string | null;
  labels: Remote<Choice>;
  repoLabels: RepoLabelUse[];
}

export interface WorkspaceSettings {
  general: WorkspaceGeneral;
  trackerProjects: ConnectionProjects[];
  bound: BoundProject[];
  labels: ConnectionLabel[];
}

export interface TrackerProjectList {
  connection: string;
  projects: Remote<Choice>;
}

export interface BoundProjectReads {
  connection: string;
  projectId: string;
  states: Remote<Choice>;
  labels: Remote<Choice>;
}

export interface ProjectOwnership {
  connection: string;
  projectId: string;
  name: string;
  owner: ProjectOwner;
  mappings: number;
  queuedRuns: number;
}

export type BoundProjectSettings = Omit<BoundProject, "states" | "labels">;

export type ConnectionLabelSettings = Omit<ConnectionLabel, "labels"> & { projectIds: string[] };

export interface WorkspaceDbSettings {
  general: WorkspaceGeneral;
  connections: Choice[];
  ownership: ProjectOwnership[];
  bound: BoundProjectSettings[];
  labels: ConnectionLabelSettings[];
}

export type WebhookStateView =
  | { kind: "off" }
  | { kind: "waiting" }
  | { kind: "receiving"; lastReceivedAt: string; lastReceivedAgoMs: number }
  | {
      kind: "rejected";
      rejectedCount: number;
      firstRejectedAt: string;
      lastReceivedAt: string | null;
      lastReceivedAgoMs: number | null;
    };

export interface TrackerConnectionView {
  id: string;
  name: string;
  hasWebhookSecret: boolean;
  webhookPath: string;
  webhook: WebhookStateView;
  webhookSettingsUrl: string | null;
}

interface FunnelPortUsage {
  port: number;
  uses: string[];
  isPublic: boolean;
}

export type FunnelPortChoice =
  | (FunnelPortUsage & { unavailable: null; command: string; address: string })
  | (FunnelPortUsage & { unavailable: "serves-this-app" | "tcp-forward" });

export type FunnelSetupView =
  | {
      kind: "ready";
      port: number;
      portState: "free" | "ours" | "unknown";
      command: string;
      address: string;
    }
  | { kind: "ports-full"; ports: FunnelPortChoice[] }
  | { kind: "bind-tailnet"; bindHost: string };

export interface WebhookSetupView {
  funnel: FunnelSetupView | null;
}

export interface PrerequisiteView {
  id: string;
  name: string;
  satisfied: boolean | null;
  hint: string | null;
  project: string | null;
  blocksAssignment: boolean;
  failure: CheckFailure | null;
}

export type RunnerCheckView =
  | { status: "pending"; requestedAt: string; requestedAgoMs?: number }
  | { status: "failed"; completedAt: string; completedAgoMs: number; error: string }
  | {
      status: "done";
      completedAt: string;
      completedAgoMs: number;
      online: boolean;
      version: string | null;
      prerequisites: PrerequisiteView[];
      error: string | null;
    }
  | { status: "unreadable"; completedAt: string; completedAgoMs: number };

export interface RunnerSettingsView {
  id: string;
  name: string;
  sshTarget: string;
  orcaPath: string;
  access: RunnerAccess;
  capacity: number;
  check: RunnerCheckView | null;
}

export type RunnerAccess = "ganger" | "manual";

export interface AddressesView {
  webAddress: string | null;
  webhookAddress: string | null;
  webhookAddressChecked: boolean;
  autoAllowedHosts: ReadonlyArray<string>;
}

export interface PowerView {
  available: boolean;
  preventSleep: boolean;
}

export interface McpView {
  launch: McpLaunch;
  writeAllowed: boolean;
  recent: McpActionView[];
  now: string;
}

export interface GhAccountView {
  login: string;
  active: boolean;
  owners: string[] | null;
}

export type GhCliView =
  | { kind: "missing" }
  | { kind: "logged-out"; multiAccount: boolean }
  | { kind: "logged-in"; multiAccount: boolean; accounts: GhAccountView[] };

export type GitHubAuthSource = "gh" | "token" | "none";

export interface GitHubAuthView {
  cli: GhCliView;
  tokenSaved: boolean;
  source: GitHubAuthSource;
}

export interface InstallSettings {
  connections: TrackerConnectionView[];
  githubConnected: boolean;
  githubToken: boolean;
  unreadPrRuns: Record<PrReadError, number>;
  runners: RunnerSettingsView[];
  addresses: AddressesView;
  power: PowerView;
  mcp: McpView;
}

export interface SettingsPage {
  workspace: WorkspaceSettings | null;
  install: InstallSettings;
  runnerProjects: Choice[];
  agents: string[];
}

export interface SettingsDbPage {
  workspace: WorkspaceDbSettings | null;
  install: InstallSettings;
  runnerProjects: Choice[];
  agents: string[];
}

export const MAX_RUN_MINUTES = 7 * 24 * 60;
export const MAX_NAME_LENGTH = 200;

export const RUNNER_CHECK_POLL_MS = 3000;
export const RUNNER_CHECK_POLL_LIMIT_MS = 2 * 60 * 1000;

export const KNOWN_AGENTS = ["claude", "codex"] as const;

export const MAX_MODEL_LENGTH = 200;

export type SaveResult<R extends string = never> = { ok: true } | { ok: false; reason: R };

export type MappingSaveReason =
  | "not-found"
  | "no-repos"
  | "no-default"
  | "many-defaults"
  | "default-has-label"
  | "duplicate-repo"
  | "label-in-use"
  | "auto-assign-label";

export type LabelCreateResult =
  | { ok: true; labelId: string; name: string; created: boolean }
  | { ok: false; reason: RemoteError | "not-found" | "rejected" | "repo-label" };

export type ConnectionSaveReason = RemoteError | "missing-key" | "not-found";

export type { WebhookAddressFailure } from "../webhook-address.js";
