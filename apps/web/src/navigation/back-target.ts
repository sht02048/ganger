import { z } from "zod";

export const BACK_ORIGINS = [
  "dashboard",
  "tickets",
  "runs",
  "run",
  "runners",
  "stats",
  "settings",
] as const;

export type BackOrigin = (typeof BACK_ORIGINS)[number];

const backOriginState = z.object({
  backOrigin: z.enum(BACK_ORIGINS),
  backDocument: z.string(),
});

const thisDocument = `${Date.now()}-${Math.random()}`;

declare module "@tanstack/react-router" {
  interface HistoryState {
    backOrigin?: BackOrigin;
    backDocument?: string;
  }
}

export function originOfPath(pathname: string): BackOrigin | null {
  if (pathname === "/") return "dashboard";
  const [screen, detail] = pathname.split("/").slice(1);
  switch (screen ?? "") {
    case "tickets":
      return "tickets";
    case "runs":
      return detail === undefined || detail === "" ? "runs" : "run";
    case "runners":
      return "runners";
    case "stats":
      return "stats";
    case "settings":
      return "settings";
    default:
      return null;
  }
}

export function backState(
  backOrigin: BackOrigin,
  backDocument: string = thisDocument,
): { backOrigin: BackOrigin; backDocument: string } {
  return { backOrigin, backDocument };
}

export function originOfHistoryState(
  state: unknown,
  document: string = thisDocument,
): BackOrigin | null {
  const parsed = backOriginState.safeParse(state);
  return parsed.success && parsed.data.backDocument === document ? parsed.data.backOrigin : null;
}

export const RUN_ANSWER_HASH = "answer";

export function ticketRunTarget(runId: string, ws: string | undefined, place?: "answer") {
  return {
    to: "/runs/$runId" as const,
    params: { runId },
    search: { ws },
    state: backState("tickets"),
    ...(place === "answer" ? { hash: RUN_ANSWER_HASH } : {}),
  };
}

export type BackTarget = { kind: "history"; origin: BackOrigin } | { kind: "runs"; origin: "runs" };

export function backTargetOf(origin: BackOrigin | null): BackTarget {
  return origin === null ? { kind: "runs", origin: "runs" } : { kind: "history", origin };
}
