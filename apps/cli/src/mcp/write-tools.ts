import { randomUUID } from "node:crypto";
import {
  AnswerRejectedError,
  DenyRejectedError,
  HUMAN_CHECK_DECISIONS,
  answerInput,
  denyInput,
  humanCheckAnswerInput,
  submitAnswer,
  submitDenial,
  submitHumanCheckAnswer,
} from "@ganger/app/home/actions";
import { mobileContinueBlock } from "@ganger/app/devices/run-retry";
import { pendingInput } from "@ganger/app/home/load";
import { mcpClientName } from "@ganger/app/mcp/actions";
import type { McpWriteTool } from "@ganger/app/mcp/actions";
import { powerSettingsStore } from "@ganger/app/power-settings";
import { requestControl } from "@ganger/app/run-control";
import {
  cancelRunOnce,
  cancelRunRequest,
  continueRunOnce,
  controlRunOnce,
  MCP_ANSWER_ACTION,
  onceForRun,
  REQUEST_REUSED,
  runActionRequestId,
  skipBlockerWaitOnce,
  skipBlockerWaitRequest,
} from "@ganger/app/run-detail/actions";
import { requestRunLogTail } from "@ganger/app/run-detail/load";
import {
  RUNNER_CAPACITY_MAX,
  addTrackerProject,
  addTrackerProjectInput,
  generalInput,
  inProgressInput,
  labelInput,
  mappingInput,
  runnerCapacityInput,
  checkGitHubToken,
  checkTrackerConnection,
  removeTrackerProject,
  requestRunnerCheckSetting,
  saveGeneral,
  saveInProgressState,
  saveLabel,
  saveMappingSetting,
  savePowerSetting,
  saveRunnerCapacitySetting,
} from "@ganger/app/settings/actions";
import { loadTrackerProjectChoices } from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import { MAX_RUN_MINUTES } from "@ganger/app/settings/model";
import { submitAssignment } from "@ganger/app/tickets/assign";
import { loadTicketsPage } from "@ganger/app/tickets/load";
import { CONTINUE_MESSAGE_MAX_LENGTH, toRunId } from "@ganger/core";
import type { RunControl, RunId } from "@ganger/core";
import {
  continueRunBlock,
  getMcpWriteAllowed,
  getRun,
  listRunners,
  listTrackerConnections,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  recordMcpAction,
  toWorkspaceId,
} from "@ganger/db";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { pickWorkspace } from "./workspace.js";
import type { WorkspaceRef } from "./workspace.js";
import type { McpContext } from "./server.js";

export const SERVER_OFF_NOTE =
  "The Ganger server is not running. The request is saved, and the server handles it when it starts.";

export const WRITES_OFF_ERROR =
  'MCP writes are turned off. The operator can turn on "Allow MCP writes" in Ganger Settings > MCP.';

const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const DESTRUCTIVE: ToolAnnotations = { ...WRITE, destructiveHint: true };
const WRITE_TRACKER: ToolAnnotations = { ...WRITE, openWorldHint: true };
const CHECK_REMOTE: ToolAnnotations = { ...WRITE, idempotentHint: true, openWorldHint: true };

type Done = {
  target: string | null;
  runId: RunId | null;
  serverHandles: boolean;
  result?: Record<string, unknown>;
  replayed?: boolean;
};
type Rejected = {
  target: string | null;
  runId: RunId | null;
  reason: string;
  error: string;
  extra?: Record<string, unknown>;
};
type Outcome = ({ ok: true } & Done) | ({ ok: false } & Rejected);

const done = (value: Done): Outcome => ({ ok: true, ...value });
const rejected = (value: Rejected): Outcome => ({ ok: false, ...value });

const workspaceArg = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe("Workspace id or name. Leave it out when there is only one workspace.");
const runIdArg = z.string().min(1).max(200).describe("Run id, as list_runs or get_run gives it.");
const requestIdArg = runActionRequestId
  .optional()
  .describe(
    "Optional id of 16 to 64 characters. Calling again with the same id and values does the action once and returns the same result.",
  );
const connectionArg = z
  .string()
  .min(1)
  .max(200)
  .describe("Tracker connection id or name, as get_settings gives it.");
const trackerProjectArg = z
  .string()
  .min(1)
  .max(200)
  .describe("Tracker project id or name, as get_settings gives it.");
const runnerArg = z.string().min(1).max(200).describe("Runner id or name.");

const MCP_HUMAN_CHECK_ACTION = "mcp-human-check";

const REUSED_ERROR = "This requestId was already used with different values.";

const CONTROL_ERRORS: Record<string, string> = {
  "not-found": "The run is gone.",
  "already-ended": "The run has already ended.",
  "not-running": "Only a Running run can be paused.",
  "not-paused": "Only a Paused run can be resumed.",
  cancelling: "The run is being canceled.",
  [REQUEST_REUSED]: REUSED_ERROR,
};

const CONTINUE_ERRORS: Record<string, string> = {
  "not-found": "The run is gone.",
  "not-ended": "Only an ended run can be continued.",
  "not-started": "The run never started, so it has no work to continue.",
  superseded: "A later run of this ticket has already started.",
  "worktree-removing": "The run's worktree is being removed.",
  "worktree-settled": "Only a Failed run whose worktree remains can be continued.",
  "active-run": "This ticket already has a run in progress.",
  "previous-agent":
    "The previous agent may still be running. The operator can stop it on Run detail first.",
  [REQUEST_REUSED]: REUSED_ERROR,
};

export interface WriteTools {
  readonly sync: () => void;
}

export function registerWriteTools(
  server: McpServer,
  context: McpContext,
  respond: (value: Record<string, unknown>) => CallToolResult,
  fail: (error: string, extra?: Record<string, unknown>) => CallToolResult,
): WriteTools {
  const tools: RegisteredTool[] = [];
  const settings = (): SettingsContext => ({
    db: context.db,
    secretBox: context.secretBox,
    registry: context.registry,
    power: powerSettingsStore(context.home),
  });

  const writesAllowed = (): boolean =>
    context.schemaProblem() === null && getMcpWriteAllowed(context.db);

  const sync = () => {
    const allowed = writesAllowed();
    for (const tool of tools) {
      if (allowed && !tool.enabled) tool.enable();
      if (!allowed && tool.enabled) tool.disable();
    }
  };

  async function perform(tool: McpWriteTool, act: () => Promise<Outcome> | Outcome) {
    const problem = context.schemaProblem();
    if (problem !== null) {
      sync();
      return fail(problem);
    }
    if (!getMcpWriteAllowed(context.db)) {
      sync();
      return fail(WRITES_OFF_ERROR);
    }
    let outcome: Outcome;
    try {
      outcome = await act();
    } catch (error) {
      outcome = rejected({
        target: null,
        runId: null,
        reason: "error",
        error: `Ganger could not do this: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    if (!outcome.ok || outcome.replayed !== true) {
      recordMcpAction(context.db, {
        at: context.now(),
        client: mcpClientName(server.server.getClientVersion()?.name),
        tool,
        target: outcome.target,
        runId: outcome.runId,
        outcome: outcome.ok ? "done" : "rejected",
        reason: outcome.ok ? null : outcome.reason,
      });
    }
    if (!outcome.ok) return fail(outcome.error, { reason: outcome.reason, ...outcome.extra });
    const pending = outcome.serverHandles && !context.serverStatus().running;
    return respond({
      outcome: "done",
      ...outcome.result,
      ...(pending ? { pending: SERVER_OFF_NOTE } : {}),
    });
  }

  function register<Shape extends z.ZodRawShape>(
    name: McpWriteTool,
    config: { title: string; description: string; annotations: ToolAnnotations },
    inputSchema: Shape,
    act: (args: z.infer<z.ZodObject<Shape>>) => Promise<Outcome> | Outcome,
  ): void {
    const schema = z.object(inputSchema);
    const shape: z.ZodRawShape = inputSchema;
    tools.push(
      server.registerTool(name, { ...config, inputSchema: shape }, (args: unknown) => {
        const parsed = schema.safeParse(args);
        if (!parsed.success) return fail(`Invalid arguments: ${parsed.error.message}`);
        return perform(name, () => act(parsed.data));
      }),
    );
  }

  const screenChecked = <S extends z.ZodType>(
    schema: S,
    value: z.input<S>,
    where: { target: string | null; runId: RunId | null },
  ): { ok: true; data: z.output<S> } | { ok: false; outcome: Outcome } => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return { ok: true, data: parsed.data };
    return {
      ok: false,
      outcome: rejected({
        ...where,
        reason: "invalid",
        error: `The app would refuse these values: ${parsed.error.message}`,
      }),
    };
  };

  const findRun = (runId: string) => getRun(context.db, toRunId(runId));
  const noRun = (runId: string) =>
    rejected({
      target: null,
      runId: null,
      reason: "not-found",
      error: `No run has the id "${runId}".`,
    });

  const inWorkspace = (
    given: string | undefined,
    act: (workspace: WorkspaceRef) => Promise<Outcome> | Outcome,
  ): Promise<Outcome> | Outcome => {
    const pick = pickWorkspace(context.db, given);
    if (!pick.ok) {
      return rejected({
        target: given ?? null,
        runId: null,
        reason: "workspace",
        error: pick.error,
        extra: { workspaces: pick.workspaces },
      });
    }
    return act(pick.workspace);
  };

  const findConnection = (given: string) => {
    const connections = listTrackerConnections(context.db, context.secretBox).map((c) => ({
      id: c.id,
      name: c.name,
    }));
    return {
      found: connections.find((c) => c.id === given) ?? connections.find((c) => c.name === given),
      connections,
    };
  };
  const noConnection = (given: string, connections: ReadonlyArray<{ id: string; name: string }>) =>
    rejected({
      target: given,
      runId: null,
      reason: "not-found",
      error: `No tracker connection has the id or name "${given}".`,
      extra: { connections },
    });

  const findRunner = (given: string) => {
    const runners = listRunners(context.db).map((r) => ({ id: r.id, name: r.name }));
    return {
      found: runners.find((r) => r.id === given) ?? runners.find((r) => r.name === given),
      runners,
    };
  };
  const noRunner = (given: string, runners: ReadonlyArray<{ id: string; name: string }>) =>
    rejected({
      target: given,
      runId: null,
      reason: "not-found",
      error: `No runner has the id or name "${given}".`,
      extra: { runners },
    });

  const boundProject = (workspace: WorkspaceRef, connection: string, project: string) => {
    const { found, connections } = findConnection(connection);
    if (found === undefined)
      return { ok: false as const, outcome: noConnection(connection, connections) };
    const bound = listTrackerProjectsOf(workspace, found.id);
    const match = bound.find((p) => p.id === project) ?? bound.find((p) => p.name === project);
    if (match === undefined) {
      return {
        ok: false as const,
        outcome: rejected({
          target: project,
          runId: null,
          reason: "not-found",
          error: `The workspace "${workspace.name}" has no tracker project "${project}" on "${found.name}".`,
          extra: { trackerProjects: bound },
        }),
      };
    }
    return {
      ok: true as const,
      ref: { ws: workspace.id, connectionId: found.id, projectId: match.id },
      name: match.name,
    };
  };

  const listTrackerProjectsOf = (workspace: WorkspaceRef, connectionId: string) =>
    listWorkspaceTrackerProjects(context.db)
      .filter((p) => p.workspaceId === workspace.id && p.connection === connectionId)
      .map((p) => ({ id: p.projectId, name: p.name }));

  register(
    "assign_ticket",
    {
      title: "Assign a ticket",
      description:
        "Assigns a tracker ticket to a coding agent, the same as Assign on the Tickets screen. This sends the ticket to an agent that runs commands on a runner, so confirm with the operator first. Leave runner out to let Ganger pick one, and agent out to use the tracker project's mapping.",
      annotations: WRITE_TRACKER,
    },
    {
      workspace: workspaceArg,
      ticket: z.string().min(1).max(200).describe("Ticket key, such as ENG-123."),
      runner: runnerArg.optional(),
      agent: z.string().min(1).max(200).optional(),
    },
    ({ workspace, ticket, runner, agent }) =>
      inWorkspace(workspace, async (picked) => {
        const page = await loadTicketsPage(context, picked.id, context.now());
        const matches = page.tickets.filter((t) => t.key === ticket);
        const [found, ...others] = matches;
        if (found === undefined || others.length > 0) {
          return rejected({
            target: ticket,
            runId: null,
            reason: "not-found",
            error:
              found === undefined
                ? `The workspace "${picked.name}" has no ticket "${ticket}" in its tracker projects.`
                : `More than one ticket has the key "${ticket}".`,
            extra: { trackerErrors: page.errors },
          });
        }
        let runnerId: string | null = null;
        if (runner !== undefined) {
          const { found: picked, runners } = findRunner(runner);
          if (picked === undefined) return noRunner(runner, runners);
          runnerId = picked.id;
        }
        const chosenAgent = agent ?? found.mapping?.agent;
        const chosenRepo = found.mapping?.runnerProject;
        if (chosenAgent === undefined || chosenRepo === undefined) {
          return rejected({
            target: ticket,
            runId: null,
            reason: "no-mapping",
            error: `The tracker project of "${ticket}" has no mapping yet.`,
          });
        }
        const assigned = submitAssignment(
          context.db,
          {
            connection: found.connection,
            ticketKey: found.key,
            ticketTitle: found.title,
            trackerProject: found.trackerProject.id,
            runnerProject: chosenRepo,
            runnerId,
            agent: chosenAgent,
          },
          context.now(),
        );
        if (!assigned.ok) {
          return rejected({
            target: ticket,
            runId: null,
            reason: assigned.reason === "unknown-repo" ? "no-mapping" : assigned.reason,
            error: `Could not assign "${ticket}": ${assigned.reason}.`,
          });
        }
        return done({
          target: ticket,
          runId: toRunId(assigned.runId),
          serverHandles: true,
          result: { runId: assigned.runId },
        });
      }),
  );

  register(
    "answer_question",
    {
      title: "Answer a question",
      description:
        "Answers the question a waiting run asked, the same as answering on the Dashboard or Run detail. The answer goes to a coding agent that runs commands, so confirm with the operator first. Leave questionId out to answer the run's pending question.",
      annotations: WRITE,
    },
    {
      runId: runIdArg,
      questionId: z.string().min(1).max(200).optional(),
      answer: z.string().trim().min(1).max(10_000),
      requestId: requestIdArg,
    },
    ({ runId, questionId, answer, requestId }) => {
      const run = findRun(runId);
      if (run === null) return noRun(runId);
      const base = { target: run.ticket.key, runId: run.id };
      const answerNow = (): Outcome => {
        const pending = pendingInput(context.db, run.id);
        const id = questionId ?? (pending?.kind === "question" ? pending.questionId : undefined);
        if (id === undefined) {
          return rejected({
            ...base,
            reason: "no-question",
            error: "The run has no pending question.",
          });
        }
        try {
          const input = screenChecked(answerInput, { runId: run.id, questionId: id, answer }, base);
          if (!input.ok) return input.outcome;
          submitAnswer(context.db, input.data, context.now());
        } catch (error) {
          if (!(error instanceof AnswerRejectedError)) throw error;
          return rejected({
            ...base,
            reason: error.reason,
            error: `Could not answer: ${error.reason}.`,
          });
        }
        return done({ ...base, serverHandles: true });
      };
      if (requestId === undefined) return answerNow();
      let outcome: Outcome = done({ ...base, serverHandles: true, replayed: true });
      const handled = onceForRun(
        context.db,
        { runId: run.id, requestId },
        MCP_ANSWER_ACTION,
        [questionId ?? "", answer],
        context.now(),
        () => {
          outcome = answerNow();
          return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
        },
      );
      if (!handled.ok && handled.reason === REQUEST_REUSED) {
        return rejected({
          ...base,
          reason: REQUEST_REUSED,
          error: "This requestId was already used with different values.",
        });
      }
      return outcome;
    },
  );

  register(
    "answer_human_check",
    {
      title: "Answer a Human Check",
      description:
        'Answers the Human Check a waiting run asked for, the same as "확인했어요" (confirmed) or "고쳐 주세요" (changes-requested) on the Dashboard or Run detail. This is a confirmation like approving a merge, so confirm with the operator first. The note is optional.',
      annotations: WRITE,
    },
    {
      runId: runIdArg,
      questionId: z
        .string()
        .min(1)
        .max(200)
        .describe("The id of the Human Check the operator saw, as get_run gives it."),
      decision: z.enum(HUMAN_CHECK_DECISIONS),
      note: z.string().optional().describe("Optional words to add to the answer."),
      requestId: requestIdArg,
    },
    ({ runId, questionId, decision, note, requestId }) => {
      const run = findRun(runId);
      if (run === null) return noRun(runId);
      const base = { target: run.ticket.key, runId: run.id };
      const answerNow = (): Outcome => {
        if (findRun(run.id)?.state === "ended") {
          return rejected({
            ...base,
            reason: "already-ended",
            error: "The run has ended, so the agent can no longer receive this answer.",
          });
        }
        const input = screenChecked(
          humanCheckAnswerInput,
          { runId: run.id, questionId, decision, note: note ?? "" },
          base,
        );
        if (!input.ok) return input.outcome;
        try {
          submitHumanCheckAnswer(context.db, input.data, context.now());
        } catch (error) {
          if (!(error instanceof AnswerRejectedError)) throw error;
          if (error.reason === "not-found") {
            return rejected({
              ...base,
              reason: "no-human-check",
              error: `The run has no Human Check with the id "${questionId}".`,
            });
          }
          return rejected({
            ...base,
            reason: error.reason,
            error: `Could not answer the Human Check: ${error.reason}.`,
          });
        }
        return done({ ...base, serverHandles: true });
      };
      if (requestId === undefined) return answerNow();
      let outcome: Outcome = done({ ...base, serverHandles: true, replayed: true });
      const handled = onceForRun(
        context.db,
        { runId: run.id, requestId },
        MCP_HUMAN_CHECK_ACTION,
        [questionId, decision, (note ?? "").trim()],
        context.now(),
        () => {
          outcome = answerNow();
          return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
        },
      );
      if (!handled.ok && handled.reason === REQUEST_REUSED) {
        return rejected({ ...base, reason: REQUEST_REUSED, error: REUSED_ERROR });
      }
      return outcome;
    },
  );

  const controlTool =
    (control: RunControl, verb: string) =>
    ({ runId, requestId }: { runId: string; requestId?: string | undefined }): Outcome => {
      const run = findRun(runId);
      if (run === null) return noRun(runId);
      const base = { target: run.ticket.key, runId: run.id };
      let replayed = false;
      const result =
        requestId === undefined
          ? requestControl(context.db, run.id, control, context.now())
          : controlRunOnce(context.db, { runId: run.id, requestId }, control, context.now(), () => {
              replayed = true;
            });
      if (!result.ok) {
        return rejected({
          ...base,
          reason: result.reason,
          error: `Could not ${verb}: ${CONTROL_ERRORS[result.reason] ?? result.reason}`,
        });
      }
      return done({ ...base, serverHandles: true, replayed });
    };

  register(
    "pause_run",
    {
      title: "Pause a run",
      description:
        "Pauses a Running run, the same as Pause on Run detail. The runner stops the agent's turn until the run is resumed. Sending the same requestId again does nothing more.",
      annotations: WRITE,
    },
    { runId: runIdArg, requestId: requestIdArg },
    controlTool("pause", "pause"),
  );

  register(
    "resume_run",
    {
      title: "Resume a run",
      description:
        "Resumes a Paused run, the same as Resume on Run detail. If the runner failed to resume it, sending the same requestId tries again.",
      annotations: WRITE,
    },
    { runId: runIdArg, requestId: requestIdArg },
    controlTool("resume", "resume"),
  );

  register(
    "continue_run",
    {
      title: "Continue from a run",
      description:
        "Starts a new run that continues a Failed run in the worktree it left, the same as Continue on Run detail. The message goes to a coding agent that runs commands, so confirm it with the operator first. Ganger refuses with the reason when the run cannot be continued.",
      annotations: WRITE,
    },
    {
      runId: runIdArg,
      message: z
        .string()
        .trim()
        .min(1)
        .refine((text) => Array.from(text).length <= CONTINUE_MESSAGE_MAX_LENGTH)
        .describe("What the operator wants the agent to do next. Required."),
      requestId: requestIdArg,
    },
    ({ runId, message, requestId }) => {
      const run = findRun(runId);
      if (run === null) return noRun(runId);
      let replayed = false;
      const failedRunBlock = () =>
        continueRunBlock(context.db, run.id) ?? mobileContinueBlock(context.db, run.id);
      const result = continueRunOnce(
        context.db,
        { runId: run.id, requestId: requestId ?? randomUUID() },
        message,
        context.now(),
        failedRunBlock,
        () => {
          replayed = true;
        },
      );
      if (!result.ok) {
        return rejected({
          target: run.ticket.key,
          runId: run.id,
          reason: result.reason,
          error: `Could not continue: ${CONTINUE_ERRORS[result.reason] ?? result.reason}`,
        });
      }
      return done({
        target: run.ticket.key,
        runId: result.runId,
        serverHandles: true,
        replayed,
        result: { runId: result.runId, continuedFrom: run.id },
      });
    },
  );

  register(
    "deny_permission",
    {
      title: "Deny a permission request",
      description:
        "Denies the permission request a waiting run is stuck on, the same as Deny on Run detail. Ganger cannot grant permissions. Leave promptId out to deny the run's pending request.",
      annotations: WRITE,
    },
    {
      runId: runIdArg,
      promptId: z.string().min(1).max(200).optional(),
      reason: z.string().trim().max(10_000).optional(),
    },
    ({ runId, promptId, reason }) => {
      const run = findRun(runId);
      if (run === null) return noRun(runId);
      const base = { target: run.ticket.key, runId: run.id };
      const pending = pendingInput(context.db, run.id);
      const id = promptId ?? (pending?.kind === "permission" ? pending.promptId : undefined);
      if (id === undefined) {
        return rejected({
          ...base,
          reason: "no-permission",
          error: "The run has no pending permission request.",
        });
      }
      try {
        const input = screenChecked(
          denyInput,
          { runId: run.id, promptId: id, reason: reason ?? "" },
          base,
        );
        if (!input.ok) return input.outcome;
        submitDenial(context.db, input.data, context.now());
      } catch (error) {
        if (!(error instanceof DenyRejectedError)) throw error;
        return rejected({
          ...base,
          reason: error.reason,
          error: `Could not deny: ${error.reason}.`,
        });
      }
      return done({ ...base, serverHandles: true });
    },
  );

  register(
    "cancel_run",
    {
      title: "Cancel a run",
      description:
        "Cancels a run that has not ended, the same as Cancel on Run detail. This cannot be undone.",
      annotations: DESTRUCTIVE,
    },
    { runId: runIdArg, requestId: requestIdArg },
    ({ runId, requestId }) => {
      const run = findRun(runId);
      if (run === null) return noRun(runId);
      const base = { target: run.ticket.key, runId: run.id };
      let replayed = false;
      const canceled =
        requestId === undefined
          ? cancelRunRequest(context.db, run.id, context.now())
          : cancelRunOnce(context.db, { runId: run.id, requestId }, context.now(), () => {
              replayed = true;
            });
      if (!canceled.ok) {
        return rejected({
          ...base,
          reason: canceled.reason,
          error: `Could not cancel: ${canceled.reason}.`,
        });
      }
      return done({ ...base, serverHandles: true, replayed });
    },
  );

  register(
    "start_run_without_waiting",
    {
      title: "Start a run without waiting",
      description:
        "Moves a queued run that waits for its blocking tickets into the normal queue. It starts when its runner has room, even if the blocking tickets are not done. Sending the same requestId again does nothing more.",
      annotations: { ...WRITE, idempotentHint: true },
    },
    { runId: runIdArg, requestId: requestIdArg },
    ({ runId, requestId }) => {
      const run = findRun(runId);
      if (run === null) return noRun(runId);
      const base = { target: run.ticket.key, runId: run.id };
      let replayed = false;
      const result =
        requestId === undefined
          ? skipBlockerWaitRequest(context.db, run.id, context.now())
          : skipBlockerWaitOnce(context.db, { runId: run.id, requestId }, context.now(), () => {
              replayed = true;
            });
      if (!result.ok) {
        return rejected({
          ...base,
          reason: result.reason,
          error: `Could not start without waiting: ${result.reason}.`,
        });
      }
      return done({ ...base, serverHandles: true, replayed });
    },
  );

  register(
    "request_run_log",
    {
      title: "Refresh a run's log",
      description:
        "Asks the runner for the latest lines of a running run's log, the same as Refresh on Run detail. Read them later with get_run.",
      annotations: WRITE,
    },
    { runId: runIdArg },
    ({ runId }) => {
      const run = findRun(runId);
      if (run === null) return noRun(runId);
      const base = { target: run.ticket.key, runId: run.id };
      if (!requestRunLogTail(context.db, run.id, context.now())) {
        return rejected({
          ...base,
          reason: "not-running",
          error: "Only a run that has started and not ended has a log to refresh.",
        });
      }
      return done({ ...base, serverHandles: true });
    },
  );

  register(
    "update_workspace",
    {
      title: "Update workspace",
      description:
        "Changes the workspace name or the longest time a run may take, the same as General in Settings. Fields left out keep their value.",
      annotations: WRITE,
    },
    {
      workspace: workspaceArg,
      name: z.string().trim().min(1).max(200).optional(),
      maxRunMinutes: z.number().int().min(1).max(MAX_RUN_MINUTES).optional(),
    },
    ({ workspace, name, maxRunMinutes }) =>
      inWorkspace(workspace, (picked) => {
        const current = listWorkspaces(context.db).find((w) => w.id === picked.id);
        if (current === undefined) {
          return rejected({
            target: picked.name,
            runId: null,
            reason: "not-found",
            error: "The workspace is gone.",
          });
        }
        const input = screenChecked(
          generalInput,
          {
            ws: picked.id,
            name: name ?? current.name,
            maxRunMinutes: maxRunMinutes ?? Math.round(current.maxRunMs / 60_000),
          },
          { target: picked.name, runId: null },
        );
        if (!input.ok) return input.outcome;
        const saved = saveGeneral(settings(), input.data);
        if (!saved.ok) {
          return rejected({
            target: picked.name,
            runId: null,
            reason: saved.reason,
            error: "The workspace is gone.",
          });
        }
        return done({ target: name ?? picked.name, runId: null, serverHandles: false });
      }),
  );

  register(
    "add_tracker_project",
    {
      title: "Add a tracker project",
      description:
        "Adds a tracker project to the workspace, the same as Tracker projects in Settings. Tickets of the project then show up and can be assigned once it has a mapping.",
      annotations: WRITE_TRACKER,
    },
    { workspace: workspaceArg, connection: connectionArg, project: trackerProjectArg },
    ({ workspace, connection, project }) =>
      inWorkspace(workspace, async (picked) => {
        const { found, connections } = findConnection(connection);
        if (found === undefined) return noConnection(connection, connections);
        const choices = await loadTrackerProjectChoices(settings(), toWorkspaceId(picked.id));
        const listed = choices.find((c) => c.connection.id === found.id);
        const projects = listed?.projects ?? [];
        const match =
          projects.find((p) => p.id === project) ?? projects.find((p) => p.name === project);
        if (match === undefined) {
          return rejected({
            target: project,
            runId: null,
            reason: listed?.error ?? "not-found",
            error: `The tracker "${found.name}" has no project "${project}".`,
            extra: { projects: projects.map((p) => ({ id: p.id, name: p.name })) },
          });
        }
        const input = screenChecked(
          addTrackerProjectInput,
          { ws: picked.id, connectionId: found.id, projectId: match.id, name: match.name },
          { target: match.name, runId: null },
        );
        if (!input.ok) return input.outcome;
        const added = addTrackerProject(settings(), input.data);
        if (!added.ok) {
          return rejected({
            target: match.name,
            runId: null,
            reason: added.reason,
            error:
              added.reason === "taken"
                ? `Another workspace already has "${match.name}".`
                : "The workspace or connection is gone.",
          });
        }
        return done({ target: match.name, runId: null, serverHandles: false });
      }),
  );

  register(
    "remove_tracker_project",
    {
      title: "Remove a tracker project",
      description:
        "Removes a tracker project from the workspace, the same as Tracker projects in Settings. Its mapping and In Progress state are removed with it.",
      annotations: DESTRUCTIVE,
    },
    { workspace: workspaceArg, connection: connectionArg, project: trackerProjectArg },
    ({ workspace, connection, project }) =>
      inWorkspace(workspace, (picked) => {
        const bound = boundProject(picked, connection, project);
        if (!bound.ok) return bound.outcome;
        const removed = removeTrackerProject(settings(), bound.ref);
        if (!removed.ok) {
          return rejected({
            target: bound.name,
            runId: null,
            reason: removed.reason,
            error: "The project is gone.",
          });
        }
        return done({ target: bound.name, runId: null, serverHandles: false });
      }),
  );

  register(
    "set_mapping",
    {
      title: "Set a mapping",
      description:
        "Chooses the default runner project and the agent (and optionally model) for a tracker project's tickets, like Mapping in Settings. Other runner projects of the mapping and their labels stay as they are. get_settings lists runner projects and agents.",
      annotations: WRITE,
    },
    {
      workspace: workspaceArg,
      connection: connectionArg,
      project: trackerProjectArg,
      runnerProject: z.string().min(1).max(500),
      agent: z.string().min(1).max(200),
      model: z.string().max(200).optional(),
    },
    ({ workspace, connection, project, runnerProject, agent, model }) =>
      inWorkspace(workspace, (picked) => {
        const bound = boundProject(picked, connection, project);
        if (!bound.ok) return bound.outcome;
        const input = screenChecked(
          mappingInput,
          {
            ...bound.ref,
            runnerProjectId: runnerProject,
            agentId: agent,
            ...(model === undefined ? {} : { model }),
          },
          { target: bound.name, runId: null },
        );
        if (!input.ok) return input.outcome;
        const saved = saveMappingSetting(settings(), input.data);
        if (!saved.ok) {
          return rejected({
            target: bound.name,
            runId: null,
            reason: saved.reason,
            error: "The project is gone.",
          });
        }
        return done({ target: bound.name, runId: null, serverHandles: false });
      }),
  );

  register(
    "set_in_progress_state",
    {
      title: "Set the In Progress state",
      description:
        "Chooses the tracker state Ganger moves a ticket to when its run starts, the same as In Progress in Settings. get_settings lists each project's states.",
      annotations: WRITE,
    },
    {
      workspace: workspaceArg,
      connection: connectionArg,
      project: trackerProjectArg,
      state: z.string().min(1).max(200).describe("Tracker state id."),
    },
    ({ workspace, connection, project, state }) =>
      inWorkspace(workspace, (picked) => {
        const bound = boundProject(picked, connection, project);
        if (!bound.ok) return bound.outcome;
        const input = screenChecked(
          inProgressInput,
          { ...bound.ref, stateId: state },
          { target: bound.name, runId: null },
        );
        if (!input.ok) return input.outcome;
        const saved = saveInProgressState(settings(), input.data);
        if (!saved.ok) {
          return rejected({
            target: bound.name,
            runId: null,
            reason: saved.reason,
            error: "The project is gone.",
          });
        }
        return done({ target: bound.name, runId: null, serverHandles: false });
      }),
  );

  register(
    "set_auto_assign_label",
    {
      title: "Set the Auto-assign Label",
      description:
        "Chooses the tracker label that makes Ganger assign a ticket on its own, the same as Auto-assign Label in Settings. get_settings lists the labels.",
      annotations: WRITE,
    },
    {
      workspace: workspaceArg,
      connection: connectionArg,
      label: z.string().min(1).max(200).describe("Tracker label id."),
    },
    ({ workspace, connection, label }) =>
      inWorkspace(workspace, (picked) => {
        const { found, connections } = findConnection(connection);
        if (found === undefined) return noConnection(connection, connections);
        const input = screenChecked(
          labelInput,
          { ws: picked.id, connectionId: found.id, labelId: label },
          { target: found.name, runId: null },
        );
        if (!input.ok) return input.outcome;
        const saved = saveLabel(settings(), input.data);
        if (!saved.ok) {
          return rejected({
            target: found.name,
            runId: null,
            reason: saved.reason,
            error: "The connection is gone.",
          });
        }
        return done({ target: found.name, runId: null, serverHandles: false });
      }),
  );

  register(
    "check_tracker_connection",
    {
      title: "Check a tracker connection",
      description:
        "Checks that the stored tracker API key still works, the same as Check again in Settings. It never returns the key.",
      annotations: CHECK_REMOTE,
    },
    { connection: connectionArg },
    async ({ connection }) => {
      const { found, connections } = findConnection(connection);
      if (found === undefined) return noConnection(connection, connections);
      const checked = await checkTrackerConnection(settings(), { id: found.id });
      if (!checked.ok) {
        return rejected({
          target: found.name,
          runId: null,
          reason: checked.reason,
          error: `The tracker connection check failed: ${checked.reason}.`,
        });
      }
      return done({ target: found.name, runId: null, serverHandles: false });
    },
  );

  register(
    "check_github_token",
    {
      title: "Check the GitHub token",
      description:
        "Checks that the stored GitHub token still works, the same as Check again in Settings. It never returns the token.",
      annotations: CHECK_REMOTE,
    },
    {},
    async () => {
      const checked = await checkGitHubToken(settings());
      if (!checked.ok) {
        return rejected({
          target: null,
          runId: null,
          reason: checked.reason,
          error: `The GitHub token check failed: ${checked.reason}.`,
        });
      }
      return done({ target: null, runId: null, serverHandles: false });
    },
  );

  register(
    "set_runner_capacity",
    {
      title: "Set runner capacity",
      description:
        "Changes how many runs an existing runner takes at once. It changes nothing else about the runner.",
      annotations: WRITE,
    },
    {
      runner: runnerArg,
      capacity: z.number().int().min(1).max(RUNNER_CAPACITY_MAX),
    },
    ({ runner, capacity }) => {
      const { found, runners } = findRunner(runner);
      if (found === undefined) return noRunner(runner, runners);
      const input = screenChecked(
        runnerCapacityInput,
        { id: found.id, capacity },
        { target: found.name, runId: null },
      );
      if (!input.ok) return input.outcome;
      const saved = saveRunnerCapacitySetting(settings(), input.data);
      if (!saved.ok) {
        return rejected({
          target: found.name,
          runId: null,
          reason: saved.reason,
          error: "The runner is gone.",
        });
      }
      return done({ target: found.name, runId: null, serverHandles: false, result: { capacity } });
    },
  );

  register(
    "request_runner_check",
    {
      title: "Check a runner again",
      description:
        "Asks the server to check a runner again over ssh, the same as Check again in Settings. Read the result later with get_runner.",
      annotations: WRITE,
    },
    { runner: runnerArg },
    ({ runner }) => {
      const { found, runners } = findRunner(runner);
      if (found === undefined) return noRunner(runner, runners);
      const requested = requestRunnerCheckSetting(settings(), { id: found.id }, context.now());
      if (!requested.ok) {
        return rejected({
          target: found.name,
          runId: null,
          reason: requested.reason,
          error: "The runner is gone.",
        });
      }
      return done({ target: found.name, runId: null, serverHandles: true });
    },
  );

  register(
    "set_prevent_sleep",
    {
      title: "Keep this Mac awake",
      description:
        "Turns on or off keeping this Mac awake while the Ganger server runs, the same as Sleep in Settings. It is a file in the installation folder.",
      annotations: WRITE,
    },
    { preventSleep: z.boolean() },
    ({ preventSleep }) => {
      const saved = savePowerSetting(settings(), { preventSleep });
      if (!saved.ok) {
        return rejected({
          target: null,
          runId: null,
          reason: saved.reason,
          error: "This MCP server does not know the installation folder, so it cannot change this.",
        });
      }
      return done({ target: null, runId: null, serverHandles: true, result: { preventSleep } });
    },
  );

  return { sync };
}
