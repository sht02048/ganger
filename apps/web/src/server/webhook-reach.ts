import { defaultMobileAccessDeps } from "@ganger/app/mobile-access";
import type { MobileAccessDeps } from "@ganger/app/mobile-access";
import {
  readServeStatusOutput,
  readThisTailnetAddresses,
  readThisTailnetDevice,
} from "@ganger/app/tailscale";
import type { ThisTailnetAddresses, ThisTailnetDevice } from "@ganger/app/tailscale";
import type { PingFetch } from "@ganger/app/webhook-address";

export function getThisTailnetDevice(): Promise<ThisTailnetDevice | null> {
  return readThisTailnetDevice();
}

export function getThisTailnetAddresses(): Promise<ThisTailnetAddresses> {
  return readThisTailnetAddresses();
}

export function getServeStatusOutput(cli: string): Promise<string | undefined> {
  return readServeStatusOutput(cli);
}

export function getWebhookPingFetch(): PingFetch {
  return (url, init) => fetch(url, init);
}

export function getMobileAccessDeps(): MobileAccessDeps {
  return defaultMobileAccessDeps;
}
