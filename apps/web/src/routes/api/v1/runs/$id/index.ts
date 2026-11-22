import { createFileRoute } from "@tanstack/react-router";
import { serveV1RunDetail } from "../../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/runs/$id/")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveV1RunDetail(request, params.id),
    },
  },
});
