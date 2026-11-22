import { createFileRoute } from "@tanstack/react-router";
import { serveV1Disconnect, serveV1ThisDevice } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/devices/me")({
  server: {
    handlers: {
      GET: ({ request }) => serveV1ThisDevice(request),
      DELETE: ({ request }) => serveV1Disconnect(request),
    },
  },
});
