# Self-hosting

> The server bundle is not published: there is no npm package and no server download. The macOS app is published on GitHub Releases (see [Desktop app](desktop.md)). To run the orchestrator as a service, build a server bundle from a clone of this repository, as described in [Build a server bundle](#build-a-server-bundle). The commands in these guides are written as `ganger <command>`; with a server bundle, that is `node <bundle>/cli/bin/cli.js <command>`.

The orchestrator is a self-hosted tool. One operator runs one installation on their own machine. The setup:

- `apps/web` and `apps/worker` run on the same machine and share one SQLite file.
- A runner is an Orca environment that the orchestrator can reach over ssh.
- Tracker connections, the GitHub token, runners, workspaces, and mappings are set up in web onboarding on first launch. Tokens are stored encrypted in the database.
- `.env` holds only the minimum values needed to boot. See [Configuration](configuration.md).

Related guides: [Configuration](configuration.md), [Networking and webhooks](networking.md), [Runners](runners.md), [MCP](mcp.md), [Troubleshooting](troubleshooting.md).

## Build a server bundle

A server bundle is one folder that holds the web app, the worker, and the CLI with all their runtime dependencies. It does not need the repository, `pnpm`, or `node_modules`. It does not include Node: you need Node 24 on the machine that runs it.

```sh
pnpm install
pnpm build
pnpm bundle
```

This writes `dist/ganger-<version>/` and the same folder packed as `dist/ganger-<version>.tar.gz`. Copy the tarball to the machine that runs the orchestrator, extract it anywhere, and run the CLI from it:

```sh
tar -xzf ganger-<version>.tar.gz
node ganger-<version>/cli/bin/cli.js init
node ganger-<version>/cli/bin/cli.js start
```

To upgrade, build a new bundle, stop the orchestrator, extract the new bundle, and start it from there. The folder name includes the version, so if you run the orchestrator as a service, run `service uninstall` with the old bundle and `service install` with the new one. Your settings and data stay in the [installation folder](configuration.md#installation-folder), not in the bundle.

You can also run the CLI straight from the repository after `pnpm build`, with `node apps/cli/dist/bin/cli.js <command>` (or `pnpm --filter @ganger/cli cli <command>`).

## Set up and start

The CLI keeps its files in one installation folder: `~/.ganger` by default, or the folder in `--home <dir>` or the `GANGER_HOME` environment variable.

```sh
ganger init     # writes <home>/.env with a new encryption key
ganger start    # applies database migrations, then runs the web server and the worker
```

The [Configuration](configuration.md) guide describes what `init` and `start` do, the environment variables, and sleep.

## Run as a service

`ganger service install` registers `start` as a background service for your user account: a launchd agent on macOS (`~/Library/LaunchAgents/ganger.plist`) and a systemd user service on Linux (`~/.config/systemd/user/ganger.service`). It starts at login and restarts after a failure. `ganger service uninstall` stops it and removes the file.

- Add `--dry-run` to either command to print the file and the commands without changing anything.
- Run `init` first. `service install` refuses to register a service that would fail to boot, and refuses to overwrite an existing service file.
- The service runs the Node and CLI paths you installed it with, and uses your current `PATH`. After you move or upgrade Node, or move the server bundle to another folder, run `service uninstall` and `service install` again.
- On macOS, the service's console output goes to `<home>/logs/ganger.log`. On Linux, read it with `journalctl --user -u ganger.service`, and run `loginctl enable-linger` once so the service keeps running after you log out. The [server logs](troubleshooting.md#server-logs) are the same however you start the server.
