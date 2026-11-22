import type { RunId, RunnerId, TicketKey } from "@ganger/core";
import { and, asc, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";
import type { WorkspaceId } from "./ids.js";
import type { NotificationEventKind } from "./notification-events-model.js";
import { notificationEvents, notificationSequence } from "./schema.js";

export { NOTIFICATION_EVENT_KINDS } from "./notification-events-model.js";
export type { NotificationEventKind } from "./notification-events-model.js";

export const RESOLVED_NOTIFICATION_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTIFICATION_REOPEN_WINDOW_MS = 10 * 60 * 1000;

export type NotificationTarget =
  | { kind: "run"; runId: RunId; workspaceId: WorkspaceId; ticketKey: TicketKey }
  | { kind: "runner"; runnerId: RunnerId };

export interface NotificationCause {
  kind: NotificationEventKind;
  cause: string;
  target: NotificationTarget;
  subject: string;
  detail: string | null;
}

export interface StoredNotificationEvent extends NotificationCause {
  id: number;
  seq: number;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface NotificationSyncResult {
  opened: number;
  reopened: number;
  resolved: number;
  purged: number;
}

type Row = typeof notificationEvents.$inferSelect;

function targetOf(row: Row): NotificationTarget {
  if (row.runId !== null && row.workspaceId !== null && row.ticketKey !== null) {
    return {
      kind: "run",
      runId: row.runId,
      workspaceId: row.workspaceId,
      ticketKey: row.ticketKey,
    };
  }
  if (row.runnerId !== null) return { kind: "runner", runnerId: row.runnerId };
  throw new Error(`notification event ${row.id} has no target`);
}

function toStored(row: Row): StoredNotificationEvent {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    cause: row.cause,
    target: targetOf(row),
    subject: row.subject,
    detail: row.detail,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

function nextSeq(db: Database): number {
  const current = db.select().from(notificationSequence).get();
  const next = (current?.last ?? 0) + 1;
  if (current === undefined) db.insert(notificationSequence).values({ id: 1, last: next }).run();
  else
    db.update(notificationSequence).set({ last: next }).where(eq(notificationSequence.id, 1)).run();
  return next;
}

export function notificationCursor(db: Database): number {
  return db.select().from(notificationSequence).get()?.last ?? 0;
}

function targetColumns(target: NotificationTarget) {
  return target.kind === "run"
    ? {
        runId: target.runId,
        workspaceId: target.workspaceId,
        ticketKey: target.ticketKey,
        runnerId: null,
      }
    : { runId: null, workspaceId: null, ticketKey: null, runnerId: target.runnerId };
}

export function syncNotificationEvents(
  db: Database,
  causes: ReadonlyArray<NotificationCause>,
  now: Date,
): NotificationSyncResult {
  return inTransaction(db, () => {
    const result: NotificationSyncResult = { opened: 0, reopened: 0, resolved: 0, purged: 0 };
    const open = new Map(
      db
        .select()
        .from(notificationEvents)
        .where(isNull(notificationEvents.resolvedAt))
        .all()
        .map((row) => [row.cause, row]),
    );
    const present = new Set<string>();
    for (const cause of causes) {
      if (present.has(cause.cause)) continue;
      present.add(cause.cause);
      if (open.has(cause.cause)) continue;
      const recent = db
        .select()
        .from(notificationEvents)
        .where(
          and(
            eq(notificationEvents.cause, cause.cause),
            isNotNull(notificationEvents.resolvedAt),
            gt(
              notificationEvents.resolvedAt,
              new Date(now.getTime() - NOTIFICATION_REOPEN_WINDOW_MS),
            ),
          ),
        )
        .orderBy(asc(notificationEvents.resolvedAt))
        .all()
        .at(-1);
      if (recent !== undefined) {
        db.update(notificationEvents)
          .set({ resolvedAt: null, seq: nextSeq(db) })
          .where(eq(notificationEvents.id, recent.id))
          .run();
        result.reopened += 1;
        continue;
      }
      db.insert(notificationEvents)
        .values({
          seq: nextSeq(db),
          kind: cause.kind,
          cause: cause.cause,
          ...targetColumns(cause.target),
          subject: cause.subject,
          detail: cause.detail,
          createdAt: now,
          resolvedAt: null,
        })
        .run();
      result.opened += 1;
    }
    for (const [key, row] of open) {
      if (present.has(key)) continue;
      db.update(notificationEvents)
        .set({ resolvedAt: now, seq: nextSeq(db) })
        .where(eq(notificationEvents.id, row.id))
        .run();
      result.resolved += 1;
    }
    result.purged = db
      .delete(notificationEvents)
      .where(
        and(
          isNotNull(notificationEvents.resolvedAt),
          lt(
            notificationEvents.resolvedAt,
            new Date(now.getTime() - RESOLVED_NOTIFICATION_KEEP_MS),
          ),
        ),
      )
      .returning({ id: notificationEvents.id })
      .all().length;
    return result;
  });
}

export function listOpenNotificationEvents(db: Database): StoredNotificationEvent[] {
  return db
    .select()
    .from(notificationEvents)
    .where(isNull(notificationEvents.resolvedAt))
    .orderBy(asc(notificationEvents.seq))
    .all()
    .map(toStored);
}

export function getNotificationEvent(db: Database, id: number): StoredNotificationEvent | null {
  const row = db.select().from(notificationEvents).where(eq(notificationEvents.id, id)).get();
  return row === undefined ? null : toStored(row);
}

export function listNotificationChanges(db: Database, afterSeq: number): StoredNotificationEvent[] {
  return db
    .select()
    .from(notificationEvents)
    .where(gt(notificationEvents.seq, afterSeq))
    .orderBy(asc(notificationEvents.seq))
    .all()
    .map(toStored);
}
