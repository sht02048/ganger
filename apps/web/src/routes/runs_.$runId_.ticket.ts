import { createFileRoute } from "@tanstack/react-router";
import { serveRunTicket } from "../server/run-ticket";

export const Route = createFileRoute("/runs_/$runId_/ticket")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveRunTicket(request, params.runId),
    },
  },
});
