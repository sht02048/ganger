import type { PullRequestSignals } from "@ganger/core";
import {
  AGENT_RESULTS,
  NOT_STARTED_AGENT_RESULTS,
  PAUSE_SOURCES,
  AGENT_CHECKS,
  CONTINUATION_PLACES,
  PR_READ_ERRORS,
  PR_STATES,
  QUESTION_KINDS,
  RUN_STATES,
  TICKET_PRIORITIES,
  WORKTREE_KEPT_REASONS,
} from "@ganger/core";
import { CHANGE_KINDS, CHANGE_PARTS } from "./change-events-model.js";
import { MCP_ACTION_OUTCOMES } from "./mcp-actions-model.js";
import { NOTIFICATION_EVENT_KINDS } from "./notification-events-model.js";
import type {
  FollowUpRef,
  AgentMessageRequestId,
  RunActionRequestId,
  AgentId,
  AgentRef,
  CodeHostKind,
  CommentId,
  DeliveryId,
  LabelId,
  MailboxRef,
  PullRequestId,
  PermissionRequestId,
  QuestionId,
  RunControl,
  RunId,
  RunnerId,
  RunnerKind,
  RunnerProjectId,
  TicketKey,
  TrackerConnectionId,
  TrackerKind,
  TrackerProjectId,
  TrackerStateId,
  WorktreeRef,
} from "@ganger/core";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { CodeHostConnectionId, WorkspaceId } from "./ids.js";

const timeMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const jsonConfig = () => text("config").notNull().default("{}");

const inList = (values: ReadonlyArray<string>) =>
  sql.raw(`(${values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ")})`);

export const LATER_PR_STATES = ["merged", "closed"] as const;

export const trackerConnections = sqliteTable(
  "tracker_connections",
  {
    id: text("id").primaryKey().$type<TrackerConnectionId>(),
    kind: text("kind").notNull().$type<TrackerKind>(),
    name: text("name").notNull(),
    config: jsonConfig(),
    secrets: text("secrets").notNull(),
    createdAt: timeMs("created_at").notNull(),
  },
  (t) => [check("tracker_connections_config_json", sql`json_valid(${t.config})`)],
);

export const codeHostConnections = sqliteTable(
  "code_host_connections",
  {
    id: text("id").primaryKey().$type<CodeHostConnectionId>(),
    kind: text("kind").notNull().$type<CodeHostKind>(),
    name: text("name").notNull(),
    config: jsonConfig(),
    secrets: text("secrets").notNull(),
    createdAt: timeMs("created_at").notNull(),
  },
  (t) => [check("code_host_connections_config_json", sql`json_valid(${t.config})`)],
);

export const installSettings = sqliteTable(
  "install_settings",
  {
    id: integer("id").primaryKey(),
    instanceId: text("instance_id").notNull(),
    webAddress: text("web_address"),
    webhookAddress: text("webhook_address"),
    webhookAddressCheckedAt: timeMs("webhook_address_checked_at"),
    mcpWriteAllowed: integer("mcp_write_allowed", { mode: "boolean" }).notNull().default(false),
    updatedAt: timeMs("updated_at").notNull(),
  },
  (t) => [check("install_settings_single_row", sql`${t.id} = 1`)],
);

export const runners = sqliteTable(
  "runners",
  {
    id: text("id").primaryKey().$type<RunnerId>(),
    kind: text("kind").notNull().$type<RunnerKind>(),
    name: text("name").notNull(),
    config: jsonConfig(),
    capacity: integer("capacity").notNull(),
    online: integer("online", { mode: "boolean" }).notNull().default(false),
    assignmentBlocked: integer("assignment_blocked", { mode: "boolean" }).notNull().default(false),
    prerequisites: text("prerequisites"),
    mailboxRef: text("mailbox_ref").$type<MailboxRef>(),
    checkedAt: timeMs("checked_at"),
    checkError: text("check_error"),
    offlineSince: timeMs("offline_since"),
    providerUsage: text("provider_usage"),
    providerUsageReadAt: timeMs("provider_usage_read_at"),
    load: text("load"),
    loadReadAt: timeMs("load_read_at"),
    ghAccounts: text("gh_accounts"),
    ghAccountsReadAt: timeMs("gh_accounts_read_at"),
    createdAt: timeMs("created_at").notNull(),
  },
  (t) => [
    check("runners_config_json", sql`json_valid(${t.config})`),
    check("runners_capacity", sql`${t.capacity} >= 1`),
    check("runners_online", sql`${t.online} IN (0, 1)`),
    check("runners_assignment_blocked", sql`${t.assignmentBlocked} IN (0, 1)`),
    check("runners_check_error_json", sql`${t.checkError} IS NULL OR json_valid(${t.checkError})`),
    check(
      "runners_prerequisites_json",
      sql`${t.prerequisites} IS NULL OR json_valid(${t.prerequisites})`,
    ),
  ],
);

export const runnerProjects = sqliteTable(
  "runner_projects",
  {
    runnerId: text("runner_id")
      .notNull()
      .references(() => runners.id, { onDelete: "cascade" })
      .$type<RunnerId>(),
    projectId: text("project_id").notNull().$type<RunnerProjectId>(),
    displayName: text("display_name").notNull(),
    setupState: text("setup_state").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runnerId, t.projectId] })],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey().$type<WorkspaceId>(),
    name: text("name").notNull(),
    maxRunMs: integer("max_run_ms").notNull().default(7_200_000),
    briefBefore: text("brief_before").notNull().default(""),
    briefAfter: text("brief_after").notNull().default(""),
    createdAt: timeMs("created_at").notNull(),
  },
  (t) => [check("workspaces_max_run_ms", sql`${t.maxRunMs} > 0`)],
);

export const workspaceTrackerProjects = sqliteTable(
  "workspace_tracker_projects",
  {
    trackerConnectionId: text("tracker_connection_id")
      .notNull()
      .references(() => trackerConnections.id)
      .$type<TrackerConnectionId>(),
    trackerProjectId: text("tracker_project_id").notNull().$type<TrackerProjectId>(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" })
      .$type<WorkspaceId>(),
    name: text("name").notNull(),
    inProgressStateId: text("in_progress_state_id").$type<TrackerStateId>(),
    mergedStateId: text("merged_state_id").$type<TrackerStateId>(),
  },
  (t) => [
    primaryKey({ columns: [t.trackerConnectionId, t.trackerProjectId] }),
    index("workspace_tracker_projects_workspace").on(t.workspaceId),
  ],
);

export const mappings = sqliteTable(
  "mappings",
  {
    trackerConnectionId: text("tracker_connection_id").notNull().$type<TrackerConnectionId>(),
    trackerProjectId: text("tracker_project_id").notNull().$type<TrackerProjectId>(),
    agentId: text("agent_id").notNull().$type<AgentId>(),
    model: text("model"),
  },
  (t) => [
    primaryKey({ columns: [t.trackerConnectionId, t.trackerProjectId] }),
    foreignKey({
      columns: [t.trackerConnectionId, t.trackerProjectId],
      foreignColumns: [
        workspaceTrackerProjects.trackerConnectionId,
        workspaceTrackerProjects.trackerProjectId,
      ],
    }).onDelete("cascade"),
  ],
);

export const mappingRepos = sqliteTable(
  "mapping_repos",
  {
    trackerConnectionId: text("tracker_connection_id").notNull().$type<TrackerConnectionId>(),
    trackerProjectId: text("tracker_project_id").notNull().$type<TrackerProjectId>(),
    runnerProjectId: text("runner_project_id").notNull().$type<RunnerProjectId>(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull(),
    labelId: text("label_id").$type<LabelId>(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.trackerConnectionId, t.trackerProjectId, t.runnerProjectId] }),
    foreignKey({
      columns: [t.trackerConnectionId, t.trackerProjectId],
      foreignColumns: [mappings.trackerConnectionId, mappings.trackerProjectId],
    }).onDelete("cascade"),
    uniqueIndex("mapping_repos_one_default")
      .on(t.trackerConnectionId, t.trackerProjectId)
      .where(sql`${t.isDefault} = 1`),
    uniqueIndex("mapping_repos_label_once")
      .on(t.trackerConnectionId, t.trackerProjectId, t.labelId)
      .where(sql`${t.labelId} IS NOT NULL`),
    check("mapping_repos_is_default", sql`${t.isDefault} IN (0, 1)`),
    check("mapping_repos_default_no_label", sql`${t.isDefault} = 0 OR ${t.labelId} IS NULL`),
  ],
);

export const autoAssignLabels = sqliteTable(
  "auto_assign_labels",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" })
      .$type<WorkspaceId>(),
    trackerConnectionId: text("tracker_connection_id")
      .notNull()
      .references(() => trackerConnections.id)
      .$type<TrackerConnectionId>(),
    labelId: text("label_id").notNull().$type<LabelId>(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.trackerConnectionId] })],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey().$type<RunId>(),
    trackerConnectionId: text("tracker_connection_id")
      .notNull()
      .references(() => trackerConnections.id)
      .$type<TrackerConnectionId>(),
    ticketKey: text("ticket_key").notNull().$type<TicketKey>(),
    ticketTitle: text("ticket_title"),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id)
      .$type<WorkspaceId>(),
    trackerProjectId: text("tracker_project_id").notNull().$type<TrackerProjectId>(),
    runnerProjectId: text("runner_project_id").notNull().$type<RunnerProjectId>(),
    agentId: text("agent_id").notNull().$type<AgentId>(),
    model: text("model"),
    worktreeName: text("worktree_name").notNull(),
    branch: text("branch"),
    state: text("state", { enum: RUN_STATES }).notNull(),
    runnerId: text("runner_id")
      .references(() => runners.id)
      .$type<RunnerId>(),
    assignedAt: timeMs("assigned_at").notNull(),
    startedAt: timeMs("started_at"),
    endedAt: timeMs("ended_at"),
    worktreeRef: text("worktree_ref").$type<WorktreeRef>(),
    agentRef: text("agent_ref").$type<AgentRef>(),
    startRequestedAt: timeMs("start_requested_at"),
    startFailures: integer("start_failures").notNull().default(0),
    startError: text("start_error"),
    agentResult: text("agent_result", { enum: AGENT_RESULTS }),
    prState: text("pr_state", { enum: PR_STATES }),
    prReadError: text("pr_read_error", { enum: PR_READ_ERRORS }),
    runnerUnreached: integer("runner_unreached", { mode: "boolean" }).notNull().default(false),
    reportBody: text("report_body"),
    agentBrief: text("agent_brief"),
    runnerChosen: integer("runner_chosen", { mode: "boolean" }).notNull().default(false),
    ticketPriority: text("ticket_priority", { enum: TICKET_PRIORITIES }),
    blockersReadAt: timeMs("blockers_read_at"),
    blockersReadFailed: integer("blockers_read_failed", { mode: "boolean" })
      .notNull()
      .default(false),
    waitSkippedAt: timeMs("wait_skipped_at"),
    continuedFromRunId: text("continued_from_run_id").$type<RunId>(),
    continueMessage: text("continue_message"),
    continuePlace: text("continue_place", { enum: CONTINUATION_PLACES }),
    agentCheck: text("agent_check", { enum: AGENT_CHECKS }),
    agentStopRequestedAt: timeMs("agent_stop_requested_at"),
    prId: text("pr_id").$type<PullRequestId>(),
    prDisplayId: text("pr_display_id"),
    prUrl: text("pr_url"),
    prCiState: text("pr_ci_state"),
    prCheckedAt: timeMs("pr_checked_at"),
    prSignals: text("pr_signals", { mode: "json" }).$type<PullRequestSignals>(),
    prSignalsReadAt: timeMs("pr_signals_read_at"),
    laterPrState: text("later_pr_state", { enum: LATER_PR_STATES }),
    laterPrStateAt: timeMs("later_pr_state_at"),
    worktreeRemovedAt: timeMs("worktree_removed_at"),
    worktreeKept: text("worktree_kept", { enum: WORKTREE_KEPT_REASONS }),
    worktreeRemoveRequestedAt: timeMs("worktree_remove_requested_at"),
    trackerStateSetAt: timeMs("tracker_state_set_at"),
    mergedStateSetAt: timeMs("merged_state_set_at"),
    trackerCommentId: text("tracker_comment_id").$type<CommentId>(),
    trackerCommentedAt: timeMs("tracker_commented_at"),
    unreachableSince: timeMs("unreachable_since"),
    pausedSince: timeMs("paused_since"),
    pausedMs: integer("paused_ms").notNull().default(0),
    pauseSource: text("pause_source", { enum: PAUSE_SOURCES }),
    lastLog: text("last_log", { mode: "json" }).$type<string[]>(),
  },
  (t) => [
    check("runs_state", sql`${t.state} IN ${inList(RUN_STATES)}`),
    check("runs_agent_result", sql`${t.agentResult} IN ${inList(AGENT_RESULTS)}`),
    check("runs_pr_state", sql`${t.prState} IN ${inList(PR_STATES)}`),
    check("runs_later_pr_state", sql`${t.laterPrState} IN ${inList(LATER_PR_STATES)}`),
    check("runs_pr_read_error", sql`${t.prReadError} IN ${inList(PR_READ_ERRORS)}`),
    check("runs_worktree_kept", sql`${t.worktreeKept} IN ${inList(WORKTREE_KEPT_REASONS)}`),
    check(
      "runs_worktree_kept_ended",
      sql`(${t.worktreeKept} IS NULL AND ${t.worktreeRemoveRequestedAt} IS NULL) OR ${t.state} = 'ended'`,
    ),
    check(
      "runs_pr_read_error_iff_unknown",
      sql`(${t.prState} IS 'unknown') = (${t.prReadError} IS NOT NULL)`,
    ),
    check("runs_last_log_json", sql`${t.lastLog} IS NULL OR json_valid(${t.lastLog})`),
    check("runs_runner_unreached", sql`${t.runnerUnreached} IN (0, 1)`),
    check("runs_queued_not_started", sql`${t.state} <> 'queued' OR ${t.startedAt} IS NULL`),
    check(
      "runs_active_started",
      sql`${t.state} NOT IN ('running', 'waiting-for-input', 'paused', 'disconnected') OR ${t.startedAt} IS NOT NULL`,
    ),
    check(
      "runs_paused_since_while_paused",
      sql`(${t.state} <> 'paused' OR ${t.pausedSince} IS NOT NULL) AND (${t.pausedSince} IS NULL OR ${t.state} IN ('paused', 'disconnected'))`,
    ),
    check("runs_paused_ms", sql`${t.pausedMs} >= 0`),
    check("runs_pause_source", sql`${t.pauseSource} IN ${inList(PAUSE_SOURCES)}`),
    check("runs_paused_has_source", sql`${t.state} <> 'paused' OR ${t.pauseSource} IS NOT NULL`),
    check(
      "runs_started_has_runner_worktree",
      sql`${t.startedAt} IS NULL OR (${t.runnerId} IS NOT NULL AND ${t.worktreeRef} IS NOT NULL AND ${t.branch} IS NOT NULL AND ${t.agentRef} IS NOT NULL)`,
    ),
    check(
      "runs_not_started_ended",
      sql`${t.state} <> 'ended' OR ${t.startedAt} IS NOT NULL OR (${t.agentResult} IN ${inList(NOT_STARTED_AGENT_RESULTS)} AND ${t.prState} = 'none' AND ${t.worktreeRef} IS NULL)`,
    ),
    check(
      "runs_could_not_start_not_started",
      sql`${t.agentResult} IS NULL OR ${t.agentResult} <> 'could-not-start' OR ${t.startedAt} IS NULL`,
    ),
    check(
      "runs_runner_unreached_canceled",
      sql`${t.runnerUnreached} = 0 OR (${t.agentResult} = 'canceled' AND ${t.startedAt} IS NOT NULL)`,
    ),
    check("runs_ended_at_iff_ended", sql`(${t.state} = 'ended') = (${t.endedAt} IS NOT NULL)`),
    check(
      "runs_agent_result_iff_ended",
      sql`(${t.state} = 'ended') = (${t.agentResult} IS NOT NULL)`,
    ),
    check("runs_pr_state_iff_ended", sql`(${t.state} = 'ended') = (${t.prState} IS NOT NULL)`),
    check("runs_later_pr_state_ended", sql`${t.laterPrState} IS NULL OR ${t.state} = 'ended'`),
    uniqueIndex("runs_one_active_per_ticket")
      .on(t.trackerConnectionId, t.ticketKey)
      .where(sql`${t.state} <> 'ended'`),
    index("runs_ticket").on(t.trackerConnectionId, t.ticketKey, t.assignedAt),
    index("runs_state").on(t.state, t.assignedAt),
    index("runs_workspace").on(t.workspaceId, t.assignedAt),
    index("runs_continued_from").on(t.continuedFromRunId),
  ],
);

export const runStateChanges = sqliteTable(
  "run_state_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    fromState: text("from_state", { enum: RUN_STATES }),
    toState: text("to_state", { enum: RUN_STATES }).notNull(),
    changedAt: timeMs("changed_at").notNull(),
  },
  (t) => [index("run_state_changes_run").on(t.runId, t.id)],
);

export const trackerEvents = sqliteTable(
  "tracker_events",
  {
    trackerConnectionId: text("tracker_connection_id")
      .notNull()
      .references(() => trackerConnections.id)
      .$type<TrackerConnectionId>(),
    deliveryId: text("delivery_id").notNull().$type<DeliveryId>(),
    kind: text("kind").notNull(),
    trackerProjectId: text("tracker_project_id").$type<TrackerProjectId>(),
    ticketKey: text("ticket_key").$type<TicketKey>(),
    labelIds: text("label_ids", { mode: "json" }).$type<LabelId[]>(),
    previousLabelIds: text("previous_label_ids", { mode: "json" }).$type<LabelId[]>(),
    receivedAt: timeMs("received_at").notNull(),
    processedAt: timeMs("processed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.trackerConnectionId, t.deliveryId] }),
    check("tracker_events_label_ids_json", sql`${t.labelIds} IS NULL OR json_valid(${t.labelIds})`),
    check(
      "tracker_events_previous_label_ids_json",
      sql`${t.previousLabelIds} IS NULL OR json_valid(${t.previousLabelIds})`,
    ),
    index("tracker_events_unprocessed")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);

export const logTailRequests = sqliteTable(
  "log_tail_requests",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    requestedAt: timeMs("requested_at").notNull(),
    completedAt: timeMs("completed_at"),
    lines: text("lines", { mode: "json" }).$type<string[]>(),
    error: text("error"),
  },
  (t) => [check("log_tail_requests_lines_json", sql`${t.lines} IS NULL OR json_valid(${t.lines})`)],
);

export const runnerCheckRequests = sqliteTable(
  "runner_check_requests",
  {
    runnerId: text("runner_id")
      .primaryKey()
      .references(() => runners.id, { onDelete: "cascade" })
      .$type<RunnerId>(),
    requestedAt: timeMs("requested_at").notNull(),
    completedAt: timeMs("completed_at"),
    result: text("result"),
    error: text("error"),
  },
  (t) => [
    check("runner_check_requests_result_json", sql`${t.result} IS NULL OR json_valid(${t.result})`),
  ],
);

export const runQuestions = sqliteTable(
  "run_questions",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    questionId: text("question_id").notNull().$type<QuestionId>(),
    kind: text("kind", { enum: QUESTION_KINDS }).notNull().default("question"),
    body: text("body").notNull(),
    options: text("options", { mode: "json" }).notNull().$type<string[]>(),
    askedAt: timeMs("asked_at").notNull(),
    answer: text("answer"),
    answeredAt: timeMs("answered_at"),
    answerSentAt: timeMs("answer_sent_at"),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.questionId] }),
    check("run_questions_kind", sql`${t.kind} IN ('question', 'human-check')`),
    check("run_questions_options_json", sql`json_valid(${t.options})`),
    check("run_questions_answered", sql`(${t.answer} IS NULL) = (${t.answeredAt} IS NULL)`),
    check(
      "run_questions_sent_after_answer",
      sql`${t.answerSentAt} IS NULL OR ${t.answer} IS NOT NULL`,
    ),
    index("run_questions_unsent")
      .on(t.answeredAt)
      .where(sql`${t.answer} IS NOT NULL AND ${t.answerSentAt} IS NULL`),
  ],
);

export const runPermissionWaits = sqliteTable(
  "run_permission_waits",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    permissionId: text("permission_id").notNull().$type<PermissionRequestId>(),
    detail: text("detail").notNull(),
    requestedAt: timeMs("requested_at").notNull(),
    resolvedAt: timeMs("resolved_at"),
    denyReason: text("deny_reason"),
    deniedAt: timeMs("denied_at"),
    denySentAt: timeMs("deny_sent_at"),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.permissionId] }),
    check("run_permission_waits_denied", sql`(${t.denyReason} IS NULL) = (${t.deniedAt} IS NULL)`),
    check(
      "run_permission_waits_sent_after_deny",
      sql`${t.denySentAt} IS NULL OR ${t.deniedAt} IS NOT NULL`,
    ),
    index("run_permission_waits_unsent")
      .on(t.deniedAt)
      .where(sql`${t.deniedAt} IS NOT NULL AND ${t.denySentAt} IS NULL`),
  ],
);

export const RUN_CONTROLS = ["pause", "resume"] as const satisfies ReadonlyArray<RunControl>;

export const runControlRequests = sqliteTable(
  "run_control_requests",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    control: text("control", { enum: RUN_CONTROLS }).notNull(),
    requestedAt: timeMs("requested_at").notNull(),
    completedAt: timeMs("completed_at"),
    error: text("error"),
  },
  (t) => [check("run_control_requests_control", sql`${t.control} IN ${inList(RUN_CONTROLS)}`)],
);

export const runAgentMessages = sqliteTable(
  "run_agent_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    requestId: text("request_id").notNull().$type<AgentMessageRequestId>(),
    body: text("body").notNull(),
    requestedAt: timeMs("requested_at").notNull(),
    sendStartedAt: timeMs("send_started_at"),
    followUpRef: text("follow_up_ref").$type<FollowUpRef>(),
    completedAt: timeMs("completed_at"),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("run_agent_messages_request_once").on(t.runId, t.requestId),
    index("run_agent_messages_run").on(t.runId, t.id),
    index("run_agent_messages_pending")
      .on(t.id)
      .where(sql`${t.completedAt} IS NULL`),
  ],
);

export const runBlockers = sqliteTable(
  "run_blockers",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    blockerKey: text("blocker_key").notNull().$type<TicketKey>(),
    title: text("title").notNull(),
    stateName: text("state_name").notNull(),
    stateCategory: text("state_category").notNull(),
    inCycle: integer("in_cycle", { mode: "boolean" }).notNull().default(false),
    readAt: timeMs("read_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.blockerKey] }),
    index("run_blockers_key").on(t.blockerKey),
  ],
);

export const runActionRequests = sqliteTable(
  "run_action_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    requestId: text("request_id").notNull().$type<RunActionRequestId>(),
    fingerprint: text("fingerprint").notNull(),
    resultRunId: text("result_run_id").$type<RunId>(),
    handledAt: timeMs("handled_at").notNull(),
  },
  (t) => [uniqueIndex("run_action_requests_once").on(t.runId, t.requestId)],
);

export const runCancelRequests = sqliteTable("run_cancel_requests", {
  runId: text("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" })
    .$type<RunId>(),
  requestedAt: timeMs("requested_at").notNull(),
  processedAt: timeMs("processed_at"),
});

export const mcpActions = sqliteTable(
  "mcp_actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: timeMs("at").notNull(),
    client: text("client").notNull(),
    tool: text("tool").notNull(),
    target: text("target"),
    runId: text("run_id")
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    outcome: text("outcome").notNull().$type<(typeof MCP_ACTION_OUTCOMES)[number]>(),
    reason: text("reason"),
  },
  (t) => [
    check("mcp_actions_outcome", sql`${t.outcome} IN ${inList(MCP_ACTION_OUTCOMES)}`),
    index("mcp_actions_run").on(t.runId, t.at),
    index("mcp_actions_at").on(t.at),
  ],
);

export const notificationEvents = sqliteTable(
  "notification_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull().$type<(typeof NOTIFICATION_EVENT_KINDS)[number]>(),
    cause: text("cause").notNull(),
    runId: text("run_id")
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    workspaceId: text("workspace_id").$type<WorkspaceId>(),
    ticketKey: text("ticket_key").$type<TicketKey>(),
    runnerId: text("runner_id")
      .references(() => runners.id, { onDelete: "cascade" })
      .$type<RunnerId>(),
    subject: text("subject").notNull(),
    detail: text("detail"),
    createdAt: timeMs("created_at").notNull(),
    resolvedAt: timeMs("resolved_at"),
  },
  (t) => [
    check("notification_events_kind", sql`${t.kind} IN ${inList(NOTIFICATION_EVENT_KINDS)}`),
    check(
      "notification_events_target",
      sql`(${t.runId} IS NULL) <> (${t.runnerId} IS NULL) AND (${t.runId} IS NULL) = (${t.workspaceId} IS NULL) AND (${t.runId} IS NULL) = (${t.ticketKey} IS NULL)`,
    ),
    uniqueIndex("notification_events_seq").on(t.seq),
    uniqueIndex("notification_events_open_cause")
      .on(t.cause)
      .where(sql`${t.resolvedAt} IS NULL`),
    index("notification_events_resolved").on(t.resolvedAt),
  ],
);

export const notificationSequence = sqliteTable(
  "notification_sequence",
  {
    id: integer("id").primaryKey(),
    last: integer("last").notNull(),
  },
  (t) => [check("notification_sequence_single", sql`${t.id} = 1`)],
);

export const trackerReadGenerations = sqliteTable(
  "tracker_read_generations",
  {
    trackerConnectionId: text("tracker_connection_id")
      .primaryKey()
      .references(() => trackerConnections.id, { onDelete: "cascade" })
      .$type<TrackerConnectionId>(),
    generation: integer("generation").notNull(),
  },
  (t) => [check("tracker_read_generations_positive", sql`${t.generation} > 0`)],
);

export const trackerWebhookReceipts = sqliteTable(
  "tracker_webhook_receipts",
  {
    trackerConnectionId: text("tracker_connection_id")
      .primaryKey()
      .references(() => trackerConnections.id, { onDelete: "cascade" })
      .$type<TrackerConnectionId>(),
    lastReceivedAt: timeMs("last_received_at"),
    rejectedCount: integer("rejected_count").notNull().default(0),
    firstRejectedAt: timeMs("first_rejected_at"),
  },
  (t) => [
    check("tracker_webhook_receipts_rejected_count", sql`${t.rejectedCount} >= 0`),
    check(
      "tracker_webhook_receipts_first_rejected",
      sql`(${t.rejectedCount} = 0) = (${t.firstRejectedAt} IS NULL)`,
    ),
  ],
);

export const changeEvents = sqliteTable(
  "change_events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull().$type<(typeof CHANGE_KINDS)[number]>(),
    targetId: text("target_id"),
    workspaceId: text("workspace_id").$type<WorkspaceId>(),
    part: text("part").$type<(typeof CHANGE_PARTS)[number]>(),
    at: timeMs("at").notNull(),
  },
  (t) => [
    check("change_events_kind", sql`${t.kind} IN ${inList(CHANGE_KINDS)}`),
    check("change_events_part", sql`${t.part} IN ${inList(CHANGE_PARTS)}`),
    index("change_events_at").on(t.at),
  ],
);

export const changeEventsPruned = sqliteTable(
  "change_events_pruned",
  {
    id: integer("id").primaryKey(),
    throughSeq: integer("through_seq").notNull(),
  },
  (t) => [
    check("change_events_pruned_single", sql`${t.id} = 1`),
    check("change_events_pruned_through", sql`${t.throughSeq} >= 0`),
  ],
);

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timeMs("created_at").notNull(),
    lastSeenAt: timeMs("last_seen_at"),
    expoPushToken: text("expo_push_token"),
    notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    notifyQuestion: integer("notify_question", { mode: "boolean" }).notNull().default(true),
    notifyPermission: integer("notify_permission", { mode: "boolean" }).notNull().default(true),
    notifyHumanCheckRequest: integer("notify_human_check_request", { mode: "boolean" })
      .notNull()
      .default(true),
    notifyFailedDisconnected: integer("notify_failed_disconnected", { mode: "boolean" })
      .notNull()
      .default(true),
    notifyRunnerIssue: integer("notify_runner_issue", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [uniqueIndex("devices_token_hash").on(t.tokenHash)],
);

export const devicePushDeliveries = sqliteTable(
  "device_push_deliveries",
  {
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    eventId: integer("event_id")
      .notNull()
      .references(() => notificationEvents.id, { onDelete: "cascade" }),
    firstSentAt: timeMs("first_sent_at"),
    remindedAt: timeMs("reminded_at"),
    clearedAt: timeMs("cleared_at"),
    bundleId: text("bundle_id"),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.eventId] }),
    index("device_push_deliveries_event").on(t.eventId),
  ],
);
