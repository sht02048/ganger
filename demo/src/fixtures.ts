import {
  toAgentId,
  toLabelId,
  toRunnerId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type {
  ProviderUsage,
  ProviderUsageReading,
  RunnerLoadReading,
  RunnerProject,
  TicketKey,
  TicketRelations,
  TrackerLabel,
  TrackerProject,
  TrackerState,
  TrackerTicket,
} from "@ganger/core";
import { toWorkspaceId } from "@ganger/db";
import { FAIL_OFFLINE, FAIL_PUSH_AUTH } from "./values.js";

export interface TrackerCatalog {
  projects: TrackerProject[];
  states: TrackerState[];
  labels: TrackerLabel[];
  tickets: TrackerTicket[];
}

export const agent = toAgentId("claude");
export const autoAssignLabel = toLabelId("label-factory");
export const inProgressState = toTrackerStateId("state-in-progress");

const states: TrackerState[] = [
  { id: toTrackerStateId("state-backlog"), name: "Backlog", category: "backlog" },
  { id: toTrackerStateId("state-todo"), name: "Todo", category: "unstarted" },
  { id: inProgressState, name: "In Progress", category: "started" },
  { id: toTrackerStateId("state-in-review"), name: "In Review", category: "started" },
  { id: toTrackerStateId("state-done"), name: "Done", category: "completed" },
];

const labels: TrackerLabel[] = [
  { id: autoAssignLabel, name: "factory" },
  { id: toLabelId("label-bug"), name: "bug" },
  { id: toLabelId("label-feature"), name: "feature" },
  { id: toLabelId("label-api"), name: "api" },
];

export const apiRepoLabel = toLabelId("label-api");

const todo = states[1] ?? states[0];

interface ProjectSpec {
  id: string;
  name: string;
  repo: string;
  titles: string[];
}

interface TrackerSpec {
  name: string;
  keyPrefix: string;
  projects: ProjectSpec[];
}

const ACME: TrackerSpec = {
  name: "Acme",
  keyPrefix: "ACME",
  projects: [
    {
      id: "acme-web",
      name: "Web",
      repo: "acme/web",
      titles: [
        "Add a health check endpoint",
        "Show the build version in the footer",
        "Fix the date picker in Safari",
        "Lazy-load the settings page",
        "Add dark mode to the dashboard",
        "Remember the last opened tab",
        "Fix overflowing table headers",
        "Add keyboard shortcuts to the list",
        "Show an empty state on search",
        "Debounce the search input",
        "Paginate the audit log",
        "Add a copy button to code blocks",
        "Improve the 404 page",
        "Trim whitespace in form fields",
        "Fix the flicker on first load",
        "Add tooltips to icon buttons",
        "Sort projects by last update",
        "Add CSV export to reports",
        "Fix focus ring on dialogs",
        "Cache avatars in the browser",
      ],
    },
    {
      id: "acme-api",
      name: "API",
      repo: "acme/api",
      titles: [
        "Rate-limit the login endpoint",
        "Return 404 for unknown projects",
        "Add an index on runs.created_at",
        "Log slow queries over 500 ms",
        "Validate webhook payloads",
        "Add pagination to /projects",
        "Retry failed email deliveries",
        "Expire sessions after 30 days",
        "Add an OpenAPI description",
        "Compress large JSON responses",
        "Remove the deprecated v1 routes",
        "Add request IDs to logs",
        "Fix the timezone in reports",
        "Batch notification writes",
        "Add a readiness probe",
      ],
    },
  ],
};

const GLOBEX: TrackerSpec = {
  name: "Globex",
  keyPrefix: "GLX",
  projects: [
    {
      id: "globex-mobile",
      name: "Mobile",
      repo: "globex/mobile",
      titles: [
        "Support pull to refresh",
        "Fix the crash on rotate",
        "Add biometric login",
        "Shrink the app icon assets",
        "Show offline banner",
        "Fix push notification badge",
        "Add haptics to buttons",
        "Cache images on disk",
        "Localize the onboarding",
        "Fix keyboard covering inputs",
      ],
    },
  ],
};

export const TRACKERS: ReadonlyArray<TrackerSpec> = [ACME, GLOBEX];

export function trackerSpecFor(apiKey: string): TrackerSpec {
  const lower = apiKey.toLowerCase();
  return TRACKERS.find((spec) => lower.includes(spec.name.toLowerCase())) ?? ACME;
}

export function trackerProjectId(spec: ProjectSpec) {
  return toTrackerProjectId(spec.id);
}

export function runnerProjectId(spec: ProjectSpec) {
  return toRunnerProjectId(spec.repo);
}

export function demoTicketBody(title: string): string {
  return `${title}.\n\nThis is a demo ticket with fake data.`;
}

const DEMO_PARENT_INDEX = 8;
const DEMO_CHILD_STATES = ["state-done", "state-done", "state-in-review", "state-todo"];

function withDemoParent(tickets: TrackerTicket[]): TrackerTicket[] {
  const parent = tickets[DEMO_PARENT_INDEX];
  if (parent === undefined) return tickets;
  return tickets.map((ticket, index) => {
    const childIndex = index - DEMO_PARENT_INDEX - 1;
    const stateId = DEMO_CHILD_STATES[childIndex];
    if (stateId === undefined) return ticket;
    return {
      ...ticket,
      state: states.find((state) => state.id === stateId) ?? ticket.state,
      ancestors: [
        {
          id: `issue-${parent.key}`,
          key: parent.key,
          title: parent.title,
          url: parent.url,
          state: { name: parent.state.name, category: parent.state.category },
        },
      ],
    };
  });
}

export function trackerCatalog(spec: TrackerSpec, now: Date): TrackerCatalog {
  const tickets: TrackerTicket[] = [];
  let n = 0;
  for (const project of spec.projects) {
    const projectTickets: TrackerTicket[] = [];
    for (const title of project.titles) {
      n += 1;
      const key = toTicketKey(`${spec.keyPrefix}-${n}`);
      projectTickets.push({
        key,
        title,
        body: demoTicketBody(title),
        url: `https://tracker.example.com/${spec.name.toLowerCase()}/issue/${key}`,
        labels: [],
        project: { id: trackerProjectId(project), name: project.name },
        state: todo ?? { id: toTrackerStateId("state-todo"), name: "Todo", category: "unstarted" },
        updatedAt: new Date(now.getTime() - (n + 1) * 3_600_000),
      });
    }
    tickets.push(...withDemoParent(projectTickets));
  }
  return {
    projects: spec.projects.map((project) => ({
      id: trackerProjectId(project),
      name: project.name,
      url: `https://tracker.example.com/${spec.name.toLowerCase()}/project/${project.id}`,
    })),
    states,
    labels,
    tickets,
  };
}

const DEMO_BLOCKED_TICKET_INDEX = 6;
const DEMO_BLOCKER_TICKET_INDEX = 5;

export function demoRelations(catalog: TrackerCatalog): Array<[TicketKey, TicketRelations]> {
  const blocked = catalog.tickets[DEMO_BLOCKED_TICKET_INDEX];
  const blocker = catalog.tickets[DEMO_BLOCKER_TICKET_INDEX];
  if (blocked === undefined || blocker === undefined) return [];
  return [
    [
      blocked.key,
      {
        priority: "high",
        blockers: [{ key: blocker.key, title: blocker.title, state: blocker.state }],
      },
    ],
  ];
}

export const RUNNER_PROJECTS: ReadonlyArray<RunnerProject> = TRACKERS.flatMap((spec) =>
  spec.projects.map((project) => ({
    id: runnerProjectId(project),
    displayName: project.repo,
    setupState: "ready",
  })),
);

export const seededConnections = TRACKERS.map((spec) => ({
  spec,
  id: toTrackerConnectionId(`conn-${spec.name.toLowerCase()}`),
  workspaceId: toWorkspaceId(`ws-${spec.name.toLowerCase()}`),
  apiKey: `lin_api_demo_${spec.name.toLowerCase()}`,
  webhookSecret: `lin_wh_demo_${spec.name.toLowerCase()}`,
}));

export const seededRunners = [
  { id: toRunnerId("runner-a"), name: "runner-a", sshTarget: "runner-a.example.com", capacity: 3 },
  {
    id: toRunnerId("runner-b"),
    name: "runner-b",
    sshTarget: `runner-b-${FAIL_PUSH_AUTH}.example.com`,
    capacity: 4,
  },
  {
    id: toRunnerId("runner-c"),
    name: "runner-c",
    sshTarget: `runner-c-${FAIL_OFFLINE}.example.com`,
    capacity: 2,
  },
] as const;

const USAGE_MINUTE = 60_000;

const DEMO_GB = 1024 ** 3;

export function runnerLoadFor(sshTarget: string): RunnerLoadReading {
  const target = sshTarget.toLowerCase();
  if (target.includes(FAIL_OFFLINE)) return { kind: "unreadable" };
  if (target.includes(FAIL_PUSH_AUTH)) {
    return {
      kind: "read",
      cpu: { percent: 24, loadAverage: 1.9, cores: 8 },
      memory: { percent: 46, usedBytes: 7.4 * DEMO_GB, totalBytes: 16 * DEMO_GB, pressure: null },
      gpu: null,
    };
  }
  return {
    kind: "read",
    cpu: { percent: 92, loadAverage: 9.2, cores: 10 },
    memory: {
      percent: 81,
      usedBytes: 26 * DEMO_GB,
      totalBytes: 32 * DEMO_GB,
      pressure: "normal",
    },
    gpu: { percent: 12, name: "Apple GPU" },
  };
}

export function providerUsageFor(sshTarget: string, now: Date): ProviderUsageReading {
  const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * USAGE_MINUTE);
  const target = sshTarget.toLowerCase();
  const unused: ProviderUsage[] = [
    { provider: "gemini", status: "unavailable", windows: [] },
    { provider: "antigravity", status: "unavailable", windows: [] },
  ];
  if (target.includes(FAIL_PUSH_AUTH)) {
    return {
      kind: "read",
      providers: [
        {
          provider: "claude",
          status: "ok",
          windows: [
            { kind: "session", usedPercent: 100, resetsAt: inMinutes(72) },
            { kind: "weekly", usedPercent: 93, resetsAt: inMinutes(3 * 24 * 60) },
          ],
        },
        { provider: "codex", status: "signed-out", windows: [] },
        ...unused,
      ],
    };
  }
  if (target.includes(FAIL_OFFLINE)) {
    return {
      kind: "read",
      providers: [
        {
          provider: "claude",
          status: "ok",
          windows: [
            { kind: "session", usedPercent: 54, resetsAt: inMinutes(110) },
            { kind: "weekly", usedPercent: 41, resetsAt: inMinutes(4 * 24 * 60) },
          ],
        },
      ],
    };
  }
  return {
    kind: "read",
    providers: [
      {
        provider: "claude",
        status: "ok",
        windows: [
          { kind: "session", usedPercent: 38, resetsAt: inMinutes(160) },
          { kind: "weekly", usedPercent: 72, resetsAt: inMinutes(2 * 24 * 60 + 300) },
          { kind: "fableWeekly", usedPercent: 31, resetsAt: inMinutes(2 * 24 * 60 + 300) },
        ],
      },
      {
        provider: "codex",
        status: "ok",
        windows: [
          { kind: "session", usedPercent: 6, resetsAt: inMinutes(200) },
          { kind: "weekly", usedPercent: 18, resetsAt: inMinutes(5 * 24 * 60) },
        ],
      },
      { provider: "kimi", status: "signed-out", windows: [] },
      { provider: "cursor", status: "signed-out", windows: [] },
      ...unused,
    ],
  };
}
