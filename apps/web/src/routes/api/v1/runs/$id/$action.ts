import { createFileRoute } from "@tanstack/react-router";
import { serveV1RunAction } from "../../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/runs/$id/$action")({
  server: {
    handlers: {
      POST: ({ request, params }) => serveV1RunAction(request, params.id, params.action),
    },
  },
});
