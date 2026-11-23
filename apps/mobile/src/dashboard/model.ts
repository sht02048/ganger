import type { AppDashboard, AppDashboardRun } from "@ganger/api";

export const ALL_WORKSPACES = "all";
export const PR_CHIPS_VISIBLE = 2;
export const SETTLED_VISIBLE = 5;

export type DashboardRun = AppDashboardRun;
export type EndedRun = Extract<DashboardRun, { state: "ended" }>;
export type QueuedRun = Extract<DashboardRun, { state: "queued" }>;
export type PrProblem = NonNullable<DashboardRun["pullRequest"]>["problems"][number];
export type ColumnKey = "queued" | "running" | "done";

export interface Board {
  queued: DashboardRun[];
  running: { humanCheck: DashboardRun[]; todo: DashboardRun[]; rest: DashboardRun[] };
  done: { todo: DashboardRun[]; settled: EndedRun[]; settledTotal: number };
}

export function buildBoard({ columns }: AppDashboard): Board {
  const settled = columns.done.rest.filter((run): run is EndedRun => run.state === "ended");
  return {
    queued: columns.queued,
    running: {
      humanCheck: columns.running.todo.filter((run) => run.todoTag === "human-check"),
      todo: columns.running.todo.filter((run) => run.todoTag !== "human-check"),
      rest: columns.running.rest,
    },
    done: {
      todo: columns.done.todo,
      settled: settled.slice(0, SETTLED_VISIBLE),
      settledTotal: settled.length,
    },
  };
}

export function hasNoRuns({ columns }: AppDashboard): boolean {
  return [
    columns.queued,
    columns.running.todo,
    columns.running.rest,
    columns.done.todo,
    columns.done.rest,
  ].every((runs) => runs.length === 0);
}

export function columnTodoCount(board: Board, column: ColumnKey): number {
  switch (column) {
    case "queued":
      return 0;
    case "running":
      return board.running.humanCheck.length + board.running.todo.length;
    case "done":
      return board.done.todo.length;
  }
}

export function columnRestCount(board: Board, column: ColumnKey): number {
  switch (column) {
    case "queued":
      return board.queued.length;
    case "running":
      return board.running.rest.length;
    case "done":
      return board.done.settledTotal;
  }
}

export function firstColumn(board: Board): ColumnKey {
  if (columnTodoCount(board, "running") > 0) return "running";
  if (columnTodoCount(board, "done") > 0) return "done";
  return "running";
}

export function endsWithFinalConsonant(word: string): boolean {
  const spoken = /[\p{L}\p{N}]+$/u.exec(word.replace(/[^\p{L}\p{N}]+$/u, ""))?.[0] ?? "";
  const last = spoken.at(-1);
  if (last === undefined) return false;
  const code = last.codePointAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/\d/.test(last)) return ["0", "1", "3", "6", "7", "8"].includes(last);
  const lower = spoken.toLowerCase();
  if (lower.endsWith("ng")) return true;
  return ["l", "m", "n", "r"].includes(lower.at(-1) ?? "");
}
