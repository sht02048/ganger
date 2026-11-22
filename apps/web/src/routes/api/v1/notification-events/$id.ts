import { createFileRoute } from "@tanstack/react-router";
import { serveV1NotificationEvent } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/notification-events/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveV1NotificationEvent(request, params.id),
    },
  },
});
