import { ALL_WORKSPACES } from "../dashboard/model";
import type { ChangeNotice } from "./change-stream";

export type ReadPart = "dashboard" | "workspaces" | "runners" | "device";

export type ReadScope = ReadonlySet<ReadPart>;

export const EVERYTHING: ReadScope = new Set<ReadPart>([
  "dashboard",
  "workspaces",
  "runners",
  "device",
]);
export const NOTHING: ReadScope = new Set<ReadPart>();
const SERVER_DATA: ReadScope = new Set<ReadPart>(["dashboard", "workspaces", "runners"]);
const DASHBOARD: ReadScope = new Set<ReadPart>(["dashboard"]);
const RUNNERS: ReadScope = new Set<ReadPart>(["runners", "dashboard"]);
const WORKSPACE_LIST: ReadScope = new Set<ReadPart>(["workspaces"]);
const WORKSPACE_AND_DASHBOARD: ReadScope = new Set<ReadPart>(["workspaces", "dashboard"]);

function concernsView(notice: ChangeNotice, workspaceId: string): boolean {
  return (
    workspaceId === ALL_WORKSPACES ||
    notice.workspaceId === null ||
    notice.workspaceId === workspaceId
  );
}

export function readScopeOf(notice: ChangeNotice | null, workspaceId: string): ReadScope {
  if (notice === null) return EVERYTHING;
  switch (notice.kind) {
    case "run":
    case "assignment":
      if (notice.part === "log") return NOTHING;
      return concernsView(notice, workspaceId) ? DASHBOARD : NOTHING;
    case "runner":
      return RUNNERS;
    case "workspace":
      return concernsView(notice, workspaceId) ? WORKSPACE_AND_DASHBOARD : WORKSPACE_LIST;
    case "settings":
      return SERVER_DATA;
    case "tracker":
      return NOTHING;
    default:
      return EVERYTHING;
  }
}
