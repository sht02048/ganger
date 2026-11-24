import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PRODUCT_DISPLAY_NAME, resolveHome } from "@ganger/cli/home";
import { app, dialog, safeStorage } from "electron";
import { useConsoleLogger } from "@ganger/log";
import { z } from "zod";
import { bundlelessServer, devServerUrl } from "../core/dev-server.js";
import type { TokenCipher } from "../core/device-link.js";
import { LocalServer, fileRecordStore } from "../core/local-server.js";
import { notificationAddonPath, notificationAddonPort } from "../core/notification-addon.js";
import { SERVER_BUNDLE_ENV, loadServerBundle } from "../core/server-bundle.js";
import { serviceInstalledFor } from "../core/service.js";
import { fileSettingsStore } from "../core/settings.js";
import type { SettingsStore } from "../core/settings.js";
import { releasesApiUrl } from "@ganger/app/updates/releases";
import { UPDATE_CONFIG_FILE, fetchReleases, updateRepository } from "../core/update-config.js";
import { Updater } from "../core/updater.js";
import type { UpdateStore } from "../core/updater.js";
import { Controller, appPaths } from "./controller.js";
import { installBlock, squirrelInstaller } from "./update-installer.js";

useConsoleLogger("desktop");

const USER_DATA_ENV = "GANGER_DESKTOP_USER_DATA";

const userData = process.env[USER_DATA_ENV]?.trim();
if (userData !== undefined && userData.length > 0) app.setPath("userData", resolve(userData));

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  let controller: Controller | undefined;
  app.on("second-instance", () => controller?.showWindow());
  app.on("activate", () => controller?.showWindow());
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", () => {
    if (controller !== undefined) controller.quitting = true;
  });

  void app.whenReady().then(() => {
    let bundle;
    let devServer;
    try {
      devServer = app.isPackaged ? undefined : devServerUrl(process.env);
      bundle =
        devServer === undefined
          ? loadServerBundle(serverBundleRoot())
          : bundlelessServer(app.getVersion());
    } catch (error) {
      dialog.showErrorBox(
        PRODUCT_DISPLAY_NAME,
        error instanceof Error ? error.message : String(error),
      );
      app.exit(1);
      return;
    }
    const home = resolveHome(undefined, process.env, homedir());
    const data = app.getPath("userData");
    const logFile = join(home, "logs", "desktop-server.log");
    const local = new LocalServer({
      home,
      bundle,
      node: { command: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
      bundleRoot: bundle.root,
      records: fileRecordStore(join(data, "server-process.json")),
      logFile,
      serviceInstalled: () => serviceInstalledFor(home, homedir()),
    });
    const settings = fileSettingsStore(join(data, "settings.json"));
    const updater = new Updater({
      currentVersion: app.getVersion(),
      arch: process.arch,
      repository: updateRepository(
        app.isPackaged ? join(process.resourcesPath, UPDATE_CONFIG_FILE) : null,
        process.env,
      ),
      fetchReleases: (repository) => fetchReleases(releasesApiUrl(repository)),
      installer: squirrelInstaller({
        downloaded: () => updater.downloaded(),
        failed: () => updater.failed(),
        beforeInstall: () => controller?.prepareForInstall(),
      }),
      blocked: installBlock,
      store: updateStore(settings),
      now: () => new Date(),
      onChange: () => controller?.sendUpdate(),
    });
    controller = new Controller({
      settings,
      updater,
      local,
      serverVersion: bundle.version,
      devServerUrl: devServer,
      tokenCipher: devServer === undefined ? safeStorageCipher : null,
      logFile,
      ...appPaths(app.getAppPath()),
      notificationPort: process.platform === "darwin" ? loadNotificationPort() : null,
      packaged: app.isPackaged,
      openedAtLogin: app.getLoginItemSettings().wasOpenedAtLogin === true,
    });
    controller.start();
  });
}

const safeStorageCipher: TokenCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
  decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed, "base64")),
};

function loadNotificationPort() {
  const path = notificationAddonPath({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  return notificationAddonPort((): unknown => createRequire(import.meta.url)(path));
}

function serverBundleRoot(): string {
  const override = process.env[SERVER_BUNDLE_ENV]?.trim();
  if (override !== undefined && override.length > 0) return resolve(override);
  if (app.isPackaged) return join(process.resourcesPath, "server");
  const repo = resolve(app.getAppPath(), "..", "..");
  const version = z
    .object({ version: z.string() })
    .safeParse(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")));
  const named = join(repo, "dist", `ganger-${version.success ? version.data.version : "0.0.0"}`);
  if (existsSync(named)) return named;
  const any = existsSync(join(repo, "dist"))
    ? readdirSync(join(repo, "dist")).find(
        (name) => /^ganger-[^/]+$/.test(name) && !name.endsWith(".tar.gz"),
      )
    : undefined;
  return any === undefined ? named : join(repo, "dist", any);
}

function updateStore(settings: SettingsStore): UpdateStore {
  return {
    read: () => settings.read().updates ?? {},
    write: (updates) => settings.write({ ...settings.read(), updates }),
  };
}
