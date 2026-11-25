import { Linking } from "react-native";

import type { DashboardRun } from "../dashboard/model";
import { isWebLink } from "./body-parts";
import type { RunPort } from "./run-port";

export async function openWebLink(url: string): Promise<boolean> {
  if (!isWebLink(url)) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export type TicketOpenOutcome = "opened" | "demo" | "failed";

export async function openTicket(port: RunPort, run: DashboardRun): Promise<TicketOpenOutcome> {
  const link = await port.ticketLink(run);
  if (link.kind === "demo") return "demo";
  if (link.kind !== "ok") return "failed";
  return (await openWebLink(link.value)) ? "opened" : "failed";
}
