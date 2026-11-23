import { deviceGroupOfKind } from "@ganger/db";
import type { NotificationEventKind } from "@ganger/db";

export const PUSH_BUNDLE_WINDOW_MS = 5_000;

export function isTodo(kind: NotificationEventKind): boolean {
  return deviceGroupOfKind(kind) !== "runnerIssue";
}

export function todoWindows<Member extends { eventId: number; createdAt: number }>(
  members: ReadonlyArray<Member>,
): Member[][] {
  const sorted = members.toSorted((a, b) => a.createdAt - b.createdAt || a.eventId - b.eventId);
  const windows: Member[][] = [];
  for (const member of sorted) {
    const current = windows.at(-1);
    const startedAt = current?.[0]?.createdAt;
    if (current !== undefined && startedAt !== undefined) {
      if (member.createdAt - startedAt <= PUSH_BUNDLE_WINDOW_MS) {
        current.push(member);
        continue;
      }
    }
    windows.push([member]);
  }
  return windows;
}
