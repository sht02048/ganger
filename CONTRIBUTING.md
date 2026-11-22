# Contributing

Read [`AGENTS.md`](./AGENTS.md) for the working rules, [`GLOSSARY.md`](./GLOSSARY.md) for terms, and [`docs/adr/`](./docs/adr/) for key decisions. Work branches from `develop`, and pull requests target `develop`.

## Structure

| Path                       | Role                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web`                 | UI, server functions, and the Linear webhook receiver (TanStack Start)                    |
| `apps/worker`              | Long-running daemon for the assignment queue, runner commands, and run and PR polling     |
| `apps/cli`                 | `init`, `start`, `logs`, `mcp`, and launchd/systemd service registration                  |
| `apps/desktop`             | macOS desktop app (Electron): window, tray, and notifications; runs the server bundle     |
| `packages/core`            | Domain logic and the Tracker, Runner, and CodeHost adapter interfaces                     |
| `packages/app`             | What each screen reads and writes, shared by the web server functions and `ganger mcp`    |
| `packages/db`              | SQLite (WAL) schema, access, and migrations                                               |
| `packages/log`             | Server log writing and reading                                                            |
| `packages/ui`              | Design system (StyleX + UI SDK)                                                           |
| `packages/tracker-linear`  | Tracker adapter for Linear (GraphQL API and webhooks)                                     |
| `packages/runner-orca`     | Runner adapter that runs `orca` on a remote runner over ssh                               |
| `packages/codehost-github` | Code host adapter for GitHub (finding pull requests and reading their state and CI state) |
| `e2e`                      | End-to-end tests with fake adapters, including operator actions in a real browser         |
| `demo`                     | The `pnpm dev` entry point: web and worker with fake adapters and seeded data             |

`packages/ui` holds the design system: tokens, components, and the usage rules in [`packages/ui/DESIGN.md`](./packages/ui/DESIGN.md). `apps/web` shows a design system preview at `/ds`. The artwork and the rules for using it are in the [brand guide](packages/ui/brand/README.md).

## Getting started

You need Node 24 LTS and the pnpm version set in the `packageManager` field of `package.json`.

```sh
nvm use
pnpm install   # also installs the lefthook pre-commit hook
```

## Commands

| Command                     | What it does                                                           |
| --------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                  | Runs `pnpm dev:web` and opens the desktop app on it                    |
| `pnpm dev:web`              | Runs the web app (hot reload) and the worker with fake adapters        |
| `pnpm typecheck`            | Type-checks every package with TypeScript 7 (`tsc`)                    |
| `pnpm lint`                 | Runs oxlint in type-aware mode                                         |
| `pnpm format`               | Formats with oxfmt                                                     |
| `pnpm format:check`         | Checks formatting                                                      |
| `pnpm test`                 | Runs Vitest (browser tests need Google Chrome)                         |
| `pnpm check:colors`         | Checks for raw color values outside `packages/ui`                      |
| `pnpm check:lengths`        | Checks for raw px/rem/em lengths in `apps/web` styles                  |
| `pnpm build`                | Builds the web app, the worker, the CLI, and the desktop app           |
| `pnpm smoke:web`            | Starts the production web build and checks a page                      |
| `pnpm smoke:cli`            | Runs the built CLI's `init` and `start` and checks a page              |
| `pnpm bundle`               | Packs the builds into a server bundle in `dist/`                       |
| `pnpm smoke:bundle`         | Extracts the server bundle outside the repository and runs it          |
| `pnpm release:mac`          | Builds a release dmg (see [Build a release dmg](#build-a-release-dmg)) |
| `pnpm update:browser-times` | Refreshes the browser test shard times from CI runs                    |

The browser tests in `e2e` drive the Google Chrome installed on the machine through `playwright-core`; they do not download a browser. GitHub's Ubuntu runners already have Chrome. When a browser test fails, a screenshot of the page is saved to `e2e/test-results/`, and CI uploads it as an artifact. A unit test that mounts a component starts with `// @vitest-environment jsdom` and runs in jsdom, a development dependency of `apps/web`.

## Development

`pnpm dev:web` starts the web app in development mode (hot reload) and the worker in one process; open the address it prints in a browser. `pnpm dev` starts the same dev server and opens the desktop app on it, described below. The tracker, the runners, and the code host are fake adapters, so it needs no Linear key, ssh access, or GitHub token, and it never reaches those services. By default it opens on the Dashboard of a finished setup with sample data: two tracker connections and workspaces, three runners (one online, one with broken GitHub authentication, one offline) with sample provider usage, runs in every state, and two weeks of past runs for Stats. The fake agents keep working over time: they ask questions now and then, open pull requests, and send completion reports. Answer questions, cancel runs, and assign tickets in the app as usual.

- `pnpm dev:web --onboarding` (or `pnpm dev --onboarding`) starts from step 1 of onboarding with an empty database. **가짜 값 채우기** (fill with fake values, bottom right) fills the form fields with values that pass every check. To see a failed check, put `invalid` in a key or token, or `offline`, `no-orca`, or `push-auth` in the runner's ssh target.
- `--reset` deletes the data of that mode and starts over. `--static` stops the fake agents from moving on their own.
- `/__dev` (the **개발 도구** (dev tools) link at the bottom right) labels a ticket for auto-assignment, adds a ticket, makes an agent ask a question, fixes or breaks a runner's GitHub authentication, and stands in for another Mac that runs the runner setup command (or lets that command expire).
- The TanStack Query devtools stay closed by default so they never cover the app. **Query devtools 켜기·끄기** on `/__dev` opens or closes them at the bottom of the app tabs open in the same browser. In the desktop app (`pnpm dev`), or without the dev tools, run `dispatchEvent(new CustomEvent("ganger:set-query-devtools", { detail: true }))` (`false` to close) in the console of the window's developer tools.
- Data lives in `.dev/<mode>/` in the repository (ignored by git), or under `GANGER_DEV_DIR`. It never touches `~/.ganger`. The server binds to `127.0.0.1:3000`; set `WEB_HOST` and `WEB_PORT` to change that (for example, `WEB_HOST=0.0.0.0 pnpm dev:web` to open it from another machine on your network). Anyone who can reach that address can use the dev server and `/__dev`, so bind to an address only trusted machines can reach.
- The fake adapters and the dev tools are registered only by `pnpm dev` and `pnpm dev:web`. They are not part of the production build or the server bundle; the bundle check (`scripts/bundle-check.ts`, run by `pnpm bundle` and `pnpm smoke:bundle`) fails if fake adapters or dev-only values end up in the bundle.

`pnpm dev` takes the same options and environment variables as `pnpm dev:web`. It builds the desktop app's main process, preload, and renderer once, starts the dev server, and then opens the desktop app with `GANGER_DESKTOP_DEV_SERVER` set to the dev server's address:

- The app connects to that address like a server on another machine and does not start a server bundle of its own. Changes to the web app reload inside the app window. Changes to `apps/desktop` need a restart of `pnpm dev`.
- The app keeps its data in `.dev/desktop/user-data` and uses `.dev/desktop/home` as its Ganger home (under `GANGER_DEV_DIR` when set), so it does not touch the settings or saved servers of an installed Ganger app, or `~/.ganger`. It can run next to an installed app.
- Quitting the app (⌘Q or **Quit** in the tray menu) stops the dev server too. Ctrl+C quits the app and then stops the dev server. Closing the window only hides it, as in the installed app.
- The `electron` package downloads its binary the first time `pnpm dev` runs. If the binary is still missing (for example, offline), `pnpm dev` stops before starting anything and prints the install command (`pnpm --filter @ganger/desktop exec node node_modules/electron/install.js`). Use `pnpm dev:web` to work in a browser instead.

`pnpm --filter @ganger/web dev` still starts only the web app; open `http://127.0.0.1:3000/ds` to see the design system. Run the production build with `pnpm --filter @ganger/web start`. It binds to `127.0.0.1` by default. To change that, set the shell environment variables `WEB_HOST` and `WEB_PORT` (for example, `WEB_PORT=4000 pnpm --filter @ganger/web start`).

Build the worker with `pnpm --filter @ganger/worker build` and start it with `pnpm --filter @ganger/worker start`. It reads `DATABASE_PATH` and `ENCRYPTION_KEY` from the shell environment, applies pending database migrations, and then polls until it receives `SIGINT` or `SIGTERM`. It builds adapters from the runners, tracker connections, and code host connections stored in the database, and rebuilds an adapter when its settings change. Started on its own like this, the worker picks up changes made in the web app (assignments, cancellations, answers, settings, tracker webhooks) only at its next poll, about every 10 seconds. Started by `ganger start` (which the service and the desktop app also use) or by `pnpm dev`, the web app wakes the worker right after each change, so the worker handles it within about a second.

The pre-commit hook runs lint, format check, typecheck, the color literal check, and the style length check. CI (GitHub Actions) runs on pull requests and on pushes to `main` and `develop`. The `static` job runs, in this order: typecheck → lint → color literal check → style length check → format check → unit tests (every Vitest project except `e2e` and `demo`) → build → web production smoke test → CLI smoke test → server bundle → server bundle smoke test. At the same time, the `browser` jobs run the `e2e` and `demo` browser tests in four shards (`vitest --shard`), balanced by the per-file times in `scripts/browser-test-times.json`. To refresh those times, run `pnpm run update:browser-times <run-id>...` with one or more successful CI runs. The `check` job waits for all of them and fails if any of them failed, was cancelled, or was skipped; `check` is the status check that `main` and `develop` require. A change to Markdown files only skips the other jobs, and `check` passes.

## Desktop app

### Build and run it locally

```sh
pnpm install
pnpm build
pnpm bundle                                                            # the server bundle the app ships
pnpm --filter @ganger/desktop exec node node_modules/electron/install.js   # downloads Electron once
pnpm --filter @ganger/desktop run package
```

This writes `apps/desktop/dist/app/Ganger-darwin-<arch>/Ganger.app` and a `.zip` of it. The app carries the server bundle unchanged in `Contents/Resources/server/` and runs it with its own Node (Electron's), so the machine does not need Node. `pnpm --filter @ganger/desktop start` runs the app from the repository with the bundle in `dist/`. To work on the app with the dev server instead, run `pnpm dev` (see [Development](#development)).

A build you package yourself is not signed, so macOS asks you to confirm before it opens the first time (Control-click the app, then **Open**).

### Build a release dmg

`pnpm release:mac` builds everything, packages the app, and writes `dist/release/Ganger-<version>-<arch>.dmg`. When `GITHUB_REPOSITORY` (set by GitHub Actions) or `GANGER_RELEASE_REPOSITORY` names the repository as `owner/name`, it also writes the update files the app downloads, `Ganger-<version>-darwin-<arch>.zip` and `ganger-update-darwin-<arch>.json`, and stores the repository in the app so the app knows where to check. `RELEASE_TAG` sets the tag the update files point to; it defaults to `v<version>`. Without signing settings, it skips signing and notarization and makes an unsigned dmg. To sign and notarize, set:

| Variable              | Value                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `APPLE_API_KEY_PATH`  | Path to an App Store Connect API key (`.p8`)                                                      |
| `APPLE_API_KEY_ID`    | The key's Key ID                                                                                  |
| `APPLE_API_ISSUER`    | The key's Issuer ID                                                                               |
| `MACOS_SIGN_KEYCHAIN` | Optional: the keychain that holds the certificate. Without it, the default keychains are searched |

The script signs with the one valid "Developer ID Application" identity it finds in the keychain, notarizes and staples the app, then signs, notarizes, and staples the dmg. Set all three API key variables or none.

## Work items

Work is tracked as local tickets in [`docs/tickets/`](./docs/tickets/) instead of in a tracker.

## Renamed repository

The repository was renamed from `factory-orchestrator` to `ganger`. GitHub forwards the old address for now, but do not rely on that. In each clone and worktree you already have, point `origin` at the new address (replace `<owner>` with the account that owns the repository):

```sh
git remote set-url origin https://github.com/<owner>/ganger.git
git remote -v   # check that fetch and push show the new address
```

Use `git@github.com:<owner>/ganger.git` instead if you clone over ssh. Worktrees share the remote of their main clone, so running the command once per clone is enough.
