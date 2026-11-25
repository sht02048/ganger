import { z } from "zod";

export const envelopeSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string().optional() }),
  }),
]);

const text = z.string();
const optionalText = z.string().nullish();

export const statusResultSchema = z.object({
  runtime: z
    .object({
      state: optionalText,
      reachable: z.boolean().nullish(),
      appVersion: optionalText,
    })
    .nullish(),
});

export const serviceStatusResultSchema = z.object({
  installed: z.boolean(),
  verdict: optionalText,
  detail: optionalText,
});

export const projectListResultSchema = z.object({
  projects: z.array(
    z.object({
      id: text,
      displayName: text,
      gitRemoteIdentity: z.object({ remoteName: optionalText }).nullish(),
    }),
  ),
});

export const projectSetupsResultSchema = z.object({
  setups: z.array(
    z.object({
      projectId: text,
      hostId: text,
      repoId: text,
      path: text,
      displayName: text,
      setupState: text,
    }),
  ),
});

export const repoHooksResultSchema = z.object({
  repo: z.object({
    hookSettings: z
      .object({
        commandSourcePolicy: z.string().nullish(),
        scripts: z.object({ setup: z.string().nullish() }).nullish(),
      })
      .nullish(),
  }),
});

export const terminalCreateResultSchema = z.object({
  terminal: z.object({ handle: text }),
});

export const terminalShowResultSchema = z.object({
  terminal: z.object({
    handle: text,
    connected: z.boolean().nullish(),
    tabId: optionalText,
    leafId: optionalText,
  }),
});

export const runBindResultSchema = z.object({ runId: text });

export const runCurrentResultSchema = z.object({ runId: optionalText });

export const workerStartResultSchema = z.object({
  dispatchId: text,
  taskId: text,
  runId: text,
  state: text,
  workspace: optionalText,
});

export const worktreeShowResultSchema = z.object({
  worktree: z.object({ id: text, branch: optionalText }),
});

export const worktreePathResultSchema = z.object({
  worktree: z.object({ path: text }),
});

export const workerListResultSchema = z.object({
  workers: z.array(z.object({ dispatchId: text, taskId: text, workspace: optionalText })),
  nextCursor: optionalText,
});

export const workerShowResultSchema = z.object({
  dispatchId: text,
  taskId: text,
  runId: text,
  state: text,
  stage: optionalText,
  liveness: optionalText,
  terminal: optionalText,
  workspace: optionalText,
  lastError: optionalText,
});

export const terminalSendResultSchema = z.object({
  send: z.object({ accepted: z.boolean() }),
});

export const taskListResultSchema = z.object({
  tasks: z.array(
    z.object({
      id: text,
      status: text,
      result: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
      created_at: optionalText,
    }),
  ),
});

export const taskReportSchema = z.object({
  provenance: optionalText,
  outcome: optionalText,
  subject: optionalText,
  body: optionalText,
  completedAt: optionalText,
});

export const mailRowSchema = z.object({
  id: text,
  type: text,
  subject: optionalText,
  body: z.string().nullish(),
  payload: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
  created_at: optionalText,
});

export const checkResultSchema = z.object({ messages: z.array(mailRowSchema) });

export const mailPayloadSchema = z.object({
  dispatchId: optionalText,
  options: z.array(z.string()).nullish(),
  stopReason: optionalText,
  reason: optionalText,
  outcome: optionalText,
  approval: z
    .object({
      approvalId: text,
      state: optionalText,
      summary: z.object({ title: optionalText, detail: optionalText }).nullish(),
    })
    .nullish(),
});

const worktreeAgentSchema = z.object({
  paneKey: optionalText,
  state: optionalText,
  interrupted: z.boolean().nullish(),
  stateStartedAt: z.number().nullish(),
  mainAgent: z
    .object({
      state: optionalText,
      outcome: optionalText,
      stateStartedAt: z.number().nullish(),
    })
    .nullish(),
});

export const worktreePsResultSchema = z.object({
  worktrees: z.array(
    z.object({
      worktreeId: text,
      liveTerminalCount: z.number().nullish(),
      agents: z.array(worktreeAgentSchema).nullish(),
    }),
  ),
  truncated: z.boolean().nullish(),
});

export const replyResultSchema = z.object({ messageId: text });
export const sendResultSchema = z.object({ messageId: text });
export const operatorSendResultSchema = z.union([
  z.object({ messageId: text }),
  z.object({ delivery: text, dispatchId: text }),
]);
export const failedFollowUpEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    result: z.object({ delivery: text, dispatchId: text }),
  })
  .transform((envelope) => envelope.result);
export const denyResultSchema = z.object({ approvalId: optionalText });
export const workerStopResultSchema = z.object({ state: text });
export const workerReleaseResultSchema = z.object({ state: text });
export const worktreeRmResultSchema = z.object({ removed: z.boolean() });

const transcriptBlockSchema = z.object({
  type: text,
  text: optionalText,
  name: optionalText,
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});

export const workerReadResultSchema = z.object({
  source: optionalText,
  transcript: z
    .object({
      messages: z.array(z.object({ role: text, blocks: z.array(transcriptBlockSchema) })),
      nextCursor: optionalText,
    })
    .nullish(),
  terminal: z.object({ tail: z.array(z.string()) }).nullish(),
});

export type MailRow = z.infer<typeof mailRowSchema>;
export type TaskRow = z.infer<typeof taskListResultSchema>["tasks"][number];
export type MailPayload = z.infer<typeof mailPayloadSchema>;
export type WorkerShowResult = z.infer<typeof workerShowResultSchema>;
export type WorktreePsResult = z.infer<typeof worktreePsResultSchema>;
export type WorktreeAgent = z.infer<typeof worktreeAgentSchema>;
export type WorkerReadResult = z.infer<typeof workerReadResultSchema>;
