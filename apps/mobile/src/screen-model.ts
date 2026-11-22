import type { V1Dashboard } from "@ganger/api";

import type { MobileRunner } from "./runners/model";

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface MobileSnapshot {
  workspaces: WorkspaceOption[];
  dashboardFor: (workspaceId: string) => V1Dashboard;
  runners: MobileRunner[];
}
