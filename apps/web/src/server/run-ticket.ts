import { loadRunTicketLink, runTicketResponse } from "@ganger/app/run-ticket-link";
import ticketLink from "../../messages/ko/ticketLink.json" with { type: "json" };
import { getAdapterRegistry, getSecretBox } from "./adapters";
import { getDatabase } from "./database";

export async function serveRunTicket(request: Request, runId: string): Promise<Response> {
  const link = await loadRunTicketLink(
    { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() },
    runId,
  );
  return runTicketResponse(request, link, ticketLink);
}
