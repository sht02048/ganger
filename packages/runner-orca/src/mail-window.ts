import type { OrcaAgent } from "./refs.js";
import type { MailRow, TaskRow } from "./schemas.js";

export const MAIL_WINDOW_FIRST = 200;
export const MAIL_WINDOW_GROWTH = 4;
export const MAIL_WINDOW_MAX = 3200;

const ORCA_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export interface MailWindow {
  limit: number;
  messages: ReadonlyArray<MailRow>;
}

export function taskStartedAt(task: TaskRow | null): Date | null {
  return parseOrcaTime(task?.created_at);
}

export function reachesBefore(mails: ReadonlyArray<MailRow>, since: Date): boolean {
  return mails.some((mail) => {
    const at = parseOrcaTime(mail.created_at);
    return at !== null && at.getTime() < since.getTime();
  });
}

export function isWholeInbox(window: MailWindow): boolean {
  return window.messages.length < window.limit;
}

export function windowReaches(window: MailWindow, since: Date | null): boolean {
  return isWholeInbox(window) || (since !== null && reachesBefore(window.messages, since));
}

export class PollCycle {
  private readonly agents: ReadonlyArray<OrcaAgent>;
  private readonly windows = new Map<string, MailWindow>();
  private readonly taskStarts = new Map<string, Map<string, Date | null>>();

  constructor(agents: ReadonlyArray<OrcaAgent> = []) {
    this.agents = agents;
  }

  windowOf(orcaRunId: string): MailWindow | undefined {
    return this.windows.get(orcaRunId);
  }

  keepWindow(orcaRunId: string, window: MailWindow): void {
    this.windows.set(orcaRunId, window);
  }

  knowsTasksOf(orcaRunId: string): boolean {
    return this.taskStarts.has(orcaRunId);
  }

  rememberTasks(orcaRunId: string, tasks: ReadonlyArray<TaskRow>): void {
    this.taskStarts.set(orcaRunId, new Map(tasks.map((task) => [task.id, taskStartedAt(task)])));
  }

  startOf(agent: OrcaAgent): Date | null {
    return this.taskStarts.get(agent.runId)?.get(agent.taskId) ?? null;
  }

  earliestStartWith(agent: OrcaAgent): Date | null {
    const own = this.startOf(agent);
    if (own === null) return null;
    return this.agents
      .filter((other) => other.runId === agent.runId)
      .map((other) => this.startOf(other))
      .reduce<Date>(
        (earliest, start) =>
          start !== null && start.getTime() < earliest.getTime() ? start : earliest,
        own,
      );
  }
}

function parseOrcaTime(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const iso = ORCA_UTC_TIMESTAMP.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
