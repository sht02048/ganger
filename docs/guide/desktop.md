# Desktop app (macOS)

`apps/desktop` is an Electron app with a window, a menu bar (tray) icon, and notifications. Its window shows the same web app.

## Install

1. Download `Ganger-<version>-arm64.dmg` from the Releases page of this repository on GitHub. The app runs on Macs with Apple silicon.
2. Open the dmg and drag **Ganger** onto **Applications**.
3. Open Ganger from Applications. Release builds are signed with a Developer ID and notarized by Apple, so macOS opens them without a warning.

## First launch

The app asks how you want to use it:

- **이 기계에서 서버 돌리기** (run the server on this machine): the app runs `init` if needed, starts the server, and opens onboarding. It also asks whether to start the server when you log in (on by default).
- **다른 서버에 붙기** (connect to another server): the app lists the orchestrator servers in your Tailscale tailnet. It reads the device list from the Tailscale app already signed in on this Mac (`tailscale status --json`; no extra sign-in) and asks each online device `http://<device>:3000/api/identity`, then `https://<device>/api/identity`. Pick a server to open it. If Tailscale is not installed or not running, or the server uses another port, enter the port or the server's address (the address shown in that server's Settings > **모바일** (mobile)). The app remembers the server and opens it next time; if it cannot reach it, it shows that and opens the server as soon as it answers again.

To open the server from another Mac, turn on **휴대폰에서 이 Mac 열기** (open this Mac from your phone) in the server's Settings > **모바일** (mobile). It serves the app with Tailscale Serve over HTTPS on the device's MagicDNS name, as described in [Open it from your phone](networking.md#open-it-from-your-phone).

The app shows a notification when an agent asks a question or waits for a permission, a run Failed or is Disconnected, and when a runner has a Runner Issue (Offline, broken GitHub authentication, or a provider usage limit). The server records these as notification events. The app registers itself as a device to get a device token, and keeps a Server-Sent Events connection to `GET /api/v1/notification-events/stream` with that token (it falls back to polling `GET /api/v1/notification-events` every 5 seconds when the stream is not available). When an event is resolved elsewhere (the web screen or another Mac), the app removes its notification. The Dock badge shows the number of To do items. Choose which notifications this Mac shows in Settings > **알림** (notifications); **알림 설정…** (notification settings) in the app menu or the tray opens that page in the main window. Do Not Disturb follows macOS Focus. A server older than v0.5.0 has no `/api/v1` routes, so the app cannot get notifications from it: it says so once and shows the same notice in Settings > **알림** until you update the server and reconnect. Since v0.6.0 the server no longer answers the old `/api/notification-events` and `/api/attention` routes, so desktop apps older than v0.5.0 get no notifications from it.

## Which setup to choose

- **A machine that is always on** (a desktop or a server): run the orchestrator as a service, as described in [Run as a service](self-hosting.md#run-as-a-service). launchd or systemd keeps it running and restarts it after a failure.
- **Your laptop**: use the desktop app's local mode (**이 기계에서 서버 돌리기**, run the server on this machine). The app starts the server in the background, separate from the app itself. Closing or quitting the app leaves the server running; only **서버도 끄고 종료** (quit and stop the server) in the tray menu stops it. **서버 멈추기** and **서버 켜기** stop and start it without quitting. While the app is open, it restarts the server if it crashes. When the laptop sleeps, the server sleeps too, so runs are only watched while the laptop is awake.
- **Another machine already runs the orchestrator**: use the desktop app's remote mode (**다른 서버에 붙기**, connect to another server) to open it and get notifications. The tray then only shows whether the server is reachable.

On a machine where the service is already installed or running for the same installation folder, the app does not start a second server: it connects to the service and only shows its status. If the service runs a different version than the app, the app tells you once.

The app uses the same installation folder as the CLI (`~/.ganger`, or `GANGER_HOME`). It writes the server's output to `<home>/logs/desktop-server.log`.

## Updates

The app checks the Releases of the repository it was built from every six hours, downloads a newer version in the background, and then asks in the lower-right corner of the window. Choose **다시 시작** (restart) to update now, or **나중에** (later) to update the next time you quit the app. When the new app opens, it replaces a server it started with its own version: the old server stops, the new one starts, and running runs continue on their runners. A server you run as a service, or a server on another machine, keeps its version, and the app tells you that the versions differ.

After the app replaces a server it started, the window reloads itself. When a server on another machine is updated while a window is open, the window notices when you return to it or when a read fails. It then offers **다시 불러오기** (reload) instead of reloading on its own, so anything you are typing stays. You can also reload at any time with **보기 > 다시 불러오기** (⌘R).

Settings > **서버** (server) shows the app and server versions, the last check, and **지금 확인** (check now). Each check sends your IP address and the app version to GitHub. Turn off automatic updates there to stop checking; then download new versions from Releases yourself. Automatic updates need a signed app in the Applications folder that you can write to; otherwise the app tells you a new version is available and links to the Release.

Builds before automatic updates (0.1.0 and earlier) cannot update themselves. Download the new dmg from Releases once and replace the app in Applications; the Release notes say so. A server bundle you run with the CLI does not update itself either: build the new version from a clone as described in [Build a server bundle](self-hosting.md#build-a-server-bundle).
