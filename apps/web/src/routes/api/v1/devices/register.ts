import { createFileRoute } from "@tanstack/react-router";
import { serveV1RegisterDesktop } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/devices/register")({
  server: {
    handlers: {
      POST: ({ request }) => serveV1RegisterDesktop(request),
    },
  },
});
