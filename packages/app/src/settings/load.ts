import { AdapterError, toTrackerConnectionId } from "@ganger/core";
import type {
  AdapterRegistry,
  RunnerId,
  Tracker,
  TrackerConnectionId,
  WorkspaceBrief,
} from "@ganger/core";
import type { GitHubAuth } from "@ganger/codehost-github";
import { ASK_GUIDE } from "@ganger/runner-orca/agent-brief";
import {
  getAutoAssignLabel,
  getInstallSettings,
  getMapping,
  getMcpWriteAllowed,
  getRunnerCheckRequest,
  getWebhookReceipt,
  listPendingRunnerCheckRequests,
  countUnreadPrRuns,
  listCodeHostConnections,
  listRecentMcpActions,
  listRunners,
  listRuns,
  listTrackerConnections,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  runnerPrerequisiteSchema,
} from "@ganger/db";
import { RECENT_MCP_ACTIONS, mcpActionView } from "../mcp/actions.js";
import type { PowerSettingsStore } from "../power-settings.js";
import { mcpLaunch } from "./mcp-launch.js";
import type { McpLaunch } from "./mcp-launch.js";
import type {
  Database,
  SecretBox,
  StoredInstallSettings,
  StoredTrackerConnection,
  WebhookReceipt,
  WorkspaceId,
} from "@ganger/db";
import { z } from "zod";
import { prerequisiteProject } from "../prerequisites.js";
import { resolveWorkspace } from "../shell/model.js";
import type { TrackerReads } from "../tracker-reads.js";
import { KNOWN_AGENTS } from "./model.js";
import { connectionProjectsOf, mergeSettingsPage } from "./merge.js";
import type {
  AddressesView,
  BoundProjectReads,
  BoundProjectSettings,
  Choice,
  ConnectionLabelSettings,
  ConnectionProjects,
  PowerView,
  ProjectOwnership,
  Remote,
  RemoteError,
  RunnerCheckView,
  RunnerSettingsView,
  SettingsDbPage,
  SettingsPage,
  TrackerConnectionView,
  TrackerProjectList,
  WebhookStateView,
  WorkspaceDbSettings,
} from "./model.js";

export type { PowerSettingsStore };

export interface SettingsContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
  githubAuth?: GitHubAuth;
  power?: PowerSettingsStore;
  mcpLaunch?: McpLaunch;
  trackerReads?: TrackerReads;
  autoAllowedHosts?: ReadonlyArray<string>;
}

function powerView(store: PowerSettingsStore | undefined): PowerView {
  if (store === undefined) return { available: false, preventSleep: true };
  return { available: true, preventSleep: store.read().preventSleep };
}

export function webhookPath(connectionId: string): string {
  return `/api/webhooks/tracker/${encodeURIComponent(connectionId)}`;
}

function addressesView(
  settings: StoredInstallSettings,
  autoAllowedHosts: ReadonlyArray<string>,
): AddressesView {
  return {
    webAddress: settings.webAddress,
    webhookAddress: settings.webhookAddress,
    webhookAddressChecked:
      settings.webhookAddress !== null && settings.webhookAddressCheckedAt !== null,
    autoAllowedHosts,
  };
}

const runnerConfigSchema = z.object({
  sshTarget: z.string().catch(""),
  orcaPath: z.string().catch(""),
  access: z
    .object({ kind: z.literal("ganger") })
    .optional()
    .catch(undefined),
});

const connectionSecretsSchema = z.object({
  webhookSecret: z.string().min(1).nullish().catch(null),
});

function hasWebhookSecret(secrets: unknown): boolean {
  const parsed = connectionSecretsSchema.safeParse(secrets);
  return parsed.success && typeof parsed.data.webhookSecret === "string";
}

const connectionConfigSchema = z.object({
  webhookSettingsUrl: z
    .url({ protocol: /^https$/ })
    .nullish()
    .catch(null),
});

function webhookSettingsUrlOf(config: unknown): string | null {
  const parsed = connectionConfigSchema.safeParse(config);
  return parsed.success ? (parsed.data.webhookSettingsUrl ?? null) : null;
}

export function webhookStateOf(
  secretSet: boolean,
  receipt: WebhookReceipt,
  now: Date,
): WebhookStateView {
  if (!secretSet) return { kind: "off" };
  const last = receipt.lastReceivedAt;
  if (receipt.firstRejectedAt !== null && receipt.rejectedCount > 0) {
    return {
      kind: "rejected",
      rejectedCount: receipt.rejectedCount,
      firstRejectedAt: receipt.firstRejectedAt.toISOString(),
      lastReceivedAt: last?.toISOString() ?? null,
      lastReceivedAgoMs: last === null ? null : Math.max(0, now.getTime() - last.getTime()),
    };
  }
  if (last === null) return { kind: "waiting" };
  return {
    kind: "receiving",
    lastReceivedAt: last.toISOString(),
    lastReceivedAgoMs: Math.max(0, now.getTime() - last.getTime()),
  };
}

export function trackerConnectionView(
  db: Database,
  connection: StoredTrackerConnection,
  now: Date,
): TrackerConnectionView {
  const secretSet = hasWebhookSecret(connection.secrets);
  return {
    id: connection.id,
    name: connection.name,
    hasWebhookSecret: secretSet,
    webhookPath: webhookPath(connection.id),
    webhook: webhookStateOf(secretSet, getWebhookReceipt(db, connection.id), now),
    webhookSettingsUrl: webhookSettingsUrlOf(connection.config),
  };
}

const runnerHealthSchema = z.object({
  online: z.boolean(),
  version: z.string().nullable(),
  prerequisites: z.array(runnerPrerequisiteSchema),
  error: z.object({ kind: z.string() }).loose().nullable(),
});

const remoteKindSchema = z.object({
  kind: z.enum(["unauthorized", "rate-limited", "not-found", "network"]),
});

const pastedToken = z.object({ token: z.string().min(1) });

export function pastedGitHubToken(secrets: unknown): string | null {
  const parsed = pastedToken.safeParse(secrets);
  return parsed.success ? parsed.data.token : null;
}

export function hasPastedGitHubToken(connections: ReadonlyArray<{ secrets: unknown }>): boolean {
  return connections.some((connection) => pastedGitHubToken(connection.secrets) !== null);
}

export function remoteErrorOfDetail(detail: unknown): RemoteError {
  const parsed = remoteKindSchema.safeParse(detail);
  return parsed.success ? parsed.data.kind : "network";
}

export function remoteErrorOf(error: unknown): RemoteError {
  if (error instanceof AdapterError) return remoteErrorOfDetail(error.detail);
  if (error instanceof z.ZodError) return "invalid";
  return "network";
}

async function remote<T>(read: () => Promise<ReadonlyArray<T>>): Promise<Remote<T>> {
  try {
    return { ok: true, items: [...(await read())] };
  } catch (error) {
    return { ok: false, error: remoteErrorOf(error) };
  }
}

export function trackerOf(
  context: SettingsContext,
  connection: StoredTrackerConnection,
): Tracker | null {
  try {
    return context.registry.createTracker(connection.kind, {
      config: connection.config,
      secrets: connection.secrets,
    });
  } catch {
    return null;
  }
}

function readingTrackerOf(
  context: SettingsContext,
  connection: StoredTrackerConnection,
): Tracker | null {
  const tracker = trackerOf(context, connection);
  if (tracker === null || context.trackerReads === undefined) return tracker;
  return context.trackerReads.wrap(context.db, connection.id, tracker);
}

const toChoice = (item: { id: string; name: string }): Choice => ({ id: item.id, name: item.name });

export function loadSettingsDb(
  context: SettingsContext,
  ws: string | undefined,
  now: Date,
): SettingsDbPage {
  const { db, secretBox } = context;
  const connections = listTrackerConnections(db, secretBox);
  const workspaces = listWorkspaces(db);
  const current = currentWorkspace(workspaces, ws);

  const runners = listRunners(db);
  const runnerProjects = new Map<string, Choice>();
  for (const runner of runners) {
    for (const project of runner.projects) {
      if (!runnerProjects.has(project.id))
        runnerProjects.set(project.id, { id: project.id, name: project.displayName });
    }
  }

  const workspace =
    current === undefined ? null : workspaceDbSettings(db, current, connections, workspaces);

  const agents = new Set<string>(KNOWN_AGENTS);
  for (const bound of workspace?.bound ?? []) {
    if (bound.mapping !== null) agents.add(bound.mapping.agent);
  }

  return {
    workspace,
    install: {
      connections: connections.map((connection) => trackerConnectionView(db, connection, now)),
      githubConnected: listCodeHostConnections(db, secretBox).length > 0,
      githubToken: hasPastedGitHubToken(listCodeHostConnections(db, secretBox)),
      unreadPrRuns: countUnreadPrRuns(db),
      addresses: addressesView(getInstallSettings(db), context.autoAllowedHosts ?? []),
      power: powerView(context.power),
      mcp: {
        launch:
          context.mcpLaunch ??
          mcpLaunch({ nodePath: "node", cliEntry: undefined, home: undefined, electron: false }),
        writeAllowed: getMcpWriteAllowed(db),
        recent: listRecentMcpActions(db, RECENT_MCP_ACTIONS).map(mcpActionView),
        now: now.toISOString(),
      },
      runners: runners.map((runner): RunnerSettingsView => {
        const config = runnerConfigSchema.safeParse(runner.config);
        return {
          id: runner.id,
          name: runner.name,
          sshTarget: config.success ? config.data.sshTarget : "",
          orcaPath: config.success ? config.data.orcaPath : "",
          access: config.success && config.data.access !== undefined ? "ganger" : "manual",
          capacity: runner.capacity,
          check: runnerCheckView(db, runner.id, runner.projects, now),
        };
      }),
    },
    runnerProjects: [...runnerProjects.values()],
    agents: [...agents],
  };
}

function currentWorkspace<W extends { id: WorkspaceId; name: string }>(
  workspaces: ReadonlyArray<W>,
  ws: string | undefined,
): W | undefined {
  const choice = resolveWorkspace(workspaces, ws);
  return choice.kind === "one" ? workspaces.find((w) => w.id === choice.workspace.id) : undefined;
}

function workspaceDbSettings(
  db: Database,
  workspace: { id: WorkspaceId; name: string; maxRunMs: number; brief: WorkspaceBrief },
  connections: ReadonlyArray<StoredTrackerConnection>,
  workspaces: ReadonlyArray<{ id: WorkspaceId; name: string }>,
): WorkspaceDbSettings {
  const mine = listWorkspaceTrackerProjects(db, workspace.id);
  const connectionChoice = (id: TrackerConnectionId): Choice => ({
    id,
    name: connections.find((c) => c.id === id)?.name ?? id,
  });
  const labelConnections = [...new Set(mine.map((p) => p.connection))];
  return {
    general: {
      id: workspace.id,
      name: workspace.name,
      maxRunMinutes: Math.round(workspace.maxRunMs / 60_000),
      brief: workspace.brief,
      agentProtocol: ASK_GUIDE,
    },
    connections: connections.map(toChoice),
    ownership: projectOwnership(db, workspace.id, workspaces),
    bound: mine.map((project): BoundProjectSettings => {
      const mapping = getMapping(db, project.connection, project.projectId);
      return {
        connection: connectionChoice(project.connection),
        trackerKind: connections.find((c) => c.id === project.connection)?.kind ?? null,
        project: { id: project.projectId, name: project.name },
        mapping:
          mapping === null
            ? null
            : {
                agent: mapping.agent,
                model: mapping.model,
                repos: mapping.repos.map((repo) => ({
                  id: repo.project,
                  isDefault: repo.isDefault,
                  labelId: repo.labelId,
                })),
              },
        inProgressStateId: project.inProgressStateId,
        mergedStateId: project.mergedStateId,
      };
    }),
    labels: labelConnections.map((connectionId): ConnectionLabelSettings => {
      const projects = mine.filter((p) => p.connection === connectionId);
      return {
        connection: connectionChoice(connectionId),
        projectIds: projects.map((p) => p.projectId),
        labelId: getAutoAssignLabel(db, workspace.id, toTrackerConnectionId(connectionId)),
        repoLabels: projects.flatMap((project) =>
          (getMapping(db, project.connection, project.projectId)?.repos ?? []).flatMap((repo) =>
            repo.labelId === null
              ? []
              : [{ labelId: repo.labelId, repo: repo.project, project: project.name }],
          ),
        ),
      };
    }),
  };
}

function projectOwnership(
  db: Database,
  workspaceId: WorkspaceId | null,
  workspaces: ReadonlyArray<{ id: WorkspaceId; name: string }>,
): ProjectOwnership[] {
  const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));
  const queued = workspaceId === null ? [] : listRuns(db, { states: ["queued"], workspaceId });
  return listWorkspaceTrackerProjects(db).map((bound): ProjectOwnership => {
    const isMine = bound.workspaceId === workspaceId;
    return {
      connection: bound.connection,
      projectId: bound.projectId,
      name: bound.name,
      owner: isMine
        ? { kind: "this" }
        : {
            kind: "other",
            workspace: {
              id: bound.workspaceId,
              name: workspaceName.get(bound.workspaceId) ?? bound.workspaceId,
            },
          },
      mappings: isMine && getMapping(db, bound.connection, bound.projectId) !== null ? 1 : 0,
      queuedRuns: isMine
        ? queued.filter(
            (run) =>
              run.ticket.connection === bound.connection && run.trackerProject === bound.projectId,
          ).length
        : 0,
    };
  });
}

export async function loadTrackerProjectLists(
  context: SettingsContext,
): Promise<TrackerProjectList[]> {
  const connections = listTrackerConnections(context.db, context.secretBox);
  return Promise.all(
    connections.map(async (connection): Promise<TrackerProjectList> => {
      const tracker = readingTrackerOf(context, connection);
      return {
        connection: connection.id,
        projects:
          tracker === null
            ? { ok: false, error: "invalid" }
            : await remote(async () => (await tracker.listProjects()).map(toChoice)),
      };
    }),
  );
}

export async function loadBoundProjectReads(
  context: SettingsContext,
  ws: string | undefined,
): Promise<BoundProjectReads[]> {
  const { db, secretBox } = context;
  const current = currentWorkspace(listWorkspaces(db), ws);
  if (current === undefined) return [];
  const connections = listTrackerConnections(db, secretBox);
  const trackers = new Map(connections.map((c) => [c.id, readingTrackerOf(context, c)]));
  return Promise.all(
    listWorkspaceTrackerProjects(db, current.id).map(
      async (project): Promise<BoundProjectReads> => {
        const tracker = trackers.get(project.connection) ?? null;
        const [states, labels] =
          tracker === null
            ? [UNREADABLE, UNREADABLE]
            : await Promise.all([
                remote(async () => (await tracker.listStates(project.projectId)).map(toChoice)),
                remote(async () =>
                  (await tracker.listLabels(project.projectId))
                    .map(toChoice)
                    .toSorted((a, b) => a.name.localeCompare(b.name)),
                ),
              ]);
        return { connection: project.connection, projectId: project.projectId, states, labels };
      },
    ),
  );
}

const UNREADABLE: Remote<Choice> = { ok: false, error: "invalid" };

export async function loadSettingsPage(
  context: SettingsContext,
  ws: string | undefined,
  now: Date,
): Promise<SettingsPage> {
  const db = loadSettingsDb(context, ws, now);
  if (db.workspace === null) return mergeSettingsPage(db, { projects: [], reads: [] });
  const [projects, reads] = await Promise.all([
    loadTrackerProjectLists(context),
    loadBoundProjectReads(context, ws),
  ]);
  return mergeSettingsPage(db, { projects, reads });
}

export async function loadTrackerProjectChoices(
  context: SettingsContext,
  workspaceId: WorkspaceId | null,
): Promise<ConnectionProjects[]> {
  const { db, secretBox } = context;
  return connectionProjectsOf(
    listTrackerConnections(db, secretBox).map(toChoice),
    projectOwnership(db, workspaceId, listWorkspaces(db)),
    await loadTrackerProjectLists(context),
  );
}

export function hasPendingRunnerChecks(db: Database): boolean {
  return listPendingRunnerCheckRequests(db).length > 0;
}

function runnerCheckView(
  db: Database,
  runnerId: RunnerId,
  projects: ReadonlyArray<{ id: string; displayName: string }>,
  now: Date,
): RunnerCheckView | null {
  const request = getRunnerCheckRequest(db, runnerId);
  if (request === null) return null;
  switch (request.status) {
    case "pending":
      return {
        status: "pending",
        requestedAt: request.requestedAt.toISOString(),
        requestedAgoMs: Math.max(0, now.getTime() - request.requestedAt.getTime()),
      };
    case "failed":
      return {
        status: "failed",
        completedAt: request.completedAt.toISOString(),
        completedAgoMs: Math.max(0, now.getTime() - request.completedAt.getTime()),
        error: request.error,
      };
    case "done": {
      const completedAt = request.completedAt.toISOString();
      const completedAgoMs = Math.max(0, now.getTime() - request.completedAt.getTime());
      const parsed = runnerHealthSchema.safeParse(request.result);
      if (!parsed.success) return { status: "unreadable", completedAt, completedAgoMs };
      return {
        status: "done",
        completedAt,
        completedAgoMs,
        online: parsed.data.online,
        version: parsed.data.version,
        prerequisites: parsed.data.prerequisites.map((p) => ({
          id: p.id,
          name: p.name,
          satisfied: p.satisfied,
          hint: p.hint,
          blocksAssignment: p.blocksAssignment,
          project: prerequisiteProject(p.id, projects),
          failure: p.failure ?? null,
        })),
        error: parsed.data.error?.kind ?? null,
      };
    }
  }
}
