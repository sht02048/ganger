import { createFileRoute } from "@tanstack/react-router";
import { serveV1Runners } from "../../../server/v1-http";

export const Route = createFileRoute("/api/v1/runners")({
  server: {
    handlers: {
      GET: ({ request }) => serveV1Runners(request),
    },
  },
});
