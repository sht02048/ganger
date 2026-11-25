# Troubleshooting

## Server logs

The web server, the worker, `ganger mcp`, and `ganger start` each write a server log to `<home>/logs/web.jsonl`, `worker.jsonl`, `mcp.jsonl`, and `cli.jsonl`. Each line is one JSON object that starts with `t` (time), `level`, `proc`, `pid`, `v` (version), `event` (a fixed dotted name such as `run.state_changed`), and `msg`, followed by context such as `runId`, `ticketKey`, `runnerId`, or `deliveryId`.

- The default level is `info`, which records only changes: start and stop, each tracker webhook, assignments, run state changes, runner calls that change something, runners going online or offline, and a worker line every 10 minutes. Set `GANGER_LOG_LEVEL=debug` (see [Environment variables](configuration.md#environment-variables)) to also record every runner call and worker tick.
- The console shows only warnings and errors.
- A file that passes 10 MB moves to `.1`, and up to five old files are kept. Change this with `GANGER_LOG_MAX_MB` and `GANGER_LOG_FILES`. `ganger.log` and the desktop app's `desktop-server.log` follow the same limits when the server starts.
- Secret values and token-shaped text are replaced with `[redacted]`. Ticket bodies, agent briefs, webhook bodies, and environment variables are never written. Ticket keys and runner names are kept, so check a log before you share it.

Read them with `ganger logs`. It merges the four files and their rotated copies in time order and prints one line per entry, colored when the output is a terminal:

```sh
ganger logs --run <run id>              # everything about one run, from every process
ganger logs --ticket ACME-12 --since 2h # one ticket over the last two hours
ganger logs --level warn -f             # warnings and errors, then keep printing new ones
ganger logs --proc worker --json        # the stored JSON lines, for jq or a coding agent
```

`--proc` takes `web`, `worker`, `mcp`, `cli`, or `desktop` (repeat it or separate names with commas), `--level` shows that level and more severe ones, and `--since` takes `30s`, `10m`, `2h`, `1d`, or an ISO 8601 date. `-f` keeps reading across rotation until you stop it. On Linux, when the systemd service is installed, it also reminds you that the service's console output is in journald. Lines that a crashed process left half-written are skipped.

The files are plain JSON Lines, so `jq` works too. These read only the current files; `ganger logs` also reads the rotated ones.

```sh
# One run across all processes (one file after another, not merged by time)
jq -c 'select(.runId == "<run id>")' ~/.ganger/logs/*.jsonl

# Warnings and errors of the worker, as time, event, and error message
jq -r 'select(.level == "warn" or .level == "error") | [.t, .event, (.err.message // "")] | @tsv' ~/.ganger/logs/worker.jsonl

# Count events by name, to see what the server has been doing
jq -r '.event' ~/.ganger/logs/*.jsonl | sort | uniq -c | sort -rn
```

## Diagnostics bundle

To attach details to an issue, open Settings > **서버** (server) > **로그와 진단** (logs and diagnostics) and make a **진단 묶음** (diagnostics bundle). It is one zip with the version and environment, a settings summary without secrets, runners, recent runs, tracker webhook deliveries, the run timeline of a run you pick, and recent server logs. By default it replaces ssh targets, hosts and tailnet addresses, runner names, home paths, and ticket key prefixes with aliases; you can turn that off. Open the file and check it before you share it.
