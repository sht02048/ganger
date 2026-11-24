import { summarizeRunOutcome } from "@ganger/core";
import { listRunners, listRuns, listWorkspaces } from "@ganger/db";
import type { Database, StoredRun } from "@ganger/db";
import { ticketTodos, todoTicketOf } from "../home/model.js";
import type { TodoCandidate } from "../home/model.js";
import type { ShellData, TodoCounts } from "./model.js";
import { runnerIssueCause } from "./model.js";

export function loadShell(db: Database): ShellData {
  const workspaces = listWorkspaces(db).map((w) => ({ id: w.id, name: w.name }));
  return {
    workspaces,
    runnerIssues: listRunners(db).filter((runner) => runnerIssueCause(runner) !== null).length,
    todo: countTodos(
      listRuns(db),
      workspaces.map((w) => w.id),
    ),
  };
}

function countTodos(
  runs: ReadonlyArray<StoredRun>,
  workspaceIds: ReadonlyArray<string>,
): TodoCounts {
  const candidates = runs.map((run) => ({
    workspaceId: run.workspaceId,
    ticket: todoTicketOf(run.ticket),
    run: todoCandidateOf(run),
  }));
  return {
    all: ticketTodos(candidates).length,
    byWorkspace: Object.fromEntries(
      workspaceIds.map((id) => [
        id,
        ticketTodos(candidates.filter((candidate) => candidate.workspaceId === id)).length,
      ]),
    ),
  };
}

function todoCandidateOf(run: StoredRun): TodoCandidate {
  return run.state === "ended"
    ? { id: run.id, state: run.state, summary: summarizeRunOutcome(run).outcome }
    : { id: run.id, state: run.state };
}
