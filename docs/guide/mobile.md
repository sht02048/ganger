# iPhone development build

`apps/mobile` is the iOS app. Expo Go (`pnpm dev:mobile`) runs most of it, but push notifications, the Notification Service Extension (NSE) that fills in a notification on a locked phone, notification buttons, the app icon badge, and fonts built into the app need a signed development build. This guide builds one in the cloud with EAS Build, so you do not need Xcode.

You need:

- An [Apple Developer Program](https://developer.apple.com/programs/) membership. Its Team ID is on the Membership page of your Apple Developer account.
- An [Expo account](https://expo.dev/signup).
- An iPhone, and a Mac with this repository and Node 24 (see [CONTRIBUTING](../../CONTRIBUTING.md)).
- A Ganger server that your iPhone can open over HTTPS, for example through Tailscale Serve (see [Open it from other devices](networking.md#open-it-from-other-devices)).

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

The values live in two places: `apps/mobile/.env` for commands on your Mac, and the `development` environment on EAS for the cloud build, which does not get `.env` because Git ignores it. Always write `.env` first and copy it to EAS, so the two never disagree:

1. Write `apps/mobile/.env` (Git ignores it; Expo CLI reads it):

   ```sh
   GANGER_EXPO_PROJECT_ID=00000000-0000-0000-0000-000000000000
   GANGER_IOS_BUNDLE_ID=com.example.ganger
   GANGER_APPLE_TEAM_ID=ABCDE12345
   ```

2. Copy each value to the EAS `development` environment:

   ```sh
   set -a; . ./.env; set +a
   for name in GANGER_EXPO_PROJECT_ID GANGER_IOS_BUNDLE_ID GANGER_APPLE_TEAM_ID; do
     eas env:set --environment development --name "$name" --value "$(printenv "$name")" --visibility plaintext --non-interactive
   done
   ```

   `eas env:set` creates a variable or updates it (it replaces `eas env:create`, which older guides use). Keep the visibility `plaintext` or `sensitive`: EAS CLI reads the values on your Mac to resolve the app configuration, and it cannot read `secret` ones.

3. Check that both places agree:

   ```sh
   eas env:list --environment development
   GANGER_MOBILE_BUILD=development npx expo config --type public --json
   ```

   The second command must show `ios.bundleIdentifier` (for example `com.example.ganger`), `extra.eas.projectId`, `extra.eas.build.experimental.ios.appExtensions` with `GangerNotificationService`, and the `expo-notifications` plugin with `"mode": "development"`. Keep `--json`: without it the output is not JSON and is hard to search. Keep `GANGER_MOBILE_BUILD=development` too: the development build profile sets it on EAS (see below), and without it the command shows the release settings (`"mode": "production"`).

To change a value later, edit `.env` and run steps 2 and 3 again.

Run the `eas` commands in the next steps in the same shell, or load `.env` again first with `set -a; . ./.env; set +a`, so EAS CLI resolves the app configuration with the same values.

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

1. On the server, set **열 주소** (web address) in Settings > **다른 기기** (other devices) to its HTTPS address, for example the Tailscale Serve address `https://server.example.ts.net`.
2. In the same section, choose **다른 기기 연결** (connect another device), then **QR 띄우기** (show QR).
3. Scan the QR code with the app.

If you connected a development build before you set the three values, disconnect it in the app (**이 기기 연결 끊기**, disconnect this device) and connect again: the NSE reads the device token from the shared keychain, and the app saves it there only when it connects.
