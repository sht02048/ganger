import type { V1Dashboard, V1Runner } from "@ganger/api";

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface MobileSnapshot {
  workspaces: ReadonlyArray<WorkspaceOption>;
  dashboardFor: (workspaceId: string) => V1Dashboard | null;
  runners: ReadonlyArray<V1Runner>;
}
