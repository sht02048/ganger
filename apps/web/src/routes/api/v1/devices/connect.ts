import { createFileRoute } from "@tanstack/react-router";
import { serveV1Connect } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/devices/connect")({
  server: {
    handlers: {
      POST: ({ request }) => serveV1Connect(request),
    },
  },
});
