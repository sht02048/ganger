import { createFileRoute } from "@tanstack/react-router";
import { serveV1TicketLink } from "../../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/runs/$id/ticket-link")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveV1TicketLink(request, params.id),
    },
  },
});
