import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import {
  DEFAULT_ENDED_DAYS,
  ENDED_VIEWS,
  pickBoardConditions,
  runBoardDaysSchema,
} from "@ganger/app/runs/board";
import type { RunBoardDays } from "@ganger/app/runs/board";
import { runConditionsSearch } from "@ganger/app/runs/conditions";
import { runsMessages } from "../../runs/messages";
import { ENDED_RUNS_PAGE_SIZE, MAX_ENDED_RUNS } from "@ganger/app/runs/model";
import { RunsScreen } from "../../runs/runs-screen";
import type { ClearableCondition } from "../../runs/runs-screen";
import { useFirstDrawKey } from "../../query/first-draw";
import { requestTimeZone, useRequestTimeZone } from "../../query/request-time-zone";
import { loadRouteQuery } from "../../query/route-query";
import { runsBoardRunQuery, runsListQuery } from "../../runs/queries";
import { useShell } from "../../shell/shell-query";
import { ScreenError } from "../../shell/screen-error";

const t = createTranslator({ locale: defaultLocale, messages: runsMessages, namespace: "runs" });

export const Route = createFileRoute("/_app/runs")({
  errorComponent: ScreenError,
  validateSearch: z.object({
    f: z.literal("failed").optional().catch(undefined),
    view: z.enum(ENDED_VIEWS).optional().catch(undefined),
    sel: z.string().optional(),
    ended: z.number().int().min(1).max(MAX_ENDED_RUNS).optional().catch(undefined),
    ...runConditionsSearch,
    days: runBoardDaysSchema.optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    ws: search.ws,
    ended: search.ended,
    ...(search.view === undefined ? {} : { view: search.view }),
    ...(search.f === undefined ? {} : { failedOnly: true }),
    ...pickBoardConditions(search),
  }),
  loader: (load) =>
    loadRouteQuery(
      load,
      runsListQuery(
        { ...load.deps, ended: load.deps.ended ?? ENDED_RUNS_PAGE_SIZE },
        requestTimeZone(),
      ),
    ),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: RunsRoute,
});

function RunsRoute() {
  const deps = Route.useLoaderDeps();
  const timeZone = useDeferredValue(useRequestTimeZone());
  const { data: page, isFetching } = useSuspenseQuery(
    runsListQuery({ ...deps, ended: deps.ended ?? ENDED_RUNS_PAGE_SIZE }, timeZone),
  );
  const drawKey = useFirstDrawKey(deps.ws, isFetching);
  const shell = useShell();
  const { sel, ws, ended, runner } = Route.useSearch();
  const navigate = Route.useNavigate();
  const nextEnded = (ended ?? ENDED_RUNS_PAGE_SIZE) + ENDED_RUNS_PAGE_SIZE;
  const listed = [...page.active, ...page.ended].some((run) => run.id === sel);
  const { data: outsideRun } = useQuery({
    ...runsBoardRunQuery(ws, sel ?? ""),
    enabled: sel !== undefined && !listed,
  });
  const narrow = (change: {
    view?: (typeof ENDED_VIEWS)[number];
    days?: RunBoardDays | undefined;
    runner?: string | undefined;
  }) => {
    void navigate({
      search: (prev) => ({ ...prev, ...change, ended: undefined }),
      replace: true,
      resetScroll: false,
    });
  };
  return (
    <ScreenMessages messages={runsMessages}>
      <RunsScreen
        page={page}
        drawKey={drawKey}
        workspaces={shell.workspaces}
        selectedId={sel}
        outsideRun={outsideRun ?? null}
        runnerId={runner}
        onSelect={(id) => {
          void navigate({
            search: (prev) => ({ ...prev, sel: id }),
            replace: true,
            resetScroll: false,
          });
        }}
        onOpen={(id) => {
          void navigate({ to: "/runs/$runId", params: { runId: id }, search: { ws } });
        }}
        onPickWorkspace={(next) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              ws: next,
              sel: undefined,
              ended: undefined,
              view: undefined,
              f: undefined,
              project: undefined,
              agent: undefined,
            }),
          });
        }}
        onEndedViewChange={(view) => narrow({ view })}
        onPeriodChange={(days) => narrow({ days: days === DEFAULT_ENDED_DAYS ? undefined : days })}
        onRunnerChange={(next) => narrow({ runner: next })}
        {...(nextEnded > MAX_ENDED_RUNS
          ? {}
          : {
              onShowMoreEnded: () => {
                void navigate({
                  search: (prev) => ({ ...prev, ended: nextEnded }),
                  replace: true,
                  resetScroll: false,
                });
              },
            })}
        onClearConditions={(keys: ReadonlyArray<ClearableCondition>) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              ...Object.fromEntries(keys.map((key) => [key, undefined])),
              sel: undefined,
              ended: undefined,
            }),
            replace: true,
          });
        }}
        runHref={(id) =>
          `/runs/${encodeURIComponent(id)}${ws === undefined ? "" : `?ws=${encodeURIComponent(ws)}`}`
        }
      />
    </ScreenMessages>
  );
}
