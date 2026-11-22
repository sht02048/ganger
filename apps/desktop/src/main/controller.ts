import { PRODUCT_DISPLAY_NAME } from "@ganger/cli/home";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  shell,
} from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from "electron";
import { createTranslator } from "use-intl";
import system from "../../messages/ko/system.json" with { type: "json" };
import { DeviceLink, deviceTokenStore, registerDesktop } from "../core/device-link.js";
import type { TokenCipher } from "../core/device-link.js";
import { NotificationFeed } from "../core/notification-feed.js";
import {
  notificationId,
  openEventIdOf,
  serverKey,
  staleNotificationIds,
} from "../core/notification-ids.js";
import type { FeedBatch } from "../core/notification-feed.js";
import { DEFAULT_NOTIFICATION_PREFS, notificationPrefsSchema } from "../core/notification-prefs.js";
import type { DeviceLinkState, NotificationPrefs } from "../core/notification-prefs.js";
import { notificationText } from "../core/notification-text.js";
import { Notifier } from "../core/notifier.js";
import type { NotifierEffect } from "../core/notifier.js";
import { DEFAULT_SERVER_PORT, discoverServers } from "../core/discovery.js";
import { opensOutsideApp } from "../core/external-url.js";
import type { DiscoveryResult, FoundServer } from "../core/discovery.js";
import { probeIdentity } from "../core/identity.js";
import type { EnsureHooks, EnsureResult, LocalServer } from "../core/local-server.js";
import { openLog } from "../core/open-log.js";
import {
  CONNECT_TIMEOUT_MS,
  connectAddress,
  isAwaitingRemote,
  isServerForbidden,
  reopenSaved,
  savedFromFound,
} from "../core/remote.js";
import type { SavedServer } from "../core/remote.js";
import type { SettingsStore } from "../core/settings.js";
import { RunnerEnrollmentFlow } from "../core/runner-enrollment.js";
import type { EnrollmentState } from "../core/runner-enrollment.js";
import {
  OFFER_POLL_MS,
  acceptOffer,
  fetchOffer,
  isServerMac,
  runSetupScript,
} from "../core/runner-offer.js";
import { SHARING_SETTINGS_URL } from "@ganger/app/runner-setup/model";
import { ServerWatch } from "../core/watch.js";
import { FIRST_CHECK_DELAY_MS } from "../core/updater.js";
import type { ServerVersion, Updater } from "../core/updater.js";
import { isUpdateAction } from "@ganger/app/updates/view";
import type { UpdateAction, UpdateView } from "@ganger/app/updates/view";
import type { WatchState } from "../core/watch.js";
import type {
  FindResult,
  NotificationPermission,
  NotificationSettingsView,
  ViewState,
} from "../shared/view.js";
import {
  IPC_PREFIX,
  LOGS_CAN_OPEN,
  LOGS_OPEN,
  NAVIGATE_CHANNEL,
  NOTIFICATION_SETTINGS_CHANNEL,
  NOTIFICATION_SETTINGS_WINDOW,
  UPDATE_ACT,
  UPDATE_CHANNEL,
  UPDATE_GET,
  VIEW_CHANNEL,
} from "../shared/view.js";
import type { NavScreen } from "@ganger/app/shell/nav-shortcuts";
import { canStepHistory, navigationMenu } from "./navigation-menu.js";
import type { HistoryDirection } from "./navigation-menu.js";
import { screenOutlivedServerSwap, viewMenu } from "./view-menu.js";
import {
  diagnosticsDownloadNotice,
  diagnosticsMenuItem,
  logFolderOpenable,
} from "./diagnostics-menu.js";
import { cancelPendingHide, hideWindow } from "./window-close.js";
import { mainWindowOptions, settingsWindowOptions, titleBarCookie } from "./window-options.js";

async function loadServerScreen(window: BrowserWindow, url: string): Promise<void> {
  await Promise.resolve()
    .then(() => window.webContents.session.cookies.set(titleBarCookie(url)))
    .catch(() => undefined);
  await window.loadURL(url).catch(() => undefined);
}

const t = createTranslator({ locale: "ko", messages: { system }, namespace: "system" });

const REMINDER_TICK_MS = 30_000;
const REMOTE_RETRY_MS = 5_000;
const UPDATE_TICK_MS = 10 * 60_000;
const SYSTEM_NOTIFICATION_SETTINGS =
  "x-apple.systempreferences:com.apple.Notifications-Settings.extension";

export interface ControllerOptions {
  settings: SettingsStore;
  local: LocalServer;
  serverVersion: string;
  logFile: string;
  rendererFile: string;
  preloadFile: string;
  trayIcon: string;
  openedAtLogin: boolean;
  updater: Updater;
  devServerUrl: string | undefined;
  tokenCipher: TokenCipher | null;
}

type Mode = "choosing" | "local" | "remote";

export class Controller {
  private readonly options: ControllerOptions;
  private window: BrowserWindow | undefined;
  private tray: Tray | undefined;
  private view: ViewState = { screen: "choose-mode" };
  private mode: Mode = "choosing";
  private serverUrl: string | undefined;
  private readonly watch: ServerWatch;
  private feed: { url: string; feed: NotificationFeed; notifier: Notifier } | undefined;
  private catchUp = true;
  private readonly delivered = new Map<string, Notification>();
  private reminderTimer: NodeJS.Timeout | undefined;
  private notificationPermission: NotificationPermission = "unknown";
  private diagnosticsListener:
    | ((event: Electron.Event, item: Electron.DownloadItem) => void)
    | undefined;
  private settingsWindow: BrowserWindow | undefined;
  private remoteTimer: NodeJS.Timeout | undefined;
  private offerTimer: NodeJS.Timeout | undefined;
  private readonly enrollment: RunnerEnrollmentFlow;
  private found: FoundServer[] = [];
  private remote: { server: SavedServer; reachable: boolean } | undefined;
  private notifiedVersion = false;
  private serverVersion: string | null = null;
  private updateTimer: NodeJS.Timeout | undefined;
  private readonly deviceLink: DeviceLink;
  private deviceLinkState: DeviceLinkState = "connected";
  private deviceRejectedNotice: Notification | undefined;
  quitting = false;

  constructor(options: ControllerOptions) {
    this.options = options;
    this.deviceLink = new DeviceLink({
      store: deviceTokenStore(options.settings, options.tokenCipher),
      identify: async (origin) => {
        const probed = await probeIdentity(origin, CONNECT_TIMEOUT_MS);
        return probed.kind === "ours" ? probed.identity.instanceId : null;
      },
      register: (origin, requestId) =>
        registerDesktop(origin, t("deviceName", { host: hostname() }), requestId),
    });
    this.watch = new ServerWatch(options.local, { onChange: (state) => this.onWatch(state) });
    this.enrollment = new RunnerEnrollmentFlow({
      fetchOffer: (origin) => fetchOffer(origin),
      acceptOffer: (origin, id) => acceptOffer(origin, id),
      runScript: (script, onProgress) => runSetupScript(script, onProgress),
      isServerMac: (server) =>
        isServerMac(server, (origin, timeoutMs) => probeIdentity(origin, timeoutMs), [
          this.options.settings.read().discoveryPort ?? DEFAULT_SERVER_PORT,
        ]),
      onChange: (state, previous) => this.onEnrollment(state, previous),
    });
  }

  start(): void {
    this.registerIpc();
    this.tray = new Tray(nativeImage.createFromPath(this.options.trayIcon));
    this.tray.setToolTip(t("tray.tooltip"));
    this.reminderTimer = setInterval(() => this.tickReminders(), REMINDER_TICK_MS);
    powerMonitor.on("resume", () => {
      this.catchUp = true;
      this.feed?.feed.reconnect();
    });
    this.offerTimer = setInterval(() => void this.pollOffer(), OFFER_POLL_MS);
    this.updateTimer = setTimeout(() => {
      void this.options.updater.tick();
      this.updateTimer = setInterval(() => void this.options.updater.tick(), UPDATE_TICK_MS);
    }, FIRST_CHECK_DELAY_MS);
    const devServerUrl = this.options.devServerUrl;
    if (devServerUrl !== undefined) {
      this.showWindow();
      void this.openDevServer(devServerUrl);
      this.refreshMenus();
      return;
    }
    const settings = this.options.settings.read();
    if (!this.options.openedAtLogin || settings.mode === undefined) this.showWindow();
    switch (settings.mode) {
      case "local":
        void this.startLocal();
        break;
      case "remote":
        if (settings.remote === undefined) void this.chooseRemote();
        else void this.openRemote(settings.remote);
        break;
      case undefined:
        this.setView({ screen: "choose-mode" });
        break;
    }
    this.refreshMenus();
  }

  showWindow(): void {
    const window = this.ensureWindow();
    cancelPendingHide(window);
    window.show();
    window.focus();
  }

  async quitWithServer(): Promise<void> {
    this.watch.stop();
    this.watch.setWanted(false);
    if (this.mode === "local") await this.options.local.stop();
    this.quit();
  }

  quit(): void {
    this.quitting = true;
    this.stopBackground();
    app.quit();
  }

  prepareForInstall(): void {
    this.quitting = true;
    this.stopBackground();
  }

  private stopBackground(): void {
    this.watch.stop();
    if (this.reminderTimer !== undefined) clearInterval(this.reminderTimer);
    this.feed?.feed.stop();
    if (this.offerTimer !== undefined) clearInterval(this.offerTimer);
    if (this.updateTimer !== undefined) clearInterval(this.updateTimer);
    this.enrollment.stop();
    this.stopRemoteRetry();
  }

  sendUpdate(): void {
    const window = this.window;
    if (window === undefined || window.isDestroyed() || this.serverUrl === undefined) return;
    window.webContents.send(UPDATE_CHANNEL, this.updateView());
  }

  private updateView(): UpdateView {
    return this.options.updater.view(this.serverVersionView());
  }

  private serverVersionView(): ServerVersion {
    if (this.mode === "remote") return { kind: "remote", version: this.serverVersion };
    const state = this.watch.state;
    const external = "owner" in state && state.owner === "external";
    return { kind: external ? "external" : "app", version: this.serverVersion };
  }

  private runUpdateAction(action: UpdateAction): void {
    const updater = this.options.updater;
    switch (action) {
      case "restart":
        updater.restart();
        break;
      case "later":
        updater.later();
        break;
      case "dismiss-updated":
        updater.dismissUpdated();
        break;
      case "check-now":
        void updater.checkNow();
        break;
      case "auto-on":
        updater.setAutoUpdate(true);
        break;
      case "auto-off":
        updater.setAutoUpdate(false);
        break;
    }
  }

  private async startLocal(): Promise<void> {
    this.mode = "local";
    this.stopRemoteRetry();
    this.watch.setWanted(true);
    this.setView({ screen: "local-starting" });
    this.refreshMenus();
    const result = await this.options.local.ensureRunning(this.swapHooks());
    this.adoptEnsured(result);
    this.watch.start();
    this.afterEnsure(result);
  }

  private adoptEnsured(result: EnsureResult): void {
    const reloadScreen = screenOutlivedServerSwap(result, this.serverUrl);
    this.watch.adopt(result);
    const window = this.window;
    if (
      reloadScreen &&
      result.kind === "running" &&
      window !== undefined &&
      !window.isDestroyed()
    ) {
      void loadServerScreen(window, new URL("/", result.status.url).toString());
    }
  }

  private swapHooks(): EnsureHooks {
    return {
      onReplacing: ({ from, to }) => this.setView({ screen: "local-updating", from, to }),
    };
  }

  private afterEnsure(result: EnsureResult): void {
    if (result.kind !== "running") return;
    const { status } = result;
    if (status.owner === "external" && status.identity.version !== this.options.serverVersion) {
      this.notifyVersion(status.identity.version);
    }
  }

  private async stopLocal(): Promise<void> {
    this.watch.setWanted(false);
    const result = await this.options.local.stop();
    if (result.ok) this.setView({ screen: "local-stopped" });
    await this.watch.tick();
  }

  private async restartLocal(): Promise<void> {
    this.watch.setWanted(true);
    this.setView({ screen: "local-starting" });
    const result = await this.options.local.ensureRunning(this.swapHooks());
    this.adoptEnsured(result);
    this.afterEnsure(result);
  }

  private onWatch(state: WatchState): void {
    if (this.mode !== "local") return;
    switch (state.kind) {
      case "running":
        this.serverVersion = state.status.identity.version;
        if (this.serverUrl !== state.status.url) this.openServer(state.status.url);
        else this.sendUpdate();
        break;
      case "starting":
        break;
      case "stopped":
        if (state.owner === "external") this.setView({ screen: "local-service" });
        else if (this.view.screen !== "local-starting" && this.view.screen !== "local-updating")
          this.setView({ screen: "local-stopped" });
        break;
      case "failed":
        this.setView({ screen: "local-failed", logFile: this.options.logFile });
        break;
    }
    this.refreshMenus();
  }

  private async chooseRemote(): Promise<void> {
    if (this.options.devServerUrl !== undefined)
      return this.openDevServer(this.options.devServerUrl);
    this.mode = "remote";
    this.stopRemoteRetry();
    this.refreshMenus();
    await this.findServers(this.options.settings.read().discoveryPort ?? DEFAULT_SERVER_PORT);
  }

  private async findServers(port: number): Promise<void> {
    const settings = this.options.settings.read();
    if (port !== (settings.discoveryPort ?? DEFAULT_SERVER_PORT)) {
      this.options.settings.write({ ...settings, discoveryPort: port });
    }
    this.setView({ screen: "find-servers", port, searching: true, result: null });
    const result = await discoverServers({ port });
    this.found = result.kind === "found" ? result.servers : [];
    if (this.view.screen === "find-servers") {
      this.setView({
        screen: "find-servers",
        port,
        searching: false,
        result: this.findView(result),
      });
    }
  }

  private findView(result: DiscoveryResult): FindResult {
    if (result.kind !== "found") return { kind: result.kind };
    return {
      kind: "found",
      servers: result.servers.map((server) => ({
        ...server,
        versionDiffers: server.version !== this.options.serverVersion,
      })),
    };
  }

  private connectFound(instanceId: string): void {
    const server = this.found.find((candidate) => candidate.instanceId === instanceId);
    if (server === undefined || server.webAccess !== "allowed") return;
    this.useRemote(savedFromFound(server));
  }

  private async connectAddress(address: string): Promise<void> {
    this.setView({ screen: "enter-address", checking: true, error: null });
    const result = await connectAddress(address, (origin, timeoutMs) =>
      probeIdentity(origin, timeoutMs),
    );
    if (result.ok) this.useRemote(result.server);
    else this.setView({ screen: "enter-address", checking: false, error: result.reason });
  }

  private useRemote(server: SavedServer): void {
    if (this.options.devServerUrl !== undefined) {
      this.showRemote(server);
      return;
    }
    const settings = this.options.settings.read();
    this.options.settings.write({ ...settings, mode: "remote", remote: server });
    this.showRemote(server);
  }

  private showRemote(server: SavedServer): void {
    this.mode = "remote";
    this.remote = { server, reachable: true };
    this.watch.stop();
    this.serverVersion = null;
    this.openServer(server.url);
    void this.readRemoteVersion(server);
  }

  private async openDevServer(url: string): Promise<void> {
    this.mode = "remote";
    this.stopRemoteRetry();
    const name = new URL(url).host;
    this.setView({ screen: "unreachable", name, url, checking: true });
    const result = await connectAddress(url, (origin, timeoutMs) =>
      probeIdentity(origin, timeoutMs),
    );
    if (result.ok) {
      this.showRemote(result.server);
      return;
    }
    this.setView({ screen: "unreachable", name, url, checking: false });
    this.refreshMenus();
  }

  private async readRemoteVersion(server: SavedServer): Promise<void> {
    const probed = await probeIdentity(server.url, 3_000);
    if (probed.kind !== "ours" || this.remote?.server.instanceId !== server.instanceId) return;
    this.serverVersion = probed.identity.version;
    this.sendUpdate();
  }

  private async openRemote(saved: SavedServer): Promise<void> {
    if (this.options.devServerUrl !== undefined)
      return this.openDevServer(this.options.devServerUrl);
    this.mode = "remote";
    this.remote = { server: saved, reachable: false };
    this.setView(
      this.serverUrl === undefined && this.view.screen === "host-blocked"
        ? { ...this.view, checking: true }
        : { screen: "unreachable", name: saved.name, url: saved.url, checking: true },
    );
    const port = this.options.settings.read().discoveryPort ?? DEFAULT_SERVER_PORT;
    const result = await reopenSaved(saved, {
      probe: (origin, timeoutMs) => probeIdentity(origin, timeoutMs),
      discover: () => discoverServers({ port }),
    });
    if (this.mode !== "remote" || this.remote?.server.instanceId !== saved.instanceId) return;
    if (!isAwaitingRemote(this.view.screen)) return;
    if (result.kind === "open") {
      this.stopRemoteRetry();
      this.useRemote(result.server);
      return;
    }
    this.remote = { server: saved, reachable: false };
    this.setView(
      result.kind === "host-not-allowed"
        ? {
            screen: "host-blocked",
            host: new URL(saved.url).hostname,
            url: saved.url,
            checking: false,
          }
        : { screen: "unreachable", name: saved.name, url: saved.url, checking: false },
    );
    this.refreshMenus();
    this.remoteTimer ??= setInterval(() => {
      const view = this.view;
      const waiting = view.screen === "unreachable" || view.screen === "host-blocked";
      if (waiting && !view.checking && this.remote !== undefined) {
        void this.openRemote(this.remote.server);
      }
    }, REMOTE_RETRY_MS);
  }

  private async showHostBlockedIfRejected(): Promise<void> {
    const server = this.remote?.server;
    if (this.mode !== "remote" || server === undefined) return;
    const probed = await probeIdentity(server.url, CONNECT_TIMEOUT_MS);
    if (this.remote?.server.instanceId !== server.instanceId) return;
    if (this.serverUrl !== server.url) return;
    const stillAllowed =
      probed.kind === "ours" &&
      probed.identity.instanceId === server.instanceId &&
      probed.identity.webAccess === "allowed";
    if (!stillAllowed) await this.openRemote(server);
  }

  private stopRemoteRetry(): void {
    if (this.remoteTimer !== undefined) clearInterval(this.remoteTimer);
    this.remoteTimer = undefined;
  }

  private chooseMode(): void {
    if (this.options.devServerUrl !== undefined) {
      void this.openDevServer(this.options.devServerUrl);
      return;
    }
    this.stopFeed();
    this.mode = "choosing";
    this.stopRemoteRetry();
    this.watch.stop();
    this.setView({ screen: "choose-mode" });
    this.refreshMenus();
  }

  private chooseLocal(openAtLogin: boolean): void {
    if (this.options.devServerUrl !== undefined) return;
    const settings = this.options.settings.read();
    this.options.settings.write({ ...settings, mode: "local", openAtLogin });
    this.applyLoginItem(openAtLogin);
    void this.startLocal();
  }

  private applyLoginItem(openAtLogin: boolean): void {
    if (!app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin });
  }

  private setView(view: ViewState): void {
    this.view = view;
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    if (this.serverUrl !== undefined) {
      this.serverUrl = undefined;
      this.refreshMenus();
      void window.loadFile(this.options.rendererFile);
      return;
    }
    window.webContents.send(VIEW_CHANNEL, view);
  }

  private openServer(url: string, path = "/"): void {
    if (this.feed?.url !== url) this.startFeed(url);
    this.serverUrl = url;
    this.refreshMenus();
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    void loadServerScreen(window, new URL(path, url).toString());
  }

  private ensureWindow(): BrowserWindow {
    if (this.window !== undefined && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow(
      mainWindowOptions(PRODUCT_DISPLAY_NAME, this.options.preloadFile),
    );
    window.once("ready-to-show", () => window.show());
    window.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      hideWindow(window);
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (opensOutsideApp(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (this.isAppScreen(url)) return;
      if (this.serverUrl !== undefined && new URL(url).origin === new URL(this.serverUrl).origin)
        return;
      event.preventDefault();
      if (opensOutsideApp(url)) void shell.openExternal(url);
    });
    window.webContents.on("did-navigate", (_event, url, httpResponseCode) => {
      if (!isServerForbidden(httpResponseCode, url, this.serverUrl)) return;
      void this.showHostBlockedIfRejected();
    });
    window.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || this.isAppScreen(url)) return;
      if (this.mode === "remote" && this.remote !== undefined)
        void this.openRemote(this.remote.server);
      else if (this.mode === "local") void this.watch.tick();
    });
    this.window = window;
    if (this.serverUrl !== undefined) void loadServerScreen(window, this.serverUrl);
    else void window.loadFile(this.options.rendererFile);
    return window;
  }

  private isAppScreen(url: string): boolean {
    return url.startsWith("file:");
  }

  private registerIpc(): void {
    const fromAppScreen = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
      event.senderFrame !== null && this.isAppScreen(event.senderFrame.url);
    const handle = (action: string, run: (...args: unknown[]) => unknown): void => {
      ipcMain.handle(`${IPC_PREFIX}${action}`, async (event, ...args: unknown[]) => {
        if (!fromAppScreen(event)) return;
        await run(...args);
      });
    };
    ipcMain.on(`${IPC_PREFIX}request-view`, (event) => {
      if (fromAppScreen(event)) event.sender.send(VIEW_CHANNEL, this.view);
    });
    handle("choose-local", (options) =>
      this.chooseLocal(
        typeof options === "object" && options !== null && "openAtLogin" in options
          ? options.openAtLogin !== false
          : true,
      ),
    );
    handle("choose-remote", () => this.chooseRemote());
    handle("find-servers", (port) =>
      this.findServers(
        typeof port === "number" && Number.isInteger(port) ? port : DEFAULT_SERVER_PORT,
      ),
    );
    handle("connect-found", (instanceId) => {
      if (typeof instanceId === "string") this.connectFound(instanceId);
    });
    handle("show-address", () =>
      this.setView({ screen: "enter-address", checking: false, error: null }),
    );
    handle("connect-address", (address) =>
      typeof address === "string" ? this.connectAddress(address) : undefined,
    );
    handle("start-local", () => this.restartLocal());
    handle("retry", () => {
      if (this.mode === "local") return this.restartLocal();
      if (this.options.devServerUrl !== undefined)
        return this.openDevServer(this.options.devServerUrl);
      if (this.remote !== undefined) return this.openRemote(this.remote.server);
      return this.chooseRemote();
    });
    handle("choose-mode", () => this.chooseMode());
    handle("open-log", () => this.openLog());
    ipcMain.handle(`${IPC_PREFIX}get-notification-settings`, (event) =>
      fromAppScreen(event) ? this.notificationSettingsView() : undefined,
    );
    handle("set-notification-settings", (value) => {
      const parsed = notificationPrefsSchema.safeParse(value);
      if (parsed.success) this.saveNotificationPrefs(parsed.data);
    });
    handle("open-system-notification-settings", () =>
      process.platform === "darwin" ? shell.openExternal(SYSTEM_NOTIFICATION_SETTINGS) : undefined,
    );
    handle("reconnect-device", () => this.reconnectDevice());
    handle("enrollment-accept", () => {
      void this.enrollment.accept();
    });
    handle("enrollment-cancel", () => this.enrollment.cancel());
    handle("enrollment-close", () => this.enrollment.close());
    handle("open-sharing", () => shell.openExternal(SHARING_SETTINGS_URL));
    ipcMain.handle(
      LOGS_CAN_OPEN,
      (event) => this.fromServerPage(event) && logFolderOpenable(this.mode),
    );
    ipcMain.handle(LOGS_OPEN, (event) =>
      this.fromServerPage(event) && logFolderOpenable(this.mode) ? this.openLogFolder() : false,
    );
    ipcMain.handle(UPDATE_GET, (event) => (this.fromServerPage(event) ? this.updateView() : null));
    ipcMain.handle(UPDATE_ACT, (event, action: unknown) => {
      if (this.fromServerPage(event) && isUpdateAction(action)) this.runUpdateAction(action);
    });
  }

  private fromServerPage(event: IpcMainInvokeEvent): boolean {
    const window = this.window;
    const serverUrl = this.serverUrl;
    if (window === undefined || window.isDestroyed() || serverUrl === undefined) return false;
    if (event.sender !== window.webContents || event.senderFrame === null) return false;
    try {
      return new URL(event.senderFrame.url).origin === new URL(serverUrl).origin;
    } catch {
      return false;
    }
  }

  private pollOffer(): Promise<void> {
    const remote =
      this.mode === "remote" && this.remote?.reachable === true ? this.remote : undefined;
    return this.enrollment.tick(remote?.server);
  }

  private onEnrollment(state: EnrollmentState | null, previous: EnrollmentState | null): void {
    if (state === null) {
      if (this.view.screen !== "runner-enrollment") return;
      if (this.mode === "remote" && this.remote !== undefined) {
        const path = previous?.step.phase === "registered" ? "/runners" : "/";
        if (this.remote.reachable) this.openServer(this.remote.server.url, path);
        else void this.openRemote(this.remote.server);
      } else {
        this.chooseMode();
      }
      return;
    }
    this.setView({ screen: "runner-enrollment", server: state.server, enrollment: state.step });
    if (previous?.offerId === state.offerId) return;
    const focused = this.window?.isFocused() === true;
    this.showWindow();
    if (!focused) this.notifyEnrollment(state.server);
  }

  private notifyEnrollment(server: string): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: t("notifications.runnerEnrollment.title"),
      body: t("notifications.runnerEnrollment.body", { server }),
    });
    notification.on("click", () => this.showWindow());
    notification.show();
  }

  private openLog(): Promise<void> {
    return openLog(this.options.logFile, {
      exists: existsSync,
      openPath: (path) => shell.openPath(path),
      showItemInFolder: (path) => shell.showItemInFolder(path),
    });
  }

  private async openLogFolder(): Promise<boolean> {
    const error = await shell.openPath(dirname(this.options.logFile));
    return error === "";
  }

  private downloadDiagnostics(url: string): void {
    this.showWindow();
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    const session = window.webContents.session;
    if (this.diagnosticsListener !== undefined) {
      session.off("will-download", this.diagnosticsListener);
    }
    const onDownload = (_event: Electron.Event, item: Electron.DownloadItem) => {
      if (item.getURL() !== url) return;
      session.off("will-download", onDownload);
      this.diagnosticsListener = undefined;
      item.once("done", (_done, state) => {
        const notice = diagnosticsDownloadNotice(state);
        if (notice === null || window.isDestroyed()) return;
        void dialog.showMessageBox(window, {
          type: notice === "saved" ? "info" : "warning",
          message: t(`diagnostics.${notice}`),
        });
      });
    };
    this.diagnosticsListener = onDownload;
    session.on("will-download", onDownload);
    window.webContents.downloadURL(url);
  }

  private notificationPrefs(): NotificationPrefs {
    return this.options.settings.read().notifications ?? DEFAULT_NOTIFICATION_PREFS;
  }

  private startFeed(url: string): void {
    this.stopFeed();
    const notifier = new Notifier({
      prefs: () => this.notificationPrefs(),
      lastSeen: this.options.settings.read().notificationsSeen?.[url] ?? null,
    });
    const feed = new NotificationFeed({
      origin: url,
      onBatch: (batch) => this.receiveNotifications(url, batch),
      connection: () => this.deviceLink.connection(url),
      onRejected: () => this.onDeviceRejected(url),
    });
    this.feed = { url, feed, notifier };
    this.setDeviceLinkState("connected");
    feed.start();
  }

  private onDeviceRejected(url: string): void {
    if (this.feed?.url !== url || this.deviceLinkState === "reconnecting") return;
    const firstNotice =
      this.deviceLinkState === "connected" || this.deviceLinkState === "reconnected";
    this.setDeviceLinkState("rejected");
    if (firstNotice) this.notifyDeviceRejected();
  }

  private notifyDeviceRejected(): void {
    if (!Notification.isSupported() || !this.notificationPrefs().enabled) return;
    const notification = new Notification({
      title: t("notifications.deviceRejected.title"),
      body: t("notifications.deviceRejected.body"),
    });
    notification.on("click", () => {
      this.deviceRejectedNotice = undefined;
      this.showNotificationSettings();
    });
    this.deviceRejectedNotice = notification;
    notification.show();
  }

  private async reconnectDevice(): Promise<void> {
    const current = this.feed;
    if (current === undefined || this.deviceLinkState === "reconnecting") return;
    this.setDeviceLinkState("reconnecting");
    const connected = await this.deviceLink.reconnect(current.url).catch(() => false);
    if (this.feed !== current) return;
    this.setDeviceLinkState(connected ? "reconnected" : "failed");
    if (connected) current.feed.reconnect();
  }

  private setDeviceLinkState(state: DeviceLinkState): void {
    if (this.deviceLinkState === state) return;
    this.deviceLinkState = state;
    this.sendNotificationSettings();
    this.refreshMenus();
  }

  private stopFeed(): void {
    const current = this.feed;
    if (current === undefined) return;
    this.feed = undefined;
    this.setDeviceLinkState("connected");
    current.feed.stop();
    this.applyNotifications(current.url, current.notifier.clear());
  }

  private receiveNotifications(url: string, batch: FeedBatch): void {
    const current = this.feed;
    if (current?.url !== url) return;
    const mode = batch.initial && this.catchUp ? "catch-up" : "live";
    if (batch.initial) this.catchUp = false;
    this.applyNotifications(url, current.notifier.receive(batch, mode, Date.now()));
    if (batch.initial && batch.open !== null) void this.removeStaleNotifications(url, batch.open);
  }

  private tickReminders(): void {
    const current = this.feed;
    if (current === undefined) return;
    this.applyNotifications(current.url, current.notifier.tick(Date.now()));
  }

  private applyNotifications(url: string, effects: ReadonlyArray<NotifierEffect>): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "show":
          this.showNotification(url, effect);
          break;
        case "remove":
          this.removeNotifications(effect.ids.map((id) => notificationId(url, id)));
          break;
        case "badge":
          app.setBadgeCount(effect.count);
          break;
        case "seen": {
          const settings = this.options.settings.read();
          this.options.settings.write({
            ...settings,
            notificationsSeen: { ...settings.notificationsSeen, [url]: effect.lastId },
          });
          break;
        }
      }
    }
  }

  private showNotification(url: string, effect: Extract<NotifierEffect, { type: "show" }>): void {
    if (!Notification.isSupported()) return;
    const id = notificationId(url, effect.id);
    const { title, body } = notificationText(effect.content);
    this.delivered.get(id)?.close();
    const notification = new Notification({
      id,
      groupId: serverKey(url),
      title,
      body,
    });
    notification.on("click", () => {
      this.delivered.delete(id);
      this.showWindow();
      if (this.view.screen === "runner-enrollment") return;
      if (this.serverUrl === url || this.feed?.url === url) this.openServer(url, effect.path);
    });
    notification.on("show", () => this.setNotificationPermission("allowed"));
    notification.on("failed", () => this.setNotificationPermission("denied"));
    this.delivered.set(id, notification);
    notification.show();
  }

  private removeNotifications(ids: ReadonlyArray<string>): void {
    for (const id of ids) {
      this.delivered.get(id)?.close();
      this.delivered.delete(id);
    }
    if (process.platform === "darwin" && ids.length > 0) Notification.remove([...ids]);
  }

  private async removeStaleNotifications(url: string, open: ReadonlyArray<number>): Promise<void> {
    if (process.platform !== "darwin") return;
    const history = await Notification.getHistory().catch(() => []);
    const stale = staleNotificationIds(
      url,
      history.map((notification) => notification.id),
      open,
      new Set(this.delivered.keys()),
    );
    if (stale.length > 0) Notification.remove(stale);
    const staleSet = new Set(stale);
    for (const notification of history) {
      const eventId = openEventIdOf(url, notification.id);
      if (eventId === null || staleSet.has(notification.id)) continue;
      if (this.delivered.has(notification.id)) continue;
      notification.on("click", () => {
        const path = this.feed?.url === url ? this.feed.notifier.openPath(eventId) : undefined;
        this.delivered.delete(notification.id);
        this.showWindow();
        if (this.view.screen === "runner-enrollment") return;
        if (path !== undefined) this.openServer(url, path);
      });
      this.delivered.set(notification.id, notification);
    }
  }

  private setNotificationPermission(permission: NotificationPermission): void {
    if (this.notificationPermission === permission) return;
    this.notificationPermission = permission;
    this.sendNotificationSettings();
  }

  private notificationSettingsView(): NotificationSettingsView {
    return {
      ...this.notificationPrefs(),
      permission: this.notificationPermission,
      deviceLink: this.deviceLinkState,
    };
  }

  private sendNotificationSettings(): void {
    const window = this.settingsWindow;
    if (window === undefined || window.isDestroyed()) return;
    window.webContents.send(NOTIFICATION_SETTINGS_CHANNEL, this.notificationSettingsView());
  }

  private saveNotificationPrefs(prefs: NotificationPrefs): void {
    this.options.settings.write({ ...this.options.settings.read(), notifications: prefs });
    const current = this.feed;
    if (current !== undefined) this.applyNotifications(current.url, current.notifier.refresh());
    this.sendNotificationSettings();
  }

  showNotificationSettings(): void {
    const existing = this.settingsWindow;
    if (existing !== undefined && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }
    const window = new BrowserWindow(
      settingsWindowOptions(t("settingsWindow.title"), this.options.preloadFile),
    );
    window.once("ready-to-show", () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("closed", () => {
      if (this.settingsWindow === window) this.settingsWindow = undefined;
    });
    this.settingsWindow = window;
    void window.loadFile(this.options.rendererFile, {
      query: { window: NOTIFICATION_SETTINGS_WINDOW },
    });
  }

  private notifyVersion(server: string): void {
    if (this.notifiedVersion || !Notification.isSupported()) return;
    this.notifiedVersion = true;
    new Notification({
      title: t("notifications.versionDiffers.title"),
      body: t("notifications.versionDiffers.body", { server, app: this.options.serverVersion }),
    }).show();
  }

  private refreshMenus(): void {
    const items = this.menuItems();
    this.tray?.setContextMenu(Menu.buildFromTemplate(items));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: "about" },
            {
              id: "notification-settings",
              label: t("menu.notificationSettings"),
              click: () => this.showNotificationSettings(),
            },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { type: "separator" },
            {
              id: "quit",
              label: t("tray.quit"),
              accelerator: "CommandOrControl+Q",
              click: () => this.quit(),
            },
          ],
        },
        { label: t("menu.edit"), role: "editMenu" },
        viewMenu({ label: t("menu.view"), reloadLabel: t("menu.reload") }),
        navigationMenu({
          label: t("menu.navigate"),
          screenLabel: (screen) => t(`navigate.${screen}`),
          backLabel: t("navigate.back"),
          forwardLabel: t("navigate.forward"),
          enabled: this.serverUrl !== undefined,
          onNavigate: (screen) => this.navigateTo(screen),
          onHistory: (direction) => this.stepHistory(direction),
        }),
        { label: t("menu.server"), submenu: items },
        { label: t("menu.window"), role: "windowMenu" },
      ]),
    );
  }

  private stepHistory(direction: HistoryDirection): void {
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    const history = window.webContents.navigationHistory;
    const allowed = canStepHistory(
      {
        activeIndex: history.getActiveIndex(),
        length: history.length(),
        urlAt: (index) => history.getEntryAtIndex(index).url,
      },
      direction,
      this.serverUrl,
    );
    if (!allowed) return;
    if (direction === "back") history.goBack();
    else history.goForward();
  }

  private navigateTo(screen: NavScreen): void {
    const window = this.window;
    if (this.serverUrl === undefined || window === undefined || window.isDestroyed()) return;
    this.showWindow();
    window.webContents.send(NAVIGATE_CHANNEL, screen);
  }

  private menuItems(): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [
      { id: "status", label: this.statusLabel(), enabled: false },
    ];
    const versionLine = this.versionLine();
    if (versionLine !== undefined) items.push({ label: versionLine, enabled: false });
    items.push(
      { type: "separator" },
      { id: "open", label: t("tray.open"), click: () => this.showWindow() },
      {
        id: "tray-notification-settings",
        label: t("menu.notificationSettings"),
        click: () => this.showNotificationSettings(),
      },
    );
    if (this.deviceLinkState === "rejected" || this.deviceLinkState === "failed") {
      items.push({
        id: "reconnect-device",
        label: t("menu.reconnectDevice"),
        click: () => void this.reconnectDevice(),
      });
    }

    const state = this.watch.state;
    const owned = this.mode === "local" && !("owner" in state && state.owner === "external");
    if (owned) {
      const running = state.kind === "running" || state.kind === "starting";
      items.push(
        running
          ? { id: "server-stop", label: t("tray.stopServer"), click: () => void this.stopLocal() }
          : {
              id: "server-start",
              label: t("tray.startServer"),
              click: () => void this.restartLocal(),
            },
      );
    }
    if (this.mode === "local") {
      const openAtLogin = this.options.settings.read().openAtLogin ?? true;
      items.push({
        id: "open-at-login",
        label: t("tray.openAtLogin"),
        type: "checkbox",
        checked: openAtLogin,
        click: (item) => {
          this.options.settings.write({
            ...this.options.settings.read(),
            openAtLogin: item.checked,
          });
          this.applyLoginItem(item.checked);
        },
      });
    }
    if (this.mode === "remote" && this.options.devServerUrl === undefined) {
      items.push({
        id: "choose-server",
        label: t("tray.chooseServer"),
        click: () => {
          this.showWindow();
          void this.chooseRemote();
        },
      });
    }
    items.push(
      diagnosticsMenuItem({
        label: t("menu.makeDiagnostics"),
        serverUrl: this.serverUrl,
        download: (url) => this.downloadDiagnostics(url),
      }),
      {
        id: "change-mode",
        label: t("tray.changeMode"),
        click: () => {
          this.showWindow();
          this.chooseMode();
        },
      },
      { type: "separator" },
      { id: "quit-app", label: t("tray.quit"), click: () => this.quit() },
    );
    if (owned) {
      items.push({
        id: "quit-with-server",
        label: t("tray.quitWithServer"),
        click: () => void this.quitWithServer(),
      });
    }
    return items;
  }

  private statusLabel(): string {
    if (this.mode === "choosing") return t("tray.status.choosing");
    if (this.mode === "remote") {
      const name = this.remote?.server.name ?? "";
      return this.remote?.reachable === true
        ? t("tray.status.remote", { name })
        : t("tray.status.remoteUnreachable", { name });
    }
    const state = this.watch.state;
    switch (state.kind) {
      case "running":
        return state.owner === "external" ? t("tray.status.external") : t("tray.status.running");
      case "starting":
        return t("tray.status.starting");
      case "stopped":
        return state.owner === "external"
          ? t("tray.status.externalStopped")
          : t("tray.status.stopped");
      case "failed":
        return t("tray.status.failed");
    }
  }

  private versionLine(): string | undefined {
    const state = this.watch.state;
    if (this.mode !== "local" || state.kind !== "running" || state.owner !== "external")
      return undefined;
    const server = state.status.identity.version;
    if (server === this.options.serverVersion) return undefined;
    return t("tray.versionDiffers", { server, app: this.options.serverVersion });
  }
}

export function appPaths(base: string): {
  rendererFile: string;
  preloadFile: string;
  trayIcon: string;
} {
  return {
    rendererFile: join(base, "dist", "renderer", "index.html"),
    preloadFile: join(base, "dist", "preload", "preload.cjs"),
    trayIcon: join(base, "assets", "trayTemplate.png"),
  };
}
