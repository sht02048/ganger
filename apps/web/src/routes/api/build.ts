import { createFileRoute } from "@tanstack/react-router";
import { BUILD_ID } from "../../identity/build-id";

export const Route = createFileRoute("/api/build")({
  server: {
    handlers: {
      GET: () => Response.json({ buildId: BUILD_ID }, { headers: { "cache-control": "no-store" } }),
    },
  },
});
