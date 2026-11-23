import { eventPushId, pushDataSchema } from "@ganger/api";
import type { AppNotificationRecord, PushData, V1DeviceNotificationGroups } from "@ganger/api";

import type { DashboardRun } from "../dashboard/model";
import type { NotificationPreferences } from "../settings/settings-screen";

export const OPEN_SHEET_ACTION = "open-sheet";
export const QUESTION_CATEGORY = "question";
export const HUMAN_CHECK_CATEGORY = "human-check";

export function parsePushData(value: unknown): PushData | null {
  const parsed = pushDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseBackgroundPush(payload: unknown): PushData | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data: unknown = Reflect.get(payload, "data");
  if (typeof data !== "object" || data === null) return null;
  const text: unknown = Reflect.get(data, "dataString");
  if (typeof text !== "string") return null;
  try {
    return parsePushData(JSON.parse(text));
  } catch {
    return null;
  }
}

export function presentedPushId(data: unknown, device: string): string | null {
  const parsed = parsePushData(data);
  if (parsed === null || parsed.device !== device) return null;
  if ("eventId" in parsed) return eventPushId(parsed.eventId);
  return "bundleId" in parsed ? parsed.bundleId : null;
}

export function notificationsToDismiss(
  presented: ReadonlyArray<{ identifier: string; data: unknown }>,
  { device, clear }: { device: string; clear: ReadonlyArray<string> },
): string[] {
  const cleared = new Set(clear);
  return presented.flatMap(({ identifier, data }) => {
    const id = presentedPushId(data, device);
    return id !== null && cleared.has(id) ? [identifier] : [];
  });
}

export type PushOpen =
  | { kind: "todo"; device: string }
  | { kind: "event"; device: string; eventId: number; action: boolean };

export function pushOpenOf(data: unknown, actionIdentifier: string): PushOpen | null {
  const parsed = parsePushData(data);
  if (parsed === null || "clear" in parsed) return null;
  if ("bundleId" in parsed) return { kind: "todo", device: parsed.device };
  return {
    kind: "event",
    device: parsed.device,
    eventId: parsed.eventId,
    action: actionIdentifier === OPEN_SHEET_ACTION,
  };
}

export type PushDestination =
  | { screen: "runners" }
  | { screen: "dashboard"; todoOnly: boolean; run: { id: string; action: boolean } | null };

export function destinationOf(
  record: AppNotificationRecord | null,
  action: boolean,
): PushDestination {
  if (record === null || record.target.kind === "unknown") {
    return { screen: "dashboard", todoOnly: false, run: null };
  }
  if (record.target.kind === "runner") return { screen: "runners" };
  return {
    screen: "dashboard",
    todoOnly: false,
    run: { id: record.target.runId, action },
  };
}

export function sheetKindFor(
  run: Pick<DashboardRun, "todoTag">,
  action: boolean,
): "answer" | "human-check" | "detail" {
  if (action && run.todoTag === "question") return "answer";
  if (action && run.todoTag === "human-check") return "human-check";
  return "detail";
}

export function toPreferences(
  enabled: boolean,
  groups: V1DeviceNotificationGroups,
): NotificationPreferences {
  const { humanCheckRequest, ...rest } = groups;
  return { enabled, kinds: { ...rest, humanCheck: humanCheckRequest } };
}

export function toGroups({ kinds }: NotificationPreferences): V1DeviceNotificationGroups {
  const { humanCheck, ...rest } = kinds;
  return { ...rest, humanCheckRequest: humanCheck };
}
