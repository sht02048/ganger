# Connect an MCP client

`ganger mcp` runs an [MCP](https://modelcontextprotocol.io) server over stdin and stdout, so an agent on the same machine (for example, Hermes) can read Ganger's current state and, when you allow it, use the app's write actions. The MCP client starts the command itself; it opens no network port. It reads the database of the installation folder (`--home` or `GANGER_HOME`) directly, so it works even while the server is stopped, and every result says whether the server is running.

- The read tools cover the Dashboard summary (including runners' provider usage), tickets, runs and run detail (with the last stored lines of the log), runners and their provider usage, stats, settings, and server logs. They are marked read-only. `list_tickets` includes each ticket's parent issue key and title (`parentIssue`). `get_server_logs` takes a run id or a ticket key and returns that run's or ticket's run timeline (assignment, state changes, tracker webhooks, MCP actions, notifications, questions, permission requests, and cancel requests in time order) with the matching server log lines; with neither, it returns the latest warnings and errors. It masks secrets again before it answers. Tools that take a workspace accept its id or name, and you can leave it out when there is only one.
- Write tools appear only after you turn on **MCP 클라이언트도 할당·답하기·취소를 하게** (allow MCP writes) in Settings > **고급** (advanced) > MCP (off by default); turning it on or off takes effect without restarting the client. They match the app's write actions: assigning a ticket, answering a question, answering a Human Check (`answer_human_check`, a confirmation like approving a merge, so the client should ask you first), denying a permission request, pausing and resuming a run (`pause_run`, `resume_run`), continuing a Failed run in the worktree it left, with your message (`continue_run`), canceling a run, refreshing a run's log, the workspace name and longest run time, adding and removing tracker projects, Mapping, the In Progress state, the Auto-assign Label, checking the tracker connection and the GitHub token again, changing an existing runner's capacity, checking a runner again, and keeping the Mac awake. Canceling a run and removing a tracker project are marked destructive.
- These stay in the app only, with no MCP tool: saving secrets (tracker API keys, webhook secrets, the GitHub token), adding a runner or changing its ssh target or Orca path, the addresses, and the MCP write switch itself.
- Every MCP write is recorded as "MCP · client name" (the `clientInfo.name` the client sends, shortened and with control characters removed), with the tool, the target, and the result. Requests about a run show up in that run's timeline on Run detail; other writes show up under **최근 작업** (recent activity) in Settings > **고급** (advanced) > MCP. When the server is stopped, writes the worker handles are saved, and the result says the server handles them when it starts.
- Results are JSON. Text that someone other than the operator wrote (ticket titles and bodies, agent questions and reports, logs) is in `external` fields, and the server instructions tell the client to treat it as data, not instructions. No result includes a secret value; settings show only whether a key or token is set.
- `ganger mcp` never applies database migrations. If the database is older than the CLI, it stops and asks you to start the server first; if it is newer, it asks you to update Ganger. It checks again before every write, so a server that migrates the database later never gets writes from an older CLI.
- Settings > **고급** (advanced) > MCP shows the client configuration with the absolute paths of this installation's CLI, in the Hermes `~/.hermes/config.yaml` format and the `mcpServers` JSON format, with a copy button. With the desktop app, `ganger` is not on your `PATH`, so copy it from there.

For a server bundle, the configuration looks like this (Hermes, `~/.hermes/config.yaml`):

```yaml
mcp_servers:
  ganger:
    command: "/usr/local/bin/node"
    args:
      - "/opt/ganger-0.1.0/cli/bin/cli.js"
      - "mcp"
      - "--home"
      - "/Users/you/.ganger"
```
