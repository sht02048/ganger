import { withLogContext } from "@ganger/log";
import { isAssignmentBlocked, summarizeRunOutcome } from "@ganger/core";
import type { Runner, RunnerErrorDetail, RunnerHealth, RunnerProject } from "@ganger/core";
import {
  getRunWithRecords,
  listRuns,
  recordRunnerCheck,
  listRunners,
  recordProviderUsage,
  recordRunnerLoad,
  updateRunRecords,
} from "@ganger/db";
import type { StoredRunner } from "@ganger/db";
import { describe, runnerErrorDetail, tryWrite } from "./context.js";
import type { TickContext } from "./context.js";

export const RUNNER_CHECK_INTERVAL_MS = 60_000;
export const PROVIDER_USAGE_INTERVAL_MS = 5 * 60_000;

export async function checkRunners(context: TickContext): Promise<void> {
  const now = context.now().getTime();
  for (const stored of listRunners(context.db)) {
    if (stored.checkedAt !== null && now - stored.checkedAt.getTime() < RUNNER_CHECK_INTERVAL_MS) {
      continue;
    }
    try {
      await withLogContext({ runnerId: stored.id }, () => checkRunner(context, stored));
    } catch (error) {
      context.logger.warn("runner.check_record_failed", { runnerId: stored.id, error });
    }
  }
}

export async function checkRunner(
  context: TickContext,
  stored: StoredRunner,
): Promise<{ ok: true; health: RunnerHealth } | { ok: false; error: RunnerErrorDetail }> {
  const runner = context.adapters.runner(stored);
  let health: RunnerHealth;
  try {
    health = await runner.checkHealth();
  } catch (error) {
    context.logger.warn("runner.check_failed", { runnerId: stored.id, error });
    recordRunnerCheck(context.db, {
      runnerId: stored.id,
      online: false,
      checkedAt: context.now(),
      error: checkError(error),
      projects: null,
      assignmentBlocked: null,
    });
    return { ok: false, error: checkError(error) };
  }

  let projects: ReadonlyArray<RunnerProject> | null = null;
  if (health.online) {
    try {
      projects = await runner.listProjects();
    } catch (error) {
      context.logger.warn("runner.projects_failed", { runnerId: stored.id, error });
    }
  }
  recordRunnerCheck(context.db, {
    runnerId: stored.id,
    online: health.online,
    checkedAt: context.now(),
    error: health.error,
    projects,
    assignmentBlocked: health.online ? isAssignmentBlocked(health) : null,
    prerequisites: health.online ? health.prerequisites : null,
  });
  if (health.online) {
    await readProviderUsage(context, stored, runner);
    try {
      await confirmRemovedWorktrees(context, stored, runner);
    } catch (error) {
      context.logger.warn("runner.removed_worktrees_failed", { runnerId: stored.id, error });
    }
  }
  return { ok: true, health };
}

async function readProviderUsage(
  context: TickContext,
  stored: StoredRunner,
  runner: Runner,
): Promise<void> {
  if (runner.readProviderUsage === undefined && runner.readUsageAndLoad === undefined) return;
  const readAt = stored.providerUsage?.readAt;
  if (
    readAt !== undefined &&
    context.now().getTime() - readAt.getTime() < PROVIDER_USAGE_INTERVAL_MS
  ) {
    return;
  }
  try {
    if (runner.readUsageAndLoad !== undefined) {
      const { usage, load } = await runner.readUsageAndLoad();
      recordProviderUsage(context.db, {
        runnerId: stored.id,
        readAt: context.now(),
        reading: usage,
      });
      recordRunnerLoad(context.db, { runnerId: stored.id, readAt: context.now(), reading: load });
      return;
    }
    const reading = await runner.readProviderUsage?.();
    if (reading === undefined) return;
    recordProviderUsage(context.db, { runnerId: stored.id, readAt: context.now(), reading });
  } catch {
    context.logger.warn("runner.provider_usage_failed", { runnerId: stored.id });
  }
}

async function confirmRemovedWorktrees(
  context: TickContext,
  stored: StoredRunner,
  runner: Runner,
): Promise<void> {
  for (const run of listRuns(context.db, { states: ["ended"] })) {
    if (run.state !== "ended" || run.worktree === null || run.runnerId !== stored.id) continue;
    const records = getRunWithRecords(context.db, run.id)?.records;
    if (records === undefined || records.worktreeRemovedAt !== null) continue;
    if (summarizeRunOutcome(run).worktree !== "operator-decides" && records.worktreeKept === null) {
      continue;
    }
    let exists: boolean;
    try {
      exists = await runner.worktreeExists(run.worktree);
    } catch (error) {
      context.logger.warn("runner.kept_worktree_check_failed", {
        runId: run.id,
        error,
      });
      continue;
    }
    if (exists) continue;
    tryWrite(context, run.id, () =>
      updateRunRecords(context.db, run.id, { worktreeRemovedAt: context.now() }),
    );
  }
}

function checkError(error: unknown): RunnerErrorDetail {
  return (
    runnerErrorDetail(error) ?? {
      kind: "malformed-output",
      raw: error instanceof Error ? error.message : describe({ error: String(error) }),
    }
  );
}
