import { prSignalsViewOf, toCiView } from "../pr-signals-view.js";
import {
  AGENT_RESULTS,
  PR_STATES,
  runDurations,
  summarizeRunOutcome,
  toTrackerConnectionId,
  toTrackerProjectId,
} from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  getWorkspaceTrackerProject,
  listPendingCancelRequests,
  listRunsWithRecords,
  listTakenOverRunIds,
  listRunners,
  listWorkspaces,
  toWorkspaceId,
} from "@ganger/db";
import type { Database, EndedAxesFilter, RunRecords, StoredRun } from "@ganger/db";
import { isWebUrl } from "../format/url.js";
import { resolveWorkspace } from "../shell/model.js";
import { DEFAULT_TIME_ZONE } from "../time-zone.js";
import { parseTrackerProjectKey, toRunsFilter } from "./conditions.js";
import type { RunConditions } from "./conditions.js";
import { ENDED_RUNS_PAGE_SIZE } from "./model.js";
import type { RunBoardDays } from "./board.js";
import type { QueuedReason, RunCondition, RunView, RunsPage } from "./model.js";
import { withoutPauses } from "../run-control.js";
import { describeQueuedReason, loadQueueReasons } from "./queue-reasons.js";

export function loadRunsPage(
  db: Database,
  ws: string | undefined,
  now: Date,
  endedLimit: number = ENDED_RUNS_PAGE_SIZE,
  conditions: RunConditions = {},
  timeZone: string = DEFAULT_TIME_ZONE,
): RunsPage {
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  if (workspace.kind !== "one")
    return { workspace, runs: [], recentEnded: 0, moreEnded: false, conditions: [] };

  const { runners, toView } = runViewBuilder(db, now);
  const workspaceId = toWorkspaceId(workspace.workspace.id);
  const filter = toRunsFilter(conditions, now, timeZone);
  const { endedBetween, ...scope } = filter;
  const inScope = { workspaceId, ...scope };
  const endedScope = endedBetween === undefined ? inScope : { ...inScope, endedBetween };
  const filtered = Object.keys(filter).length > 0;
  const active =
    endedBetween === undefined
      ? listRunsWithRecords(db, { ...inScope, states: ACTIVE_STATES, order: "newest" })
      : [];
  const ended = listRunsWithRecords(db, {
    ...endedScope,
    states: ["ended"],
    order: "newest",
    limit: endedLimit + 1,
  });
  const moreEnded = ended.length > endedLimit;
  const recentEnded = ended.slice(0, endedLimit);
  const recentEndedIds = new Set(recentEnded.map(({ run }) => run.id));
  const unresolvedLatest =
    moreEnded || filtered
      ? listRunsWithRecords(db, {
          ...endedScope,
          latestPerTicket: true,
          endedAxes: UNRESOLVED_ENDED_AXES,
        })
      : null;
  const unresolvedLatestIds =
    unresolvedLatest === null ? null : new Set(unresolvedLatest.map(({ run }) => run.id));
  const olderAttention = moreEnded
    ? (unresolvedLatest ?? []).filter(({ run }) => !recentEndedIds.has(run.id))
    : [];
  const stored = [...active, ...recentEnded, ...olderAttention].toSorted(newestFirst);
  const latestByTicket = new Map<string, RunId>();
  for (const { run } of stored.toReversed())
    latestByTicket.set(`${run.ticket.connection}\u0000${run.ticket.key}`, run.id);

  const runs = stored.map((entry) => {
    const { run } = entry;
    const latest =
      unresolvedLatestIds === null
        ? latestByTicket.get(`${run.ticket.connection}\u0000${run.ticket.key}`) === run.id
        : unresolvedLatestIds.has(run.id);
    return toView(entry, latest && isUnresolvedEndedRun(run));
  });

  return {
    workspace,
    runs,
    recentEnded: recentEnded.length,
    moreEnded,
    conditions: describeConditions(db, conditions, runners),
  };
}

export function runViewBuilder(db: Database, now: Date) {
  const runners = new Map(listRunners(db).map((r) => [r.id, r]));
  const cancelling = new Set<RunId>(listPendingCancelRequests(db).map((r) => r.runId));
  const takenOver = listTakenOverRunIds(db);
  const queueReasons = loadQueueReasons(db, now);

  const projectNames = new Map<string, string>();
  const projectName = (run: StoredRun): string => {
    const key = `${run.ticket.connection}\u0000${run.trackerProject}`;
    let name = projectNames.get(key);
    if (name === undefined) {
      name =
        getWorkspaceTrackerProject(db, run.ticket.connection, run.trackerProject)?.name ??
        run.trackerProject;
      projectNames.set(key, name);
    }
    return name;
  };

  const queuedReason = (id: RunId): QueuedReason =>
    describeQueuedReason(
      queueReasons.get(id) ?? { kind: "behind" },
      (runnerId) => runners.get(runnerId)?.name ?? runnerId,
      now,
    );

  const toView = (
    { run, records }: { run: StoredRun; records: RunRecords },
    endedAttention: boolean,
  ): RunView => {
    const runner = run.runnerId === null ? undefined : runners.get(run.runnerId);
    const startedAt = run.state === "queued" ? null : run.startedAt;
    const durations = runDurations({
      assignedAt: run.assignedAt,
      startedAt,
      endedAt: run.state === "ended" ? run.endedAt : null,
      now,
    });
    const pr = records.pullRequest;
    const signals =
      pr === null || pr === undefined || takenOver.has(run.id)
        ? null
        : prSignalsViewOf(run, records);
    const readAt = signals?.checkedAt ?? pr?.checkedAt.toISOString() ?? "";
    const base = {
      id: run.id,
      ticketKey: run.ticket.key,
      ticketTitle: run.ticketTitle,
      trackerProject: projectName(run),
      branch: run.state === "queued" ? null : run.branch,
      runner: runner === undefined ? null : { name: runner.name, online: runner.online },
      agent: run.agent,
      waitMs: durations.waitMs ?? 0,
      executionMs: withoutPauses(durations.executionMs, records, now),
      pullRequest:
        pr === null || pr === undefined || !isWebUrl(pr.url)
          ? null
          : {
              displayId: pr.displayId,
              url: pr.url,
              ci: toCiView(pr.ci),
              signals,
              checkedAt: readAt,
              checkedAgoMs: now.getTime() - Date.parse(readAt),
              closedOnHost: pr.signals?.open === false,
            },
      attention: false,
    };
    switch (run.state) {
      case "queued":
        return {
          ...base,
          state: run.state,
          queuedReason: queuedReason(run.id),
          cancelling: cancelling.has(run.id),
        };
      case "running":
        return { ...base, state: run.state, cancelling: cancelling.has(run.id) };
      case "paused": {
        const since = records.pausedSince;
        return {
          ...base,
          state: run.state,
          cancelling: cancelling.has(run.id),
          pausedMs: since === null ? null : Math.max(0, now.getTime() - since.getTime()),
        };
      }
      case "waiting-for-input":
        return {
          ...base,
          state: run.state,
          cancelling: cancelling.has(run.id),
          attention: true,
        };
      case "disconnected":
        return {
          ...base,
          state: run.state,
          cancelling: cancelling.has(run.id),
          attention: true,
          paused: records.pausedSince !== null,
        };
      case "ended": {
        const summary = summarizeRunOutcome(run).outcome;
        return {
          ...base,
          state: run.state,
          endedAt: run.endedAt.toISOString(),
          endedAgoMs: Math.max(0, now.getTime() - run.endedAt.getTime()),
          agentResult: run.agentResult,
          prState: run.prState,
          laterPrState: records.laterPrState?.state ?? null,
          prReadError: records.prReadError,
          summary,
          attention: endedAttention,
        };
      }
    }
  };
  return { runners, toView };
}

export function describeConditions(
  db: Database,
  conditions: Omit<RunConditions, "days"> & { days?: RunBoardDays },
  runners: ReadonlyMap<string, { name: string }>,
): RunCondition[] {
  const described: RunCondition[] = [];
  if (conditions.runner !== undefined)
    described.push({
      key: "runner",
      name:
        conditions.runner === ""
          ? null
          : (runners.get(conditions.runner)?.name ?? conditions.runner),
    });
  const project =
    conditions.project === undefined ? null : parseTrackerProjectKey(conditions.project);
  if (project !== null)
    described.push({
      key: "project",
      name:
        getWorkspaceTrackerProject(
          db,
          toTrackerConnectionId(project.connection),
          toTrackerProjectId(project.project),
        )?.name ?? project.project,
    });
  if (conditions.agent !== undefined) described.push({ key: "agent", agent: conditions.agent });
  if (conditions.days !== undefined) described.push({ key: "days", days: conditions.days });
  return described;
}

export function isUnresolvedEndedRun(run: StoredRun): boolean {
  return run.state === "ended" && summarizeRunOutcome(run).outcome === "failed";
}

export const UNRESOLVED_ENDED_AXES: ReadonlyArray<EndedAxesFilter> = AGENT_RESULTS.flatMap(
  (agentResult) =>
    PR_STATES.flatMap((prState): EndedAxesFilter[] => {
      switch (summarizeRunOutcome({ agentResult, prState, runnerUnreached: false }).outcome) {
        case "failed":
          return [{ agentResult, prState }];
        case "succeeded":
        case "canceled":
          return [];
      }
    }),
);

export const ACTIVE_STATES = [
  "queued",
  "running",
  "waiting-for-input",
  "paused",
  "disconnected",
] as const;

function newestFirst(
  a: { run: StoredRun; records: RunRecords },
  b: { run: StoredRun; records: RunRecords },
): number {
  const byTime = b.run.assignedAt.getTime() - a.run.assignedAt.getTime();
  if (byTime !== 0) return byTime;
  return a.run.id < b.run.id ? 1 : a.run.id > b.run.id ? -1 : 0;
}
