import { createFileRoute } from "@tanstack/react-router";
import { serveV1NotificationStream } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/notification-events/stream")({
  server: {
    handlers: {
      GET: ({ request }) => serveV1NotificationStream(request),
    },
  },
});
