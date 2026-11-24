import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { createTranslator } from "use-intl";
import { toRunId } from "@ganger/core";
import { z } from "zod";
import { useAgedHomePage } from "../../home/aged-page";
import { HomeScreen } from "../../home/home-screen";
import { homeMessages } from "../../home/messages";
import { useDashboardActions } from "../../home/mutations";
import { dashboardQuery } from "../../home/query";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { useFirstDrawKey } from "../../query/first-draw";
import { loadInRequestTimeZone } from "../../query/request-time-zone";
import { loadRouteQuery } from "../../query/route-query";
import { ScreenError } from "../../shell/screen-error";

const t = createTranslator({ locale: defaultLocale, messages: homeMessages, namespace: "home" });

export const Route = createFileRoute("/_app/")({
  errorComponent: ScreenError,
  validateSearch: z.object({
    view: z.enum(["todo"]).optional().catch(undefined),
    run: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: (load) =>
    loadInRequestTimeZone((timeZone) =>
      loadRouteQuery(load, dashboardQuery(load.deps.ws, timeZone)),
    ),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const { ws } = Route.useLoaderDeps();
  const timeZone = Route.useLoaderData({ select: (data) => data.timeZone });
  const { data: loaded, refetch, isFetching } = useSuspenseQuery(dashboardQuery(ws, timeZone));
  const drawKey = useFirstDrawKey(ws, isFetching);
  const readAgainWhenLimitLifts = useCallback(() => {
    void refetch();
  }, [refetch]);
  const page = useAgedHomePage(loaded, readAgainWhenLimitLifts);
  const { view, run } = Route.useSearch();
  const navigate = Route.useNavigate();
  const actions = useDashboardActions();
  const clearOpenRun = useCallback(() => {
    void navigate({
      search: (prev) => ({ ...prev, run: undefined }),
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);
  return (
    <ScreenMessages messages={homeMessages}>
      <HomeScreen
        page={page}
        drawKey={drawKey}
        view={view ?? "all"}
        onViewChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, view: next === "all" ? undefined : next }),
            replace: true,
            resetScroll: false,
          });
        }}
        onAnswer={actions.onAnswer}
        onHumanCheck={actions.onHumanCheck}
        onDeny={actions.onDeny}
        onControl={actions.onControl}
        onMerge={actions.onMerge}
        onLoadCommits={actions.onLoadCommits}
        openRunId={run === undefined ? undefined : toRunId(run)}
        onOpenRunShown={clearOpenRun}
      />
    </ScreenMessages>
  );
}
