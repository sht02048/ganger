# Runners

A runner is an Orca environment that the orchestrator can reach over ssh.

## Add another Mac

- To add another Mac that has the Ganger desktop app, pick **다른 맥 · 그 맥에 Ganger 앱이 있어요** (another Mac, it has the Ganger app) in onboarding or under Runners > **러너 추가** (add runner). A Ganger app on that Mac that is connected to this server (**다른 서버에 붙기**, connect to another server) asks **이 맥을 러너로 등록할까요?** (register this Mac as a runner?); press **등록하기** (register) there and the app runs the same setup script as the terminal command and shows its progress. The request lasts 10 minutes, and only one Mac can take it. The app on the Mac that runs the server never asks.
- To add another Mac as a runner, pick **다른 맥 · 터미널 명령으로** (another Mac, terminal command) in onboarding or under Runners > **러너 추가** (add runner). Ganger shows a one-line `curl … | sh` command that works once within 10 minutes. It needs Orca on that Mac, the same tailnet, and the address other devices use to reach this server (Settings > **다른 기기** (other devices)).

## Put the ticket key in pull request titles

The orchestrator does not change your projects' agent settings. We recommend adding a rule to each project's agent instructions (for example, `AGENTS.md`) to put the ticket key in the pull request title. Otherwise, if an agent opens the pull request from a branch other than the one the orchestrator created (including by renaming that branch), the orchestrator may not find it and may record the run's pull request as missing or closed.
