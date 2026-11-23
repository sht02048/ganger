export function runTicketHref(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}/ticket`;
}
