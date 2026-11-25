# iPhone builds

`apps/mobile` is the iOS app. Expo Go (`pnpm dev:mobile`) runs most of it, but push notifications, the Notification Service Extension (NSE) that fills in a notification on a locked phone, notification buttons, the app icon badge, and fonts built into the app need a signed build. This guide builds one in the cloud with EAS Build, so you do not need Xcode.

There are two kinds of build. Both install only on the iPhones you register (internal distribution):

- A **development build** (steps 1 to 8) loads its JavaScript from the Metro dev server on your Mac. Use it while you change the app.
- A **preview build** ([Preview build (no Mac needed)](#preview-build-no-mac-needed)) has its JavaScript inside the app. Install it, connect it to your server, and it keeps working without your Mac. Use it to run Ganger every day.

Both builds need steps 1 to 5.

You need:

- An [Apple Developer Program](https://developer.apple.com/programs/) membership. Its Team ID is on the Membership page of your Apple Developer account.
- An [Expo account](https://expo.dev/signup).
- An iPhone, and a Mac with this repository and Node 24 (see [CONTRIBUTING](../../CONTRIBUTING.md)).
- A Ganger server that your iPhone can open over HTTPS. Settings > **모바일** (mobile) sets this up with Tailscale Serve (see [Open it from your phone](networking.md#open-it-from-your-phone)).

Run every `eas` command from `apps/mobile`. EAS reads `apps/mobile/eas.json` there and installs the whole pnpm workspace from the lockfile at the repository root.

## 1. Install EAS CLI and log in

```sh
npm install --global eas-cli
eas login
cd apps/mobile
```

`apps/mobile/eas.json` sets the oldest EAS CLI version it accepts (`cli.version`). If `eas` stops with a version error, update it with the same `npm install` command.

## 2. Create the Expo project

```sh
eas init
```

This creates the project `ganger` in your Expo account. The app configuration (`app.config.ts`) is code, so EAS CLI cannot write the project ID into it and prints the ID instead. Copy it. If you already made the project on [expo.dev](https://expo.dev), copy the ID from the project page.

## 3. Set the three build values

The build reads three values. None of them are secret, but they belong to your accounts, so they are not in the repository.

| Variable                 | What it is                                  | Example                                |
| ------------------------ | ------------------------------------------- | -------------------------------------- |
| `GANGER_EXPO_PROJECT_ID` | The Expo project ID from step 2             | `00000000-0000-0000-0000-000000000000` |
| `GANGER_IOS_BUNDLE_ID`   | A bundle ID you own, in reverse domain form | `com.example.ganger`                   |
| `GANGER_APPLE_TEAM_ID`   | Your Apple Developer Team ID                | `ABCDE12345`                           |

When all three are set, the app configuration adds the NSE target (bundle ID `<bundle ID>.notification-service`) and the shared keychain group `<team ID>.<bundle ID>.shared`. Without them the build has no NSE, and pushes arrive without their title and text on a locked phone.

The values live in two places, because Expo CLI and EAS CLI read them differently:

- Expo CLI (`npx expo ...`) reads `apps/mobile/.env` by itself.
- EAS CLI (`eas ...`) does not read `.env` files ([Expo: environment variables FAQ](https://docs.expo.dev/eas/environment-variables/faq/)). Until the values are on EAS, it gets them only from your shell. Without `GANGER_EXPO_PROJECT_ID` it finds no project ID in `app.config.ts`, tries to link the project again, and stops with `Cannot automatically write to dynamic config at: app.config.ts`.
- The cloud build does not get `.env` either, because Git ignores it. It uses the variables in the EAS environment of its build profile: `development` for a development build, `preview` for a preview build.

Always write `.env` first and copy it to EAS, so the two never disagree:

1. Write `apps/mobile/.env` (Git ignores it):

   ```sh
   GANGER_EXPO_PROJECT_ID=00000000-0000-0000-0000-000000000000
   GANGER_IOS_BUNDLE_ID=com.example.ganger
   GANGER_APPLE_TEAM_ID=ABCDE12345
   ```

2. Load `.env` into your shell. Do this in every new shell before you run an `eas` command:

   ```sh
   set -a; source .env; set +a
   ```

3. Copy each value to the EAS `development` and `preview` environments from the shell variables, so you never type a value twice:

   ```sh
   for environment in development preview; do
     eas env:set --environment "$environment" --name GANGER_EXPO_PROJECT_ID --value "$GANGER_EXPO_PROJECT_ID" --visibility plaintext --non-interactive
     eas env:set --environment "$environment" --name GANGER_IOS_BUNDLE_ID --value "$GANGER_IOS_BUNDLE_ID" --visibility plaintext --non-interactive
     eas env:set --environment "$environment" --name GANGER_APPLE_TEAM_ID --value "$GANGER_APPLE_TEAM_ID" --visibility plaintext --non-interactive
   done
   ```

   `eas env:set` creates a variable or updates it. `eas env:create`, which older guides use, is deprecated. Keep the visibility `plaintext` or `sensitive`: EAS CLI reads the values on your Mac to resolve the app configuration, and it cannot read `secret` ones.

4. Check that both places agree:

   ```sh
   eas env:list --environment development
   eas env:list --environment preview
   GANGER_MOBILE_BUILD=development npx expo config --type public --json
   ```

   The first two commands must each list the three variables with the values in `.env`. The third must show `ios.bundleIdentifier` (for example `com.example.ganger`), `extra.eas.projectId`, `extra.eas.build.experimental.ios.appExtensions` with `GangerNotificationService`, and the `expo-notifications` plugin with `"mode": "development"`. Keep `--json`: without it the output is not JSON and is hard to search. Keep `GANGER_MOBILE_BUILD=development` too: the development build profile sets it on EAS (see below), and without it the command shows the release settings (`"mode": "production"`).

To change a value later, edit `.env` and run steps 2 to 4 again.

`eas build --profile development` resolves the app configuration on your Mac with the variables of the profile's EAS environment (`development`; `preview` for `--profile preview`), and the cloud build gets the same variables ([Expo: using environment variables with EAS Build](https://docs.expo.dev/eas/environment-variables/usage/)). The project ID still has to be in your shell when the command starts, because EAS CLI needs it to know which project's variables to fetch, so keep step 2 for every shell.

The `development` build profile in `apps/mobile/eas.json` sets `GANGER_MOBILE_BUILD=development` (`env`). With it, the build accepts local-network HTTP (for the Metro dev server) and is signed for the APNs development environment (`aps-environment` `development`). It is not an account value, so do not add it to `.env` or to the EAS environment.

## 4. Upload the push key

```sh
eas credentials --platform ios
```

Choose the `development` build profile, then the push notifications key, and let EAS create an APNs key in your Apple team (or upload a `.p8` key you already have). EAS keeps the key; it never goes into the repository. If you skip this step, `eas build` asks about push notifications the first time.

## 5. Register the iPhone

```sh
eas device:create
```

Open the link it prints on the iPhone and install the profile it offers. A development build installs only on registered devices, so register each iPhone before you build. If you add a device later, build again.

On iOS 16 or later, turn on **Settings > Privacy & Security > Developer Mode** on the iPhone and restart when asked. The switch appears after you install a development build for the first time if it is not there yet.

## 6. Build

```sh
eas build --profile development --platform ios
```

The first build asks to sign in to your Apple account and to create the certificates and provisioning profiles for the app and its NSE. When it finishes, it prints a link and a QR code. Open it on the iPhone to install **Ganger**.

The profile uses the same Node (`node`) and pnpm (`pnpm`) versions as the repository. Build the app again when you change native code, add a native package, or change the three values; JavaScript changes do not need a new build.

## 7. Run the app from your Mac

A development build loads its JavaScript from the Metro dev server on your Mac, so the iPhone must reach the Mac (the same Wi-Fi, or the same tailnet).

- To use the seeded demo server, run `pnpm dev:mobile --dev-client` from the repository root. Without `--dev-client`, `pnpm dev:mobile` keeps opening Expo Go. The phone cannot reach the demo server at `127.0.0.1`, so to connect it automatically, serve the demo server over HTTPS (for example with Tailscale Serve) and pass that address: `GANGER_MOBILE_DEV_SERVER=https://dev.example.ts.net pnpm dev:mobile --dev-client`.
- To use your own server, run `pnpm --filter @ganger/mobile start --dev-client`. Then connect the app as described below.

Open **Ganger** on the iPhone and choose the Mac's dev server in the list, or scan the QR code that Metro prints with the Camera app.

## 8. Connect to your server over HTTPS

The app connects only to an HTTPS address.

1. Install Tailscale on the phone and sign in to the same account as the server Mac.
2. On the server, open Settings > **모바일** (mobile) and select **켜기** (turn on) on **휴대폰에서 이 Mac 열기** (open this Mac from your phone). It serves the app at the Mac's Tailscale HTTPS address, for example `https://server.example.ts.net`, only inside your tailnet. If another service already uses port 443, it picks a free port and the address carries it, for example `https://server.example.ts.net:8444`; the app connects to it the same way (see [Open it from your phone](networking.md#open-it-from-your-phone)).
3. The page shows a QR code right away. Scan it with the app. If it expired, choose **새 QR 만들기** (new QR code).

The phones you connected are listed under the QR code. **연결 끊기** (disconnect) removes a phone's device token.

If you connected a development build before you set the three values, disconnect it in the app (**이 기기 연결 끊기**, disconnect this device) and connect again: the NSE reads the device token from the shared keychain, and the app saves it there only when it connects.

## Preview build (no Mac needed)

A preview build has its JavaScript inside the app, so it does not need the Metro dev server or your Mac after you install it. It uses the same settings as a release: push notifications go through the APNs production environment (`aps-environment` `production`), the app accepts only HTTPS, and it never connects to a dev server by itself. It installs only on the iPhones you registered, like a development build.

Do steps 1 to 5 first. Step 3 copies the three values to the EAS `preview` environment too; if you set them before preview builds existed, run step 3 again so `eas env:list --environment preview` lists them.

### Build it

```sh
set -a; source .env; set +a
npx expo config --type public --json
eas build --profile preview --platform ios
```

Without `GANGER_MOBILE_BUILD`, `npx expo config` shows the settings a preview build gets. Check that it shows the `expo-notifications` plugin with `"mode": "production"`, `ios.infoPlist.NSAppTransportSecurity` with `"NSAllowsArbitraryLoads": false` and no `NSAllowsLocalNetworking`, and `extra.eas.build.experimental.ios.appExtensions` with `GangerNotificationService`.

The first preview build asks to create an ad hoc provisioning profile for the app and its NSE. It lists the devices you registered with `eas device:create`; only those can install the build. If you register another iPhone later, build again.

EAS keeps iOS credentials per bundle ID, so the preview build uses the push key from step 4 ([Expo: app credentials](https://docs.expo.dev/app-signing/app-credentials/#push-notification-keys)). An APNs key sends to both the development and the production environment unless it was made for one environment only. A key that EAS creates is fine. If you uploaded your own `.p8` key, check its environment in your Apple Developer account under **Certificates, Identifiers & Profiles > Keys**; it must allow production.

The server needs no change. It sends every notification to the Expo push service, and the app tells Expo which APNs environment it uses when it gets its push address ([Expo: `ExpoPushTokenOptions.development`](https://docs.expo.dev/versions/latest/sdk/notifications/#expopushtokenoptions)).

### Install it

When the build finishes, EAS prints a link and a QR code. Open the link on the iPhone, or scan the QR code with the Camera app, and install **Ganger**. You can also open the build on [expo.dev](https://expo.dev) and select **Install**.

On iOS 16 or later, the iPhone needs **Settings > Privacy & Security > Developer Mode** turned on to open the app, as for a development build ([Expo: iOS Developer Mode](https://docs.expo.dev/guides/ios-developer-mode/)).

### Connect it

Open **Ganger** and scan the QR code from Settings > **모바일** (mobile) on your server, as in [step 8](#8-connect-to-your-server-over-https). After that, the app needs only Tailscale on the phone and your Ganger server.

### Development build or preview build

|                        | Development build                                | Preview build                                |
| ---------------------- | ------------------------------------------------ | -------------------------------------------- |
| Command                | `eas build --profile development --platform ios` | `eas build --profile preview --platform ios` |
| JavaScript             | Loaded from Metro on your Mac                    | Inside the app                               |
| Needs your Mac running | Yes                                              | No                                           |
| APNs environment       | Development (sandbox)                            | Production                                   |
| Local-network HTTP     | Allowed (for Metro)                              | Not allowed                                  |
| Use it to              | Change the app and see the change right away     | Use Ganger every day                         |

Build a new preview build to get app changes, including JavaScript changes.

Both builds use the same bundle ID (`GANGER_IOS_BUNDLE_ID`), so an iPhone holds only one of them. Installing one replaces the other. The app keeps its data, including the server connection, because the keychain and the app's files belong to the bundle ID. If notifications are on, the app sends its push address to the server again when it comes to the foreground and the address changed, so notifications follow the build you installed.
