import { randomUUID } from "node:crypto";
import { toTrackerConnectionId, toTrackerProjectId } from "@ganger/core";
import {
  getAutoAssignLabel,
  getTrackerConnection,
  getWorkspaceTrackerProject,
  inTransaction,
  getMapping,
  listCodeHostConnections,
  listRunners,
  listTrackerConnections,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
} from "@ganger/db";
import type { Database, SecretBox, WorkspaceId } from "@ganger/db";
import { z } from "zod";
import { idSchema, nameSchema } from "@ganger/app/settings/actions";
import { loadSettingsPage, loadTrackerProjectChoices } from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import type { ConnectionProjects, SaveResult, SettingsPage } from "@ganger/app/settings/model";
import { ONBOARDING_STEPS, isSetupComplete, resolveStep } from "./model";
import type { SetupCounts } from "./model";

export function loadSetupCounts(db: Database, secretBox: SecretBox): SetupCounts {
  const mapped = listWorkspaceTrackerProjects(db).filter(
    (project) => getMapping(db, project.connection, project.projectId) !== null,
  );
  return {
    trackerConnections: listTrackerConnections(db, secretBox).length,
    githubTokens: listCodeHostConnections(db, secretBox).length,
    runners: listRunners(db).length,
    workspaces: listWorkspaces(db).length,
    mappings: mapped.length,
    autoAssignReady: mapped.filter(
      (project) =>
        project.inProgressStateId !== null &&
        getAutoAssignLabel(db, project.workspaceId, project.connection) !== null,
    ).length,
  };
}

export function isOnboardingComplete(db: Database, secretBox: SecretBox): boolean {
  return isSetupComplete(loadSetupCounts(db, secretBox));
}

export async function loadOnboardingPage(
  context: SettingsContext,
  step: number | undefined,
  now: Date,
): Promise<{ page: SettingsPage; trackerProjects: ConnectionProjects[] }> {
  const page = await loadSettingsPage(context, undefined, now);
  if (page.workspace !== null) return { page, trackerProjects: page.workspace.trackerProjects };
  const onWorkspaceStep = ONBOARDING_STEPS[resolveStep(page, step)] === "workspace";
  return {
    page,
    trackerProjects:
      onWorkspaceStep && page.install.connections.length > 0
        ? await loadTrackerProjectChoices(context, null)
        : [],
  };
}

export const firstWorkspaceInput = z.object({
  name: nameSchema,
  projects: z
    .array(z.object({ connectionId: idSchema, projectId: idSchema, name: nameSchema }))
    .max(500),
});

class WorkspaceSetupRejected extends Error {
  readonly reason: "not-found" | "taken";

  constructor(reason: "not-found" | "taken") {
    super(reason);
    this.reason = reason;
  }
}

function bindProjects(
  { db, secretBox }: SettingsContext,
  workspaceId: WorkspaceId,
  projects: z.infer<typeof firstWorkspaceInput>["projects"],
): void {
  for (const project of projects) {
    const connection = toTrackerConnectionId(project.connectionId);
    if (getTrackerConnection(db, secretBox, connection) === null) {
      throw new WorkspaceSetupRejected("not-found");
    }
    const projectId = toTrackerProjectId(project.projectId);
    const bound = getWorkspaceTrackerProject(db, connection, projectId);
    if (bound !== null) {
      if (bound.workspaceId === workspaceId) continue;
      throw new WorkspaceSetupRejected("taken");
    }
    saveWorkspaceTrackerProject(db, {
      workspaceId,
      connection,
      projectId,
      name: project.name,
      inProgressStateId: null,
    });
  }
}

export function setUpFirstWorkspace(
  context: SettingsContext,
  input: z.infer<typeof firstWorkspaceInput>,
  now: Date,
): SaveResult<"not-found" | "taken"> {
  const { db } = context;
  try {
    inTransaction(db, () => {
      const existing = listWorkspaces(db)[0];
      const workspaceId = existing?.id ?? toWorkspaceId(randomUUID());
      saveWorkspace(
        db,
        {
          id: workspaceId,
          name: input.name,
          ...(existing === undefined ? {} : { maxRunMs: existing.maxRunMs }),
        },
        now,
      );
      bindProjects(context, workspaceId, input.projects);
    });
  } catch (error) {
    if (error instanceof WorkspaceSetupRejected) return { ok: false, reason: error.reason };
    throw error;
  }
  return { ok: true };
}

export const newWorkspaceInput = firstWorkspaceInput.extend({
  projects: firstWorkspaceInput.shape.projects.min(1),
});

export type NewWorkspaceResult =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: "not-found" | "taken" };

export function createNewWorkspace(
  context: SettingsContext,
  input: z.infer<typeof newWorkspaceInput>,
  now: Date,
): NewWorkspaceResult {
  const { db } = context;
  const workspaceId = toWorkspaceId(randomUUID());
  try {
    inTransaction(db, () => {
      saveWorkspace(db, { id: workspaceId, name: input.name }, now);
      bindProjects(context, workspaceId, input.projects);
    });
  } catch (error) {
    if (error instanceof WorkspaceSetupRejected) return { ok: false, reason: error.reason };
    throw error;
  }
  return { ok: true, id: workspaceId, name: input.name };
}
