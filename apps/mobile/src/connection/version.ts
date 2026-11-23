import { APP_CONTRACT_VERSION, contractFit } from "@ganger/api";
import type { V1Meta } from "@ganger/api";

export type NeededUpdate = "app" | "server";

export function neededUpdate(meta: V1Meta): NeededUpdate | null {
  switch (contractFit(meta)) {
    case "compatible":
      return null;
    case "update-app":
      return "app";
    case "update-server":
      return "server";
  }
}

export function updateForUnreadableReply(meta: V1Meta): NeededUpdate {
  return meta.contractVersion > APP_CONTRACT_VERSION ? "app" : "server";
}
