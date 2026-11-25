import type { MobileAccessDeps } from "@ganger/app/mobile-access";
import { TAILSCALE_CLI_ENV } from "@ganger/app/tailscale";
import type { ThisTailnetAddresses, ThisTailnetDevice } from "@ganger/app/tailscale";
import type { PingFetch } from "@ganger/app/webhook-address";
import { WEBHOOK_PING_PRODUCT } from "@ganger/app/webhook-address";
import { DEMO_TAILNET_HOST, DEMO_TAILNET_IP } from "./values.ts";

function demoServeFull(): string {
  const webPort = process.env["WEB_PORT"] ?? "3000";
  return JSON.stringify({
    TCP: {
      "443": { HTTPS: true },
      "8443": { HTTPS: true },
      "10000": { TCPForward: "127.0.0.1:22" },
    },
    Web: {
      [`${DEMO_TAILNET_HOST}:443`]: {
        Handlers: { "/": { Proxy: `http://127.0.0.1:${webPort}` } },
      },
      [`${DEMO_TAILNET_HOST}:8443`]: { Handlers: { "/docs/": { Proxy: "http://127.0.0.1:4000" } } },
    },
    AllowFunnel: { [`${DEMO_TAILNET_HOST}:8443`]: true },
  });
}

export function getThisTailnetDevice(): Promise<ThisTailnetDevice | null> {
  return Promise.resolve({ cli: "tailscale", host: DEMO_TAILNET_HOST });
}

export function getThisTailnetAddresses(): Promise<ThisTailnetAddresses> {
  return Promise.resolve({ kind: "known", hosts: [DEMO_TAILNET_HOST, DEMO_TAILNET_IP] });
}

export function getServeStatusOutput(): Promise<string | undefined> {
  const mode = process.env["GANGER_DEMO_SERVE"];
  if (mode === "full") return Promise.resolve(demoServeFull());
  if (mode === "broken") return Promise.resolve("not json");
  return Promise.resolve("{}");
}

function nodeError(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

export function getWebhookPingFetch(): PingFetch {
  return (url) => {
    const { hostname } = new URL(url);
    const label = hostname.split(".")[0] ?? "";
    if (label === "missing") return Promise.reject(nodeError("ENOTFOUND"));
    if (label === "closed") return Promise.reject(nodeError("ECONNREFUSED"));
    if (label === "broken") return Promise.reject(nodeError("CERT_HAS_EXPIRED"));
    if (label === "other") return Promise.resolve(new Response("<html></html>", { status: 200 }));
    return Promise.resolve(Response.json({ product: WEBHOOK_PING_PRODUCT, match: true }));
  };
}

const DEMO_TAILSCALE_CLI = "/demo/tailscale";
let demoMobileServe: Record<string, unknown> = {};

function demoTailscaleStatus(): string {
  if (process.env["GANGER_DEMO_TAILSCALE"] === "missing") {
    return JSON.stringify({ BackendState: "NeedsLogin" });
  }
  return JSON.stringify({ BackendState: "Running", Self: { DNSName: `${DEMO_TAILNET_HOST}.` } });
}

export function getMobileAccessDeps(): MobileAccessDeps {
  return {
    env: { [TAILSCALE_CLI_ENV]: DEMO_TAILSCALE_CLI },
    exists: (path) => path === DEMO_TAILSCALE_CLI,
    run: (_file, args) =>
      Promise.resolve(
        args[0] === "status" ? demoTailscaleStatus() : JSON.stringify(demoMobileServe),
      ),
    command: (_file, args) => {
      const target = args.at(-1) ?? "";
      demoMobileServe =
        target === "off"
          ? {}
          : { Web: { [`${DEMO_TAILNET_HOST}:443`]: { Handlers: { "/": { Proxy: target } } } } };
      return Promise.resolve({ ok: true, output: "" });
    },
  };
}
