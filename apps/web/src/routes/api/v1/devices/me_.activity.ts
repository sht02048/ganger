import { createFileRoute } from "@tanstack/react-router";
import { serveV1DeviceActivity } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/devices/me_/activity")({
  server: {
    handlers: {
      PUT: ({ request }) => serveV1DeviceActivity(request),
    },
  },
});
