import { createFileRoute } from "@tanstack/react-router";
import { serveV1Dashboard } from "../../../server/v1-http";

export const Route = createFileRoute("/api/v1/dashboard")({
  server: {
    handlers: {
      GET: ({ request }) => serveV1Dashboard(request),
    },
  },
});
