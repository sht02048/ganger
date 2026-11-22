import { createFileRoute } from "@tanstack/react-router";
import { serveV1NotificationFeed } from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/notification-events/")({
  server: {
    handlers: {
      GET: ({ request }) => serveV1NotificationFeed(request),
    },
  },
});
