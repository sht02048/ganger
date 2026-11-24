import { toRunId } from "@ganger/core";
import type { AdapterRegistry, RunId } from "@ganger/core";
import { SecretBoxError, getRun, getTrackerConnection } from "@ganger/db";
import type { Database, SecretBox } from "@ganger/db";
import { isWebUrl } from "./format/url.js";
import { noticePageResponse } from "./host-blocked-page.js";

export type RunTicketLink =
  | { status: 200; url: string }
  | { status: 404; reason: "not-found" }
  | { status: 503; reason: "tracker-unavailable" };

export interface RunTicketLinkContext {
  db: Database;
  secretBox: SecretBox;
  registry: AdapterRegistry;
}

export interface RunTicketNotice {
  title: string;
  body: string;
}

export type RunTicketCopy = Record<"notFound" | "unavailable", RunTicketNotice>;

export async function loadRunTicketLink(
  context: RunTicketLinkContext,
  runId: string,
): Promise<RunTicketLink> {
  const run = getRun(context.db, toRunId(runId));
  if (run === null) return { status: 404, reason: "not-found" };
  const stored = getTrackerConnection(context.db, context.secretBox, run.ticket.connection);
  if (stored === null) return { status: 503, reason: "tracker-unavailable" };
  try {
    const tracker = context.registry.createTracker(stored.kind, {
      config: stored.config,
      secrets: stored.secrets,
    });
    const ticket = await tracker.getTicket(run.ticket.key);
    if (ticket === null || !isWebUrl(ticket.url)) return { status: 404, reason: "not-found" };
    return { status: 200, url: ticket.url };
  } catch {
    return { status: 503, reason: "tracker-unavailable" };
  }
}

export async function loadRunTicketPageLink(
  context: RunTicketLinkContext,
  runId: RunId,
): Promise<RunTicketLink> {
  try {
    return await loadRunTicketLink(context, runId);
  } catch (error) {
    if (error instanceof SecretBoxError) return { status: 503, reason: "tracker-unavailable" };
    throw error;
  }
}

function httpsLocation(url: string): string | null {
  if (!isWebUrl(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return null;
  return parsed.href;
}

export function runTicketResponse(
  request: Request,
  link: RunTicketLink,
  copy: RunTicketCopy,
): Response {
  if (link.status === 503) return noticePageResponse(request, { ...copy.unavailable, status: 503 });
  const location = link.status === 200 ? httpsLocation(link.url) : null;
  if (location === null) return noticePageResponse(request, { ...copy.notFound, status: 404 });
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
