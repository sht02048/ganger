import { createFileRoute } from "@tanstack/react-router";
import { serveV1Disconnect } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/devices/me")({
  server: {
    handlers: {
      DELETE: ({ request }) => serveV1Disconnect(request),
    },
  },
});
