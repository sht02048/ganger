import { MAX_NAME_LENGTH } from "@ganger/app/settings/model";
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

export interface ProjectGroupChoice {
  connectionId: string;
  connectionName: string;
  unreadable: boolean;
  options: ReadonlyArray<{ key: string; name: string; picked: boolean }>;
  pickedCount: number;
  selection: "none" | "some" | "all";
}

export function projectGroupChoice(
  group: ConnectionProjects,
  picked: ReadonlySet<string>,
): ProjectGroupChoice {
  const options = group.projects
    .filter((project) => project.owner.kind === "free")
    .map((project) => {
      const key = projectChoiceKey(group.connection.id, project.id);
      return { key, name: project.name, picked: picked.has(key) };
    });
  const pickedCount = options.filter((option) => option.picked).length;
  return {
    connectionId: group.connection.id,
    connectionName: group.connection.name,
    unreadable: group.error !== null,
    options,
    pickedCount,
    selection: pickedCount === 0 ? "none" : pickedCount === options.length ? "all" : "some",
  };
}

export function withKeysPicked(
  picked: ReadonlySet<string>,
  keys: ReadonlyArray<string>,
  on: boolean,
): ReadonlySet<string> {
  const next = new Set(picked);
  for (const key of keys) {
    if (on) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function startsExpanded(groupCount: number): boolean {
  return groupCount === 1;
}

export function hiddenProjectCount(groups: ReadonlyArray<ConnectionProjects>): number {
  return groups
    .flatMap((group) => group.projects)
    .filter((project) => project.owner.kind === "other").length;
}

export function canCreateWorkspace(
  name: string,
  projects: ReadonlyArray<NewWorkspaceProject>,
): boolean {
  return name.trim() !== "" && !workspaceNameTooLong(name) && projects.length > 0;
}

export function isAtCreatedWorkspace(href: string, workspaceId: string): boolean {
  const url = new URL(href);
  return url.pathname === "/settings/projects" && url.searchParams.get("ws") === workspaceId;
}

export function workspaceNameTooLong(name: string): boolean {
  return Array.from(name.trim()).length > MAX_NAME_LENGTH;
}
