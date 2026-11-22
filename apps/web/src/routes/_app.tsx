import {
  Outlet,
  createFileRoute,
  retainSearchParams,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { z } from "zod";
import { ChangeEventsSubscription } from "../change-events/subscription";
import { InAppLinks } from "../navigation/in-app-links";
import { AppShell } from "../shell/app-shell";
import { shellQuery, useShell } from "../shell/shell-query";
import { resolveWorkspace } from "@ganger/app/shell/model";

export const Route = createFileRoute("/_app")({
  validateSearch: z.object({ ws: z.string().optional() }),
  search: { middlewares: [retainSearchParams(["ws"])] },
  loader: ({ context }) => context.queryClient.query({ ...shellQuery, staleTime: "static" }),
  component: AppLayout,
});

function AppLayout() {
  const shell = useShell();
  const { ws } = Route.useSearch();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  return (
    <AppShell
      shell={shell}
      workspace={resolveWorkspace(shell.workspaces, ws)}
      pathname={pathname}
      onWorkspaceChange={(next) => {
        void navigate({ to: ".", search: { ws: next } });
      }}
    >
      <ChangeEventsSubscription />
      <InAppLinks />
      <Outlet />
    </AppShell>
  );
}
