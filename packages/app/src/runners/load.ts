import { blockedProjectsOf, currentWindows, highestUsage, summarizeRunOutcome } from "@ganger/core";
import type { UsageWindow } from "@ganger/core";
import { listRunners, listRunsWithRecords, listWorkspaces, listTakenOverRunIds } from "@ganger/db";
import type { Database, StoredProviderUsage, StoredRun } from "@ganger/db";
import { z } from "zod";
import { pendingInput } from "../home/load.js";
import { prerequisiteHint, prerequisiteProject } from "../prerequisites.js";
import type {
  LeftWorktree,
  OccupyingRun,
  RunWorkspace,
  RunnerUsageView,
  RunnerView,
  RunnersPage,
  UsageWindowView,
  QueuedRunView,
} from "./model.js";

const runnerConfigSchema = z.object({
  sshTarget: z.string().min(1).optional().catch(undefined),
  orcaPath: z.string().min(1).optional().catch(undefined),
});

export function loadRunnersPage(db: Database, now: Date): RunnersPage {
  const workspaces = new Map(listWorkspaces(db).map((w) => [w.id, { id: w.id, name: w.name }]));
  const workspaceOf = (run: StoredRun): RunWorkspace =>
    workspaces.get(run.workspaceId) ?? { id: run.workspaceId, name: run.workspaceId };

  const occupying = new Map<string, OccupyingRun[]>();
  const queued = new Map<string, QueuedRunView[]>();
  const leftWorktrees = new Map<string, LeftWorktree[]>();
  const push = <T>(map: Map<string, T[]>, runnerId: string, item: T) => {
    const list = map.get(runnerId);
    if (list === undefined) map.set(runnerId, [item]);
    else list.push(item);
  };

  const takenOver = listTakenOverRunIds(db);
  for (const { run, records } of listRunsWithRecords(db)) {
    if (run.runnerId === null) continue;
    const base = { id: run.id, ticketKey: run.ticket.key, workspace: workspaceOf(run) };
    switch (run.state) {
      case "queued":
        push(queued, run.runnerId, { ...base, waitMs: now.getTime() - run.assignedAt.getTime() });
        break;
      case "running":
      case "waiting-for-input":
      case "paused":
      case "disconnected":
        push(occupying, run.runnerId, {
          ...base,
          ticketTitle: run.ticketTitle,
          state: run.state,
          waitingFor:
            run.state === "waiting-for-input" ? (pendingInput(db, run.id)?.kind ?? null) : null,
          executionMs: now.getTime() - run.startedAt.getTime(),
        });
        break;
      case "ended": {
        if (records.worktreeRemovedAt !== null) break;
        if (takenOver.has(run.id)) break;
        const worktree =
          records.worktreeKept === null ? summarizeRunOutcome(run).worktree : "operator-decides";
        if (worktree !== "keep-until-pr-settles" && worktree !== "operator-decides") break;
        push(leftWorktrees, run.runnerId, { ...base, worktree });
        break;
      }
    }
  }

  const runners = listRunners(db).map((runner): RunnerView => {
    const parsed = runnerConfigSchema.safeParse(runner.config);
    const config = parsed.success ? parsed.data : {};
    return {
      id: runner.id,
      name: runner.name,
      online: runner.online,
      offlineMs:
        runner.online || runner.offlineSince === null
          ? null
          : Math.max(0, now.getTime() - runner.offlineSince.getTime()),
      assignmentBlocked: runner.assignmentBlocked,
      pushBlockedProjects: runner.online
        ? blockedProjectsOf(runner.prerequisites ?? []).map(
            (id) => runner.projects.find((p) => p.id === id)?.displayName ?? id,
          )
        : [],
      checks:
        runner.prerequisites?.map((p) => ({
          id: p.id,
          name: p.name,
          project: prerequisiteProject(p.id, runner.projects),
          satisfied: p.satisfied,
          blocksAssignment: p.blocksAssignment,
          hint: prerequisiteHint(p),
          failure: p.failure ?? null,
        })) ?? null,
      checked:
        runner.checkedAt === null
          ? null
          : {
              at: runner.checkedAt.toISOString(),
              agoMs: now.getTime() - runner.checkedAt.getTime(),
            },
      capacity: runner.capacity,
      occupying: (occupying.get(runner.id) ?? []).toSorted((a, b) => b.executionMs - a.executionMs),
      queued: queued.get(runner.id) ?? [],
      leftWorktrees: leftWorktrees.get(runner.id) ?? [],
      sshTarget: config.sshTarget ?? null,
      orcaPath: config.orcaPath ?? null,
      usage: usageView(runner.providerUsage, now),
    };
  });
  return { runners };
}

function windowView(window: UsageWindow): UsageWindowView {
  return {
    kind: window.kind,
    usedPercent: window.usedPercent,
    resetsAt: window.resetsAt === null ? null : window.resetsAt.toISOString(),
  };
}

export function usageView(stored: StoredProviderUsage | null, now: Date): RunnerUsageView | null {
  if (stored === null) return null;
  const base = {
    readAt: stored.readAt.toISOString(),
    agoMs: Math.max(0, now.getTime() - stored.readAt.getTime()),
    now: now.toISOString(),
  };
  if (stored.reading.kind === "unreadable") return { ...base, kind: "unreadable" };
  const providers = currentWindows(stored.reading.providers, now);
  const highest = highestUsage(providers);
  return {
    ...base,
    kind: "read",
    providers: providers.map((usage) => ({
      provider: usage.provider,
      status: usage.status,
      windows: usage.windows.map(windowView),
    })),
    highest:
      highest === null ? null : { provider: highest.provider, window: windowView(highest.window) },
  };
}
