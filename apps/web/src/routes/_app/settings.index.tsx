import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  SETTINGS_PAGE_PATHS,
  settingsTargetOf,
  type LegacySettingsTarget,
} from "../../settings/settings-page";
import { useWorkspaceView } from "../../settings/settings-route";

function navigation(target: LegacySettingsTarget, ws: string | undefined) {
  const search = ws === undefined ? {} : { ws };
  return target.kind === "connection"
    ? {
        to: "/settings/connections/$connectionId" as const,
        params: { connectionId: target.connectionId },
        search,
        replace: true,
      }
    : {
        to: SETTINGS_PAGE_PATHS[target.page],
        ...(target.rowId === undefined ? {} : { hash: target.rowId }),
        search,
        replace: true,
      };
}

function openedHash(location: { pathname: string; hash: string }): string {
  return window.location.pathname === location.pathname && location.hash === ""
    ? window.location.hash
    : location.hash;
}

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsIndexRoute,
});

function SettingsIndexRoute() {
  const { ws } = Route.useSearch();
  const view = useWorkspaceView(ws);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hash = useRouterState({ select: (state) => state.location.hash });
  const navigate = useNavigate();
  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    void navigate(navigation(settingsTargetOf(openedHash({ pathname, hash }), view), ws));
  }, [pathname, hash, view, ws, navigate]);
  return null;
}
