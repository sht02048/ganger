import type { AppDashboard, AppDashboardRun } from "@ganger/api";

import { runsOf } from "../dashboard/model";
import { sameValue } from "./same-value";

function sameItems<T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function reuseRuns(previous: AppDashboard, next: AppDashboard): AppDashboard {
  if (sameValue(previous, next)) return previous;
  const earlier = new Map(runsOf(previous).map((run) => [run.id, run]));
  const keep = (run: AppDashboardRun): AppDashboardRun => {
    const before = earlier.get(run.id);
    return before !== undefined && sameValue(before, run) ? before : run;
  };
  const keepList = (
    before: AppDashboardRun[],
    after: ReadonlyArray<AppDashboardRun>,
  ): AppDashboardRun[] => {
    const kept = after.map(keep);
    return sameItems(before, kept) ? before : kept;
  };
  const { queued, running, done } = previous.columns;
  return {
    ...next,
    columns: {
      queued: keepList(queued, next.columns.queued),
      running: {
        todo: keepList(running.todo, next.columns.running.todo),
        rest: keepList(running.rest, next.columns.running.rest),
      },
      done: {
        todo: keepList(done.todo, next.columns.done.todo),
        rest: keepList(done.rest, next.columns.done.rest),
      },
    },
  };
}
