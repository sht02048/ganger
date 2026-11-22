import { z } from "zod";
import type { RunNextStep } from "../run-next-step.js";
import type { WorkspaceChoice } from "../shell/model.js";
import { STATS_PERIOD_DAYS } from "../stats/model.js";
import { pickConditions } from "./conditions.js";
import type { RunConditions } from "./conditions.js";
import type { RunCondition, RunView } from "./model.js";

export const RUNNER_CARD_VISIBLE_RUNS = 4;
export const WAITING_CARD_VISIBLE_RUNS = 5;

export const RUN_BOARD_DAYS = [1, ...STATS_PERIOD_DAYS] as const;
export type RunBoardDays = (typeof RUN_BOARD_DAYS)[number];
export const runBoardDaysSchema = z.literal(RUN_BOARD_DAYS);
export const ENDED_PERIOD_CHOICES = [1, 7, 30] as const satisfies ReadonlyArray<RunBoardDays>;
export const DEFAULT_ENDED_DAYS: RunBoardDays = 7;

export type RunBoardConditions = Omit<RunConditions, "days"> & { days?: RunBoardDays };

export function pickBoardConditions(search: {
  runner?: string | undefined;
  project?: string | undefined;
  agent?: string | undefined;
  days?: RunBoardDays | undefined;
}): RunBoardConditions {
  const { days, ...rest } = search;
  return { ...pickConditions(rest), ...(days === undefined ? {} : { days }) };
}

export const ENDED_VIEWS = ["review", "all"] as const;
export type EndedView = (typeof ENDED_VIEWS)[number];

export type WaitingFor = "question" | "permission" | "human-check";

export type HandledInput = "answered" | "denied";

export type BoardRun = RunView & {
  runnerId: string | null;
  waitingFor: WaitingFor | null;
  handledInput: HandledInput | null;
  nextStep: RunNextStep;
  canContinue: boolean;
};

export interface RunnerSeats {
  id: string;
  name: string;
  online: boolean;
  capacity: number;
  used: number;
  otherWorkspaces: OtherWorkspaceRuns;
}

export interface OtherWorkspaceRuns {
  count: number;
  onlyWorkspaceId: string | null;
}

export interface RunsBoardPage {
  workspace: WorkspaceChoice;
  active: BoardRun[];
  ended: BoardRun[];
  endedCounts: { review: number; all: number };
  endedView: EndedView;
  failedOnly: boolean;
  days: RunBoardDays;
  moreEnded: boolean;
  runners: RunnerSeats[];
  conditions: RunCondition[];
}

export type RunWord =
  | "running"
  | "question"
  | "permission"
  | "human-check"
  | "answer-sent"
  | "permission-denied"
  | "cancelling"
  | "paused"
  | "disconnected"
  | "queued"
  | "done"
  | "needs-review"
  | "failed"
  | "canceled";

export type PrProblem = "ci-failed" | "conflict";

export function prProblemOf(run: BoardRun): PrProblem | null {
  if (run.nextStep === "pr-ci-failed") return "ci-failed";
  return run.nextStep === "pr-conflict" ? "conflict" : null;
}

export function isCancelling(run: BoardRun): boolean {
  return run.state !== "ended" && run.cancelling;
}

export function runWord(run: BoardRun): RunWord {
  if (isCancelling(run)) return "cancelling";
  switch (run.state) {
    case "running":
    case "paused":
    case "disconnected":
    case "queued":
      return run.state;
    case "waiting-for-input":
      if (run.handledInput === "answered") return "answer-sent";
      if (run.handledInput === "denied") return "permission-denied";
      return run.waitingFor ?? "question";
    case "ended":
      switch (run.summary) {
        case "failed":
        case "canceled":
          return run.summary;
        case "succeeded":
          return prProblemOf(run) === null ? "done" : "needs-review";
      }
  }
}

export function needsReview(run: BoardRun): boolean {
  if (run.state !== "ended" || run.summary === "canceled") return false;
  return run.nextStep === "failed" || prProblemOf(run) !== null;
}

export interface RunnerCard extends RunnerSeats {
  runs: BoardRun[];
  dimmed: boolean;
}

function isWaitingForPerson(run: BoardRun): boolean {
  return run.state === "waiting-for-input" && run.handledInput === null && !isCancelling(run);
}

function isCutOff(run: BoardRun): boolean {
  return run.state === "disconnected" && !isCancelling(run);
}

function needsPerson(run: BoardRun): boolean {
  return isWaitingForPerson(run) || isCutOff(run);
}

function cardRunRank(run: BoardRun): number {
  if (isCancelling(run)) return 4;
  if (isWaitingForPerson(run)) return 0;
  if (isCutOff(run)) return 1;
  return run.state === "running" || run.state === "waiting-for-input" ? 2 : 3;
}

function cardTier(card: { online: boolean; runs: ReadonlyArray<BoardRun> }): number {
  if (card.runs.some(needsPerson)) return 0;
  if (card.runs.length > 0) return 1;
  return card.online ? 2 : 3;
}

export function runnerCards(
  runners: ReadonlyArray<RunnerSeats>,
  active: ReadonlyArray<BoardRun>,
  conditions: ReadonlyArray<RunCondition> = [],
  runnerId?: string,
): RunnerCard[] {
  const byRunner = new Map<string, BoardRun[]>();
  for (const run of active) {
    if (run.state === "queued" || run.runnerId === null) continue;
    byRunner.set(run.runnerId, [...(byRunner.get(run.runnerId) ?? []), run]);
  }
  const known = new Set(runners.map((runner) => runner.id));
  const removed = [...byRunner.entries()]
    .filter(([id]) => !known.has(id))
    .map(([id, runs]): RunnerSeats => ({
      id,
      name: runs[0]?.runner?.name ?? id,
      online: false,
      capacity: 0,
      used: runs.length,
      otherWorkspaces: { count: 0, onlyWorkspaceId: null },
    }));
  const narrowed = conditions.some((c) => c.key === "project" || c.key === "agent");
  return [...runners, ...removed]
    .filter((runner) => runnerId === undefined || runner.id === runnerId)
    .map((runner): RunnerCard => {
      const runs = (byRunner.get(runner.id) ?? []).toSorted(
        (a, b) => cardRunRank(a) - cardRunRank(b) || (b.executionMs ?? 0) - (a.executionMs ?? 0),
      );
      return { ...runner, runs, dimmed: !runner.online && runs.length === 0 };
    })
    .filter((card) => !narrowed || card.runs.length > 0)
    .toSorted((a, b) => cardTier(a) - cardTier(b) || a.name.localeCompare(b.name));
}

export function waitingRuns(active: ReadonlyArray<BoardRun>): BoardRun[] {
  return active
    .filter((run) => run.state === "queued")
    .toSorted((a, b) => Number(isCancelling(a)) - Number(isCancelling(b)) || b.waitMs - a.waitMs);
}

export function foldRuns<T>(
  runs: ReadonlyArray<T>,
  limit: number,
  expanded: boolean,
): { shown: ReadonlyArray<T>; hidden: number } {
  if (expanded || runs.length <= limit) return { shown: runs, hidden: 0 };
  return { shown: runs.slice(0, limit), hidden: runs.length - limit };
}

export type SituationPart =
  | { key: "disconnected"; count: number }
  | { key: "runningAndWaiting"; running: number; waiting: number }
  | { key: "running"; count: number }
  | { key: "waiting"; count: number }
  | { key: "queued"; count: number }
  | { key: "settling"; count: number }
  | { key: "none" };

export function situationParts(active: ReadonlyArray<BoardRun>): SituationPart[] {
  const live = active.filter((run) => !isCancelling(run));
  const count = (state: RunView["state"]) => live.filter((run) => run.state === state).length;
  const disconnected = count("disconnected");
  const running = count("running");
  const waiting = live.filter(isWaitingForPerson).length;
  const queued = count("queued");
  const parts: SituationPart[] = [];
  if (disconnected > 0) parts.push({ key: "disconnected", count: disconnected });
  if (running > 0 && waiting > 0) parts.push({ key: "runningAndWaiting", running, waiting });
  else if (running > 0) parts.push({ key: "running", count: running });
  else if (waiting > 0) parts.push({ key: "waiting", count: waiting });
  if (queued > 0) parts.push({ key: "queued", count: queued });
  if (parts.length > 0) return parts;
  const settling = active.filter(
    (run) => isCancelling(run) || run.state === "waiting-for-input",
  ).length;
  return settling > 0 ? [{ key: "settling", count: settling }] : [{ key: "none" }];
}
