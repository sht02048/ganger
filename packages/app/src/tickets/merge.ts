import { routeToRepo, toLabelId, toRunnerProjectId } from "@ganger/core";
import type { MappingRepo } from "@ganger/core";
import type {
  AssignDefaults,
  TicketProjectFacts,
  TicketRunFacts,
  TicketRunsData,
  TicketView,
  TicketsPage,
  TrackerTicketView,
  TrackerTicketsData,
} from "./model.js";

export function ticketId(connection: string, key: string): string {
  return JSON.stringify([connection, key]);
}

function projectKey(connection: string, projectId: string): string {
  return JSON.stringify([connection, projectId]);
}

const NO_RUNS: TicketRunFacts = { runs: [], activeRunId: null, retryRepo: null, blockerWait: null };

interface Names {
  labelNames: ReadonlyMap<string, string>;
  repoNames: Readonly<Record<string, string>>;
}

function mappingRepos(project: TicketProjectFacts): MappingRepo[] {
  return (project.mapping?.repos ?? []).map((repo) => ({
    project: toRunnerProjectId(repo.project),
    isDefault: repo.isDefault,
    labelId: repo.labelId === null ? null : toLabelId(repo.labelId),
  }));
}

export function assignDefaultsOf(
  project: TicketProjectFacts,
  ticket: Pick<TrackerTicketView, "labels">,
  facts: TicketRunFacts,
  { labelNames, repoNames }: Names,
): AssignDefaults | null {
  const mapping = project.mapping;
  if (mapping === null) return null;
  const routed =
    routeToRepo(
      mappingRepos(project),
      ticket.labels.map((label) => toLabelId(label.id)),
    ) ?? mapping.defaultRepo;
  const previous = mapping.repos.some((repo) => repo.project === facts.retryRepo)
    ? facts.retryRepo
    : null;
  return {
    runnerProject: previous ?? routed,
    agent: mapping.agent,
    repos: mapping.repos.map((repo) => ({
      id: repo.project,
      name: repoNames[repo.project] ?? repo.project,
      isDefault: repo.isDefault,
      label: repo.labelId === null ? null : (labelNames.get(repo.labelId) ?? null),
    })),
  };
}

export function assignabilityOf(
  project: TicketProjectFacts,
  ticket: Pick<TrackerTicketView, "labels">,
  facts: TicketRunFacts,
  names: Names,
): TicketView["assignability"] {
  if (facts.activeRunId !== null) return { kind: "active-run", runId: facts.activeRunId };
  const defaults = assignDefaultsOf(project, ticket, facts, names);
  if (defaults === null) return { kind: "no-mapping" };
  return { kind: "ready", defaults };
}

function labelNamesOf(tracker: TrackerTicketsData): Map<string, string> {
  const names = new Map<string, string>();
  for (const project of tracker.labels) {
    if (!project.labels.ok) continue;
    for (const label of project.labels.items) names.set(label.id, label.name);
  }
  for (const ticket of tracker.tickets) {
    for (const label of ticket.labels) names.set(label.id, label.name);
  }
  return names;
}

export function mergeTicketsPage(runs: TicketRunsData, tracker: TrackerTicketsData): TicketsPage {
  const base = {
    workspace: runs.workspace,
    runners: runs.runners,
    agents: runs.agents,
    trackerProjectCount: runs.projects.length,
  };
  if (runs.workspace.kind !== "one") return { ...base, tickets: [], errors: [], truncated: [] };

  const projects = new Map(
    runs.projects.map((project) => [projectKey(project.connection, project.projectId), project]),
  );
  const names: Names = { labelNames: labelNamesOf(tracker), repoNames: runs.repoNames };
  const parentIssueIds = new Set(
    tracker.tickets.flatMap((ticket) =>
      ticket.ancestors.map((ancestor) => ticketId(ticket.connection, ancestor.key)),
    ),
  );
  const tickets = tracker.tickets.map((ticket): TicketView => {
    const id = ticketId(ticket.connection, ticket.key);
    const facts = runs.runsByTicket[id] ?? NO_RUNS;
    const project = projects.get(projectKey(ticket.connection, ticket.projectId)) ?? {
      connection: ticket.connection,
      projectId: ticket.projectId,
      name: ticket.projectName,
      mapping: null,
      autoAssignLabel: null,
    };
    return {
      id,
      connection: ticket.connection,
      key: ticket.key,
      title: ticket.title,
      url: ticket.url,
      trackerProject: { id: project.projectId, name: project.name },
      trackerState: ticket.state,
      priority: ticket.priority,
      ancestors: ticket.ancestors,
      isParentIssue: parentIssueIds.has(id),
      blockerWait: facts.blockerWait,
      waitingTickets: runs.waitingByBlocker[id] ?? [],
      labels: ticket.labels.map((label) => ({
        name: label.name,
        autoAssign: label.id === project.autoAssignLabel,
      })),
      runs: facts.runs,
      mapping: assignDefaultsOf(project, ticket, facts, names),
      assignability: assignabilityOf(project, ticket, facts, names),
    };
  });
  return { ...base, tickets, errors: tracker.errors, truncated: tracker.truncated };
}
