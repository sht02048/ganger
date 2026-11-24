import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NOTIFICATION_ADDON_FILE } from "../src/core/notification-addon.ts";

const DESKTOP = resolve(import.meta.dirname, "..");
const SOURCE = join(DESKTOP, "native", "notification-permission.mm");
const NAPI_VERSION = "8";
const MACOS_MIN = "12.0";

export const DEV_ADDON_DIR = join(DESKTOP, "dist", "native");

export function nodeIncludeDir(execPath: string = process.execPath): string {
  return join(dirname(dirname(execPath)), "include", "node");
}

export function addonCompileArgs(output: string, arch: string, includeDir: string): string[] {
  return [
    "clang++",
    "-std=c++17",
    "-ObjC++",
    "-fobjc-arc",
    "-O2",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-arch",
    arch === "x64" ? "x86_64" : arch,
    `-mmacosx-version-min=${MACOS_MIN}`,
    `-DNAPI_VERSION=${NAPI_VERSION}`,
    "-DNODE_GYP_MODULE_NAME=notification_permission",
    "-I",
    includeDir,
    "-framework",
    "Foundation",
    "-framework",
    "Security",
    "-framework",
    "UserNotifications",
    "-o",
    output,
    SOURCE,
  ];
}

export function buildNotificationAddon(outDir: string, arch: string = process.arch): string {
  const includeDir = nodeIncludeDir();
  if (!existsSync(join(includeDir, "node_api.h"))) {
    throw new Error(`${includeDir}/node_api.h not found. Use a Node install that ships headers.`);
  }
  mkdirSync(outDir, { recursive: true });
  const output = join(outDir, NOTIFICATION_ADDON_FILE);
  const result = spawnSync("xcrun", addonCompileArgs(output, arch, includeDir), {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`notification addon build exited with ${result.status ?? "unknown"}`);
  }
  return output;
}

if (import.meta.main) {
  if (process.platform !== "darwin") {
    console.log("notification addon: skipped (macOS only)");
  } else {
    console.log(`notification addon: ${buildNotificationAddon(DEV_ADDON_DIR)}`);
  }
}
