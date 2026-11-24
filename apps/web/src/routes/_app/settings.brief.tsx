import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings/brief")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/settings/general",
      search: search.ws === undefined ? {} : { ws: search.ws },
      replace: true,
    });
  },
});
