import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { loadRouteQuery } from "../../query/route-query";
import {
  LOG_POLL_LIMIT,
  fetchCountOf,
  runDetailPollMs,
  useRunDetailMutations,
} from "../../run-detail/actions";
import { runMessages } from "../../run-detail/messages";
import { RunDetailScreen } from "../../run-detail/run-detail-screen";
import { runDetailQuery } from "../../runs/queries";
import type { RunDetailPage } from "@ganger/app/run-detail/model";
import { ScreenError } from "../../shell/screen-error";

const t = createTranslator({ locale: defaultLocale, messages: runMessages, namespace: "run" });

export const Route = createFileRoute("/_app/runs_/$runId")({
  errorComponent: ScreenError,
  loader: (load) => loadRouteQuery(load, runDetailQuery(load.params.runId)),
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.kind === "found"
            ? t("documentTitle", { ticket: loaderData.run.ticketKey })
            : t("documentTitleNotFound"),
      },
    ],
  }),
  component: RunDetailRoute,
});

function useFetchCount(runId: string): () => number {
  const queryClient = useQueryClient();
  return useCallback(() => {
    const state = queryClient.getQueryState(runDetailQuery(runId).queryKey);
    return state === undefined ? 0 : fetchCountOf(state);
  }, [queryClient, runId]);
}

function controlPending(page: RunDetailPage): boolean {
  return page.kind === "found" && page.run.control?.status === "pending";
}

function RunDetailRoute() {
  const { runId } = Route.useParams();
  return <RunDetail key={runId} runId={runId} />;
}

function RunDetail({ runId }: { runId: string }) {
  const { ws } = Route.useSearch();
  const fetchCount = useFetchCount(runId);
  const [logPollsFrom, setLogPollsFrom] = useState(fetchCount);
  const logRequested = useCallback(() => setLogPollsFrom(fetchCount()), [fetchCount]);
  const { data: page } = useSuspenseQuery({
    ...runDetailQuery(runId),
    refetchInterval: (query) =>
      query.state.data === undefined
        ? false
        : runDetailPollMs(query.state.data, fetchCountOf(query.state) - logPollsFrom),
  });
  const { actions, openLog } = useRunDetailMutations(runId, logRequested);

  useEffect(() => {
    openLog();
  }, [openLog]);

  const search = ws === undefined ? "" : `?ws=${encodeURIComponent(ws)}`;
  return (
    <ScreenMessages messages={runMessages}>
      <RunDetailScreen
        page={page}
        runsHref={`/runs${search}`}
        runHref={(id) => `/runs/${encodeURIComponent(id)}${search}`}
        runnerHref={(id) =>
          `/runs${search === "" ? "?" : `${search}&`}runner=${encodeURIComponent(id)}`
        }
        logStalled={!controlPending(page) && fetchCount() - logPollsFrom >= LOG_POLL_LIMIT}
        {...actions}
      />
    </ScreenMessages>
  );
}
