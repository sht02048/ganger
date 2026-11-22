import {
  toAgentId,
  toRunnerId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerProjectId,
} from "@ganger/core";
import {
  TICKET_TITLE_MAX_LENGTH,
  assignRun,
  getMapping,
  listRunners,
  listWorkspaceTrackerProjects,
  markTrackerReadsStale,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { log } from "@ganger/log";
import { BULK_ASSIGN_LIMIT } from "./bulk-assign.js";
import type { BulkAssignItemResult } from "./bulk-assign.js";
import type { AssignRejectReason } from "./model.js";
import { z } from "zod";

export const assignInput = z.object({
  connection: z.string().min(1),
  ticketKey: z.string().min(1),
  ticketTitle: z.string().trim().max(TICKET_TITLE_MAX_LENGTH).default(""),
  trackerProject: z.string().min(1),
  runnerProject: z.string().min(1),
  runnerId: z.string().min(1).nullable(),
  agent: z.string().min(1),
});

export type AssignInput = z.infer<typeof assignInput>;

export type AssignResult = { ok: true; runId: string } | { ok: false; reason: AssignRejectReason };

export const bulkAssignInput = z.object({
  assignments: z
    .array(
      assignInput.extend({
        ticketTitle: z
          .string()
          .trim()
          .transform((title) => title.slice(0, TICKET_TITLE_MAX_LENGTH).trim()),
        runnerId: z.null(),
      }),
    )
    .min(1)
    .max(BULK_ASSIGN_LIMIT),
});

export type BulkAssignInput = z.input<typeof bulkAssignInput>;

export interface BulkAssignResult {
  results: BulkAssignItemResult[];
}

function assignOneOfMany(db: Database, input: AssignInput, now: Date): BulkAssignItemResult {
  const ticket = { connection: input.connection, ticketKey: input.ticketKey };
  try {
    const result = submitAssignment(db, input, now);
    return result.ok
      ? { ...ticket, ok: true, runId: result.runId }
      : { ...ticket, ok: false, reason: result.reason };
  } catch (error) {
    log().error("run.bulk_assign_failed", {
      ticketKey: input.ticketKey,
      trackerConnectionId: input.connection,
      error,
    });
    return { ...ticket, ok: false, reason: "failed" };
  }
}

export function submitBulkAssignment(
  db: Database,
  input: z.output<typeof bulkAssignInput>,
  now: Date,
): BulkAssignResult {
  const unique = new Map(
    input.assignments.map((assignment) => [
      JSON.stringify([assignment.connection, assignment.ticketKey]),
      assignment,
    ]),
  );
  return { results: [...unique.values()].map((one) => assignOneOfMany(db, one, now)) };
}

export function submitAssignment(db: Database, input: AssignInput, now: Date): AssignResult {
  const connection = toTrackerConnectionId(input.connection);
  const trackerProject = toTrackerProjectId(input.trackerProject);
  const mapping = getMapping(db, connection, trackerProject);
  if (mapping === null) return { ok: false, reason: "no-mapping" };

  const knownAgent =
    input.agent === mapping.agent ||
    listWorkspaceTrackerProjects(db).some(
      (project) => getMapping(db, project.connection, project.projectId)?.agent === input.agent,
    );
  if (!knownAgent) return { ok: false, reason: "unknown-agent" };

  const runnerProject = toRunnerProjectId(input.runnerProject);
  if (!mapping.repos.some((repo) => repo.project === runnerProject)) {
    return { ok: false, reason: "unknown-repo" };
  }

  if (input.runnerId !== null) {
    const runner = listRunners(db).find((r) => r.id === input.runnerId);
    if (runner === undefined || !runner.projects.some((p) => p.id === runnerProject)) {
      return { ok: false, reason: "unknown-runner" };
    }
  }

  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(input.ticketKey) },
    ticketTitle: input.ticketTitle,
    trackerProject,
    runnerProject,
    agent: toAgentId(input.agent),
    model: input.agent === mapping.agent ? mapping.model : null,
    ...(input.runnerId === null ? {} : { runnerId: toRunnerId(input.runnerId) }),
    now,
  });
  if (result.ok) {
    markTrackerReadsStale(db, connection);
    return { ok: true, runId: result.run.id };
  }
  switch (result.reason) {
    case "active-run":
    case "unknown-runner":
    case "runner-assignment-blocked":
      return { ok: false, reason: result.reason };
    case "unknown-tracker-project":
      return { ok: false, reason: "no-mapping" };
  }
}
