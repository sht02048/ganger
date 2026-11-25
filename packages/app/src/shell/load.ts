import { summarizeRunOutcome } from "@ganger/core";
import { listRunners, listRunsWithRecords, listWorkspaces } from "@ganger/db";
import type { Database, RunRecords, StoredRun } from "@ganger/db";
import { ticketTodos, todoTicketOf } from "../home/model.js";
import { todoClearedOf } from "../todo-cleared.js";
import type { TodoCandidate } from "../home/model.js";
import type { ShellData, TodoCounts } from "./model.js";
import { runnerIssueCause } from "./model.js";

export function loadShell(db: Database): ShellData {
  const workspaces = listWorkspaces(db).map((w) => ({ id: w.id, name: w.name }));
  return {
    workspaces,
    runnerIssues: listRunners(db).filter((runner) => runnerIssueCause(runner) !== null).length,
    todo: countTodos(
      listRunsWithRecords(db),
      workspaces.map((w) => w.id),
    ),
  };
}

function countTodos(
  runs: ReadonlyArray<{ run: StoredRun; records: RunRecords }>,
  workspaceIds: ReadonlyArray<string>,
): TodoCounts {
  const candidates = runs.map(({ run, records }) => ({
    ticket: todoTicketOf(run.ticket),
    run: todoCandidateOf(run, records),
  }));
  const byWorkspace = new Map<string, typeof candidates>(workspaceIds.map((id) => [id, []]));
  runs.forEach(({ run }, index) => {
    const candidate = candidates[index];
    if (candidate !== undefined) byWorkspace.get(run.workspaceId)?.push(candidate);
  });
  return {
    all: ticketTodos(candidates).length,
    byWorkspace: Object.fromEntries(
      [...byWorkspace].map(([id, workspaceRuns]) => [id, ticketTodos(workspaceRuns).length]),
    ),
  };
}

function todoCandidateOf(run: StoredRun, records: RunRecords): TodoCandidate {
  return run.state === "ended"
    ? {
        id: run.id,
        state: run.state,
        summary: summarizeRunOutcome(run).outcome,
        todoCleared: todoClearedOf(run, records),
      }
    : { id: run.id, state: run.state };
}
