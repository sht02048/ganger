import type { ConnectionProjects } from "@ganger/app/settings/model";

export interface NewWorkspaceProject {
  connectionId: string;
  projectId: string;
  name: string;
}

export type ProjectChoiceNotice = "no-connections" | "all-taken";

export function projectChoiceKey(connectionId: string, projectId: string): string {
  return `${connectionId}\n${projectId}`;
}

export function projectChoiceNotice(
  groups: ReadonlyArray<ConnectionProjects>,
): ProjectChoiceNotice | null {
  if (groups.length === 0) return "no-connections";
  if (groups.some((group) => group.error !== null)) return null;
  const projects = groups.flatMap((group) => group.projects);
  return projects.length > 0 && projects.every((project) => project.owner.kind === "other")
    ? "all-taken"
    : null;
}

export function pickedProjects(
  groups: ReadonlyArray<ConnectionProjects>,
  picked: ReadonlySet<string>,
): NewWorkspaceProject[] {
  return groups.flatMap((group) =>
    group.projects.flatMap((project) =>
      project.owner.kind === "free" && picked.has(projectChoiceKey(group.connection.id, project.id))
        ? [{ connectionId: group.connection.id, projectId: project.id, name: project.name }]
        : [],
    ),
  );
}

export function canCreateWorkspace(
  name: string,
  projects: ReadonlyArray<NewWorkspaceProject>,
): boolean {
  return name.trim() !== "" && projects.length > 0;
}
