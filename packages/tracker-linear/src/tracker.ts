import {
  toCommentId,
  toLabelId,
  toTicketKey,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type {
  CommentId,
  LabelId,
  Page,
  Paged,
  TicketBlocker,
  TicketKey,
  TicketPriority,
  TicketRelations,
  Tracker,
  TrackerComment,
  TrackerConnectionCheck,
  TrackerFactory,
  TrackerLabel,
  TrackerProject,
  TrackerProjectId,
  TrackerState,
  TrackerStateId,
  TrackerTicket,
  TrackerTicketAncestor,
} from "@ganger/core";
import { z } from "zod";
import { LinearApiError, LinearClient, LinearTrackerError, connectionSchema } from "./client.js";
import type { Fetch } from "./client.js";
import { verifyLinearWebhook } from "./webhook.js";
import type { WebhookResult } from "./webhook.js";

export const LINEAR_TRACKER_KIND = toTrackerKind("linear");

export const LINEAR_MAX_PAGE_SIZE = 250;
const DEFAULT_PAGE_SIZE = 50;
const LABELS_PER_TICKET = 100;
const MAX_PAGES = 200;

export const linearConnectionSettingsSchema = z.object({
  config: z
    .object({
      apiUrl: z.url().optional(),
    })
    .loose()
    .nullish(),
  secrets: z.object({
    apiKey: z.string().min(1),
    webhookSecret: z.string().min(1).nullish(),
  }),
});

export type LinearConnectionSettings = z.input<typeof linearConnectionSettingsSchema>;

export const linearTrackerFactory: TrackerFactory = {
  kind: LINEAR_TRACKER_KIND,
  create(config: unknown): Tracker {
    const settings = linearConnectionSettingsSchema.parse(config);
    const apiUrl = settings.config?.apiUrl;
    return new LinearTracker({
      apiKey: settings.secrets.apiKey,
      webhookSecret: settings.secrets.webhookSecret ?? null,
      ...(apiUrl === undefined ? {} : { apiUrl }),
    });
  },
};

const TICKET_FIELDS = `
fragment TicketFields on Issue {
  identifier
  title
  description
  url
  updatedAt
  priority
  state { id name type }
  project { id name }
  labels(first: ${LABELS_PER_TICKET}) { nodes { id name } }
}`;

const ANCESTOR_FIELDS = "id identifier title url state { name type }";

const PROJECT_TICKET_FIELDS = `
fragment ProjectTicketFields on Issue {
  ...TicketFields
  parent {
    ${ANCESTOR_FIELDS}
    parent {
      ${ANCESTOR_FIELDS}
      parent { ${ANCESTOR_FIELDS} }
    }
  }
}
${TICKET_FIELDS}`;

const PAGE_INFO = "pageInfo { hasNextPage endCursor }";

const QUERY_CONNECTION = "query Connection { viewer { id } }";

const QUERY_ORGANIZATION = "query Organization { viewer { organization { name urlKey } } }";

const URL_KEY = /^[a-z0-9][a-z0-9-]*$/iu;

export function linearWebhookSettingsUrl(urlKey: string): string | null {
  return URL_KEY.test(urlKey) ? `https://linear.app/${urlKey}/settings/api` : null;
}

const QUERY_TICKET = `query Ticket($id: String!) { issue(id: $id) { ...TicketFields } }
${TICKET_FIELDS}`;

const QUERY_TICKET_RELATIONS = `query TicketRelations($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    priority
    inverseRelations(first: $first, after: $after, includeArchived: true) {
      nodes { type issue { identifier title state { id name type } } }
      ${PAGE_INFO}
    }
  }
}`;

const QUERY_PROJECT_TICKETS = `query ProjectTickets($projectId: ID!, $first: Int!, $after: String) {
  issues(filter: { project: { id: { eq: $projectId } } }, first: $first, after: $after) {
    nodes { ...ProjectTicketFields }
    ${PAGE_INFO}
  }
}
${PROJECT_TICKET_FIELDS}`;

const QUERY_LABELED_TICKETS = `query LabeledTickets($labelId: ID!, $updatedSince: DateTimeOrDuration!, $first: Int!, $after: String) {
  issues(filter: { labels: { id: { eq: $labelId } }, updatedAt: { gte: $updatedSince } }, first: $first, after: $after) {
    nodes { ...TicketFields }
    ${PAGE_INFO}
  }
}
${TICKET_FIELDS}`;

const QUERY_COMMENTS = `query TicketComments($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    comments(first: $first, after: $after) {
      nodes { id body createdAt user { name } }
      ${PAGE_INFO}
    }
  }
}`;

const QUERY_PROJECTS = `query Projects($first: Int!, $after: String) {
  projects(first: $first, after: $after) {
    nodes { id name url }
    ${PAGE_INFO}
  }
}`;

const QUERY_PROJECT_TEAMS = `query ProjectTeams($id: String!) {
  project(id: $id) { teams(first: ${LINEAR_MAX_PAGE_SIZE}) { nodes { id } } }
}`;

const QUERY_TEAM_STATES = `query TeamStates($teamIds: [ID!]!, $first: Int!, $after: String) {
  workflowStates(filter: { team: { id: { in: $teamIds } } }, first: $first, after: $after) {
    nodes { id name type position }
    ${PAGE_INFO}
  }
}`;

const QUERY_TEAM_LABELS = `query TeamLabels($teamIds: [ID!]!, $first: Int!, $after: String) {
  issueLabels(filter: { or: [{ team: { id: { in: $teamIds } } }, { team: { null: true } }] }, first: $first, after: $after) {
    nodes { id name isGroup }
    ${PAGE_INFO}
  }
}`;

const MUTATION_CREATE_LABEL = `mutation CreateLabel($name: String!, $color: String!) {
  issueLabelCreate(input: { name: $name, color: $color }) { success issueLabel { id name } }
}`;

const MUTATION_SET_STATE = `mutation SetState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`;

const MUTATION_ADD_COMMENT = `mutation AddComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id url } }
}`;

const idSchema = z.string().min(1);
const dateSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const stateSchema = z.object({ id: idSchema, name: z.string(), type: z.string() });

const LINEAR_PRIORITIES: Readonly<Record<number, TicketPriority>> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "medium",
  4: "low",
};

const prioritySchema = z
  .number()
  .nullish()
  .transform((value): TicketPriority => LINEAR_PRIORITIES[value ?? 0] ?? "none");

const relationSchema = z.object({
  type: z.string(),
  issue: z.object({ identifier: idSchema, title: z.string(), state: stateSchema }),
});

const ticketRelationsSchema = z.object({
  issue: z.object({
    priority: prioritySchema,
    inverseRelations: connectionSchema(relationSchema),
  }),
});

const issueSchema = z.object({
  identifier: idSchema,
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  updatedAt: dateSchema,
  priority: prioritySchema,
  state: stateSchema,
  project: z.object({ id: idSchema, name: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ id: idSchema, name: z.string() })) }),
});

function toTicket(issue: z.output<typeof issueSchema>): TrackerTicket {
  return {
    key: toTicketKey(issue.identifier),
    title: issue.title,
    body: issue.description ?? "",
    url: issue.url,
    labels: issue.labels.nodes.map(toLabel),
    project:
      issue.project === null
        ? null
        : { id: toTrackerProjectId(issue.project.id), name: issue.project.name },
    state: toState(issue.state),
    updatedAt: issue.updatedAt,
    priority: issue.priority,
  };
}

const ticketSchema = issueSchema.transform(toTicket);

const ancestorFieldsSchema = z.object({
  id: idSchema,
  identifier: idSchema,
  title: z.string(),
  url: z.string(),
  state: z.object({ name: z.string(), type: z.string() }),
});

type AncestorFields = z.output<typeof ancestorFieldsSchema>;

const thirdAncestorSchema = ancestorFieldsSchema;
const secondAncestorSchema = ancestorFieldsSchema.extend({
  parent: thirdAncestorSchema.nullish(),
});
const firstAncestorSchema = ancestorFieldsSchema.extend({
  parent: secondAncestorSchema.nullish(),
});

function toAncestor(fields: AncestorFields): TrackerTicketAncestor {
  return {
    id: fields.id,
    key: toTicketKey(fields.identifier),
    title: fields.title,
    url: fields.url,
    state: { name: fields.state.name, category: fields.state.type },
  };
}

function ancestorsOf(
  parent: z.output<typeof firstAncestorSchema> | null | undefined,
): TrackerTicketAncestor[] {
  if (parent === null || parent === undefined) return [];
  const second = parent.parent ?? null;
  const third = second?.parent ?? null;
  return [parent, second, third]
    .filter((fields) => fields !== null)
    .map((fields) => toAncestor(fields));
}

const projectTicketSchema = issueSchema
  .extend({ parent: firstAncestorSchema.nullish() })
  .transform((issue): TrackerTicket => ({
    ...toTicket(issue),
    ancestors: ancestorsOf(issue.parent),
  }));

const ticketConnectionSchema = z.object({ issues: connectionSchema(ticketSchema) });
const projectTicketConnectionSchema = z.object({ issues: connectionSchema(projectTicketSchema) });

const commentSchema = z
  .object({
    id: idSchema,
    body: z.string(),
    createdAt: dateSchema,
    user: z.object({ name: z.string() }).nullable(),
  })
  .transform((comment): TrackerComment => ({
    id: toCommentId(comment.id),
    body: comment.body,
    createdAt: comment.createdAt,
    author: comment.user?.name ?? null,
  }));

const projectSchema = z
  .object({ id: idSchema, name: z.string(), url: z.string() })
  .transform((project): TrackerProject => ({
    id: toTrackerProjectId(project.id),
    name: project.name,
    url: project.url,
  }));

const workflowStateSchema = stateSchema.extend({ position: z.number() });
const issueLabelSchema = z.object({ id: idSchema, name: z.string(), isGroup: z.boolean() });

function toLabel(label: { id: string; name: string }): TrackerLabel {
  return { id: toLabelId(label.id), name: label.name };
}

function toState(state: { id: string; name: string; type: string }): TrackerState {
  return { id: toTrackerStateId(state.id), name: state.name, category: state.type };
}

const CATEGORY_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function pageSize(page: Page | undefined): number {
  const first = page?.first ?? DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(first)) return DEFAULT_PAGE_SIZE;
  return Math.min(LINEAR_MAX_PAGE_SIZE, Math.max(1, Math.trunc(first)));
}

function notFound(): LinearTrackerError {
  return new LinearTrackerError({ kind: "not-found" });
}

export class LinearTracker implements Tracker {
  readonly kind = LINEAR_TRACKER_KIND;
  private readonly client: LinearClient;
  private readonly webhookSecret: string | null;

  constructor(input: {
    apiKey: string;
    webhookSecret: string | null;
    apiUrl?: string;
    fetch?: Fetch;
  }) {
    this.client = new LinearClient(input);
    this.webhookSecret = input.webhookSecret;
  }

  async checkConnection(): Promise<TrackerConnectionCheck> {
    try {
      await this.client.request(
        QUERY_CONNECTION,
        {},
        z.object({ viewer: z.object({ id: idSchema }) }),
      );
      const organization = await this.organization();
      const webhookSettingsUrl =
        organization?.urlKey === undefined ? null : linearWebhookSettingsUrl(organization.urlKey);
      return {
        ok: true,
        organizationName: organization?.name ?? null,
        ...(webhookSettingsUrl === null ? {} : { webhookSettingsUrl }),
      };
    } catch (error) {
      if (error instanceof LinearTrackerError) return { ok: false, error: error.detail };
      throw error;
    }
  }

  private async organization(): Promise<{ name: string; urlKey?: string | undefined } | null> {
    try {
      const data = await this.client.request(
        QUERY_ORGANIZATION,
        {},
        z.object({
          viewer: z.object({
            organization: z.object({
              name: z.string(),
              urlKey: z.string().optional().catch(undefined),
            }),
          }),
        }),
      );
      return data.viewer.organization;
    } catch {
      return null;
    }
  }

  verifyWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string | undefined>>;
    now: Date;
  }): WebhookResult {
    return verifyLinearWebhook({ ...input, secret: this.webhookSecret });
  }

  async getTicket(key: TicketKey): Promise<TrackerTicket | null> {
    try {
      const data = await this.client.request(
        QUERY_TICKET,
        { id: key },
        z.object({ issue: ticketSchema }),
      );
      return data.issue;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getTicketRelations(key: TicketKey): Promise<TicketRelations | null> {
    const blockers: TicketBlocker[] = [];
    let priority: TicketPriority = "none";
    let after: string | null = null;
    try {
      for (let pages = 0; pages < MAX_PAGES; pages += 1) {
        const data: z.output<typeof ticketRelationsSchema> = await this.client.request(
          QUERY_TICKET_RELATIONS,
          { id: key, first: LINEAR_MAX_PAGE_SIZE, after },
          ticketRelationsSchema,
        );
        priority = data.issue.priority;
        const { nodes, pageInfo } = data.issue.inverseRelations;
        for (const relation of nodes) {
          if (relation.type !== "blocks") continue;
          blockers.push({
            key: toTicketKey(relation.issue.identifier),
            title: relation.issue.title,
            state: toState(relation.issue.state),
          });
        }
        if (!pageInfo.hasNextPage || pageInfo.endCursor === null) {
          return { priority, blockers };
        }
        after = pageInfo.endCursor;
      }
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    throw new Error(`Linear 목록이 ${MAX_PAGES}쪽을 넘었다`);
  }

  async listProjectTickets(
    projectId: TrackerProjectId,
    page?: Page,
  ): Promise<Paged<TrackerTicket>> {
    const data = await this.client.request(
      QUERY_PROJECT_TICKETS,
      { projectId, first: pageSize(page), after: page?.after ?? null },
      projectTicketConnectionSchema,
    );
    return toPaged(data.issues);
  }

  async listLabeledTickets(input: {
    labelId: LabelId;
    updatedSince: Date;
  }): Promise<ReadonlyArray<TrackerTicket>> {
    return this.readAll(
      QUERY_LABELED_TICKETS,
      {
        labelId: input.labelId,
        updatedSince: input.updatedSince.toISOString(),
      },
      ticketConnectionSchema.transform((data) => data.issues),
    );
  }

  async listComments(key: TicketKey, page?: Page): Promise<Paged<TrackerComment>> {
    const data = await this.client.request(
      QUERY_COMMENTS,
      { id: key, first: pageSize(page), after: page?.after ?? null },
      z.object({ issue: z.object({ comments: connectionSchema(commentSchema) }) }),
    );
    return toPaged(data.issue.comments);
  }

  async listProjects(): Promise<ReadonlyArray<TrackerProject>> {
    return this.readAll(
      QUERY_PROJECTS,
      {},
      z.object({ projects: connectionSchema(projectSchema) }).transform((data) => data.projects),
    );
  }

  async listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>> {
    const teamIds = await this.projectTeamIds(projectId);
    const labels = await this.readAll(
      QUERY_TEAM_LABELS,
      { teamIds },
      z
        .object({ issueLabels: connectionSchema(issueLabelSchema) })
        .transform((data) => data.issueLabels),
    );
    return labels
      .filter((label) => !label.isGroup)
      .map(toLabel)
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }

  async listStates(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerState>> {
    const teamIds = await this.projectTeamIds(projectId);
    const states = await this.readAll(
      QUERY_TEAM_STATES,
      { teamIds },
      z
        .object({ workflowStates: connectionSchema(workflowStateSchema) })
        .transform((data) => data.workflowStates),
    );
    return states
      .toSorted((a, b) => categoryRank(a.type) - categoryRank(b.type) || a.position - b.position)
      .map(toState);
  }

  async createLabel(input: { name: string; color: string }): Promise<TrackerLabel> {
    const data = await this.client.request(
      MUTATION_CREATE_LABEL,
      { name: input.name, color: input.color },
      z.object({
        issueLabelCreate: z.object({
          success: z.boolean(),
          issueLabel: z.object({ id: idSchema, name: z.string() }).nullable(),
        }),
      }),
    );
    const label = data.issueLabelCreate.issueLabel;
    if (!data.issueLabelCreate.success || label === null) {
      throw new LinearApiError("Linear가 라벨을 만들지 않았다", { code: null, status: 200 });
    }
    return toLabel(label);
  }

  async setState(key: TicketKey, stateId: TrackerStateId): Promise<void> {
    const data = await this.client.request(
      MUTATION_SET_STATE,
      { id: key, stateId },
      z.object({ issueUpdate: z.object({ success: z.boolean() }) }),
    );
    if (!data.issueUpdate.success) throw notFound();
  }

  async addComment(key: TicketKey, body: string): Promise<{ id: CommentId; url: string }> {
    const data = await this.client.request(
      MUTATION_ADD_COMMENT,
      { issueId: key, body },
      z.object({
        commentCreate: z.object({
          success: z.boolean(),
          comment: z.object({ id: idSchema, url: z.string() }).nullable(),
        }),
      }),
    );
    const comment = data.commentCreate.comment;
    if (!data.commentCreate.success || comment === null) throw notFound();
    return { id: toCommentId(comment.id), url: comment.url };
  }

  private async projectTeamIds(projectId: TrackerProjectId): Promise<string[]> {
    const data = await this.client.request(
      QUERY_PROJECT_TEAMS,
      { id: projectId },
      z.object({
        project: z.object({ teams: z.object({ nodes: z.array(z.object({ id: idSchema })) }) }),
      }),
    );
    return data.project.teams.nodes.map((team) => team.id);
  }

  private async readAll<T>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    schema: z.ZodType<{
      nodes: T[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    }>,
  ): Promise<T[]> {
    type Connection = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    const items: T[] = [];
    let after: string | null = null;
    for (let pages = 0; pages < MAX_PAGES; pages += 1) {
      const data: Connection = await this.client.request(
        query,
        { ...variables, first: LINEAR_MAX_PAGE_SIZE, after },
        schema,
      );
      items.push(...data.nodes);
      if (!data.pageInfo.hasNextPage || data.pageInfo.endCursor === null) return items;
      after = data.pageInfo.endCursor;
    }
    throw new Error(`Linear 목록이 ${MAX_PAGES}쪽을 넘었다`);
  }
}

function toPaged<T>(connection: {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}): Paged<T> {
  return {
    items: connection.nodes,
    nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof LinearTrackerError && error.detail.kind === "not-found";
}
