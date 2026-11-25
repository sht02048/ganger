import { execFile } from "node:child_process";
import { getInstallSettings, saveInstallAddresses } from "@ganger/db";
import type { Database } from "@ganger/db";
import { funnelTargetHost, parseServeStatus } from "./funnel-setup.js";
import type { ServePortUse } from "./funnel-setup.js";
import { allowedHosts, hostnameOfHostHeader, isHostAllowed } from "./request-guard.js";
import type { RequestOrigin } from "./settings/actions.js";
import { defaultTailnetDeps, findTailscaleCli, parseTailnetStatus } from "./tailscale.js";
import type { TailnetDeps } from "./tailscale.js";

export const MOBILE_SERVE_PORT = 443;

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
  | { kind: "on"; address: string; viaTailscale: boolean };

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

type ServeOnThisMac =
  | { kind: "unreadable" }
  | { kind: "free" }
  | { kind: "ours" }
  | { kind: "in-use"; portInUse: PortInUse };

type ThisMac = { kind: "missing" } | { kind: "running"; cli: string; host: string };

export function mobileServeTarget(bindHost: string, webPort: number): string {
  return `http://${funnelTargetHost(bindHost)}:${String(webPort)}`;
}

export function mobileAddress(host: string): string {
  return `https://${host}`;
}

export function serveOnCommand(target: string): string[] {
  return ["serve", "--bg", "--yes", `--https=${String(MOBILE_SERVE_PORT)}`, target];
}

export function serveOffCommand(): string[] {
  return ["serve", `--https=${String(MOBILE_SERVE_PORT)}`, "off"];
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

export function readServeOnThisMac(output: string | undefined, target: string): ServeOnThisMac {
  const ports = parseServeStatus(output);
  if (ports === null) return { kind: "unreadable" };
  const use = ports.get(MOBILE_SERVE_PORT);
  if (use === undefined) return { kind: "free" };
  if (isOurs(use, target)) return { kind: "ours" };
  return { kind: "in-use", portInUse: { uses: use.uses, isPublic: use.isPublic } };
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

async function readServe(
  deps: MobileAccessDeps,
  cli: string,
  target: string,
): Promise<ServeOnThisMac> {
  const output = await deps.run(cli, ["serve", "status", "--json"], STATUS_TIMEOUT_MS);
  return readServeOnThisMac(output, target);
}

export async function loadMobileAccess(context: MobileAccessContext): Promise<MobileAccessView> {
  const saved = getInstallSettings(context.db).webAddress;
  const deps = context.deps ?? defaultMobileAccessDeps;
  const mac = await readThisMac(deps);
  if (saved !== null) {
    return {
      kind: "on",
      address: saved,
      viaTailscale: mac.kind === "running" && saved === mobileAddress(mac.host),
    };
  }
  if (mac.kind === "missing") return { kind: "needs-tailscale" };
  const serve = await readServe(
    deps,
    mac.cli,
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
  const before = await readServe(deps, mac.cli, target);
  if (before.kind === "unreadable") return { ok: false, reason: "serve-unreadable" };
  if (before.kind === "in-use") {
    return { ok: false, reason: "port-in-use", portInUse: before.portInUse };
  }
  if (before.kind === "free") {
    const outcome = await deps.command(mac.cli, serveOnCommand(target), SERVE_TIMEOUT_MS);
    const after = await readServe(deps, mac.cli, target);
    if (!outcome.ok || after.kind !== "ours") {
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
    { webAddress: mobileAddress(mac.host), webhookAddress: current.webhookAddress },
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
  if (mac.kind === "running" && current.webAddress === mobileAddress(mac.host)) {
    const target = mobileServeTarget(context.bindHost, context.webPort);
    const serve = await readServe(deps, mac.cli, target);
    if (serve.kind === "unreadable") return { ok: false, reason: "serve-unreadable" };
    if (serve.kind === "ours") {
      const outcome = await deps.command(mac.cli, serveOffCommand(), SERVE_TIMEOUT_MS);
      if (!outcome.ok || (await readServe(deps, mac.cli, target)).kind === "ours") {
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
