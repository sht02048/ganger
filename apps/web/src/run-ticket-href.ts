import type { RunId } from "@ganger/core";

export function runTicketHref(runId: RunId): string {
  return `/runs/${encodeURIComponent(runId)}/ticket`;
}
