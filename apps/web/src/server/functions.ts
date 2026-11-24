import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { CONTINUE_MESSAGE_MAX_LENGTH } from "@ganger/core";
import { countUnreadPrRuns, listCodeHostConnections, markAllTrackersChanged } from "@ganger/db";
import type { Database } from "@ganger/db";
import { z } from "zod";
import { denyInput, submitDenial } from "@ganger/app/home/actions";
import { loadHomePage, loadRunPrCommits, runPrCommitsInput } from "@ganger/app/home/load";
import { loadServerGitHub } from "@ganger/app/pr-read-diagnosis";
import type { ServerGitHub } from "@ganger/app/pr-read-diagnosis";
import { mergePrInput, mergeRunPullRequest } from "@ganger/app/home/merge-pr";
import {
  agentMessageInput,
  answerOnceInput,
  cancelRunOnce,
  continueRunOnce,
  controlRunOnce,
  humanCheckOnceInput,
  removeWorktreeOnce,
  runActionRequestId,
  sendAgentMessageRequest,
  skipBlockerWaitOnce,
  stopPreviousAgentOnce,
  submitAnswerOnce,
  submitHumanCheckOnce,
} from "@ganger/app/run-detail/actions";
import { loadRunDetail, requestRunLogTail } from "@ganger/app/run-detail/load";
import { loadRunnersPage } from "@ganger/app/runners/load";
import { ENDED_VIEWS, pickBoardConditions, runBoardDaysSchema } from "@ganger/app/runs/board";
import { loadBoardRun, loadRunsBoard } from "@ganger/app/runs/board-load";
import { runConditionsSchema } from "@ganger/app/runs/conditions";
import { MAX_ENDED_RUNS } from "@ganger/app/runs/model";
import { loadShell } from "@ganger/app/shell/load";
import { TITLE_BAR_COOKIE, isTitleBarHidden } from "@ganger/app/shell/window-chrome";
import { loadStatsPage } from "@ganger/app/stats/load";
import { statsPeriodDaysSchema } from "@ganger/app/stats/model";
import {
  assignInput,
  bulkAssignInput,
  submitAssignment,
  submitBulkAssignment,
} from "@ganger/app/tickets/assign";
import { loadTicketBlockers, loadTicketRuns, loadTrackerTickets } from "@ganger/app/tickets/load";
import { TIME_ZONE_COOKIE, parseTimeZone } from "@ganger/app/time-zone";
import { getAdapterRegistry, getGitHubAuth, getSecretBox } from "./adapters";
import { getDatabase } from "./database";
import { getTrackerReads } from "./tracker-reads";

export const getTimeZone = createServerFn({ method: "GET" }).handler(() =>
  parseTimeZone(getCookie(TIME_ZONE_COOKIE)),
);

export const getTitleBarHidden = createServerFn({ method: "GET" }).handler(() =>
  isTitleBarHidden(getCookie(TITLE_BAR_COOKIE)),
);

export const getShell = createServerFn({ method: "GET" }).handler(() => loadShell(getDatabase()));

export const getRunnersPage = createServerFn({ method: "GET" }).handler(() =>
  loadRunnersPage(getDatabase(), new Date(), { includeLoad: true, includeGhAccounts: true }),
);

async function serverGitHubForDiagnosis(db: Database): Promise<ServerGitHub | null> {
  try {
    return await loadServerGitHub(getGitHubAuth(), listCodeHostConnections(db, getSecretBox()));
  } catch {
    return null;
  }
}

export const getHomePage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(async ({ data }) => {
    const db = getDatabase();
    const serverGitHub =
      countUnreadPrRuns(db)["no-access"] > 0 ? await serverGitHubForDiagnosis(db) : null;
    return loadHomePage(db, data.ws, new Date(), parseTimeZone(getCookie(TIME_ZONE_COOKIE)), {
      includeLoad: true,
      serverGitHub,
    });
  });

export const getRunPrCommits = createServerFn({ method: "GET" })
  .validator(runPrCommitsInput)
  .handler(({ data }) => loadRunPrCommits(getDatabase(), data.runId, new Date()));

export const answerQuestion = createServerFn({ method: "POST" })
  .validator(answerOnceInput)
  .handler(({ data }) => submitAnswerOnce(getDatabase(), data, new Date()));

export const answerHumanCheck = createServerFn({ method: "POST" })
  .validator(humanCheckOnceInput)
  .handler(({ data }) => submitHumanCheckOnce(getDatabase(), data, new Date()));

export const mergePullRequest = createServerFn({ method: "POST" })
  .validator(mergePrInput)
  .handler(({ data }) =>
    mergeRunPullRequest(
      { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() },
      data,
      () => new Date(),
    ),
  );

export const denyPermission = createServerFn({ method: "POST" })
  .validator(denyInput)
  .handler(({ data }) => submitDenial(getDatabase(), data, new Date()));

export const getRunsPage = createServerFn({ method: "GET" })
  .validator(
    runConditionsSchema.extend({
      ws: z.string().optional(),
      ended: z.number().int().min(1).max(MAX_ENDED_RUNS).optional(),
      days: runBoardDaysSchema.optional(),
      view: z.enum(ENDED_VIEWS).optional(),
      failedOnly: z.boolean().optional(),
    }),
  )
  .handler(({ data }) =>
    loadRunsBoard(getDatabase(), data.ws, new Date(), {
      ...(data.ended === undefined ? {} : { endedLimit: data.ended }),
      conditions: pickBoardConditions(data),
      ...(data.view === undefined ? {} : { view: data.view }),
      failedOnly: data.failedOnly === true,
      timeZone: parseTimeZone(getCookie(TIME_ZONE_COOKIE)),
    }),
  );

export const getRunsBoardRun = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional(), runId: z.string().min(1).max(200) }))
  .handler(({ data }) => loadBoardRun(getDatabase(), data.ws, data.runId, new Date()));

export const getStatsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional(), days: statsPeriodDaysSchema }))
  .handler(({ data }) =>
    loadStatsPage(
      getDatabase(),
      data.ws,
      new Date(),
      parseTimeZone(getCookie(TIME_ZONE_COOKIE)),
      data.days,
    ),
  );

export const getRunDetail = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => loadRunDetail(getDatabase(), data.runId, new Date()));

export const requestRunLog = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => requestRunLogTail(getDatabase(), data.runId, new Date()));

const runActionKey = z.object({ runId: z.string().min(1), requestId: runActionRequestId });

export const cancelRun = createServerFn({ method: "POST" })
  .validator(runActionKey)
  .handler(({ data }) => cancelRunOnce(getDatabase(), data, new Date()));

export const removeRunWorktree = createServerFn({ method: "POST" })
  .validator(runActionKey)
  .handler(({ data }) => removeWorktreeOnce(getDatabase(), data, new Date()));

const continueMessageSchema = z
  .string()
  .trim()
  .min(1)
  .refine((text) => Array.from(text).length <= CONTINUE_MESSAGE_MAX_LENGTH);

export const continueRunFrom = createServerFn({ method: "POST" })
  .validator(runActionKey.extend({ message: continueMessageSchema }))
  .handler(({ data }) => continueRunOnce(getDatabase(), data, data.message, new Date()));

export const stopPreviousAgent = createServerFn({ method: "POST" })
  .validator(runActionKey)
  .handler(({ data }) => stopPreviousAgentOnce(getDatabase(), data, new Date()));

export const sendAgentMessage = createServerFn({ method: "POST" })
  .validator(agentMessageInput)
  .handler(({ data }) => sendAgentMessageRequest(getDatabase(), data, new Date()));

export const startRunWithoutWaiting = createServerFn({ method: "POST" })
  .validator(runActionKey)
  .handler(({ data }) => skipBlockerWaitOnce(getDatabase(), data, new Date()));

export const controlRun = createServerFn({ method: "POST" })
  .validator(runActionKey.extend({ control: z.enum(["pause", "resume"]) }))
  .handler(({ data }) => controlRunOnce(getDatabase(), data, data.control, new Date()));

export const getTicketRuns = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) => loadTicketRuns(getDatabase(), data.ws, new Date()));

export const getTicketBlockers = createServerFn({ method: "GET" })
  .validator(
    z.object({ ws: z.string().optional(), connection: z.string().min(1), key: z.string().min(1) }),
  )
  .handler(({ data }) =>
    loadTicketBlockers(
      { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() },
      { ws: data.ws, connection: data.connection, key: data.key },
    ),
  );

export const getTrackerTickets = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) =>
    loadTrackerTickets(
      {
        db: getDatabase(),
        secretBox: getSecretBox(),
        registry: getAdapterRegistry(),
        trackerReads: getTrackerReads(),
      },
      data.ws,
    ),
  );

export const rereadTrackers = createServerFn({ method: "POST" }).handler(() => {
  markAllTrackersChanged(getDatabase());
});

export const assignTicket = createServerFn({ method: "POST" })
  .validator(assignInput)
  .handler(({ data }) => submitAssignment(getDatabase(), data, new Date()));

export const assignTickets = createServerFn({ method: "POST" })
  .validator(bulkAssignInput)
  .handler(({ data }) => submitBulkAssignment(getDatabase(), data, new Date()));
