import type { AppDashboard, AppRunner } from "@ganger/api";

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface MobileSnapshot {
  workspaces: ReadonlyArray<WorkspaceOption>;
  dashboardFor: (workspaceId: string) => AppDashboard | null;
  runners: ReadonlyArray<AppRunner>;
}
