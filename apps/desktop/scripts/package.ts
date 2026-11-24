import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { packager } from "@electron/packager";
import { ELECTRON_LICENSES, findAppProblems, NOTICE_FILE } from "../../../scripts/bundle-check.ts";
import { readManifests, renderNotices, THIRD_PARTY_DIR } from "../../../scripts/third-party.ts";
import { appIconPaths } from "../src/core/app-icon.ts";
import { NOTIFICATION_ADDON_FILE } from "../src/core/notification-addon.ts";
import { UPDATE_CONFIG_FILE, updateConfigJson } from "../src/core/update-config.ts";
import { buildNotificationAddon } from "./native-addon.ts";

const DESKTOP = resolve(import.meta.dirname, "..");
const REPO = resolve(DESKTOP, "..", "..");
const PRODUCT = "Ganger";
const MAIN_ENTITLEMENTS = join(DESKTOP, "entitlements.mac.plist");

const { values } = parseArgs({
  options: {
    arch: { type: "string" },
    bundle: { type: "string" },
    out: { type: "string" },
    "sign-identity": { type: "string" },
    keychain: { type: "string" },
    "update-repository": { type: "string" },
  },
});

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

function stringField(json: Record<string, unknown>, key: string): string {
  const value = json[key];
  if (typeof value !== "string") throw new Error(`${key} missing`);
  return value;
}

const version = stringField(readJson(join(REPO, "package.json")), "version");
const electronVersion = stringField(
  readJson(join(DESKTOP, "node_modules", "electron", "package.json")),
  "version",
);
const bundleDir = resolve(values.bundle ?? join(REPO, "dist", `ganger-${version}`));
for (const required of [
  join(DESKTOP, "dist", "main", "main.js"),
  join(DESKTOP, "dist", "preload", "preload.cjs"),
  join(DESKTOP, "dist", "renderer", "index.html"),
  join(bundleDir, "cli", "bin", "cli.js"),
]) {
  if (!existsSync(required)) {
    console.error(
      `${required} not found. Run pnpm build && pnpm run bundle at the repository root first.`,
    );
    process.exit(1);
  }
}

const work = join(DESKTOP, "dist", "package");
const stage = join(work, "app");
const resources = join(work, "resources");
const out = resolve(values.out ?? join(DESKTOP, "dist", "app"));
rmSync(work, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(resources, { recursive: true });

for (const dir of ["main", "preload", "renderer"]) {
  cpSync(join(DESKTOP, "dist", dir), join(stage, "dist", dir), { recursive: true });
}
cpSync(join(DESKTOP, "assets"), join(stage, "assets"), { recursive: true });
writeFileSync(
  join(stage, "package.json"),
  `${JSON.stringify(
    {
      name: "ganger-desktop",
      productName: PRODUCT,
      version,
      type: "module",
      main: "dist/main/main.js",
      license: "MIT",
    },
    null,
    2,
  )}\n`,
);
cpSync(bundleDir, join(resources, "server"), { recursive: true });
const updateRepository = values["update-repository"];
if (updateRepository !== undefined) {
  writeFileSync(join(resources, UPDATE_CONFIG_FILE), updateConfigJson(updateRepository));
}
console.log(`update feed: ${updateRepository ?? "none (this app will not check for updates)"}`);
writeFileSync(
  join(resources, NOTICE_FILE),
  renderNotices(PRODUCT, readManifests([join(DESKTOP, "dist", THIRD_PARTY_DIR)])),
);

const arch = values.arch ?? process.arch;
buildNotificationAddon(resources, arch);
console.log(`notification addon: ${NOTIFICATION_ADDON_FILE} (${arch})`);

const actool = spawnSync("actool", ["--version"], { encoding: "utf8" });
const icon = appIconPaths(join(DESKTOP, "icons"), actool.status === 0 ? actool.stdout : null);
console.log(`app icon: ${icon.map((path) => basename(path)).join(", ")}`);

const signIdentity = values["sign-identity"];
const osxSign =
  signIdentity === undefined
    ? undefined
    : {
        identity: signIdentity,
        continueOnError: false,
        optionsForFile: (filePath: string) =>
          basename(filePath).startsWith(`${PRODUCT} Helper`)
            ? {}
            : { entitlements: MAIN_ENTITLEMENTS },
        ...(values.keychain === undefined ? {} : { keychain: values.keychain }),
      };
function copyElectronLicenses({ buildPath }: { buildPath: string }): void {
  const resources = join(buildPath, `${PRODUCT}.app`, "Contents", "Resources");
  const [electronLicense, chromiumLicenses] = ELECTRON_LICENSES;
  cpSync(join(buildPath, "LICENSE"), join(resources, electronLicense));
  cpSync(join(buildPath, chromiumLicenses), join(resources, chromiumLicenses));
}

const [appDir] = await packager({
  dir: stage,
  out,
  name: PRODUCT,
  platform: "darwin",
  arch,
  electronVersion,
  appVersion: version,
  appBundleId: "dev.ganger.desktop",
  appCategoryType: "public.app-category.developer-tools",
  icon,
  asar: true,
  extraResource: [
    join(resources, "server"),
    join(resources, NOTICE_FILE),
    join(resources, NOTIFICATION_ADDON_FILE),
    ...(updateRepository === undefined ? [] : [join(resources, UPDATE_CONFIG_FILE)]),
  ],
  overwrite: true,
  prune: false,
  afterCopyExtraResources: [copyElectronLicenses],
  osxSign,
});
if (appDir === undefined) throw new Error("packager produced nothing");

const appPath = join(appDir, `${PRODUCT}.app`);
const appResources = join(appPath, "Contents", "Resources");
const problems = findAppProblems(appResources);
if (problems.length > 0) {
  console.error(`app check failed:\n${problems.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}
const zip = join(out, `${PRODUCT}-${version}-darwin-${arch}.zip`);
const ditto = spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zip], {
  stdio: "inherit",
});
if (ditto.status !== 0) throw new Error(`ditto exited with ${ditto.status ?? "unknown"}`);
rmSync(work, { recursive: true, force: true });

console.log(`app: ${appPath}`);
console.log(`zip: ${zip}`);
console.log(
  `server bundle: ${readdirSync(join(appPath, "Contents", "Resources", "server")).join(", ")}`,
);
