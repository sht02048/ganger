import { createFileRoute } from "@tanstack/react-router";
import { serveV1ChangeStream } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/change-events/stream")({
  server: {
    handlers: {
      GET: ({ request }) => serveV1ChangeStream(request),
    },
  },
});
