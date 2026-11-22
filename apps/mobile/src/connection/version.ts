import { CONTRACT_VERSION } from "@ganger/api";
import type { V1Meta } from "@ganger/api";

export const MINIMUM_SERVER_VERSION = "0.4.0";

function versionParts(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isServerVersionSupported(
  version: string,
  minimum: string = MINIMUM_SERVER_VERSION,
): boolean {
  const actual = versionParts(version);
  const required = versionParts(minimum);
  if (actual === null || required === null) return false;
  for (const index of [0, 1, 2] as const) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

export function isCompatibleServer(meta: V1Meta): boolean {
  return meta.contractVersion === CONTRACT_VERSION && isServerVersionSupported(meta.serverVersion);
}
