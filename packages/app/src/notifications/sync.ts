import { inTransaction, syncNotificationEvents } from "@ganger/db";
import type { Database, NotificationSyncResult } from "@ganger/db";
import { loadNotificationCauses } from "./causes.js";

export function syncNotifications(db: Database, now: Date): NotificationSyncResult {
  return inTransaction(db, () => syncNotificationEvents(db, loadNotificationCauses(db, now), now));
}
