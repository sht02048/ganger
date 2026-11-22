import type { HomeRun, PrSignalsView, RunnerView } from "../demo/contract";

export const PR_CHIPS_VISIBLE = 2;
export const DONE_COLUMN_DAYS = 7;
export const SETTLED_VISIBLE = 5;

export type ColumnKey = "queued" | "running" | "done";
export type TodoTag =
  | "question"
  | "permission"
  | "human-check"
  | "waiting-for-input"
  | "disconnected"
  | "failed";
export type TodoGroupKind = "check" | "answer" | "stopped";
export type PrProblem =
  | { kind: "ci-failed" }
  | { kind: "conflict" }
  | { kind: "behind"; commits: number };

export interface Board {
  queued: HomeRun[];
  running: { humanCheck: HomeRun[]; todo: HomeRun[]; rest: HomeRun[] };
  done: { todo: HomeRun[]; settled: HomeRun[]; settledTotal: number };
}

export function todoTagOf(run: HomeRun): TodoTag | null {
  switch (run.state) {
    case "waiting-for-input":
      return run.input === null ? "waiting-for-input" : run.input.kind;
    case "disconnected":
      return "disconnected";
    case "ended":
      return run.summary === "failed" ? "failed" : null;
    case "queued":
    case "running":
    case "paused":
      return null;
  }
}

export function todoGroupOf(run: HomeRun): TodoGroupKind | null {
  const tag = todoTagOf(run);
  switch (tag) {
    case null:
      return null;
    case "human-check":
      return "check";
    case "question":
    case "permission":
    case "waiting-for-input":
      return "answer";
    case "disconnected":
    case "failed":
      return "stopped";
  }
}

export function isInDoneWeek(endedAt: string, now: Date): boolean {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (DONE_COLUMN_DAYS - 1));
  return Date.parse(endedAt) >= start.getTime();
}

function urgency(run: HomeRun): number {
  return run.state === "waiting-for-input" ? 0 : 1;
}

function endedAgo(run: HomeRun): number {
  return run.state === "ended" ? run.endedAgoMs : 0;
}

export function latestFailedOnly(runs: ReadonlyArray<HomeRun>): HomeRun[] {
  const latestByTicket = new Map(runs.map((run) => [run.ticketId, run.id]));
  return runs.filter(
    (run) => todoTagOf(run) !== "failed" || latestByTicket.get(run.ticketId) === run.id,
  );
}

export function buildBoard(runs: ReadonlyArray<HomeRun>, now: Date): Board {
  const current = latestFailedOnly(runs);
  const unfinishedTodo = current
    .flatMap((run, index) =>
      run.state !== "ended" && todoTagOf(run) !== null ? [{ run, index }] : [],
    )
    .toSorted((a, b) => urgency(a.run) - urgency(b.run) || b.index - a.index)
    .map(({ run }) => run);
  const settled = current
    .filter(
      (run) => run.state === "ended" && todoTagOf(run) === null && isInDoneWeek(run.endedAt, now),
    )
    .toSorted((a, b) => endedAgo(a) - endedAgo(b));
  return {
    queued: current.filter((run) => run.state === "queued"),
    running: {
      humanCheck: unfinishedTodo.filter((run) => todoTagOf(run) === "human-check"),
      todo: unfinishedTodo.filter((run) => todoTagOf(run) !== "human-check"),
      rest: current.filter((run) => run.state === "running" || run.state === "paused"),
    },
    done: {
      todo: current
        .filter((run) => todoTagOf(run) === "failed")
        .toSorted((a, b) => endedAgo(a) - endedAgo(b)),
      settled: settled.slice(0, SETTLED_VISIBLE),
      settledTotal: settled.length,
    },
  };
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

export function prProblemsOf(signals: PrSignalsView | null): PrProblem[] {
  if (signals === null) return [];
  const behindBy = signals.behindBy ?? 0;
  return [
    ...(signals.ciFailed ? [{ kind: "ci-failed" as const }] : []),
    ...(signals.conflict === true ? [{ kind: "conflict" as const }] : []),
    ...(behindBy > 0 ? [{ kind: "behind" as const, commits: behindBy }] : []),
  ];
}

export function runnerIssueCount(runners: ReadonlyArray<RunnerView>): number {
  return runners.filter((runner) => runner.cause !== null).length;
}

export function limitedRunners(runners: ReadonlyArray<RunnerView>): RunnerView[] {
  return runners.filter((runner) => runner.limits.length > 0);
}

export function readyAgainInMs(runner: RunnerView): number | null {
  let latest = 0;
  for (const limit of runner.limits) {
    if (limit.resetsInMs === null) return null;
    latest = Math.max(latest, limit.resetsInMs);
  }
  return latest;
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
