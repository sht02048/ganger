import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings/devices")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/settings/mobile",
      search: search.ws === undefined ? {} : { ws: search.ws },
      replace: true,
    });
  },
});
