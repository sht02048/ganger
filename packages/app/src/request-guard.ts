export const WEBHOOK_PATH_PREFIX = "/api/webhooks/";
export const IDENTITY_PATH = "/api/identity";
export const WEBHOOK_PING_PREFIX = `${WEBHOOK_PATH_PREFIX}ping/`;

export const LOOPBACK_HOSTS: ReadonlyArray<string> = ["127.0.0.1", "localhost", "[::1]"];

const WILDCARD_BIND_HOSTS = new Set(["0.0.0.0", "[::]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FUNNEL_LISTEN_PORTS = new Set([443, 8443, 10000]);
const FUNNEL_REQUEST_HEADER = "tailscale-funnel-request";

export interface AllowedHosts {
  web: ReadonlySet<string>;
  tailnetWeb: ReadonlySet<string>;
  webhook: ReadonlySet<string>;
}

export interface AllowedHostsInput {
  bindHost: string | null;
  webAddress: string | null;
  webhookAddress: string | null;
  tailnetHosts?: ReadonlyArray<string>;
  webPort?: number | null;
}

export function isWildcardBind(bindHost: string | null): boolean {
  return bindHost !== null && WILDCARD_BIND_HOSTS.has(normalizeHostname(bindHost));
}

export type RejectReason = "host-not-allowed" | "origin-not-allowed";

export type GuardVerdict =
  | { ok: true }
  | { ok: false; status: 403; reason: RejectReason; host: string; origin: string | null };

const HOST_HEADER = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?)(?::\d{1,5})?$/u;

export function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  const bare = lower.endsWith(".") ? lower.slice(0, -1) : lower;
  if (bare.includes(":") && !bare.startsWith("[")) return `[${bare}]`;
  return bare;
}

export function hostnameOfHostHeader(value: string | null): string | null {
  if (value === null) return null;
  const match = HOST_HEADER.exec(value.trim().toLowerCase());
  const hostname = match?.[1];
  return hostname === undefined ? null : normalizeHostname(hostname);
}

function hostnameOfAddress(address: string | null): string | null {
  if (address === null) return null;
  try {
    return normalizeHostname(new URL(address).hostname);
  } catch {
    return null;
  }
}

function hostPortOfAddress(address: string | null): string | null {
  if (address === null) return null;
  const url = URL.parse(address);
  if (url === null) return null;
  const port = url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
  return `${normalizeHostname(url.hostname)}:${port}`;
}

function hostPortOfHostHeader(value: string | null): string | null {
  const hostname = hostnameOfHostHeader(value);
  const port = value === null ? undefined : /:(\d{1,5})$/u.exec(value.trim())?.[1];
  if (hostname === null || port === undefined) return null;
  return `${hostname}:${String(Number(port))}`;
}

export function allowedHosts(input: AllowedHostsInput): AllowedHosts {
  const web = new Set(LOOPBACK_HOSTS);
  const tailnetWeb = new Set<string>();
  const webhook = new Set<string>();
  const webhookHost = hostnameOfAddress(input.webhookAddress);
  if (webhookHost !== null) webhook.add(webhookHost);
  if (input.bindHost !== null) {
    const bind = normalizeHostname(input.bindHost);
    if (WILDCARD_BIND_HOSTS.has(bind)) {
      const webhookHostPort = hostPortOfAddress(input.webhookAddress);
      for (const tailnetHost of input.tailnetHosts ?? []) {
        const host = normalizeHostname(tailnetHost);
        webhook.add(host);
        if (input.webPort === undefined || input.webPort === null) continue;
        if (FUNNEL_LISTEN_PORTS.has(input.webPort)) continue;
        const hostPort = `${host}:${String(input.webPort)}`;
        if (hostPort !== webhookHostPort) tailnetWeb.add(hostPort);
      }
    } else {
      web.add(bind);
    }
  }
  const webHost = hostnameOfAddress(input.webAddress);
  if (webHost !== null) web.add(webHost);
  return { web, tailnetWeb, webhook };
}

export function isFunnelRequest(headers: Headers): boolean {
  return headers.has(FUNNEL_REQUEST_HEADER);
}

function isAnswerableOnAnyHost(pathname: string): boolean {
  return pathname === IDENTITY_PATH || pathname.startsWith(WEBHOOK_PING_PREFIX);
}

export function isWebhookPath(pathname: string): boolean {
  return pathname.startsWith(WEBHOOK_PATH_PREFIX);
}

export function isHostAllowed(
  hostHeader: string | null,
  pathname: string,
  allowed: AllowedHosts,
  viaFunnel = false,
): boolean {
  if (viaFunnel && !isWebhookPath(pathname)) return false;
  const hostname = hostnameOfHostHeader(hostHeader);
  if (hostname === null) return false;
  if (allowed.web.has(hostname)) return true;
  const hostPort = hostPortOfHostHeader(hostHeader);
  if (hostPort !== null && allowed.tailnetWeb.has(hostPort)) return true;
  return isWebhookPath(pathname) && allowed.webhook.has(hostname);
}

function originAllowed(origin: string, allowed: AllowedHosts): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = normalizeHostname(url.hostname);
    if (allowed.web.has(hostname)) return true;
    return url.port !== "" && allowed.tailnetWeb.has(`${hostname}:${url.port}`);
  } catch {
    return false;
  }
}

export function checkRequest(request: Request, allowed: AllowedHosts): GuardVerdict {
  const { pathname } = new URL(request.url);
  const hostHeader = request.headers.get("host");
  const origin = request.headers.get("origin");
  const host = hostHeader ?? "";
  if (SAFE_METHODS.has(request.method) && isAnswerableOnAnyHost(pathname)) return { ok: true };
  if (!isHostAllowed(hostHeader, pathname, allowed, isFunnelRequest(request.headers))) {
    return { ok: false, status: 403, reason: "host-not-allowed", host, origin };
  }
  if (SAFE_METHODS.has(request.method) || isWebhookPath(pathname) || origin === null) {
    return { ok: true };
  }
  if (!originAllowed(origin, allowed)) {
    return { ok: false, status: 403, reason: "origin-not-allowed", host, origin };
  }
  return { ok: true };
}

const REJECT_BODY: Record<RejectReason, string> = {
  "host-not-allowed":
    "Blocked request: this server does not accept the host name you used. " +
    "Open it from the server machine at http://127.0.0.1, then add the address you use " +
    "under Settings > 다른 기기 (other devices) > 열 주소 (web address).",
  "origin-not-allowed":
    "Blocked request: a page from another site tried to change this server. " +
    "Open the server at an allowed address and try again.",
};

export function rejectionResponse(reason: RejectReason): Response {
  return new Response(`${REJECT_BODY[reason]}\n`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export interface RejectionLogFields {
  status: number;
  reason: RejectReason;
  method: string;
  path: string;
  host: string;
  origin: string | null;
}

export function rejectionLogFields(
  request: Request,
  verdict: Extract<GuardVerdict, { ok: false }>,
): RejectionLogFields {
  const clip = (value: string) => value.slice(0, 200);
  return {
    status: verdict.status,
    reason: verdict.reason,
    method: request.method,
    path: clip(new URL(request.url).pathname),
    host: clip(verdict.host),
    origin: verdict.origin === null ? null : clip(verdict.origin),
  };
}
