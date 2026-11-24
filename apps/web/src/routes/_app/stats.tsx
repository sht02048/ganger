import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { conditionsForStatsGroup } from "@ganger/app/runs/conditions";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { loadInRequestTimeZone } from "../../query/request-time-zone";
import { loadRouteQuery } from "../../query/route-query";
import { statsMessages } from "../../stats/messages";
import { statsQuery } from "../../stats/query";
import {
  DEFAULT_STATS_PERIOD_DAYS,
  STATS_DIMENSIONS,
  statsPeriodDaysSchema,
} from "@ganger/app/stats/model";
import { StatsScreen } from "../../stats/stats-screen";
import { useShell } from "../../shell/shell-query";
import { ScreenError } from "../../shell/screen-error";

const t = createTranslator({ locale: defaultLocale, messages: statsMessages, namespace: "stats" });

export const Route = createFileRoute("/_app/stats")({
  errorComponent: ScreenError,
  validateSearch: z.object({
    by: z.enum(STATS_DIMENSIONS).optional().catch(undefined),
    days: statsPeriodDaysSchema.optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws, days: search.days ?? DEFAULT_STATS_PERIOD_DAYS }),
  loader: (load) =>
    loadInRequestTimeZone((timeZone) =>
      loadRouteQuery(load, statsQuery(load.deps.ws, load.deps.days, timeZone)),
    ),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: StatsRoute,
});

function StatsRoute() {
  const { ws, days } = Route.useLoaderDeps();
  const timeZone = Route.useLoaderData({ select: (data) => data.timeZone });
  const { data: page } = useSuspenseQuery(statsQuery(ws, days, timeZone));
  const shell = useShell();
  const { by } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  return (
    <ScreenMessages messages={statsMessages}>
      <StatsScreen
        page={page}
        workspaces={shell.workspaces}
        dimension={by ?? "runner"}
        onDimensionChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, by: next === "runner" ? undefined : next }),
            replace: true,
          });
        }}
        onPeriodChange={(next) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              days: next === DEFAULT_STATS_PERIOD_DAYS ? undefined : next,
            }),
            replace: true,
          });
        }}
        onPickWorkspace={(next) => {
          void navigate({ search: (prev) => ({ ...prev, ws: next }) });
        }}
        runsHref={(dimension, key, days) =>
          router.buildLocation({
            to: "/runs",
            search: { ws, ...conditionsForStatsGroup(dimension, key, days) },
          }).href
        }
        onOpenRuns={(dimension, key, days) => {
          void navigate({
            to: "/runs",
            search: { ws, ...conditionsForStatsGroup(dimension, key, days) },
          });
        }}
        failedRunsHref={(days) =>
          router.buildLocation({ to: "/runs", search: { ws, f: "failed", days } }).href
        }
        onOpenFailedRuns={(days) => {
          void navigate({ to: "/runs", search: { ws, f: "failed", days } });
        }}
      />
    </ScreenMessages>
  );
}
