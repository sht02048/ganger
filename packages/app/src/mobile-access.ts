import { execFile } from "node:child_process";
import { getInstallSettings, saveInstallAddresses } from "@ganger/db";
import type { Database } from "@ganger/db";
import { funnelTargetHost, parseServeStatus } from "./funnel-setup.js";
import type { ServePortUse, ServePorts } from "./funnel-setup.js";
import { allowedHosts, hostnameOfHostHeader, isHostAllowed } from "./request-guard.js";
import type { RequestOrigin } from "./settings/actions.js";
import { defaultTailnetDeps, findTailscaleCli, parseTailnetStatus } from "./tailscale.js";
import type { TailnetDeps } from "./tailscale.js";

export const MOBILE_SERVE_PORT = 443;
export const MOBILE_FALLBACK_PORTS: ReadonlyArray<number> = [8444, 8445, 8446, 8447, 8448];

const STATUS_TIMEOUT_MS = 3_000;
const SERVE_TIMEOUT_MS = 20_000;
const TAILSCALE_LOGIN_HOST = "login.tailscale.com";

export interface CommandOutcome {
  ok: boolean;
  output: string;
}

export interface MobileAccessDeps extends TailnetDeps {
  command(file: string, args: ReadonlyArray<string>, timeoutMs: number): Promise<CommandOutcome>;
}

export interface PortInUse {
  uses: string[];
  isPublic: boolean;
}

export type MobileAccessView =
  | { kind: "needs-tailscale" }
  | { kind: "off"; host: string; portInUse: PortInUse | null }
  | { kind: "on"; address: string; viaTailscale: boolean; fallbackPort: number | null };

export type MobileAccessRefusal =
  | "no-tailscale"
  | "port-in-use"
  | "serve-unreadable"
  | "serve-failed"
  | "locks-out";

export type MobileAccessResult =
  | { ok: true }
  | { ok: false; reason: MobileAccessRefusal; approvalUrl?: string; portInUse?: PortInUse };

export interface MobileAccessContext {
  db: Database;
  bindHost: string;
  webPort: number;
  deps?: MobileAccessDeps;
}

type MobileServePick =
  | { kind: "unreadable" }
  | { kind: "free"; port: number }
  | { kind: "ours"; port: number }
  | { kind: "in-use"; portInUse: PortInUse };

type ThisMac = { kind: "missing" } | { kind: "running"; cli: string; host: string };

export function mobileServeTarget(bindHost: string, webPort: number): string {
  return `http://${funnelTargetHost(bindHost)}:${String(webPort)}`;
}

export function mobileAddress(host: string, port: number): string {
  return port === MOBILE_SERVE_PORT ? `https://${host}` : `https://${host}:${String(port)}`;
}

export function tailscalePortOf(address: string, host: string): number | null {
  const url = URL.parse(address);
  if (url === null || url.protocol !== "https:" || url.hostname !== host) return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  return url.port === "" ? MOBILE_SERVE_PORT : Number(url.port);
}

export function serveOnCommand(target: string, port: number): string[] {
  return ["serve", "--bg", "--yes", `--https=${String(port)}`, target];
}

export function serveOffCommand(port: number): string[] {
  return ["serve", `--https=${String(port)}`, "off"];
}

function isOurs(use: ServePortUse, target: string): boolean {
  return (
    !use.isPublic &&
    !use.forwardsTcp &&
    use.uses.length === 1 &&
    use.proxies.length === 1 &&
    use.proxies[0]?.path === "/" &&
    use.proxies[0].proxy === target
  );
}

function oursPort(ports: ServePorts, target: string): number | undefined {
  const served = [...ports.entries()]
    .filter(([, use]) => isOurs(use, target))
    .map(([port]) => port);
  return served.includes(MOBILE_SERVE_PORT) ? MOBILE_SERVE_PORT : served.sort((a, b) => a - b)[0];
}

export function pickMobileServePort(output: string | undefined, target: string): MobileServePick {
  const ports = parseServeStatus(output);
  if (ports === null) return { kind: "unreadable" };
  const ours = oursPort(ports, target);
  if (ours !== undefined) return { kind: "ours", port: ours };
  const main = ports.get(MOBILE_SERVE_PORT);
  if (main === undefined) return { kind: "free", port: MOBILE_SERVE_PORT };
  const fallback = MOBILE_FALLBACK_PORTS.find((port) => !ports.has(port));
  if (fallback !== undefined) return { kind: "free", port: fallback };
  return { kind: "in-use", portInUse: { uses: main.uses, isPublic: main.isPublic } };
}

export function isServedHere(output: string | undefined, target: string, port: number): boolean {
  const use = parseServeStatus(output)?.get(port);
  return use !== undefined && isOurs(use, target);
}

export function approvalUrlOf(output: string): string | undefined {
  for (const match of output.matchAll(/https:\/\/[^\s"'<>]+/gu)) {
    const url = URL.parse(match[0]);
    if (url?.protocol === "https:" && url.hostname === TAILSCALE_LOGIN_HOST) return url.href;
  }
  return undefined;
}

async function readThisMac(deps: MobileAccessDeps): Promise<ThisMac> {
  const cli = findTailscaleCli(deps);
  if (cli === undefined) return { kind: "missing" };
  const output = await deps.run(cli, ["status", "--json"], STATUS_TIMEOUT_MS);
  if (output === undefined) return { kind: "missing" };
  const status = parseTailnetStatus(output);
  if (status.kind !== "running" || status.self === null) return { kind: "missing" };
  return { kind: "running", cli, host: status.self };
}

function readServe(deps: MobileAccessDeps, cli: string): Promise<string | undefined> {
  return deps.run(cli, ["serve", "status", "--json"], STATUS_TIMEOUT_MS);
}

export async function loadMobileAccess(context: MobileAccessContext): Promise<MobileAccessView> {
  const saved = getInstallSettings(context.db).webAddress;
  const deps = context.deps ?? defaultMobileAccessDeps;
  const mac = await readThisMac(deps);
  if (saved !== null) {
    const port = mac.kind === "running" ? tailscalePortOf(saved, mac.host) : null;
    return {
      kind: "on",
      address: saved,
      viaTailscale: port !== null,
      fallbackPort: port === null || port === MOBILE_SERVE_PORT ? null : port,
    };
  }
  if (mac.kind === "missing") return { kind: "needs-tailscale" };
  const serve = pickMobileServePort(
    await readServe(deps, mac.cli),
    mobileServeTarget(context.bindHost, context.webPort),
  );
  return {
    kind: "off",
    host: mac.host,
    portInUse: serve.kind === "in-use" ? serve.portInUse : null,
  };
}

export async function turnOnMobileAccess(
  context: MobileAccessContext,
  now: Date,
): Promise<MobileAccessResult> {
  const current = getInstallSettings(context.db);
  if (current.webAddress !== null) return { ok: true };
  const deps = context.deps ?? defaultMobileAccessDeps;
  const mac = await readThisMac(deps);
  if (mac.kind === "missing") return { ok: false, reason: "no-tailscale" };
  const target = mobileServeTarget(context.bindHost, context.webPort);
  const pick = pickMobileServePort(await readServe(deps, mac.cli), target);
  if (pick.kind === "unreadable") return { ok: false, reason: "serve-unreadable" };
  if (pick.kind === "in-use") {
    return { ok: false, reason: "port-in-use", portInUse: pick.portInUse };
  }
  if (pick.kind === "free") {
    const outcome = await deps.command(
      mac.cli,
      serveOnCommand(target, pick.port),
      SERVE_TIMEOUT_MS,
    );
    const served = isServedHere(await readServe(deps, mac.cli), target, pick.port);
    if (!outcome.ok || !served) {
      const approvalUrl = approvalUrlOf(outcome.output);
      return {
        ok: false,
        reason: "serve-failed",
        ...(approvalUrl === undefined ? {} : { approvalUrl }),
      };
    }
  }
  saveInstallAddresses(
    context.db,
    { webAddress: mobileAddress(mac.host, pick.port), webhookAddress: current.webhookAddress },
    now,
  );
  return { ok: true };
}

function locksOutWithoutWebAddress(webhookAddress: string | null, from: RequestOrigin): boolean {
  if (hostnameOfHostHeader(from.host) === null) return false;
  const next = allowedHosts({
    bindHost: from.bindHost,
    webAddress: null,
    webhookAddress,
    tailnetHosts: from.tailnetHosts ?? [],
    webPort: from.webPort ?? null,
  });
  return !isHostAllowed(from.host, "/", next);
}

export async function turnOffMobileAccess(
  context: MobileAccessContext,
  now: Date,
  from: RequestOrigin,
): Promise<MobileAccessResult> {
  const current = getInstallSettings(context.db);
  if (current.webAddress === null) return { ok: true };
  const openedThroughIt = URL.parse(current.webAddress)?.host === from.host;
  if (openedThroughIt || locksOutWithoutWebAddress(current.webhookAddress, from)) {
    return { ok: false, reason: "locks-out" };
  }
  const deps = context.deps ?? defaultMobileAccessDeps;
  const mac = await readThisMac(deps);
  const port = mac.kind === "running" ? tailscalePortOf(current.webAddress, mac.host) : null;
  if (mac.kind === "running" && port !== null) {
    const target = mobileServeTarget(context.bindHost, context.webPort);
    const before = await readServe(deps, mac.cli);
    if (parseServeStatus(before) === null) return { ok: false, reason: "serve-unreadable" };
    if (isServedHere(before, target, port)) {
      const outcome = await deps.command(mac.cli, serveOffCommand(port), SERVE_TIMEOUT_MS);
      if (!outcome.ok || isServedHere(await readServe(deps, mac.cli), target, port)) {
        return { ok: false, reason: "serve-failed" };
      }
    }
  }
  saveInstallAddresses(
    context.db,
    { webAddress: null, webhookAddress: current.webhookAddress },
    now,
  );
  return { ok: true };
}

export const defaultMobileAccessDeps: MobileAccessDeps = {
  ...defaultTailnetDeps,
  command: (file, args, timeoutMs) =>
    new Promise((resolve) => {
      execFile(
        file,
        [...args],
        { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8" },
        (error, stdout, stderr) => resolve({ ok: error === null, output: `${stdout}\n${stderr}` }),
      );
    }),
};
