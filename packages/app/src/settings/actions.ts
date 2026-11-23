import { randomUUID } from "node:crypto";
import {
  AUTO_ASSIGN_LABEL_NAME,
  AdapterError,
  WORKSPACE_BRIEF_MAX_LENGTH,
  findLabelNamed,
  toAgentId,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerConnectionId,
  toTrackerProjectId,
  toTrackerStateId,
  workspaceBriefLength,
} from "@ganger/core";
import type { RunnerId, RunnerKind, TrackerConnectionId } from "@ganger/core";
import { TOKEN_ONLY } from "@ganger/codehost-github";
import {
  clearMergeDenials,
  forgetWebhookReceipt,
  inTransaction,
  getAutoAssignLabel,
  getInstallSettings,
  getMapping,
  getTrackerConnection,
  getWorkspaceTrackerProject,
  listCodeHostConnections,
  listWorkspaceTrackerProjects,
  listRunners,
  listWorkspaces,
  markTrackerChanged,
  markTrackerReadsStale,
  recordSettingsChange,
  removeWorkspaceTrackerProject,
  requestRunnerCheck,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveCheckedWebhookAddress,
  saveInstallAddresses,
  replaceMapping,
  saveMapping,
  saveMcpWriteAllowed,
  saveRunner,
  saveRunnerCapacity,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceBrief,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { WorkspaceId } from "@ganger/db";
import { z } from "zod";
import { allowedHosts, hostnameOfHostHeader, isHostAllowed } from "../request-guard.js";
import { checkWebhookAddress } from "../webhook-address.js";
import type { PingFetch, WebhookAddressFailure } from "../webhook-address.js";
import { remoteErrorOf, remoteErrorOfDetail, trackerConnectionView, trackerOf } from "./load.js";
import type { SettingsContext } from "./load.js";
import { MAX_MODEL_LENGTH, MAX_NAME_LENGTH, MAX_RUN_MINUTES } from "./model.js";
import type {
  ConnectionSaveReason,
  LabelCreateResult,
  MappingSaveReason,
  RemoteError,
  SaveResult,
  WebhookStateView,
} from "./model.js";

export const RUNNER_KIND: RunnerKind = toRunnerKind("orca");

export const idSchema = z.string().trim().min(1);
export { MAX_NAME_LENGTH };
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Array.from(value).length <= MAX_NAME_LENGTH);
const id = idSchema;
const name = nameSchema;

function workspaceOf(context: SettingsContext, ws: string): WorkspaceId | null {
  return listWorkspaces(context.db).find((w) => w.id === ws)?.id ?? null;
}

export const generalInput = z.object({
  ws: id,
  name,
  maxRunMinutes: z.number().int().min(1).max(MAX_RUN_MINUTES),
});

export function saveGeneral(
  context: SettingsContext,
  input: z.infer<typeof generalInput>,
): SaveResult<"not-found"> {
  const workspaceId = workspaceOf(context, input.ws);
  if (workspaceId === null) return { ok: false, reason: "not-found" };
  saveWorkspace(context.db, {
    id: workspaceId,
    name: input.name,
    maxRunMs: input.maxRunMinutes * 60_000,
  });
  return { ok: true };
}

const workspaceBriefText = z
  .string()
  .max(WORKSPACE_BRIEF_MAX_LENGTH * 4)
  .transform((value) => value.trim())
  .refine((value) => workspaceBriefLength(value) <= WORKSPACE_BRIEF_MAX_LENGTH);

export const briefInput = z.object({
  ws: id,
  before: workspaceBriefText,
  after: workspaceBriefText,
});

export function saveBrief(
  context: SettingsContext,
  input: z.infer<typeof briefInput>,
): SaveResult<"not-found"> {
  const workspaceId = workspaceOf(context, input.ws);
  if (workspaceId === null) return { ok: false, reason: "not-found" };
  const saved = saveWorkspaceBrief(context.db, {
    id: workspaceId,
    brief: { before: input.before, after: input.after },
  });
  return saved ? { ok: true } : { ok: false, reason: "not-found" };
}

export const trackerProjectInput = z.object({
  ws: id,
  connectionId: id,
  projectId: id,
});

export const addTrackerProjectInput = trackerProjectInput.extend({ name });

export function addTrackerProject(
  context: SettingsContext,
  input: z.infer<typeof addTrackerProjectInput>,
): SaveResult<"not-found" | "taken"> {
  const workspaceId = workspaceOf(context, input.ws);
  const connection = toTrackerConnectionId(input.connectionId);
  if (
    workspaceId === null ||
    getTrackerConnection(context.db, context.secretBox, connection) === null
  ) {
    return { ok: false, reason: "not-found" };
  }
  const projectId = toTrackerProjectId(input.projectId);
  const existing = getWorkspaceTrackerProject(context.db, connection, projectId);
  if (existing !== null) {
    return existing.workspaceId === workspaceId ? { ok: true } : { ok: false, reason: "taken" };
  }
  const saved = saveWorkspaceTrackerProject(context.db, {
    workspaceId,
    connection,
    projectId,
    name: input.name,
    inProgressStateId: null,
  });
  if (!saved) return { ok: false, reason: "taken" };
  return { ok: true };
}

export function removeTrackerProject(
  context: SettingsContext,
  input: z.infer<typeof trackerProjectInput>,
): SaveResult<"not-found"> {
  const workspaceId = workspaceOf(context, input.ws);
  if (workspaceId === null) return { ok: false, reason: "not-found" };
  const connection = toTrackerConnectionId(input.connectionId);
  const removed = removeWorkspaceTrackerProject(context.db, {
    workspaceId,
    connection,
    projectId: toTrackerProjectId(input.projectId),
  });
  if (!removed) return { ok: false, reason: "not-found" };
  return { ok: true };
}

function boundProject(context: SettingsContext, input: z.infer<typeof trackerProjectInput>) {
  const workspaceId = workspaceOf(context, input.ws);
  if (workspaceId === null) return null;
  const project = getWorkspaceTrackerProject(
    context.db,
    toTrackerConnectionId(input.connectionId),
    toTrackerProjectId(input.projectId),
  );
  return project?.workspaceId === workspaceId ? project : null;
}

export const mappingInput = trackerProjectInput.extend({
  runnerProjectId: id,
  agentId: id,
  model: z
    .string()
    .trim()
    .max(MAX_MODEL_LENGTH)
    .refine((value) => value === "" || /^[^\s\p{Cc}-][^\s\p{Cc}]*$/u.test(value))
    .optional(),
});

export function saveMappingSetting(
  context: SettingsContext,
  input: z.infer<typeof mappingInput>,
): SaveResult<"not-found"> {
  const project = boundProject(context, input);
  if (project === null) return { ok: false, reason: "not-found" };
  saveMapping(context.db, {
    connection: project.connection,
    trackerProject: project.projectId,
    runnerProject: toRunnerProjectId(input.runnerProjectId),
    agent: toAgentId(input.agentId),
    model: input.model === undefined || input.model === "" ? null : input.model,
  });
  return { ok: true };
}

export const MAX_MAPPING_REPOS = 50;

export const mappingStateInput = trackerProjectInput.extend({
  agentId: id,
  model: mappingInput.shape.model,
  repos: z
    .array(z.object({ runnerProjectId: id, isDefault: z.boolean(), labelId: id.nullable() }))
    .min(1)
    .max(MAX_MAPPING_REPOS),
});

export function saveMappingState(
  context: SettingsContext,
  input: z.infer<typeof mappingStateInput>,
): SaveResult<MappingSaveReason> {
  const project = boundProject(context, input);
  if (project === null) return { ok: false, reason: "not-found" };
  const autoAssignLabel = getAutoAssignLabel(context.db, project.workspaceId, project.connection);
  if (autoAssignLabel !== null && input.repos.some((repo) => repo.labelId === autoAssignLabel)) {
    return { ok: false, reason: "auto-assign-label" };
  }
  const saved = replaceMapping(context.db, {
    connection: project.connection,
    trackerProject: project.projectId,
    agent: toAgentId(input.agentId),
    model: input.model === undefined || input.model === "" ? null : input.model,
    repos: input.repos.map((repo) => ({
      project: toRunnerProjectId(repo.runnerProjectId),
      isDefault: repo.isDefault,
      labelId: repo.labelId === null ? null : toLabelId(repo.labelId),
    })),
  });
  if (saved.ok) markTrackerReadsStale(context.db, project.connection);
  return saved;
}

export const inProgressInput = trackerProjectInput.extend({ stateId: id });

export function saveInProgressState(
  context: SettingsContext,
  input: z.infer<typeof inProgressInput>,
): SaveResult<"not-found"> {
  const project = boundProject(context, input);
  if (project === null) return { ok: false, reason: "not-found" };
  saveWorkspaceTrackerProject(context.db, {
    ...project,
    inProgressStateId: toTrackerStateId(input.stateId),
  });
  return { ok: true };
}

export const mergedStateInput = trackerProjectInput.extend({ stateId: id.nullable() });

export function saveMergedState(
  context: SettingsContext,
  input: z.infer<typeof mergedStateInput>,
): SaveResult<"not-found"> {
  const project = boundProject(context, input);
  if (project === null) return { ok: false, reason: "not-found" };
  saveWorkspaceTrackerProject(context.db, {
    ...project,
    mergedStateId: input.stateId === null ? null : toTrackerStateId(input.stateId),
  });
  return { ok: true };
}

export const labelInput = z.object({ ws: id, connectionId: id, labelId: id });

export const createLabelInput = z.object({ ws: id, connectionId: id });

export async function createAutoAssignLabel(
  context: SettingsContext,
  input: z.infer<typeof createLabelInput>,
  color: string,
): Promise<LabelCreateResult> {
  const workspaceId = workspaceOf(context, input.ws);
  const connection = toTrackerConnectionId(input.connectionId);
  const stored =
    workspaceId === null ? null : getTrackerConnection(context.db, context.secretBox, connection);
  const tracker = stored === null ? null : trackerOf(context, stored);
  if (workspaceId === null || tracker === null) return { ok: false, reason: "not-found" };
  const projects = listWorkspaceTrackerProjects(context.db, workspaceId).filter(
    (project) => project.connection === connection,
  );
  try {
    const lists = await Promise.all(projects.map((p) => tracker.listLabels(p.projectId)));
    const label =
      findLabelNamed(lists.flat(), AUTO_ASSIGN_LABEL_NAME) ??
      (await tracker.createLabel({ name: AUTO_ASSIGN_LABEL_NAME, color }));
    const created = !lists.flat().some((existing) => existing.id === label.id);
    if (repoLabelIds(context, workspaceId, connection).has(label.id)) {
      return { ok: false, reason: "repo-label" };
    }
    saveAutoAssignLabel(context.db, { workspaceId, connection, labelId: label.id });
    markTrackerChanged(context.db, connection);
    return { ok: true, labelId: label.id, name: label.name, created };
  } catch (error) {
    return { ok: false, reason: error instanceof AdapterError ? remoteErrorOf(error) : "rejected" };
  }
}

export function repoLabelIds(
  context: SettingsContext,
  workspaceId: WorkspaceId,
  connection: TrackerConnectionId,
): Set<string> {
  const ids = new Set<string>();
  for (const project of listWorkspaceTrackerProjects(context.db, workspaceId)) {
    if (project.connection !== connection) continue;
    for (const repo of getMapping(context.db, connection, project.projectId)?.repos ?? []) {
      if (repo.labelId !== null) ids.add(repo.labelId);
    }
  }
  return ids;
}

export function saveLabel(
  context: SettingsContext,
  input: z.infer<typeof labelInput>,
): SaveResult<"not-found" | "repo-label"> {
  const workspaceId = workspaceOf(context, input.ws);
  const connection = toTrackerConnectionId(input.connectionId);
  if (
    workspaceId === null ||
    getTrackerConnection(context.db, context.secretBox, connection) === null
  ) {
    return { ok: false, reason: "not-found" };
  }
  if (repoLabelIds(context, workspaceId, connection).has(input.labelId)) {
    return { ok: false, reason: "repo-label" };
  }
  saveAutoAssignLabel(context.db, {
    workspaceId,
    connection,
    labelId: toLabelId(input.labelId),
  });
  return { ok: true };
}

const secret = z.string().trim().max(1000);

const DEFAULT_CONNECTION_NAME = "Linear";

function connectionNameOf(organizationName: string | null): string | null {
  const trimmed = Array.from(organizationName?.trim() ?? "")
    .slice(0, MAX_NAME_LENGTH)
    .join("")
    .trim();
  return trimmed === "" ? null : trimmed;
}

export const trackerConnectionInput = z.object({
  id: id.optional(),
  name: name.optional(),
  apiKey: secret,
  webhookSecret: secret,
});

const trackerSecretsSchema = z
  .object({ apiKey: z.string(), webhookSecret: z.string().nullish() })
  .loose();

export async function saveTrackerConnectionSetting(
  context: SettingsContext,
  input: z.infer<typeof trackerConnectionInput>,
  now: Date,
): Promise<SaveResult<ConnectionSaveReason>> {
  const existing =
    input.id === undefined
      ? null
      : getTrackerConnection(context.db, context.secretBox, toTrackerConnectionId(input.id));
  if (input.id !== undefined && existing === null) return { ok: false, reason: "not-found" };

  const kind = existing?.kind ?? context.registry.kinds().trackers[0];
  if (kind === undefined) return { ok: false, reason: "invalid" };
  const stored = existing === null ? null : trackerSecretsSchema.safeParse(existing.secrets);
  const previous = stored?.success === true ? stored.data : null;
  const apiKey = input.apiKey === "" ? previous?.apiKey : input.apiKey;
  if (apiKey === undefined || apiKey === "") return { ok: false, reason: "missing-key" };
  const webhookSecret =
    input.webhookSecret === "" ? (previous?.webhookSecret ?? null) : input.webhookSecret;
  const secrets = { ...previous, apiKey, webhookSecret };
  let config: unknown = existing?.config ?? {};

  let organizationName: string | null = null;
  if (input.apiKey !== "") {
    const check = await checkWith<{
      ok: true;
      organizationName: string | null;
      webhookSettingsUrl?: string;
    }>(() => context.registry.createTracker(kind, { config, secrets }).checkConnection());
    if (!check.ok) return { ok: false, reason: check.reason };
    organizationName = connectionNameOf(check.organizationName);
    if (check.webhookSettingsUrl !== undefined) {
      config = { ...configObject(config), webhookSettingsUrl: check.webhookSettingsUrl };
    }
  }
  const id = existing?.id ?? toTrackerConnectionId(randomUUID());
  inTransaction(context.db, () => {
    saveTrackerConnection(
      context.db,
      context.secretBox,
      {
        id,
        kind,
        name: input.name ?? existing?.name ?? organizationName ?? DEFAULT_CONNECTION_NAME,
        config,
        secrets,
      },
      now,
    );
    if (webhookSecret !== (previous?.webhookSecret ?? null))
      forgetWebhookReceipt(context.db, id, now);
  });
  return { ok: true };
}

const configObjectSchema = z.record(z.string(), z.unknown());

function configObject(config: unknown): Record<string, unknown> {
  const parsed = configObjectSchema.safeParse(config);
  return parsed.success ? parsed.data : {};
}

export const connectionIdInput = z.object({ id });

export function turnOffWebhook(
  context: SettingsContext,
  input: z.infer<typeof connectionIdInput>,
  now: Date,
): SaveResult<"not-found"> {
  const existing = getTrackerConnection(
    context.db,
    context.secretBox,
    toTrackerConnectionId(input.id),
  );
  if (existing === null) return { ok: false, reason: "not-found" };
  const stored = trackerSecretsSchema.safeParse(existing.secrets);
  if (!stored.success) return { ok: false, reason: "not-found" };
  inTransaction(context.db, () => {
    saveTrackerConnection(
      context.db,
      context.secretBox,
      { ...existing, secrets: { ...stored.data, webhookSecret: null } },
      now,
    );
    forgetWebhookReceipt(context.db, existing.id, now);
  });
  return { ok: true };
}

export function webhookStateNow(
  context: SettingsContext,
  input: z.infer<typeof connectionIdInput>,
  now: Date,
): WebhookStateView | null {
  const connection = getTrackerConnection(
    context.db,
    context.secretBox,
    toTrackerConnectionId(input.id),
  );
  return connection === null ? null : trackerConnectionView(context.db, connection, now).webhook;
}

export const webhookAddressInput = z.object({ address: z.string().trim().max(2000) });

export async function verifyWebhookAddress(
  context: SettingsContext,
  input: z.infer<typeof webhookAddressInput>,
  now: Date,
  fetch: PingFetch,
): Promise<SaveResult<WebhookAddressFailure>> {
  const install = getInstallSettings(context.db);
  const check = await checkWebhookAddress(input.address, {
    fetch,
    instanceId: install.instanceId,
  });
  if (!check.ok) return check;
  saveCheckedWebhookAddress(context.db, check.address, now);
  return { ok: true };
}

export async function checkTrackerConnection(
  context: SettingsContext,
  input: z.infer<typeof connectionIdInput>,
): Promise<SaveResult<ConnectionSaveReason>> {
  const connection = getTrackerConnection(
    context.db,
    context.secretBox,
    toTrackerConnectionId(input.id),
  );
  if (connection === null) return { ok: false, reason: "not-found" };
  markTrackerChanged(context.db, connection.id);
  return checkWith(() =>
    context.registry
      .createTracker(connection.kind, { config: connection.config, secrets: connection.secrets })
      .checkConnection(),
  );
}

export const githubTokenInput = z.object({ token: z.string().trim().min(1).max(1000) });

export async function saveGitHubToken(
  context: SettingsContext,
  input: z.infer<typeof githubTokenInput>,
  now: Date,
): Promise<SaveResult<RemoteError>> {
  const existing = listCodeHostConnections(context.db, context.secretBox)[0];
  const kind = existing?.kind ?? context.registry.kinds().codeHosts[0];
  if (kind === undefined) return { ok: false, reason: "invalid" };
  const config = existing?.config ?? {};
  const secrets = { token: input.token };
  const check = await checkWith(() =>
    context.registry
      .createCodeHost(kind, { config: { ...config, credentials: TOKEN_ONLY }, secrets })
      .checkConnection(),
  );
  if (!check.ok) return check;
  saveCodeHostConnection(
    context.db,
    context.secretBox,
    {
      id: existing?.id ?? toCodeHostConnectionId(kind),
      kind,
      name: existing?.name ?? kind,
      config,
      secrets,
    },
    now,
  );
  clearMergeDenials(context.db);
  return { ok: true };
}

async function checkWith<C extends { ok: true }>(
  run: () => Promise<C | { ok: false; error: unknown }>,
): Promise<C | { ok: false; reason: RemoteError }> {
  try {
    const result = await run();
    if (result.ok) return result;
    return { ok: false, reason: remoteErrorOfDetail(result.error) };
  } catch (error) {
    return { ok: false, reason: remoteErrorOf(error) };
  }
}

export const RUNNER_CAPACITY_MAX = 100;
const capacity = z.number().int().min(1).max(RUNNER_CAPACITY_MAX);

export const runnerInput = z.object({
  id: id.optional(),
  name,
  sshTarget: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[^-\s\p{Cc}][^\s\p{Cc}]*$/u),
  orcaPath: z.string().trim().max(1000),
  capacity,
});

export function saveRunnerSetting(
  context: SettingsContext,
  input: z.infer<typeof runnerInput>,
  now: Date,
): { ok: true; runnerId: RunnerId } | { ok: false; reason: "not-found" } {
  const existing =
    input.id === undefined ? undefined : listRunners(context.db).find((r) => r.id === input.id);
  if (input.id !== undefined && existing === undefined) return { ok: false, reason: "not-found" };
  const runnerId = existing?.id ?? toRunnerId(randomUUID());
  saveRunner(
    context.db,
    {
      id: runnerId,
      kind: existing?.kind ?? RUNNER_KIND,
      name: input.name,
      config: {
        ...configKeepingAccessFor(existing?.config, input.sshTarget),
        sshTarget: input.sshTarget,
        orcaPath: input.orcaPath,
      },
      capacity: input.capacity,
    },
    now,
  );
  requestRunnerCheck(context.db, runnerId, now);
  return { ok: true, runnerId };
}

function looseConfig(config: unknown): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(config);
  return parsed.success ? parsed.data : {};
}

function configKeepingAccessFor(config: unknown, sshTarget: string): Record<string, unknown> {
  const { access, ...rest } = looseConfig(config);
  return rest["sshTarget"] === sshTarget && access !== undefined ? { ...rest, access } : rest;
}

export const runnerCapacityInput = z.object({ id, capacity });

export function saveRunnerCapacitySetting(
  context: SettingsContext,
  input: z.infer<typeof runnerCapacityInput>,
): SaveResult<"not-found"> {
  return saveRunnerCapacity(context.db, toRunnerId(input.id), input.capacity)
    ? { ok: true }
    : { ok: false, reason: "not-found" };
}

export const runnerIdInput = z.object({ id });

export function requestRunnerCheckSetting(
  context: SettingsContext,
  input: z.infer<typeof runnerIdInput>,
  now: Date,
): SaveResult<"not-found"> {
  const runner = listRunners(context.db).find((r) => r.id === input.id);
  if (runner === undefined) return { ok: false, reason: "not-found" };
  requestRunnerCheck(context.db, runner.id, now);
  return { ok: true };
}

export const addressesInput = z.object({
  webAddress: z.string().trim().max(2000),
  webhookAddress: z.string().trim().max(2000),
});

export function normalizeAddress(value: string): string | null | undefined {
  if (value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const plain =
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";
  return plain && hostnameOfHostHeader(url.host) !== null ? url.origin : undefined;
}

export type AddressSaveReason = "invalid-web-address" | "invalid-webhook-address" | "locks-out";

export interface RequestOrigin {
  host: string | null;
  bindHost: string | null;
  tailnetHosts?: ReadonlyArray<string>;
  webPort?: number | null;
}

export function saveAddresses(
  context: SettingsContext,
  input: z.infer<typeof addressesInput>,
  now: Date,
  from: RequestOrigin,
): SaveResult<AddressSaveReason> {
  const webAddress = normalizeAddress(input.webAddress);
  if (webAddress === undefined) return { ok: false, reason: "invalid-web-address" };
  const webhookAddress = normalizeAddress(input.webhookAddress);
  if (webhookAddress === undefined) return { ok: false, reason: "invalid-webhook-address" };
  const current = hostnameOfHostHeader(from.host);
  if (current !== null) {
    const next = allowedHosts({
      bindHost: from.bindHost,
      webAddress,
      webhookAddress,
      tailnetHosts: from.tailnetHosts ?? [],
      webPort: from.webPort ?? null,
    });
    if (!isHostAllowed(from.host, "/", next)) return { ok: false, reason: "locks-out" };
  }
  saveInstallAddresses(context.db, { webAddress, webhookAddress }, now);
  return { ok: true };
}

export const powerInput = z.object({ preventSleep: z.boolean() });

export function savePowerSetting(
  context: SettingsContext,
  input: z.infer<typeof powerInput>,
): SaveResult<"unavailable"> {
  if (context.power === undefined) return { ok: false, reason: "unavailable" };
  context.power.write({ preventSleep: input.preventSleep });
  recordSettingsChange(context.db);
  return { ok: true };
}

export const mcpWriteInput = z.object({ allowed: z.boolean() });

export function saveMcpWriteSetting(
  context: SettingsContext,
  input: z.infer<typeof mcpWriteInput>,
  now: Date,
): SaveResult {
  saveMcpWriteAllowed(context.db, input.allowed, now);
  return { ok: true };
}
