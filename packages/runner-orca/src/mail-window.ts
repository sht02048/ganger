import type { MailRow, TaskRow } from "./schemas.js";

export const MAIL_WINDOW_FIRST = 200;
export const MAIL_WINDOW_GROWTH = 4;
export const MAIL_WINDOW_MAX = 3200;

const ORCA_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function taskStartedAt(task: TaskRow | null): Date | null {
  return parseOrcaTime(task?.created_at);
}

export function reachesBefore(mails: ReadonlyArray<MailRow>, since: Date): boolean {
  return mails.some((mail) => {
    const at = parseOrcaTime(mail.created_at);
    return at !== null && at.getTime() < since.getTime();
  });
}

function parseOrcaTime(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const iso = ORCA_UTC_TIMESTAMP.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
