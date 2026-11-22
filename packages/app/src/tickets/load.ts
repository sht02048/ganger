import {
  AdapterError,
  blockedProjectsOf,
  checkAssignment,
  isBlockerFinished,
  summarizeRunOutcome,
  toTicketKey,
  usageLimitsAt,
} from "@ganger/core";
import type {
  AdapterRegistry,
  RunId,
  RunnerId,
  SummaryOutcome,
  Tracker,
  TrackerConnectionId,
  TrackerTicket,
} from "@ganger/core";
import {
  getAutoAssignLabel,
  getMapping,
  getTrackerConnection,
  listRunners,
  listRunsWithRecords,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  toWorkspaceId,
} from "@ganger/db";
import type {
  Database,
  SecretBox,
  StoredTrackerConnection,
  StoredWorkspaceTrackerProject,
} from "@ganger/db";
import { z } from "zod";
import { isWebUrl } from "../format/url.js";
import { pendingInput } from "../home/load.js";
import type { BlockerReason } from "../runs/model.js";
import { loadQueueReasons } from "../runs/queue-reasons.js";
import type { QueuedReasonCode } from "../runs/queue-reasons.js";
import { remoteErrorOf } from "../settings/load.js";
import type { Remote } from "../settings/model.js";
import { resolveWorkspace } from "../shell/model.js";
import type { WorkspaceChoice } from "../shell/model.js";
import type { TrackerReads } from "../tracker-reads.js";
import { mergeTicketsPage, ticketId } from "./merge.js";
import type {
  TicketBlockersResult,
  TicketMappingFacts,
  TicketProjectFacts,
  TicketRun,
  TicketRunFacts,
  TicketRunsData,
  TicketsPage,
  TrackerLabel,
  TrackerLoadError,
  TrackerProjectLabels,
  TrackerTicketView,
  TrackerTicketsData,
  TrackerTruncation,
  WaitingTicket,
} from "./model.js";

export interface TicketsContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
  trackerReads?: TrackerReads;
}

export const PAGE_SIZE = 250;
export const MAX_PAGES = 4;

export async function loadTicketsPage(
  context: TicketsContext,
  ws: string | undefined,
  now: Date,
): Promise<TicketsPage> {
  const runs = loadTicketRuns(context.db, ws, now);
  const tracker = await loadTrackerTickets(context, ws);
  return mergeTicketsPage(runs, tracker);
}

function workspaceOf(db: Database, ws: string | undefined): WorkspaceChoice {
  return resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
}

export function loadTicketRuns(db: Database, ws: string | undefined, now: Date): TicketRunsData {
  const workspace = workspaceOf(db, ws);
  const storedRunners = listRunners(db);
  const runners = storedRunners.map((runner) => ({
    id: runner.id,
    name: runner.name,
    online: runner.online,
    assignmentBlocked: runner.assignmentBlocked,
    projects: runner.projects.map((p) => p.id),
    blockedProjects: runner.online ? blockedProjectsOf(runner.prerequisites ?? []) : [],
    usageLimits: usageLimitsAt(runner.providerUsage, now).map((limit) => ({
      provider: limit.provider,
      resetsInMs: limit.until.getTime() - now.getTime(),
    })),
  }));
  const agents = mappingAgents(db);
  const base = { workspace, runners, agents };
  if (workspace.kind !== "one")
    return { ...base, projects: [], repoNames: {}, runsByTicket: {}, waitingByBlocker: {} };

  const workspaceId = toWorkspaceId(workspace.workspace.id);
  const runnerNames = new Map(storedRunners.map((runner) => [runner.id, runner.name]));
  const repoNames = Object.fromEntries(
    storedRunners.flatMap((runner) => runner.projects.map((p) => [p.id, p.displayName] as const)),
  );
  const projects = listWorkspaceTrackerProjects(db, workspaceId).map(
    (project): TicketProjectFacts => ({
      connection: project.connection,
      projectId: project.projectId,
      name: project.name,
      mapping: mappingFacts(db, project),
      autoAssignLabel: getAutoAssignLabel(db, workspaceId, project.connection),
    }),
  );
  const queueReasons = loadQueueReasons(db, now);
  const runsByTicket: Record<string, TicketRunFacts> = {};
  const waitingByBlocker: Record<string, WaitingTicket[]> = {};
  for (const [id, runs] of groupRuns(listRunsWithRecords(db, { workspaceId }))) {
    const facts = runFacts(db, runs, runnerNames, queueReasons, now);
    runsByTicket[id] = facts;
    const ticket = runs[0]?.run;
    if (ticket === undefined || facts.blockerWait === null) continue;
    for (const blocker of facts.blockerWait.blockers) {
      if (isBlockerFinished(blocker.stateCategory)) continue;
      const blockerId = ticketId(ticket.ticket.connection, blocker.key);
      (waitingByBlocker[blockerId] ??= []).push({
        key: ticket.ticket.key,
        title: runs.at(-1)?.run.ticketTitle ?? null,
      });
    }
  }
  return { ...base, projects, repoNames, runsByTicket, waitingByBlocker };
}

function blockerWaitOf(code: QueuedReasonCode | undefined): BlockerReason | null {
  return code?.kind === "blockers-waiting" || code?.kind === "blockers-stuck" ? code : null;
}

export async function loadTicketBlockers(
  context: TicketsContext,
  input: { ws: string | undefined; connection: string; key: string },
): Promise<TicketBlockersResult> {
  const { db } = context;
  const workspace = workspaceOf(db, input.ws);
  if (workspace.kind !== "one") return { ok: false, reason: "failed" };
  const project = listWorkspaceTrackerProjects(db, toWorkspaceId(workspace.workspace.id)).find(
    (candidate) => candidate.connection === input.connection,
  );
  if (project === undefined) return { ok: false, reason: "unknown-connection" };
  const stored = getTrackerConnection(db, context.secretBox, project.connection);
  if (stored === null) return { ok: false, reason: "unknown-connection" };
  const tracker = context.registry.createTracker(stored.kind, {
    config: stored.config,
    secrets: stored.secrets,
  });
  try {
    if (tracker.getTicketRelations === undefined) return { ok: true, blockers: [] };
    const relations = await tracker.getTicketRelations(toTicketKey(input.key));
    if (relations === null) return { ok: false, reason: "not-found" };
    return {
      ok: true,
      blockers: relations.blockers.map((blocker) => ({
        key: blocker.key,
        title: blocker.title,
        stateName: blocker.state.name,
        stateCategory: blocker.state.category,
      })),
    };
  } catch (error) {
    return { ok: false, reason: loadErrorReason(error) };
  }
}

function mappingFacts(
  db: Database,
  project: StoredWorkspaceTrackerProject,
): TicketMappingFacts | null {
  const mapping = getMapping(db, project.connection, project.projectId);
  if (mapping === null) return null;
  return {
    agent: mapping.agent,
    defaultRepo: mapping.defaultRepo,
    repos: mapping.repos.map((repo) => ({
      project: repo.project,
      isDefault: repo.isDefault,
      labelId: repo.labelId,
    })),
  };
}

function runFacts(
  db: Database,
  runs: ReadonlyArray<RunWithRecords>,
  runnerNames: ReadonlyMap<RunnerId, string>,
  queueReasons: ReadonlyMap<RunId, QueuedReasonCode>,
  now: Date,
): TicketRunFacts {
  const stored = runs.map(({ run }) => run);
  const first = stored[0];
  const check =
    first === undefined ? { ok: true } : checkAssignment({ ticket: first.ticket, runs: stored });
  const active = stored.findLast((run) => run.state !== "ended");
  const last = stored.at(-1);
  return {
    blockerWait: active?.state === "queued" ? blockerWaitOf(queueReasons.get(active.id)) : null,
    runs: runs.toReversed().map((run) => toTicketRun(db, run, runnerNames, now)),
    activeRunId: check.ok ? null : (active?.id ?? ""),
    retryRepo:
      last !== undefined &&
      last.state === "ended" &&
      retriesLastRepo(summarizeRunOutcome(last).outcome)
        ? last.runnerProject
        : null,
  };
}

export async function loadTrackerTickets(
  context: TicketsContext,
  ws: string | undefined,
): Promise<TrackerTicketsData> {
  const { db } = context;
  const workspace = workspaceOf(db, ws);
  const empty = { workspace, tickets: [], labels: [], errors: [], truncated: [] };
  if (workspace.kind !== "one") return empty;

  const projects = listWorkspaceTrackerProjects(db, toWorkspaceId(workspace.workspace.id));
  const trackers = new Map<TrackerConnectionId, Tracker | null>();
  const trackerOf = (connection: TrackerConnectionId): Tracker | null => {
    let tracker = trackers.get(connection);
    if (tracker === undefined) {
      const stored = getTrackerConnection(db, context.secretBox, connection);
      tracker = stored === null ? null : readingTracker(context, stored);
      trackers.set(connection, tracker);
    }
    return tracker;
  };

  const errors: TrackerLoadError[] = [];
  const truncated: TrackerTruncation[] = [];
  const labels: TrackerProjectLabels[] = [];
  const results = await Promise.all(
    projects.map(async (project) => {
      try {
        const tracker = trackerOf(project.connection);
        if (tracker === null) {
          errors.push({ trackerProject: project.name, reason: "unknown-connection" });
          return [];
        }
        const [{ tickets, more }, projectLabels] = await Promise.all([
          readProjectTickets(tracker, project),
          readProjectLabels(tracker, project),
        ]);
        if (more) truncated.push({ trackerProject: project.name, limit: tickets.length });
        labels.push({
          connection: project.connection,
          projectId: project.projectId,
          labels: projectLabels,
        });
        return tickets.map((ticket) => ({ project, ticket }));
      } catch (error) {
        errors.push({ trackerProject: project.name, reason: loadErrorReason(error) });
        return [];
      }
    }),
  );

  const tickets = results
    .flat()
    .toSorted((a, b) => b.ticket.updatedAt.getTime() - a.ticket.updatedAt.getTime())
    .map(({ project, ticket }): TrackerTicketView => ({
      connection: project.connection,
      projectId: project.projectId,
      projectName: project.name,
      key: ticket.key,
      title: ticket.title,
      url: isWebUrl(ticket.url) ? ticket.url : null,
      state: { name: ticket.state.name, category: ticket.state.category },
      priority: ticket.priority ?? "none",
      labels: ticket.labels.map((label) => ({ id: label.id, name: label.name })),
      ancestors: (ticket.ancestors ?? []).map((ancestor) => ({
        key: ancestor.key,
        title: ancestor.title,
        url: isWebUrl(ancestor.url) ? ancestor.url : null,
        state: ancestor.state,
      })),
    }));

  errors.sort((a, b) => a.trackerProject.localeCompare(b.trackerProject));
  truncated.sort((a, b) => a.trackerProject.localeCompare(b.trackerProject));
  labels.sort(
    (a, b) => a.connection.localeCompare(b.connection) || a.projectId.localeCompare(b.projectId),
  );
  return { workspace, tickets, labels, errors, truncated };
}

async function readProjectLabels(
  tracker: Tracker,
  project: StoredWorkspaceTrackerProject,
): Promise<Remote<TrackerLabel>> {
  try {
    const labels = await tracker.listLabels(project.projectId);
    return {
      ok: true,
      items: labels
        .map((label) => ({ id: label.id, name: label.name }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (error) {
    return { ok: false, error: remoteErrorOf(error) };
  }
}

function readingTracker(context: TicketsContext, stored: StoredTrackerConnection): Tracker {
  const tracker = context.registry.createTracker(stored.kind, {
    config: stored.config,
    secrets: stored.secrets,
  });
  return context.trackerReads === undefined
    ? tracker
    : context.trackerReads.wrap(context.db, stored.id, tracker);
}

export { ticketId };

async function readProjectTickets(
  tracker: Tracker,
  project: StoredWorkspaceTrackerProject,
): Promise<{ tickets: TrackerTicket[]; more: boolean }> {
  const tickets: TrackerTicket[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await tracker.listProjectTickets(project.projectId, {
      first: PAGE_SIZE,
      ...(after === null ? {} : { after }),
    });
    tickets.push(...result.items);
    after = result.nextCursor;
    if (after === null) break;
  }
  return { tickets, more: after !== null };
}

const adapterErrorSchema = z.object({ kind: z.string() });

function loadErrorReason(error: unknown): TrackerLoadError["reason"] {
  if (!(error instanceof AdapterError)) return "failed";
  const detail: unknown = error.detail;
  const parsed = adapterErrorSchema.safeParse(detail);
  if (!parsed.success) return "failed";
  const { kind } = parsed.data;
  switch (kind) {
    case "unauthorized":
    case "rate-limited":
    case "not-found":
    case "network":
      return kind;
    default:
      return "failed";
  }
}

type RunWithRecords = ReturnType<typeof listRunsWithRecords>[number];

function groupRuns(runs: ReadonlyArray<RunWithRecords>): Map<string, RunWithRecords[]> {
  const byTicket = new Map<string, RunWithRecords[]>();
  for (const entry of runs) {
    const id = ticketId(entry.run.ticket.connection, entry.run.ticket.key);
    const list = byTicket.get(id);
    if (list === undefined) byTicket.set(id, [entry]);
    else list.push(entry);
  }
  return byTicket;
}

function toTicketRun(
  db: Database,
  { run, records }: RunWithRecords,
  runnerNames: ReadonlyMap<RunnerId, string>,
  now: Date,
): TicketRun {
  const runnerName = run.runnerId === null ? null : (runnerNames.get(run.runnerId) ?? null);
  if (run.state !== "ended")
    return {
      id: run.id,
      runnerName,
      state: run.state,
      elapsedMs: msSince(run.state === "queued" ? run.assignedAt : run.startedAt, now),
      waitingOn:
        run.state === "waiting-for-input" ? (pendingInput(db, run.id)?.kind ?? null) : null,
    };
  return {
    id: run.id,
    runnerName,
    state: run.state,
    endedAt: run.endedAt.toISOString(),
    endedAgoMs: msSince(run.endedAt, now),
    agentResult: run.agentResult,
    prState: run.prState,
    laterPrState: records.laterPrState?.state ?? null,
    pullRequest: records.pullRequest?.displayId ?? null,
    summary: summarizeRunOutcome(run).outcome,
  };
}

function msSince(at: Date, now: Date): number {
  return Math.max(0, now.getTime() - at.getTime());
}

function retriesLastRepo(outcome: SummaryOutcome): boolean {
  switch (outcome) {
    case "failed":
    case "canceled":
      return true;
    case "succeeded":
      return false;
  }
}

function mappingAgents(db: Database): string[] {
  const agents = new Set<string>();
  for (const project of listWorkspaceTrackerProjects(db)) {
    const mapping = getMapping(db, project.connection, project.projectId);
    if (mapping !== null) agents.add(mapping.agent);
  }
  return [...agents].toSorted();
}
