import { createFileRoute } from "@tanstack/react-router";
import { serveV1Workspaces } from "../../../server/v1-http";

export const Route = createFileRoute("/api/v1/workspaces")({
  server: {
    handlers: {
      GET: ({ request }) => serveV1Workspaces(request),
    },
  },
});
