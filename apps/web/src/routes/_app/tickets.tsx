import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { trackerProjectKey } from "@ganger/app/runs/conditions";
import type { AssignInput, AssignResult, BulkAssignInput } from "@ganger/app/tickets/assign";
import { mergeTicketsPage } from "@ganger/app/tickets/merge";
import { TICKET_VIEWS } from "@ganger/app/tickets/groups";
import { ASSIGN_REJECT_REASONS, TICKET_FILTERS } from "@ganger/app/tickets/model";
import type { AssignRejectReason } from "@ganger/app/tickets/model";
import { INVALIDATED_KEYS } from "../../change-events/invalidation";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { okOrThrow, rejectionReasonOf, toMutationError } from "../../query/mutation-error";
import { loadCachedRouteQuery, loadRouteQuery } from "../../query/route-query";
import {
  assignTicket,
  assignTickets,
  getTicketBlockers,
  rereadTrackers,
} from "../../server/functions";
import { useShell } from "../../shell/shell-query";
import { ticketsMessages } from "../../tickets/messages";
import { TRACKER_KEY, ticketRunsQuery, trackerTicketsQuery } from "../../tickets/tickets-query";
import { TicketsScreen } from "../../tickets/tickets-screen";
import { ScreenError } from "../../shell/screen-error";

const t = createTranslator({
  locale: defaultLocale,
  messages: ticketsMessages,
  namespace: "tickets",
});

function assignResultOf(error: unknown): AssignResult {
  const reason = rejectionReasonOf(error, ASSIGN_REJECT_REASONS);
  if (reason === null) throw toMutationError(error, ASSIGN_REJECT_REASONS);
  return { ok: false, reason };
}

export const Route = createFileRoute("/_app/tickets")({
  errorComponent: ScreenError,
  validateSearch: z.object({
    f: z.enum(TICKET_FILTERS).optional().catch(undefined),
    view: z.enum(TICKET_VIEWS).optional().catch(undefined),
    sel: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: async (load) => {
    await Promise.all([
      loadRouteQuery(load, ticketRunsQuery(load.deps.ws)),
      loadCachedRouteQuery(load, trackerTicketsQuery(load.context.queryClient, load.deps.ws)),
    ]);
  },
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: TicketsRoute,
});

function TicketsRoute() {
  const { f, view, sel, ws } = Route.useSearch();
  const queryClient = useQueryClient();
  const { data: runs } = useSuspenseQuery(ticketRunsQuery(ws));
  const { data: tracker } = useSuspenseQuery(trackerTicketsQuery(queryClient, ws));
  const page = useMemo(() => mergeTicketsPage(runs, tracker), [runs, tracker]);
  const shell = useShell();
  const navigate = Route.useNavigate();
  const assign = useMutation({
    mutationFn: async (input: AssignInput) =>
      okOrThrow<{ runId: string }, AssignRejectReason>(await assignTicket({ data: input })),
    onSuccess: () =>
      Promise.all(
        INVALIDATED_KEYS.assignment.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
  const assignMany = useMutation({
    mutationFn: (input: BulkAssignInput) => assignTickets({ data: input }),
    onSuccess: () =>
      Promise.all(
        INVALIDATED_KEYS.assignment.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
  return (
    <ScreenMessages messages={ticketsMessages}>
      <TicketsScreen
        page={page}
        workspaces={shell.workspaces}
        filter={f ?? "all"}
        view={view ?? "grouped"}
        onViewChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, view: next === "grouped" ? undefined : next }),
            replace: true,
            resetScroll: false,
          });
        }}
        selectedId={sel}
        onFilterChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, f: next === "all" ? undefined : next, sel: undefined }),
            replace: true,
          });
        }}
        onSelect={(id) => {
          void navigate({
            search: (prev) => ({ ...prev, sel: id }),
            replace: true,
            resetScroll: false,
          });
        }}
        onPickWorkspace={(next) => {
          void navigate({ search: (prev) => ({ ...prev, ws: next, sel: undefined }) });
        }}
        onOpenRun={(runId) => {
          void navigate({ to: "/runs", search: (prev) => ({ ws: prev.ws, sel: runId }) });
        }}
        onOpenRuns={(ticket) => {
          void navigate({
            to: "/runs",
            search: (prev) => ({
              ws: prev.ws,
              project: trackerProjectKey(ticket.connection, ticket.trackerProject.id),
            }),
          });
        }}
        onAssign={(input) =>
          assign.mutateAsync(input).then((result): AssignResult => result, assignResultOf)
        }
        onAssignMany={(input) => assignMany.mutateAsync(input)}
        onAssigned={(id) => {
          void navigate({
            search: (prev) => ({ ...prev, sel: id }),
            replace: true,
            resetScroll: false,
          });
        }}
        onReadBlockers={(ticket) =>
          getTicketBlockers({ data: { ws, connection: ticket.connection, key: ticket.key } })
        }
        onReread={async () => {
          await rereadTrackers();
          await queryClient.invalidateQueries({ queryKey: TRACKER_KEY });
        }}
      />
    </ScreenMessages>
  );
}
