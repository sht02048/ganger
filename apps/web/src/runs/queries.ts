import { queryOptions } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { RunId } from "@ganger/core";
import type { EndedView, RunBoardConditions } from "@ganger/app/runs/board";
import { RUNNERS_LIST_KEY } from "../runners/runners-query";
import { getRunDetail, getRunsBoardRun, getRunsPage } from "../server/functions";
import { TICKET_RUNS_KEY } from "../tickets/tickets-query";

export const runsListKey = ["runs", "list"] as const;

export function runDetailKey(runId: string) {
  return ["runs", "detail", runId] as const;
}

export function keysChangedByRunWrite(runId: RunId): ReadonlyArray<QueryKey> {
  return [
    runDetailKey(runId),
    runsListKey,
    ["dashboard"],
    ["stats"],
    TICKET_RUNS_KEY,
    RUNNERS_LIST_KEY,
    ["settings"],
  ];
}

export interface RunsListParams extends RunBoardConditions {
  ws: string | undefined;
  ended: number;
  view?: EndedView;
  failedOnly?: boolean;
}

export function runsListQuery(params: RunsListParams, timeZone: string) {
  const { ws, ...rest } = params;
  return queryOptions({
    queryKey: [...runsListKey, { ws: ws ?? "", ...rest }, timeZone] as const,
    queryFn: () => getRunsPage({ data: ws === undefined ? rest : { ...rest, ws } }),
  });
}

export function runsBoardRunQuery(ws: string | undefined, runId: string) {
  return queryOptions({
    queryKey: [...runsListKey, "run", ws ?? "", runId] as const,
    queryFn: () => getRunsBoardRun({ data: ws === undefined ? { runId } : { ws, runId } }),
  });
}

export function runDetailQuery(runId: string) {
  return queryOptions({
    queryKey: runDetailKey(runId),
    queryFn: () => getRunDetail({ data: { runId } }),
  });
}
