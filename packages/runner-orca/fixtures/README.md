# Fixtures

Real `orca` output captured from the test runner (macOS, Orca 1.4.258) over non-interactive ssh for ticket 0013. Tests also read the research fixtures in `docs/research/fixtures/` (0003, 0004, 0008). The ids in each folder are separate, so a test never mixes two folders.

Local paths, host names, user names and accounts are replaced with `<path>`, `<host>`, `<user>` and `acme`. The repository is called `sandbox`. Terminal, Run, Task and Dispatch ids are the real ones from one disposable run (`fo-t0013-probe1`). `status-ready.json` keeps only the first three runtime capabilities.

| File                                       | Command and situation                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `status-ready.json`                        | `status --json`, runtime ready                                                |
| `account-list.json`                        | `account list --json` shaped like the real output; accounts are made up       |
| `serve-service-status-live.json`           | `serve service status --json`, service installed and live                     |
| `project-list.json`                        | `project list --json`                                                         |
| `project-setups.json`                      | `project setups --json`                                                       |
| `push-dry-run-ok.json`                     | `git push --dry-run` in the project checkout, exit code and output            |
| `push-dry-run-no-credentials.json`         | the same with the credential helper turned off                                |
| `ssh-unreachable.json`                     | ssh to a host that does not resolve (exit 255)                                |
| `orca-not-found.json`                      | a wrong `orca` path (exit 127)                                                |
| `terminal-create-mailbox.json`             | `terminal create` for the mailbox terminal                                    |
| `terminal-show-live.json`                  | `terminal show` on the live mailbox terminal                                  |
| `terminal-show-closed.json`                | `terminal show` after `terminal close` (`connected: false`)                   |
| `terminal-show-stale.json`                 | `terminal show` on an unknown handle (`terminal_handle_stale`)                |
| `terminal-close.json`                      | `terminal close`                                                              |
| `run-create.json`                          | `orchestration run-create --from <mailbox>`                                   |
| `run-current-unbound.json`                 | `orchestration run-current --from` on a terminal bound to no Run              |
| `run-current-bound.json`                   | the same after `run-use`                                                      |
| `run-use.json`                             | `orchestration run-use` of the same Run from a new mailbox terminal           |
| `check-peek-empty.json`                    | `orchestration check --peek` with no mail                                     |
| `check-peek-full-question.json`            | `check --peek --full` with one question                                       |
| `check-peek-full-question-and-done.json`   | `check --peek --full` after the `worker_done` report                          |
| `worker-start-spec-stdin.json`             | `orchestration worker-start --spec-file -` with the spec on ssh stdin         |
| `worktree-show.json`                       | `worktree show --worktree name:<name>` of the started worktree                |
| `worktree-show-not-found.json`             | `worktree show` for a name that does not exist                                |
| `worker-list-run.json`                     | `orchestration worker-list --run <run>`                                       |
| `task-list-full-dispatched.json`           | `task-list --full` while the agent works                                      |
| `task-list-full-brief-failed-report.json`  | `task-list --full --brief` after `worker_done --outcome failed` (`failed`)    |
| `worker-show-working.json`                 | `worker-show` while the agent works                                           |
| `worker-show-failed-report.json`           | `worker-show` after the failed report                                         |
| `worktree-ps-agent-wait-working.json`      | `worktree ps --agent-wait`, only the test worktree row                        |
| `reply.json`                               | `reply` with a body holding a newline, quotes, `$`, backticks and backslashes |
| `reply-answer-conflict.json`               | a second `reply` with a different body (`answer_conflict`)                    |
| `worker-read-transcript.json`              | `worker-read --limit 100` of the agent transcript                             |
| `worker-read-terminal-empty.json`          | `worker-read` of a released agent that died without a report (empty archive)  |
| `worker-read-terminal-released-error.json` | `worker-read --source terminal` after the terminal output was released        |
| `worker-release.json`                      | `worker-release` after the report                                             |
| `worktree-rm-force.json`                   | `worktree rm --force`                                                         |
