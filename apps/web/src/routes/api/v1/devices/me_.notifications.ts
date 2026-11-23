import { createFileRoute } from "@tanstack/react-router";
import {
  serveV1DeviceNotifications,
  serveV1SaveDeviceNotifications,
} from "../../../../server/v1-http";

export const Route = createFileRoute("/api/v1/devices/me_/notifications")({
  server: {
    handlers: {
      GET: ({ request }) => serveV1DeviceNotifications(request),
      PUT: ({ request }) => serveV1SaveDeviceNotifications(request),
    },
  },
});
