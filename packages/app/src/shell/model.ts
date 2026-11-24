export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface TodoCounts {
  all: number;
  byWorkspace: Record<string, number>;
}

export interface ShellData {
  workspaces: WorkspaceSummary[];
  runnerIssues: number;
  todo: TodoCounts;
}

export const NO_TODO: TodoCounts = { all: 0, byWorkspace: {} };

export type RunnerIssueCause = "offline" | "auth";

export function runnerIssueCause(runner: {
  online: boolean;
  assignmentBlocked: boolean;
}): RunnerIssueCause | null {
  if (!runner.online) return "offline";
  if (runner.assignmentBlocked) return "auth";
  return null;
}

export const ALL_WORKSPACES = "all";

export type WorkspaceChoice =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "one"; workspace: WorkspaceSummary };

export function resolveWorkspace(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  ws: string | undefined,
): WorkspaceChoice {
  if (ws === ALL_WORKSPACES && workspaces.length > 0) return { kind: "all" };
  const found = workspaces.find((w) => w.id === ws) ?? workspaces[0];
  return found === undefined ? { kind: "none" } : { kind: "one", workspace: found };
}

export function todoCountOf(todo: TodoCounts, workspace: WorkspaceChoice): number {
  switch (workspace.kind) {
    case "none":
      return 0;
    case "all":
      return todo.all;
    case "one":
      return todo.byWorkspace[workspace.workspace.id] ?? 0;
  }
}
