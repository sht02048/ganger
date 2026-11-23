import {
  CPU_HIGH_AFTER_MS,
  EMPTY_WORKSPACE_BRIEF,
  composeAgentBrief,
  isAssignmentBlocked,
  ticketBriefText,
  summarizeRunOutcome,
  toAgentId,
  toAgentRef,
  toCommentId,
  toPermissionRequestId,
  toPullRequestId,
  toQuestionId,
  toTicketKey,
  toWorktreeRef,
} from "@ganger/core";
import type {
  AgentId,
  AgentResult,
  PrState,
  RunId,
  RunnerId,
  TicketKey,
  WorktreeKeptReason,
} from "@ganger/core";
import {
  assignRun,
  changeRunState,
  getRun,
  getWorkspaceBrief,
  inTransaction,
  recordPermissionWaits,
  recordProviderUsage,
  recordRunnerLoad,
  recordRunQuestions,
  recordRunnerCheck,
  recordStartRequested,
  recordWebhookAccepted,
  recordWebhookBadSignature,
  saveAutoAssignLabel,
  saveCheckedWebhookAddress,
  saveCodeHostConnection,
  saveInstallAddresses,
  replaceMapping,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceBrief,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
  updateRunRecords,
} from "@ganger/db";
import type { Database, SecretBox } from "@ganger/db";
import { ASK_GUIDE } from "@ganger/runner-orca/agent-brief";
import {
  RUNNER_PROJECTS,
  agent,
  apiRepoLabel,
  autoAssignLabel,
  demoTicketBody,
  inProgressState,
  providerUsageFor,
  runnerLoadFor,
  runnerProjectId,
  seededConnections,
  seededRunners,
  trackerProjectId,
} from "./fixtures.js";
import { DEMO_WEBHOOK_ADDRESS, DEMO_WEB_ADDRESS, DEMO_WORKSPACE_BRIEF, PREFILL } from "./values.js";
import { CODE_HOST_KIND, RUNNER_KIND, TRACKER_KIND } from "./world.js";
import type { DemoWorld } from "./world.js";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const OFFLINE_FOR_MINUTES = 47;
const USAGE_READ_MINUTES_AGO = 2;
const DAY = 24 * HOUR;
export const HISTORY_DAYS = 14;

export interface SeededRuns {
  queued: RunId[];
  running: RunId[];
  question: RunId;
  permission: RunId;
  paused: RunId;
  pausedOnRunner: RunId;
  pausedUnreported: RunId;
  disconnected: RunId;
}

export async function seedDemo(
  db: Database,
  box: SecretBox,
  world: DemoWorld,
  now: Date,
): Promise<SeededRuns> {
  const checks = await Promise.all(
    seededRunners.map(async (runner) => {
      const fake = world.runner(runner.sshTarget);
      const health = await fake.checkHealth();
      return { runner, health, projects: health.online ? await fake.listProjects() : null };
    }),
  );
  return inTransaction(db, () => {
    seedSettings(db, box, now);
    for (const runner of seededRunners) {
      recordRunnerCheck(db, {
        runnerId: runner.id,
        online: true,
        checkedAt: now,
        error: null,
        projects: RUNNER_PROJECTS,
        assignmentBlocked: false,
      });
    }
    seedHistory(db, now);
    const active = seedActive(db, now);
    for (const { runner, health, projects } of checks) {
      if (!health.online) {
        recordRunnerCheck(db, {
          runnerId: runner.id,
          online: false,
          checkedAt: new Date(now.getTime() - OFFLINE_FOR_MINUTES * MINUTE),
          error: health.error,
          projects: null,
          assignmentBlocked: null,
        });
      }
      recordRunnerCheck(db, {
        runnerId: runner.id,
        online: health.online,
        checkedAt: now,
        error: health.error,
        projects: projects === null ? null : [...projects],
        assignmentBlocked: isAssignmentBlocked(health),
        prerequisites: health.prerequisites,
      });
      const readAt = new Date(
        now.getTime() - (health.online ? USAGE_READ_MINUTES_AGO : OFFLINE_FOR_MINUTES) * MINUTE,
      );
      recordProviderUsage(db, {
        runnerId: runner.id,
        readAt,
        reading: providerUsageFor(runner.sshTarget, readAt),
      });
      const load = runnerLoadFor(runner.sshTarget);
      recordRunnerLoad(db, {
        runnerId: runner.id,
        readAt: new Date(readAt.getTime() - CPU_HIGH_AFTER_MS - MINUTE),
        reading: load,
      });
      recordRunnerLoad(db, { runnerId: runner.id, readAt, reading: load });
    }
    return active;
  });
}

const MINUTE_MS = 60_000;

function seedWebhookReceipts(db: Database, now: Date): void {
  const [receiving, rejected] = seededConnections;
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE_MS);
  if (receiving !== undefined) recordWebhookAccepted(db, receiving.id, ago(3));
  if (rejected !== undefined) {
    recordWebhookAccepted(db, rejected.id, ago(26 * 60));
    for (const minutes of [180, 95, 40, 12])
      recordWebhookBadSignature(db, rejected.id, ago(minutes));
  }
}

function seedSettings(db: Database, box: SecretBox, now: Date): void {
  saveInstallAddresses(
    db,
    { webAddress: DEMO_WEB_ADDRESS, webhookAddress: DEMO_WEBHOOK_ADDRESS },
    now,
  );
  saveCheckedWebhookAddress(db, DEMO_WEBHOOK_ADDRESS, now);
  for (const connection of seededConnections) {
    saveTrackerConnection(
      db,
      box,
      {
        id: connection.id,
        kind: TRACKER_KIND,
        name: connection.spec.name,
        config: {},
        secrets: { apiKey: connection.apiKey, webhookSecret: connection.webhookSecret },
      },
      now,
    );
    saveWorkspace(db, { id: connection.workspaceId, name: connection.spec.name }, now);
    if (connection === seededConnections[0]) {
      saveWorkspaceBrief(db, { id: connection.workspaceId, brief: DEMO_WORKSPACE_BRIEF }, now);
    }
    for (const project of connection.spec.projects) {
      saveWorkspaceTrackerProject(db, {
        workspaceId: connection.workspaceId,
        connection: connection.id,
        projectId: trackerProjectId(project),
        name: project.name,
        inProgressStateId: inProgressState,
      });
      saveMapping(db, {
        connection: connection.id,
        trackerProject: trackerProjectId(project),
        runnerProject: runnerProjectId(project),
        agent,
        model: project.repo.endsWith("api") ? "sonnet" : "opus",
      });
    }
    const [first, second] = connection.spec.projects;
    if (first !== undefined && second !== undefined) {
      replaceMapping(db, {
        connection: connection.id,
        trackerProject: trackerProjectId(first),
        agent,
        model: "opus",
        repos: [
          { project: runnerProjectId(first), isDefault: true, labelId: null },
          { project: runnerProjectId(second), isDefault: false, labelId: apiRepoLabel },
        ],
      });
    }
    saveAutoAssignLabel(db, {
      workspaceId: connection.workspaceId,
      connection: connection.id,
      labelId: autoAssignLabel,
    });
  }
  seedWebhookReceipts(db, now);
  saveCodeHostConnection(
    db,
    box,
    {
      id: toCodeHostConnectionId(CODE_HOST_KIND),
      kind: CODE_HOST_KIND,
      name: CODE_HOST_KIND,
      config: {},
      secrets: { token: PREFILL["token"] ?? "github_pat_demo" },
    },
    now,
  );
  for (const runner of seededRunners) {
    saveRunner(
      db,
      {
        id: runner.id,
        kind: RUNNER_KIND,
        name: runner.name,
        config: { sshTarget: runner.sshTarget, orcaPath: "orca" },
        capacity: runner.capacity,
      },
      now,
    );
  }
}

interface Ticket {
  connection: (typeof seededConnections)[number];
  project: (typeof seededConnections)[number]["spec"]["projects"][number];
  key: TicketKey;
  title: string;
}

function ticket(prefix: string, n: number): Ticket {
  for (const connection of seededConnections) {
    if (connection.spec.keyPrefix !== prefix) continue;
    let index = n;
    for (const project of connection.spec.projects) {
      const title = project.titles[index - 1];
      if (title !== undefined) {
        return { connection, project, key: toTicketKey(`${prefix}-${n}`), title };
      }
      index -= project.titles.length;
    }
  }
  throw new Error(`no demo ticket ${prefix}-${n}`);
}

function assign(
  db: Database,
  t: Ticket,
  input: { at: Date; runnerId: RunnerId | null; agentId?: AgentId },
): { id: RunId; worktreeName: string } {
  const result = assignRun(db, {
    ticket: { connection: t.connection.id, key: t.key },
    ticketTitle: t.title,
    trackerProject: trackerProjectId(t.project),
    runnerProject: runnerProjectId(t.project),
    agent: input.agentId ?? agent,
    model: t.project.repo.endsWith("api") ? "sonnet" : "opus",
    ...(input.runnerId === null ? {} : { runnerId: input.runnerId }),
    now: input.at,
  });
  if (!result.ok) throw new Error(`could not assign ${t.key}: ${result.reason}`);
  return { id: result.run.id, worktreeName: result.run.worktreeName };
}

function sentBrief(db: Database, runId: RunId): string {
  const run = getRun(db, runId);
  if (run === null) throw new Error(`demo seed run ${runId} is gone`);
  const title = run.ticketTitle ?? run.ticket.key;
  return composeAgentBrief({
    workspace: getWorkspaceBrief(db, run.workspaceId) ?? EMPTY_WORKSPACE_BRIEF,
    ticket: ticketBriefText({ title, body: demoTicketBody(title) }),
    protocol: ASK_GUIDE,
  });
}

function start(db: Database, runId: RunId, worktreeName: string, at: Date): void {
  recordStartRequested(db, runId, at, sentBrief(db, runId));
  ok(
    changeRunState(
      db,
      runId,
      {
        to: "running",
        started: {
          worktree: toWorktreeRef(`fake::/fake/${worktreeName}`),
          branch: `fake/${worktreeName}`,
          agentRef: toAgentRef(`fake-agent-${worktreeName}`),
        },
      },
      at,
    ),
  );
  updateRunRecords(db, runId, { trackerStateSetAt: at });
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`demo seed state change failed: ${JSON.stringify(result.error)}`);
}

interface Ending {
  agentResult: AgentResult;
  prState: PrState;
  worktreeKept?: WorktreeKeptReason;
}

function end(
  db: Database,
  runId: RunId,
  input: { ending: Ending; at: Date; prNumber: number; repo: string },
): void {
  const { ending, at } = input;
  ok(
    changeRunState(
      db,
      runId,
      {
        to: "ended",
        agentResult: ending.agentResult,
        prState: ending.prState,
        ...(ending.agentResult.startsWith("reported")
          ? { reportBody: "Done. Opened a pull request with the change and tests." }
          : {}),
      },
      at,
    ),
  );
  updateRunRecords(db, runId, {
    trackerComment: { id: toCommentId(`demo-comment-${runId}`), at },
    worktreeRemovedAt:
      ending.worktreeKept === undefined &&
      summarizeRunOutcome({ ...ending, runnerUnreached: false }).worktree === "remove-now"
        ? at
        : null,
    worktreeKept: ending.worktreeKept ?? null,
    lastLog: ["$ pnpm test", "✓ 42 tests passed", "$ git push", "done"],
    ...(ending.prState === "none"
      ? {}
      : {
          pullRequest: {
            id: toPullRequestId(`pr-${input.prNumber}`),
            displayId: `#${input.prNumber}`,
            url: `https://code.example.com/${input.repo}/pull/${input.prNumber}`,
            ...demoChecks(ending.prState, input.prNumber),
            checkedAt: at,
          },
        }),
  });
}

function demoChecks(prState: Ending["prState"], prNumber: number) {
  const base = {
    headCommit: `demo-${prNumber}`,
    ciFailed: false,
    checkTotal: 6,
    failedCount: 0,
    failedChecks: [],
    checksTruncated: false,
  };
  if (prState !== "open") {
    return {
      ci: "success",
      signals: { ...base, open: false, conflict: null, behindBy: null },
    };
  }
  return prNumber % 2 === 0
    ? {
        ci: "failure",
        signals: {
          ...base,
          open: true,
          ciFailed: true,
          failedCount: 1,
          failedChecks: ["lint"],
          conflict: true,
          behindBy: 4,
        },
      }
    : { ci: "success", signals: { ...base, open: true, conflict: false, behindBy: 2 } };
}

const ACTIVE_TICKETS = { ACME: [1, 2, 3, 4, 5, 6, 7, 8, 9, 21, 22, 23, 24, 25, 26, 27], GLX: [2] };
const HISTORY_TICKETS = [
  range(1, 35).filter((n) => !ACTIVE_TICKETS.ACME.includes(n)),
  range(1, 10).filter((n) => !ACTIVE_TICKETS.GLX.includes(n)),
] as const;

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function seedHistory(db: Database, now: Date): void {
  const random = mulberry32(47);
  const pick = <T>(items: ReadonlyArray<T>): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error("empty pick");
    return item;
  };
  const runners = [seededRunners[0].id, seededRunners[0].id, seededRunners[1].id];
  let prNumber = 100;
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo -= 1) {
    const dayStart = startOfDay(now).getTime() - daysAgo * DAY;
    const weekday = new Date(dayStart).getUTCDay();
    const count =
      weekday === 0 || weekday === 6 ? 1 + Math.floor(random() * 2) : 3 + Math.floor(random() * 5);
    for (let i = 0; i < count; i += 1) {
      const assignedAt = new Date(dayStart + (8 + random() * 10) * HOUR);
      const startedAt = new Date(assignedAt.getTime() + (1 + random() * 6) * MINUTE);
      const endedAt = new Date(startedAt.getTime() + (8 + random() * 80) * MINUTE);
      if (endedAt.getTime() > now.getTime() - 30 * MINUTE) continue;
      const prefix = random() < 0.75 ? "ACME" : "GLX";
      const t = ticket(prefix, pick(HISTORY_TICKETS[prefix === "ACME" ? 0 : 1]));
      const run = assign(db, t, {
        at: assignedAt,
        runnerId: pick(runners),
        agentId: random() < 0.8 ? agent : toAgentId("codex"),
      });
      const roll = random();
      const ending: Ending =
        roll < 0.58
          ? { agentResult: "reported-success", prState: "merged" }
          : roll < 0.68 && daysAgo <= 2
            ? { agentResult: "reported-success", prState: "open" }
            : roll < 0.74
              ? { agentResult: "reported-failure", prState: "none" }
              : roll < 0.8
                ? { agentResult: "ended-without-report", prState: "none" }
                : roll < 0.85
                  ? { agentResult: "timed-out", prState: "none" }
                  : roll < 0.9
                    ? { agentResult: "reported-success", prState: "closed" }
                    : { agentResult: "canceled", prState: "none" };
      start(db, run.id, run.worktreeName, startedAt);
      prNumber += 1;
      end(db, run.id, { ending, at: endedAt, prNumber, repo: t.project.repo });
    }
  }
}

function seedActive(db: Database, now: Date): SeededRuns {
  const [runnerA, runnerB, runnerC] = seededRunners;
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE);

  const running = [
    startedRun(db, ticket("ACME", 1), runnerA.id, ago(25), ago(24)),
    startedRun(db, ticket("ACME", 21), runnerB.id, ago(50), ago(48)),
  ];

  const question = startedRun(db, ticket("ACME", 2), runnerA.id, ago(40), ago(39));
  ok(changeRunState(db, question, { to: "waiting-for-input" }, ago(12)));
  recordRunQuestions(db, question, [
    {
      id: toQuestionId("demo-question-1"),
      body: "The cache can live in SQLite or in memory. Which one should the health check use?",
      options: ["SQLite", "In memory"],
      askedAt: ago(12),
    },
  ]);

  const permission = startedRun(db, ticket("ACME", 22), runnerA.id, ago(35), ago(34));
  ok(changeRunState(db, permission, { to: "waiting-for-input" }, ago(6)));
  recordPermissionWaits(db, permission, [
    {
      id: toPermissionRequestId("demo-permission-1"),
      detail: "Bash(pnpm add -D @types/supertest)",
      requestedAt: ago(6),
    },
  ]);

  const humanCheck = startedRun(db, ticket("ACME", 27), runnerA.id, ago(45), ago(44));
  ok(changeRunState(db, humanCheck, { to: "waiting-for-input" }, ago(3)));
  recordRunQuestions(db, humanCheck, [
    {
      id: toQuestionId("demo-human-check-1"),
      kind: "human-check",
      body: "PR #571 머지를 확인해 주세요\n\n설정 파일 형식을 바꿔 머지 위험이 one-way예요. 독립 리뷰와 CI를 통과했어요.\nhttps://github.com/acme/widgets/pull/571",
      options: [],
      askedAt: ago(3),
    },
  ]);

  const paused = startedRun(db, ticket("ACME", 24), runnerB.id, ago(70), ago(68));
  ok(changeRunState(db, paused, { to: "paused" }, ago(18)));

  const pausedOnRunner = startedRun(db, ticket("ACME", 25), runnerB.id, ago(55), ago(54));
  ok(changeRunState(db, pausedOnRunner, { to: "paused", source: "runner" }, ago(9)));

  const pausedUnreported = startedRun(db, ticket("ACME", 26), runnerB.id, ago(65), ago(64));
  ok(changeRunState(db, pausedUnreported, { to: "paused", source: "unreported" }, ago(4)));
  updateRunRecords(db, pausedUnreported, {
    lastLog: [
      "Added page and per_page to GET /projects with a default of 50.",
      "Tests pass locally: 42 passed.",
      "",
      "I have not opened a PR yet.",
      "❯",
    ],
  });

  const disconnected = startedRun(db, ticket("ACME", 23), runnerC.id, ago(45), ago(44));
  updateRunRecords(db, disconnected, { unreachableSince: ago(20) });
  ok(changeRunState(db, disconnected, { to: "disconnected" }, ago(15)));

  const queued = [
    assign(db, ticket("ACME", 3), { at: ago(8), runnerId: null }).id,
    assign(db, ticket("GLX", 2), { at: ago(4), runnerId: null }).id,
  ];

  const endings: Array<[number, Ending]> = [
    [4, { agentResult: "reported-success", prState: "merged" }],
    [5, { agentResult: "reported-success", prState: "open" }],
    [6, { agentResult: "ended-without-report", prState: "none" }],
    [7, { agentResult: "canceled", prState: "none" }],
    [8, { agentResult: "reported-success", prState: "none" }],
    [9, { agentResult: "reported-failure", prState: "none", worktreeKept: "unpushed-commits" }],
  ];
  let prNumber = 900;
  for (const [n, ending] of endings) {
    const t = ticket("ACME", n);
    const runId = startedRun(db, t, runnerA.id, ago(200 - n * 20), ago(198 - n * 20));
    prNumber += 1;
    end(db, runId, { ending, at: ago(120 - n * 15), prNumber, repo: t.project.repo });
  }
  return {
    queued,
    running,
    question,
    permission,
    paused,
    pausedOnRunner,
    pausedUnreported,
    disconnected,
  };
}

function startedRun(
  db: Database,
  t: Ticket,
  runnerId: RunnerId,
  assignedAt: Date,
  startedAt: Date,
): RunId {
  const run = assign(db, t, { at: assignedAt, runnerId });
  start(db, run.id, run.worktreeName, startedAt);
  return run.id;
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
