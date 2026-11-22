# 외부 계약 조사: Orca CLI, Linear, GitHub

조사일 2026-11-17. to-spec과 Tracker 어댑터, Runner 어댑터, worker가 기댈 외부 계약을 사실로 정리한다. 각 항목에 출처를 붙인다. 출처는 세 종류다.

- **[문서]** 공식 문서 URL.
- **[스키마]** 기계가 읽는 스키마. Orca는 `orca agent-context --json`, Linear·GitHub는 GraphQL introspection, Linear SDK는 npm 패키지 소스.
- **[실행]** 실제로 돌린 읽기 전용 명령의 결과. Orca는 1.4.253에서 확인했다.

예시 출력의 로컬 경로, 호스트명, 계정, ID는 `<path>`, `<host>`, `<owner>`, `<uuid>`처럼 가렸다. 출처가 없거나 확인하지 못한 것은 마지막 "아직 모르는 것"에 모았다.

관련 결정: ADR 0001(트래커가 기준), 0002(worker 데몬이 ssh로 러너에 명령·폴링), 0004(결과는 런 종료 시 PR 상태로 판정), 0005(셀프호스팅).

## A. Orca CLI

### A.1 1차 출처: `orca agent-context`

`orca agent-context --json`은 모든 명령의 기계용 스키마를 낸다 **[실행]**. 1.4.253 기준 `schemaVersion: 1`, `commandCount: 321`이다. 명령 하나는 `command`, `path`, `usage`, `flags`, `positionalArgs`, `repeatableFlags`, `examples`, `notes`를 가진다.

이 명령은 런타임 없이 로컬 명령 레지스트리만 읽는다. help에 "works without a running Orca app, so it is safe over SSH and in headless contexts"라고 적혀 있다 **[실행]** (`orca agent-context --help`). 그래서 러너 등록 시 버전·명령 지원 여부를 확인하는 첫 호출로 쓰기 좋다.

버전은 `orca --version`이 한 줄로 낸다(`1.4.253`) **[실행]**. 런타임이 켜져 있으면 `orca status --json`의 `result.runtime.appVersion`에도 있다.

### A.2 공통 출력 형태와 종료 코드

`--json`을 주면 모든 명령이 같은 봉투를 쓴다 **[실행]**.

```json
{ "id": "<uuid>", "ok": true, "result": {}, "_meta": { "runtimeId": "<uuid>" } }
```

실패하면 `ok: false`와 `error`가 온다. `error.code`는 기계가 분기할 값이고, `error.data.nextSteps`는 사람이 읽는 안내다 **[실행]**.

```json
{
  "id": "<uuid>",
  "ok": false,
  "error": {
    "code": "selector_not_found",
    "message": "selector_not_found",
    "data": {
      "selector": "name:does-not-exist",
      "validSelectorForms": [
        "id:<repo-id>::<absolute-path>",
        "path:<absolute-path>",
        "name:<display-name>",
        "branch:<branch>",
        "identity:<identity-key>",
        "issue:<number>",
        "current",
        "active"
      ],
      "suggestions": [],
      "nextSteps": ["..."]
    }
  },
  "_meta": { "runtimeId": "<uuid>" }
}
```

직접 본 오류 코드 **[실행]**:

| 상황                                                | `error.code`            | 종료 코드 |
| --------------------------------------------------- | ----------------------- | --------- |
| 없는 명령(`orca "project list"`처럼 한 인자로 넘김) | `invalid_argument`      | 1         |
| 없는 워크트리 선택자                                | `selector_not_found`    | 1         |
| 다른 서버의 터미널 핸들 또는 없는 핸들              | `terminal_handle_stale` | 1         |
| 모르는 `--environment` 이름                         | `invalid_argument`      | 1         |
| 런타임이 꺼짐(research 0003)                        | `runtime_unavailable`   | 1         |

성공은 종료 코드 0이다 **[실행]**. 이 밖에 문서화된 종료 코드는 명령별 `notes`에 있다. `orchestration worker-start`는 실패·결과 불명에 1 **[스키마]**, `orca serve`는 이미 다른 Orca가 이 프로필을 서빙 중이면 3 **[스키마]**, plugin 명령은 0/1/2/3 **[문서]**(`orca skills get orca-cli --full`)이다.

어댑터는 종료 코드만으로 판단하지 말고 stdout JSON의 `ok`와 `error.code`로 분기해야 한다. 예를 들어 `worktree current`는 Orca 워크트리 밖에서 `ok: false`, `selector_not_found`로 종료 코드 1을 낸다 **[실행]**. 오류 JSON은 stdout으로 나오고, 일부 명령은 stderr에 `error: <code>: <message>` 한 줄을 함께 쓴다 **[실행]**.

### A.3 러너 상태: `orca status`

```
orca status [--json]
```

**[스키마]** "Show app/runtime/graph readiness". 결과 형태 **[실행]**:

```json
{
  "id": "local-status",
  "ok": true,
  "result": {
    "target": { "kind": "local" },
    "app": { "running": true, "pid": 12345, "desktopWindowStatus": "available" },
    "runtime": {
      "state": "ready",
      "reachable": true,
      "connectionState": "connected",
      "runtimeId": "<uuid>",
      "appVersion": "1.4.253",
      "remoteUpdateSupport": {
        "installMode": "interactive",
        "automatic": true,
        "reason": "available"
      },
      "capabilities": ["... 283개 ..."]
    },
    "graph": { "state": "ready" }
  },
  "_meta": { "runtimeId": "<uuid>" }
}
```

러너의 Online 판정은 "ssh 성공 + `ok: true` + `runtime.reachable: true` + `runtime.state: "ready"`"로 잡을 수 있다. `runtime.capabilities`는 기능 문자열 목록이라, 필요한 기능이 있는지 확인하는 데 쓸 수 있다. 런타임이 꺼져 있을 때 `status --json`은 `ok: true`, 종료 코드 0에 `runtime.reachable: false`, `state: "not_running"`을 낸다. 다른 명령은 `runtime_unavailable`로 실패한다 **[실행]**([research 0003](0003-orca-runner-contract.md) 1절).

창 없이 런타임을 띄우는 방법도 있다 **[스키마]**:

- `orca serve`: 데스크톱 창 없이 런타임 서버를 포그라운드로 띄운다. 같은 프로필을 이미 서빙 중이면 종료 코드 3.
- `orca serve service install|status|uninstall`: launchd·systemd 서비스로 등록한다. 서비스는 늘 `orca serve --supervise --no-pairing`을 돌려 서버가 멈추면 스스로 다시 띄운다. 1.4.258의 `install`에는 `--supervise` 플래그가 없고, `--command`의 기본값은 PATH의 `orca`라 비대화형 PATH에 없으면 절대 경로를 줘야 한다([research 0003](0003-orca-runner-contract.md) 6절).
- `orca serve service status --json` **[실행]**: `{ installed, manager: "launchd", name, unitPath, gaveUp, verdict: "live"|"exited"|"unverifiable", pid, detail }`.

### A.4 러너의 프로젝트 목록

두 단계로 나뉜다 **[스키마]**.

- `orca project list [--json]`: Orca가 아는 프로젝트(저장소 정체성) 목록.
- `orca project setups [--project <id>] [--host <host>] [--json]`: 프로젝트가 어느 호스트의 어느 경로에 준비돼 있는지. note: "A setup means a project is available on a host at a concrete filesystem path."

`project list --json` 행 하나 **[실행]**:

```json
{
  "id": "github:<owner>/<repo>",
  "displayName": "<repo>",
  "kind": "git",
  "providerIdentity": { "provider": "github", "owner": "<owner>", "repo": "<repo>" },
  "gitRemoteIdentity": {
    "canonicalKey": "github.com/<owner>/<repo>",
    "remoteName": "origin",
    "remoteUrl": "https://github.com/<owner>/<repo>.git"
  },
  "sourceRepoIds": ["<uuid>"],
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000
}
```

`project setups --json` 행 하나 **[실행]**:

```json
{
  "id": "<setup-uuid>",
  "projectId": "github:<owner>/<repo>",
  "hostId": "local",
  "repoId": "<uuid>",
  "path": "<path>",
  "displayName": "<repo>",
  "kind": "git",
  "hookSettings": {
    "mode": "auto",
    "setupRunPolicy": "run-by-default",
    "setupAgentStartupPolicy": "start-immediately",
    "scripts": { "setup": "...", "archive": "" }
  },
  "setupState": "ready",
  "setupMethod": "cloned",
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000
}
```

`setupState`가 받을 수 있는 값은 `setup-create`의 usage에 나온다: `ready|not-set-up|setting-up|error|unsupported` **[스키마]**. 매핑(Mapping)의 러너 쪽 프로젝트 키는 `projectId`(`github:<owner>/<repo>`)가 적당하다. GitHub 저장소와 바로 이어지고, 러너마다 다른 `repoId`·`path`보다 안정적이다.

`orca repo list --json`은 같은 저장소를 경로 기준으로 보여 준다(`id`, `path`, `displayName`, `kind`, `gitRemoteIdentity`, `hookSettings` 등) **[실행]**. 워크트리를 만들 때 `--repo id:<repoId>`로 지정할 수 있다.

### A.5 워크트리 만들기와 에이전트 시작

**첫판은 스키마와 help로만 확인했다.** 실제 출력은 [research 0004](0004-orca-run-contract.md) 4절에 있다.

```
orca worktree create --name <name>
  [--repo <selector> | --project <id-or-name> [--host <host>] | --project-host-setup <id>]
  [--agent <id>] [--prompt <text>] [--model <id>] [--effort <level>] [--surface chat|terminal]
  [--setup run|skip|inherit] [--base-branch <ref>] [--branch <name>]
  [--linear-issue <identifier-or-url>] [--pr <number>] [--comment <text>]
  [--parent-worktree <selector>] [--no-parent] [--activate] [--retry-launch <operationId>] [--json]
```

위 usage는 어댑터에 필요한 플래그만 남긴 것이다. 실제 usage에는 `--reference <url-or-jira-key>...`, `--reference-site <id>`, `--issue <number>`, `--gitlab-issue`, `--gitlab-mr`, `--run-hooks`도 있다 **[스키마]**.

**[스키마]** 핵심 notes:

- 새 체크아웃을 만든다. 이미 있는 워크트리에 에이전트만 띄우려면 `orca agent launch`를 쓴다.
- `--agent`를 주면 워크트리와 함께 에이전트를 시작하고, `--prompt`가 첫 지시가 된다. 이것이 "티켓 내용을 지시로 넘기는" 경로다.
- `--project`는 프로젝트 id 또는 표시 이름을 받는다. 그 프로젝트가 한 호스트에만 준비돼 있으면 `--host`가 필요 없다.
- `--branch`는 설정된 접두사 없이 Git 브랜치 이름을 정한다. 이미 있는 이름이면 숫자 접미사가 붙는다. `--base-branch`는 시작 ref다.
- `--no-parent`를 주지 않으면 호출한 맥락(Orca 터미널·현재 디렉터리)의 자식 워크트리로 기록된다. ssh 비대화형 셸은 Orca 워크트리 밖이므로, 어댑터는 `--no-parent`를 명시하는 편이 안전하다.
- `--linear-issue`는 워크트리에 Linear 이슈 링크를 기록한다(`worktree list`의 `linkedLinearIssue`).
- `--json`과 `--agent`를 함께 쓰면 `result.launch`가 무엇이 시작됐는지 알린다: `launch.outcome.kind`(`structured`=chat 또는 `terminal`), `launch.outcome.handle`, `launch.receipt.detail`. 더 오래된 호스트는 `result.agentTerminalHandle`만 준다 **[스키마]**.
- 프롬프트 전달 여부는 `prompt.outcome`이 `journaled` 또는 `handed-to-terminal`인지로 본다 **[문서]**(`orca skills get orca-cli`, "Full Handoffs").
- 응답을 잃으면 오류에 담긴 `operationId`로 같은 명령을 같은 디렉터리·같은 호스트에서 `--retry-launch <operationId>`와 함께 다시 보낸다. 새 launch로 재시도하면 에이전트가 둘 생길 수 있다 **[스키마]**.

에이전트가 chat으로 뜰지 terminal로 뜰지는 러너 쪽 사용자 설정(Chat | CLI)이 정한다. 오케스트레이터가 정하려면 `--surface terminal`을 준다 **[스키마]**. 진행 감지를 터미널 기반으로 하려면 `--surface terminal`이 예측 가능하다.

`--prompt`는 명령행 인자 하나로 넘어간다. ssh로 원격 실행할 때 티켓 본문의 따옴표·백틱·줄바꿈을 셸 이스케이프해야 한다. `orchestration worker-start`에는 `--spec-file <path|->`(stdin)가 있지만 `worktree create`와 `agent launch`에는 파일·stdin 입력 플래그가 없다 **[스키마]**.

기존 워크트리에 에이전트를 띄우는 명령 **[스키마]**:

```
orca agent launch --agent <id> [--worktree <selector>] [--prompt <text>] [--model <id>] [--effort <level>]
  [--surface chat|terminal] [--focus] [--retry-launch <operationId>] [--json]
```

### A.6 진행과 종료 감지

선택지는 셋이다.

**1) `orca worktree ps --json` (권장)** **[스키마]** "Show a compact orchestration summary across worktrees". 행 하나의 핵심 필드 **[실행]**:

```json
{
  "workspaceKind": "git",
  "worktreeId": "<repoId>::<path>",
  "repoId": "<uuid>",
  "hostId": "local",
  "branch": "refs/heads/<branch>",
  "displayName": "<name>",
  "workspaceStatus": "in-progress",
  "linkedLinearIssue": null,
  "linkedPR": null,
  "liveTerminalCount": 1,
  "hasAttachedPty": true,
  "lastOutputAt": 1790000000000,
  "status": "working",
  "agents": [
    {
      "paneKey": "<tabId>:<leafId>",
      "state": "working",
      "agentType": "claude",
      "prompt": "...",
      "toolName": "Bash",
      "interrupted": false,
      "stateStartedAt": 1790000000000,
      "updatedAt": 1790000000000,
      "hasLivePty": true,
      "programStatus": { "state": "working", "message": "...", "observedAt": 1790000000000 }
    }
  ],
  "sidebarStatus": "working",
  "terminalVerdict": "live"
}
```

결과에는 `hostScope`(`hostIds`, `omittedHostIds`, `omittedHostSelectors`), `totalCount`, `truncated`가 함께 온다 **[실행]**. 행 수 제한은 `--limit`이고, `truncated: true`면 잘린 것이다.

실제로 관측한 값 **[실행]** (워크트리 25개):

- 행 `status`: `active`, `working`, `permission`, `inactive`
- `agents[].state`: `working`, `done`, `waiting`
- `agents[].programStatus.state`: `working`, `done`, `blocked`, 없음(null)
- `terminalVerdict`: `live`, `none`

전체 열거값은 문서·스키마에 없다. 앱 번들 소스에서 `agents[].state`, `programStatus.state`, `terminalVerdict`의 닫힌 목록을 찾았다([research 0004](0004-orca-run-contract.md) 2절). 행 `status`는 닫힌 목록을 찾지 못했다. 소스의 목록도 다음 버전에서 늘 수 있으므로 어느 필드든 모르는 값은 "진행 중"으로 다루는 편이 안전하다.

`--agent-wait`를 주면 사람만 답할 수 있는 프롬프트(권한 메뉴 등)에 멈춘 에이전트를 행마다 `agentWait`로 표시한다 **[스키마]**. 권한·질문 대기에 걸린 런을 Waiting for Input으로 볼지 판단하는 데 쓸 수 있다. 질문(`AskUserQuestion`)에도 왔다 **[실행]**([research 0004](0004-orca-run-contract.md) 3절).

**2) 터미널 명령** **[스키마]**. 특정 에이전트 터미널을 따라갈 때 쓴다.

- `orca terminal list [--worktree <selector>] --json`: `terminals[]`에 `handle`, `worktreeId`, `tabId`, `leafId`, `connected`, `lastOutputAt`, `agentIdentity` 등 **[실행]**.
- `worktree ps`의 `agents[].paneKey`(`<tabId>:<leafId>`)를 `terminal list`의 `tabId`·`leafId`와 이어야 특정 에이전트의 핸들을 얻는다 **[문서]**(`orca skills get orca-cli`, "Terminals").
- `orca terminal wait --terminal <handle> --for exit|tui-idle --timeout-ms <ms> --json`: 에이전트 CLI에는 `tui-idle`을 쓰고 `--timeout-ms`를 반드시 준다 **[문서]**. 블로킹 호출이라 ssh 세션을 오래 잡는다. 폴링 설계(ADR 0002)와는 `worktree ps`가 더 맞다.
- `orca terminal read --terminal <handle> [--cursor <n>] [--limit <n>] [--screen] --json`: `result.terminal`에 `handle`, `status`(`running|exited|unknown`), `tail`, `truncated`, `nextCursor` 등 **[스키마]**. 실패 사유를 런 로그로 남길 때 쓸 수 있다. 단, `terminal close`나 `worktree rm --force`로 터미널을 끝낸 뒤에는 같은 핸들의 `tail`이 비므로 멈추거나 지우기 전에 읽어야 한다 **[실행]**([research 0003](0003-orca-runner-contract.md) 19절).

**3) `orca orchestration` task/dispatch** **[스키마]**. Orca 자체의 코디네이터·워커 메일박스 모델(Run, Task, Dispatch, `worker_done`)이다. 워커가 `orca orchestration send --type worker_done`으로 스스로 끝을 알려야 하고, 호출자는 Run에 묶인 코디네이터여야 한다. 실제로 워커 맥락에서 `orchestration task-list`를 부르면 `run_required` 오류가 났다 **[실행]**. 이 모델은 에이전트에게 오케스트레이션 프로토콜을 지시로 줘야 하는데, 이는 "에이전트에게는 티켓만 지시로 준다"(GLOSSARY Agent, ADR 0004)와 맞지 않는다. 용어도 겹친다(Orca의 Run·Dispatch와 이 제품의 Run·Assignment). 1단계 어댑터에는 쓰지 않는 쪽을 권한다.

**종료 판정 제안.** ADR 0004에 따라 오케스트레이터는 "런이 끝났는지"만 알면 되고 결과는 GitHub PR 상태로 정한다. 끝남의 신호 후보는 다음과 같다. 어느 조합이 믿을 만한지는 실제 런으로 확인해야 한다. 실제 런의 결과는 [research 0004](0004-orca-run-contract.md) 3절에 있다. 대화형 에이전트는 일을 마쳐도 프로세스가 끝나지 않고, 끝나도 셸 터미널이 남아 아래 둘째 후보는 에이전트 종료 신호가 아니었다.

- 해당 워크트리 행의 모든 `agents[].state`가 `done`이고 일정 시간 유지됨.
- ~~`liveTerminalCount: 0` 또는 `terminalVerdict: "none"`(에이전트 프로세스가 끝남).~~ 에이전트가 끝나도 띄운 셸이 남아 `live`였다. 에이전트 종료는 행의 `agents`에서 전에 본 그 에이전트가 사라지는 것으로 보인다 **[실행]**([research 0004](0004-orca-run-contract.md) 3절, 조건 포함).
- 워크트리 행이 사라짐(누군가 지움) → Failed 후보. 단, `worktree ps`에는 워크트리별 필터가 없고 `--limit`으로 잘린다. 응답이 `truncated: false`이고 `hostScope.hostIds`에 `local`이 있을 때만 "없음"을 증거로 쓴다. 그 밖에는 `worktree show --worktree <selector> --json`의 `selector_not_found`로 다시 확인한다.

### A.7 워크트리 조회와 정리

- `orca worktree list [--repo <selector>] [--limit <n>] --json` **[스키마]**. 행에 `id`(`<repoId>::<path>`), `identity.key`(`wt2:<host>:<instanceId>`), `repoId`, `projectId`, `hostId`, `path`, `head`, `branch`, `displayName`, `linkedLinearIssue`, `linkedPR`, `linkedItems`, `workspaceStatus`, `isArchived`, `lastActivityAt` 등 **[실행]**.
- `orca worktree show --worktree <selector> --json` **[스키마]**. 선택자는 `id:<repo-id>::<absolute-path>`, `path:`, `name:`, `branch:`, `identity:`, `issue:`, `current`, `active` **[실행]**(오류의 `validSelectorForms`). 어댑터는 이름 대신 `create` 결과의 전체 `id`(`<repoId>::<path>`)를 저장해 쓰는 편이 안전하다. 이름·브랜치는 겹칠 수 있다. `worktree ps` 행에도 `worktreeId`(같은 `<repoId>::<path>`), `worktreeInstanceId`, `identity`가 있으므로 **[실행]**, `worktreeId`로 저장하면 `ps` 행과 바로 맞출 수 있다. 첫판은 `ps` 행에 `identity`가 없다고 적었으나 1.4.258에서는 `--agent-wait` 유무와 상관없이 있었다([research 0003](0003-orca-runner-contract.md)).
- `orca worktree rm --worktree <selector> [--force] [--delete-branch] [--run-hooks] [--allow-failed-archive-hook] --json` **[스키마]**. 새 호스트에서는 로컬 브랜치를 기본으로 남기고, `--delete-branch`를 줘도 병합이 증명되지 않은 브랜치는 남긴다. `--run-hooks`일 때 archive hook이 실패하면 `worktree_archive_hook_failed`로 아무것도 지우지 않는다. 실행 결과는 [research 0003](0003-orca-runner-contract.md) 9절에 있다. 에이전트가 남긴 untracked 파일이 있으면 `--force` 없이 지워지지 않는다.

정리 시점은 런이 끝나고 PR 상태를 판정한 뒤다. PR이 열린 채(Human Check) 끝난 런의 워크트리를 지울지는 제품 결정이다.

### A.8 ssh 원격 실행 시 주의점

- **PATH.** macOS 앱 설치에서 `orca`는 `/Applications/Orca.app/Contents/Resources/bin/orca`에 있고 **[실행]** `/usr/local/bin`·`/opt/homebrew/bin`에는 링크가 없었다 **[실행]**. Orca가 띄운 터미널에서만 PATH에 이 경로가 들어간다. 빈 환경으로 띄운 `zsh -c`, `bash -c`, `zsh -lc` 모두 `orca`를 찾지 못했다 **[실행]**. ssh 비대화형 명령도 같았다(종료 코드 127, [research 0003](0003-orca-runner-contract.md) 6절). 러너 등록 때 `orca` 실행 파일 경로를 설정으로 받고, 기본값을 차례로 시도하는 편이 낫다. 가이드는 개발 빌드가 `/usr/local/bin` 심볼릭 링크를 쓰기도 한다고 적는다 **[문서]**(`orca skills get orca-cli`). Linux 설치 경로는 확인하지 못했다.
- **런처 스크립트.** `orca`는 bash 스크립트이고 Electron 바이너리를 `ELECTRON_RUN_AS_NODE=1`로 띄워 CLI를 실행한다 **[실행]**. 원격에 bash가 필요하다.
- **런타임.** help의 Behavior 절: "Most commands require a running Orca runtime. If Orca is not open yet, run `orca open` first." **[실행]**(`orca --help`). `orca open`은 데스크톱 앱을 띄우므로 GUI 세션이 없는 ssh에서는 실패할 수 있다. 창 없는 러너는 `orca serve`(서비스 등록 권장)로 런타임을 상시 띄워 두는 구성이 맞다 **[스키마]**.
- **원격 런타임 대안.** Orca는 자체 원격 연결도 지원한다. 다른 기계의 `orca serve`와 페어링(`orca environment add --pairing-code`)한 뒤 `--environment <name>`이나 `ORCA_ENVIRONMENT`·`ORCA_PAIRING_CODE` 환경 변수로 명령을 그 서버로 보낼 수 있다 **[실행]**(`orca --help`). ADR 0002는 ssh를 택했지만, 오케스트레이터 기계에 Orca를 설치하지 않는다는 전제가 바뀌면 다시 볼 만한 선택지다. Orca 런타임 자신도 ssh 대상을 등록해 쓸 수 있다(`orca host list`의 `--host ssh:<target-id>`, `worktree create --host`) **[스키마]**. 이 역시 오케스트레이터 쪽에 Orca 런타임이 있어야 한다.
- **호스트 범위.** `worktree list`·`worktree ps`는 그 런타임이 닿는 호스트만 덮고, 못 덮은 호스트를 `hostScope.omittedHostIds`로 알린다 **[스키마]**. ssh로 러너에서 직접 실행하면 그 러너의 `local` 호스트가 기준이다.
- **인자 전달.** 원격 명령 문자열은 원격 셸이 한 번 더 해석한다. 인자 하나를 따옴표로 묶어 넘기지 않으면 `Unknown command: project list` 같은 오류가 난다(로컬 재현) **[실행]**.

## B. Linear

### B.1 인증

**[문서]** https://linear.app/developers/graphql, https://linear.app/developers/oauth-2-0-authentication

- 엔드포인트: `https://api.linear.app/graphql`.
- 개인 API 키: `Authorization: <API_KEY>` (`Bearer` 없음).
- OAuth 액세스 토큰: `Authorization: Bearer <ACCESS_TOKEN>`.
- OAuth 엔드포인트: authorize `GET https://linear.app/oauth/authorize`, token `POST https://api.linear.app/oauth/token`, revoke `POST https://api.linear.app/oauth/revoke`.
- 스코프: `read`(기본), `write`, `issues:create`, `comments:create`, `timeSchedule:write`, `admin`. 문서는 `admin`을 "absolutely needed"일 때만 요청하라고 한다.
- `actor`: `user`(기본) 또는 `app`.
- 액세스 토큰 수명 기본 24시간, refresh token은 발급 후 30일에 만료. client credentials 토큰(`actor=app`)은 30일, refresh token 없음.

**셀프호스팅에 맞는 쪽.** 1단계는 개인 API 키를 권한다. 근거는 다음과 같다.

- OAuth는 어느 방식이든 앱을 Linear에 등록해 client id/secret을 받아야 한다. 셀프호스팅이라 설치마다 운영자가 OAuth 앱을 만들어야 하고, 온보딩 단계가 늘어난다(ADR 0005의 "Linear 연결" 단계).
- authorization code 방식은 redirect URI가 필요하고, 액세스 토큰 24시간·refresh 30일이라 오케스트레이터가 30일 넘게 쉬면 다시 인증해야 한다.
- client credentials 방식(`actor=app`)은 사용자 흐름과 redirect URI가 없고, 30일짜리 토큰을 앱이 client id/secret으로 다시 받으면 된다 **[문서]**. 다만 앱에서 이 방식을 먼저 켜야 하고, 앱 등록 부담은 그대로다. 변경이 앱 이름으로 남는 장점이 있어, 다중 사용자나 봇 표기가 필요해지면 다시 볼 후보다.
- 개인 API 키는 붙여 넣기 하나로 끝나고, DB에 암호화해 저장하면 된다(ADR 0005).
- 단점: 상태 변경·댓글이 운영자 본인 이름으로 남고, 요청 수 한도가 OAuth보다 낮다(2,500 대 5,000/시간). 복잡도 한도는 API 키가 더 높다(3,000,000 대 2,000,000/시간, B.4).

webhook을 API로 만들려면 워크스페이스 관리자이거나 `admin` 스코프 OAuth 앱이어야 한다 **[문서]**("Only workspace admins, or OAuth applications with the `admin` scope, can create or read webhooks."). 운영자가 관리자가 아닐 수 있으므로, 온보딩은 Settings > API에서 webhook을 손으로 만들게 안내하고 signing secret을 붙여 넣게 하는 편이 단순하다.

### B.2 Webhook

**[문서]** https://linear.app/developers/webhooks

- 대상 모델: Issues, Issue attachments, Issue comments, Issue labels, Comment reactions, Projects, Project updates, Documents, Initiatives, Initiative Updates, Cycles, Customers, Customer Requests, Users. 그 밖에 Issue SLA, OAuthApp revoked.
- `action`: `create`, `update`, `remove`.
- 본문 필드: `action`, `actor`(null 가능), `createdAt`, `data`(대상의 직렬화 값), `type`(예: `Issue`), `url`, `updatedFrom`, `webhookTimestamp`. 예시에는 `organizationId`, `webhookId`도 있다.
- `updatedFrom`: "For `update` actions, an object containing the previous values of all updated properties. Properties that were previously not set, will have a value of `null`."
- 헤더: `Linear-Delivery`(UUID v4), `Linear-Event`(예: `Issue`), `Linear-Signature`, `Linear-Timestamp`(Unix ms), `User-Agent: Linear-Webhook`.

**서명 검증.**

- `Linear-Signature`는 원문 본문 바이트의 HMAC-SHA256을 hex로 인코딩한 값이고, 키는 webhook signing secret이다 **[문서]**. JSON을 다시 문자열화하지 말고 받은 바이트 그대로 검증한다.
- 재전송 방지: 본문의 `webhookTimestamp`(ms)가 받은 시각과 1분 안인지 본다 **[문서]**.
- 공식 SDK `@linear/sdk`(102.0.0)의 `@linear/sdk/webhooks`가 이를 구현한다 **[스키마]**(npm 패키지 소스). `LinearWebhookClient(secret)`의 `verify(rawBody, signature, timestamp)`는 `createHmac("sha256", secret)`, `crypto.timingSafeEqual`, `Math.abs(Date.now() - timestamp) > 60_000`이면 실패한다. 상수는 `LINEAR_WEBHOOK_SIGNATURE_HEADER = "linear-signature"`, `LINEAR_WEBHOOK_TS_HEADER = "linear-timestamp"`, `LINEAR_WEBHOOK_TS_FIELD = "webhookTimestamp"`, 본문 최대 크기 기본 5 MiB. `parseData(rawBody, signature, timestamp)`, `createHandler(options)`도 있다.
- 발신 IP 목록은 https://linear.app/docs/security 와 https://linear.app/.well-known/appspecific/app.linear.ips.json 에 있다 **[문서]**. 서명 검증이 1차 방어이고, IP 허용 목록은 선택이다.

**재시도 정책** **[문서]**. 서버가 응답하지 않거나, 5초(5000ms)를 넘기거나, 200이 아닌 상태 코드를 내면 실패다. 최대 3번, 1분·1시간·6시간 뒤에 재시도한다. 계속 응답하지 않으면 Linear가 webhook을 끌 수 있고, 손으로 다시 켜야 한다.

이 제품에 주는 뜻:

- 수신 핸들러는 서명 검증과 DB 기록만 하고 5초 안에 200을 돌려준다. 실제 할당은 worker가 큐에서 처리한다(ADR 0002).
- 같은 이벤트가 두 번 올 수 있으므로 `Linear-Delivery`로 중복을 거른다.
- webhook이 꺼질 수 있으므로 ADR 0001의 주기적 폴링 보정이 꼭 필요하다.

**Auto-assign Label 감지.** 라벨 추가와 상태 변경은 `type: "Issue"`, `action: "update"` 이벤트로 오고, `data`에 현재 값이, `updatedFrom`에 이전 값이 담길 것으로 본다. `Issue` 객체에 `labelIds`, `state` 필드가 있다 **[스키마]**(Linear introspection). 하지만 `updatedFrom`에 `labelIds`·`stateId`가 실제로 담기는지는 문서 예시로 확인하지 못했다(아래 "아직 모르는 것"). 확인 전까지는 "`data.labelIds`에 Auto-assign Label이 있고, 그 티켓에 진행 중인 런이 없다"를 할당 조건으로 쓰면 `updatedFrom`에 기대지 않아도 된다.

webhook 만들기 mutation **[문서]**, 입력 필드 **[스키마]**:

```graphql
mutation {
  webhookCreate(
    input: {
      url: "https://orchestrator.example.com/webhooks/linear"
      teamId: "<team-id>" # 또는 allPublicTeams: true
      resourceTypes: ["Issue"]
      secret: "<signing-secret>" # WebhookCreateInput에 secret 필드가 있다
      label: "factory-orchestrator"
    }
  ) {
    success
    webhook {
      id
      enabled
    }
  }
}
```

`WebhookCreateInput` 필드: `label`, `id`, `enabled`, `secret`, `url`, `resourceTypes`, `teamId`, `allPublicTeams` **[스키마]**.

### B.3 API 쿼리 예시

필드 이름은 Linear introspection으로 확인했다 **[스키마]**. 공개 스키마는 인증 없이 introspection된다 **[실행]**.

이슈 조회(제목·본문·댓글·라벨·프로젝트):

```graphql
query Issue($id: String!) {
  issue(id: $id) {
    # "ENG-123" 같은 identifier 또는 UUID
    id
    identifier
    title
    description
    url
    branchName
    state {
      id
      name
      type
    }
    labels {
      nodes {
        id
        name
      }
    }
    project {
      id
      name
    }
    team {
      id
      key
    }
    comments(first: 50) {
      nodes {
        id
        body
        createdAt
        user {
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

`issue(id: "BLA-123")`처럼 identifier로 조회하는 예시는 문서에 있다 **[문서]**(graphql). `Issue.branchName`은 Linear가 제안하는 브랜치 이름이다 **[스키마]**.

상태 변경 **[문서]**:

```graphql
mutation {
  issueUpdate(id: "ENG-123", input: { stateId: "<state-id>" }) {
    success
    issue {
      id
      state {
        id
        name
      }
    }
  }
}
```

`IssueUpdateInput`에는 `stateId`, `labelIds`, `addedLabelIds`, `removedLabelIds`, `projectId` 등이 있다 **[스키마]**. 라벨 하나만 더하거나 뺄 때는 `issueAddLabel`, `issueRemoveLabel` mutation도 있다 **[스키마]**.

워크플로 상태 목록. 상태는 팀마다 다르므로 팀 기준으로 찾는다 **[문서]**:

```graphql
query {
  workflowStates(filter: { team: { id: { eq: "<team-id>" } } }) {
    nodes {
      id
      name
      type
    }
  }
}
```

`WorkflowState.type`은 `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`, `duplicate` 중 하나다 **[스키마]**(필드 설명). 런 시작 시 "started" 계열 상태로 옮기려면 이름 대신 `type`으로 고르는 편이 워크스페이스마다 덜 깨진다.

댓글 쓰기. `CommentCreateInput`에 `issueId`, `body`, `parentId` 등이 있다 **[스키마]**:

```graphql
mutation {
  commentCreate(input: { issueId: "<issue-uuid>", body: "런을 시작했다: <run-url>" }) {
    success
    comment {
      id
      url
    }
  }
}
```

PR 링크 첨부. `attachmentLinkGitHubPR`, `attachmentLinkURL`, `attachmentCreate` mutation이 있다 **[스키마]**. Linear GitHub 통합이 켜져 있으면 Linear가 PR을 스스로 잇기도 하므로, 중복 첨부 여부는 확인이 필요하다.

프로젝트 목록 **[스키마]**:

```graphql
query {
  projects(first: 50) {
    nodes {
      id
      name
      slugId
      url
      teams {
        nodes {
          id
          key
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

페이지 나누기 **[문서]** (https://linear.app/developers/pagination): Relay 방식 `first`/`after`, `last`/`before`. 인자가 없으면 50개를 준다. `pageInfo { hasNextPage endCursor }`. 최대 페이지 크기는 문서에 없다. 필터는 `eq`, `neq`, `in`, `nin` 등을 쓴다 **[문서]** (https://linear.app/developers/filtering).

상위 이슈(티켓 0171). 공개 스키마(`linear/linear`의 `packages/sdk/src/schema.graphql`, 2026-11-22 확인)에서 `Issue.parent`는 null이 될 수 있는 `Issue`다 **[스키마]**. 프로젝트 티켓 목록은 `parent`를 3단계까지 중첩해 `id identifier title url state { name type }`을 읽는다. 티켓 하나를 읽는 쿼리와 라벨 쿼리에는 넣지 않는다. 실제 Linear 응답과 복잡도 점수는 이 조사에서 재지 않았다.

### B.4 Rate limit

**[문서]** https://linear.app/developers/rate-limiting

| 인증     | 요청/시간                       | 복잡도 점수/시간 |
| -------- | ------------------------------- | ---------------- |
| API 키   | 2,500 (사용자당)                | 3,000,000        |
| OAuth 앱 | 5,000 (사용자 또는 앱 사용자당) | 2,000,000        |
| 비인증   | 600 (IP당)                      | 100,000          |

- 쿼리 하나의 최대 복잡도는 10,000점. 속성 0.1점, 객체 1점, connection은 `first`(기본 50)만큼 곱한다.
- 응답 헤더: `X-RateLimit-Requests-Limit`, `X-RateLimit-Requests-Remaining`, `X-RateLimit-Requests-Reset`(UTC epoch ms), `X-Complexity`, `X-RateLimit-Complexity-*`.
- 초과 시 HTTP 429, `errors[].extensions.code = "RATELIMITED"`, `Retry-After` 헤더(초).
- Business 플랜은 2배, Enterprise는 5배.

API 키 2,500/시간이면 폴링 보정을 1분마다 한 번 해도 60회/시간이라 여유가 크다. 이슈 조회에서 `comments(first: 50)` 같은 중첩 connection은 복잡도를 빠르게 키우므로 `first`를 작게 준다.

## C. GitHub

### C.1 판정에 필요한 정보

ADR 0004의 판정은 "런이 끝났을 때 그 런의 PR이 병합됐나, 열려 있나, 없나"다. 필요한 것은 (1) 런의 브랜치로 PR 찾기, (2) PR 상태와 병합 여부, (3) 보조로 CI 체크 상태다. 브랜치 이름은 런 시작 때 오케스트레이터가 `worktree create --branch`로 정하거나, 생성 결과의 `branch`를 기록해 둔다(A.5, A.7).

### C.2 GraphQL 한 번으로 조회 (권장)

필드와 열거값은 GitHub introspection으로 확인했고, 실제 저장소의 병합된 PR로 응답을 확인했다 **[스키마]**, **[실행]**.

```graphql
query RunPr($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, first: 5, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        number
        url
        state
        merged
        mergedAt
        headRefName
        headRefOid
        baseRefName
        isCrossRepository
        headRepository {
          nameWithOwner
        }
        mergeStateStatus
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
              }
            }
          }
        }
      }
    }
  }
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
}
```

실제 응답 **[실행]** (값은 가림):

```json
{
  "number": 2,
  "state": "MERGED",
  "merged": true,
  "mergedAt": "2026-11-17T08:24:05Z",
  "headRefName": "<branch>",
  "headRefOid": "<sha>",
  "baseRefName": "main",
  "mergeStateStatus": "UNKNOWN",
  "commits": {
    "nodes": [{ "commit": { "oid": "<sha>", "statusCheckRollup": { "state": "SUCCESS" } } }]
  }
}
```

`rateLimit`은 `{ "limit": 5000, "cost": 1 }`이었다 **[실행]**.

열거값 **[스키마]**:

- `PullRequestState`: `OPEN`, `CLOSED`, `MERGED`
- `StatusState`(statusCheckRollup.state): `EXPECTED`, `ERROR`, `FAILURE`, `PENDING`, `SUCCESS`
- `CheckStatusState`: `REQUESTED`, `QUEUED`, `IN_PROGRESS`, `COMPLETED`, `WAITING`, `PENDING`
- `CheckConclusionState`: `ACTION_REQUIRED`, `TIMED_OUT`, `CANCELLED`, `FAILURE`, `SUCCESS`, `NEUTRAL`, `SKIPPED`, `STARTUP_FAILURE`, `STALE`
- `MergeStateStatus`: `DIRTY`, `UNKNOWN`, `BLOCKED`, `BEHIND`, `UNSTABLE`, `HAS_HOOKS`, `CLEAN`, 그리고 deprecated된 `DRAFT`(`includeDeprecated: true`일 때만 보인다)

병합된 PR의 `mergeStateStatus`는 `UNKNOWN`으로 왔다 **[실행]**. 판정에는 `state`/`merged`만 쓴다.

판정 규칙:

| PR 조회 결과                     | 런 결과                                        |
| -------------------------------- | ---------------------------------------------- |
| `state: MERGED` (`merged: true`) | Merged                                         |
| `state: OPEN`                    | Human Check                                    |
| PR 없음                          | Failed                                         |
| `state: CLOSED`, 병합 안 됨      | Failed(사유: PR이 닫힘). ADR 0004에서 결정했다 |

같은 브랜치로 PR이 여러 개면(닫고 다시 연 경우) 가장 최근 것을 쓴다. `headRefName`은 포크까지 구분하지 않으므로, `isCrossRepository: false`이고 `headRepository.nameWithOwner`가 대상 저장소인지, `baseRefName`이 기대한 브랜치인지 함께 확인한다. 이 두 필드는 위 응답 예시에는 없지만, 같은 PR로 따로 조회해 `isCrossRepository: false`와 `headRepository.nameWithOwner` 값을 확인했다 **[실행]**.

### C.3 REST로 조회 (대안)

**[문서]** https://docs.github.com/en/rest/pulls/pulls

- PR 찾기: `GET /repos/{owner}/{repo}/pulls?state=all&head=<owner>:<branch>`. `head`는 "user:ref-name or organization:ref-name" 형식, `state`는 `open`·`closed`·`all`(기본 `open`). 목록 응답에는 `merged` 불리언이 없고 `merged_at`(null 가능)이 있다. 실제 응답에서 병합된 PR은 `state: "closed"`, `merged_at`이 채워져 있었다 **[실행]**.
- 단건: `GET /repos/{owner}/{repo}/pulls/{pull_number}` 응답에 `merged`(불리언), `mergeable`(null이면 계산 중), `mergeable_state`.
- 병합 확인: `GET /repos/{owner}/{repo}/pulls/{pull_number}/merge`, 204면 병합됨, 404면 아님.
- 브랜치·커밋으로 PR 찾기: `GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls` **[문서]** (https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit).
- CI: `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` **[문서]** (https://docs.github.com/en/rest/checks/runs), `GET /repos/{owner}/{repo}/commits/{ref}/status` **[문서]** (https://docs.github.com/en/rest/commits/statuses). combined status는 하나라도 error/failure면 `failure`, 상태가 없거나 pending이 있으면 `pending`, 모두 success면 `success`.

REST는 판정에 2~3번 호출이 들지만, ETag 조건부 요청(304는 한도에서 빠짐)을 쓸 수 있다는 장점이 있다(C.5).

### C.4 토큰 권한 (fine-grained 최소 권한)

**[문서]** https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens

판정에 필요한 저장소 권한은 모두 읽기다.

| 권한                  | 쓰는 엔드포인트                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Metadata: read        | 모든 fine-grained PAT에 기본 포함                                                                      |
| Pull requests: read   | `GET /repos/{owner}/{repo}/pulls`, `GET .../commits/{commit_sha}/pulls`, `GET .../pulls/{pull_number}` |
| Commit statuses: read | `GET .../commits/{ref}/status`, `GET .../commits/{ref}/statuses`                                       |

`GET .../pulls/{pull_number}`은 Contents와 Pull requests 두 표에 모두 있고 "Additional permissions" 열이 ✓다. 문서는 ✓를 "여러 권한이 필요하거나, 집합 중 하나면 되는" 경우라고 설명한다.

**Checks API 제약.** 같은 문서 사이트의 PAT 관리 페이지는 fine-grained PAT의 알려진 한계로 "Using fine-grained personal access token to call the Checks API"를 적는다 **[문서]** (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens, "Fine-grained personal access tokens limitations"). 권한 표에도 Checks 권한 절이 없다. REST check-runs 엔드포인트는 fine-grained PAT로 못 쓸 수 있다. GraphQL `statusCheckRollup`이 fine-grained PAT로 check run 결과까지 담아 주는지는 확인하지 못했다(아래 "아직 모르는 것"). 판정 자체는 PR 상태만 쓰므로 이 제약에 막히지 않는다. CI 상태는 화면 보조 정보로만 쓴다.

fine-grained PAT의 다른 한계 **[문서]** (같은 페이지): 조직 저장소는 조직 관리자가 승인하기 전까지 공개 리소스만 읽는다. 조직이 최대 수명 정책을 걸 수 있다. 사용자당 50개까지 만들 수 있다. 실패한 요청은 `X-Accepted-GitHub-Permissions` 헤더로 필요한 권한을 알려 준다 **[문서]** (권한 페이지).

GraphQL은 PAT로 인증할 수 있다 **[문서]** (https://docs.github.com/en/graphql/guides/forming-calls-with-graphql).

### C.5 Rate limit과 폴링 간격

REST **[문서]** (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):

- 인증 사용자 5,000 요청/시간, 비인증 60.
- secondary limit: 동시 요청 100개(REST·GraphQL 합산), REST 900점/분(GET 1점, 쓰기 5점), GraphQL 2,000점/분.
- 헤더: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-used`, `x-ratelimit-reset`(UTC epoch 초), `x-ratelimit-resource`. 실제 응답에서도 확인했다 **[실행]**.
- 초과 시 403 또는 429. `retry-after`가 있으면 따르고, 없으면 최소 1분 기다린다.

GraphQL **[문서]** (https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api):

- PAT 5,000점/시간. 쿼리 점수는 connection별 요청 수 합을 100으로 나눠 반올림, 최소 1. C.2 쿼리는 1점이었다 **[실행]**.
- `first`/`last`는 1~100.
- 초과해도 HTTP 200에 오류 메시지가 오고 `x-ratelimit-remaining`이 0이다. 상태 코드만 보면 놓친다.

폴링 권장 **[문서]** (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api):

- 가능하면 webhook을 구독하라고 권한다. ADR 0002는 러너 쪽 콜백 없이 폴링을 택했고, GitHub webhook은 공개 수신 주소가 필요하다.
- 폴링한다면 `x-poll-interval` 헤더가 있을 때 그만큼 기다린다.
- 저장한 `etag`를 `if-none-match`로 보내 304를 받으면 한도에서 빠진다(올바른 Authorization 헤더가 있을 때).
- 동시 요청을 피하고, 쓰기 요청 사이에는 최소 1초를 둔다.

간격 제안: PR 판정은 런이 끝났다고 감지한 뒤 한 번 하면 된다(ADR 0004). 런 진행 중 PR 링크를 화면에 보이려면 진행 중인 런마다 30~60초 간격 GraphQL 1점 쿼리로 충분하다. 런 50개를 60초마다 조회해도 3,000점/시간이라 5,000점 안에 든다.

## 어댑터 인터페이스 초안

구현 없는 타입 시그니처 초안이다. 이름은 GLOSSARY를 따른다. 외부 값은 문자열 그대로 두고, 모르는 열거값이 와도 깨지지 않게 `(string & {})`로 열어 둔다.

```ts
// ---------- 공통 ----------
type Brand<T, B extends string> = T & { readonly __brand: B };

type TicketKey = Brand<string, "TicketKey">; // Linear identifier, 예: "ENG-123"
type RunnerId = Brand<string, "RunnerId">;
type RunnerProjectId = Brand<string, "RunnerProjectId">; // Orca projectId, 예: "github:acme/app"
type WorktreeRef = Brand<string, "WorktreeRef">; // Orca worktree id "<repoId>::<path>" (worktree ps의 worktreeId와 같은 값)

// ---------- Tracker (Linear) ----------
interface TrackerTicket {
  key: TicketKey;
  trackerId: string; // Linear issue UUID
  title: string;
  body: string; // markdown
  url: string;
  labels: ReadonlyArray<{ id: string; name: string }>;
  project: { id: string; name: string } | null;
  team: { id: string; key: string };
  state: { id: string; name: string; type: TrackerStateType };
  suggestedBranchName: string | null;
}

type TrackerStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "duplicate"
  | (string & {});

interface TrackerComment {
  id: string;
  body: string;
  createdAt: string; // ISO 8601
  author: string | null;
}

interface TrackerProject {
  id: string;
  name: string;
  url: string;
  teamIds: ReadonlyArray<string>;
}

/** 서명·타임스탬프 검증을 통과한 webhook 하나. 검증 실패는 이 타입이 되지 못한다. */
interface TrackerEvent {
  deliveryId: string; // Linear-Delivery, 중복 제거 키
  kind: "ticket.updated" | "ticket.created" | "ticket.removed" | "other";
  ticketKey: TicketKey | null;
  labelIds: ReadonlyArray<string> | null; // data.labelIds
  previous: Readonly<Record<string, unknown>> | null; // updatedFrom
  receivedAt: Date;
}

type WebhookVerifyError = "bad-signature" | "stale-timestamp" | "body-too-large" | "malformed";

interface Tracker {
  verifyWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string | undefined>>;
    now: Date;
  }): { ok: true; event: TrackerEvent } | { ok: false; error: WebhookVerifyError };

  getTicket(key: TicketKey): Promise<TrackerTicket | null>;
  listComments(
    key: TicketKey,
    page?: { after?: string; first?: number },
  ): Promise<{
    comments: ReadonlyArray<TrackerComment>;
    nextCursor: string | null;
  }>;
  /** 폴링 보정용: 라벨이 붙은 티켓을 updatedAt 이후로 찾는다. */
  listLabeledTickets(input: {
    labelName: string;
    updatedSince: Date;
  }): Promise<ReadonlyArray<TrackerTicket>>;
  listProjects(): Promise<ReadonlyArray<TrackerProject>>;
  listStates(
    teamId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; type: TrackerStateType }>>;

  setState(key: TicketKey, stateId: string): Promise<void>;
  addComment(key: TicketKey, body: string): Promise<{ id: string; url: string }>;
}

type TrackerError =
  | { kind: "unauthorized" }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "not-found" }
  | { kind: "network"; cause: unknown };

// ---------- Runner (Orca over ssh) ----------
interface RunnerConnection {
  sshTarget: string; // ssh config의 Host 이름 등, 운영자 설정 값
  orcaPath: string; // 원격 orca 실행 파일 절대 경로 (A.8)
}

interface RunnerHealth {
  online: boolean; // ssh 성공 + runtime ready
  orcaVersion: string | null;
  runtimeState: "ready" | (string & {}) | null;
  checkedAt: Date;
  error: RunnerError | null;
}

interface RunnerProject {
  id: RunnerProjectId; // project setups[].projectId
  setupId: string;
  displayName: string;
  setupState: "ready" | "not-set-up" | "setting-up" | "error" | "unsupported" | (string & {});
}

interface StartRunInput {
  project: RunnerProjectId;
  worktreeName: string;
  branch: string;
  baseBranch?: string;
  agent: string; // Orca agent id, 예: "claude", "codex"
  prompt: string; // 티켓 내용만 (GLOSSARY Agent)
  linearIssue?: string; // --linear-issue
  /** 응답을 잃었을 때 같은 launch를 다시 보내기 위한 값 (--retry-launch) */
  retryOperationId?: string;
}

interface StartedRun {
  worktree: WorktreeRef;
  branch: string;
  agentHandle: string | null;
  promptDelivered: boolean; // prompt.outcome이 journaled 또는 handed-to-terminal
}

type RunProgress =
  | { kind: "running"; agentStates: ReadonlyArray<string>; lastOutputAt: Date | null }
  | { kind: "waiting-for-human"; detail: string } // --agent-wait 결과
  | { kind: "finished" } // 에이전트가 끝남. 결과는 GitHub로 판정한다 (ADR 0004)
  | { kind: "gone" }; // 워크트리가 없어짐

type RunnerError =
  | { kind: "ssh-failed"; exitCode: number | null; stderr: string }
  | { kind: "orca-not-found" }
  | { kind: "runtime-unavailable"; detail: string }
  | { kind: "orca-error"; code: string; message: string } // error.code 그대로
  | { kind: "launch-outcome-unknown"; operationId: string }
  | { kind: "malformed-output"; raw: string };

interface Runner {
  checkHealth(conn: RunnerConnection): Promise<RunnerHealth>;
  listProjects(conn: RunnerConnection): Promise<ReadonlyArray<RunnerProject>>;
  startRun(conn: RunnerConnection, input: StartRunInput): Promise<StartedRun>;
  pollRun(conn: RunnerConnection, worktree: WorktreeRef): Promise<RunProgress>;
  /** 런 종료·판정 뒤 정리. 브랜치는 지우지 않는다(PR이 쓴다). */
  removeWorktree(
    conn: RunnerConnection,
    worktree: WorktreeRef,
    opts: { force: boolean },
  ): Promise<void>;
}

// ---------- Code host (GitHub) ----------
interface RepoRef {
  owner: string;
  name: string;
}

type CiState = "success" | "failure" | "pending" | "error" | "expected" | "none";

interface PullRequestSnapshot {
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  mergedAt: string | null;
  headRefName: string;
  headSha: string;
  baseRefName: string;
  ci: CiState; // statusCheckRollup.state, 없으면 "none"
}

type RunOutcome =
  | { kind: "merged"; pr: PullRequestSnapshot }
  | { kind: "human-check"; pr: PullRequestSnapshot }
  | { kind: "failed"; reason: "no-pr" | "closed-unmerged"; pr: PullRequestSnapshot | null };

interface CodeHost {
  /** 브랜치로 PR을 찾는다. 같은 브랜치의 PR이 여럿이면 최신순. */
  findPullRequests(repo: RepoRef, branch: string): Promise<ReadonlyArray<PullRequestSnapshot>>;
  rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date }>;
}

/** 순수 함수: ADR 0004 판정. closed-unmerged는 Failed다. */
type JudgeRunOutcome = (prs: ReadonlyArray<PullRequestSnapshot>) => RunOutcome;
```

## 아직 모르는 것

**Orca**

1. ~~런타임이 꺼져 있을 때 `orca status --json`과 다른 명령의 `error.code`·종료 코드.~~ [research 0003](0003-orca-runner-contract.md) 1절에서 확인했다.
2. ~~`worktree ps`의 `status`, `agents[].state`, `programStatus.state`, `terminalVerdict` 전체 열거값.~~ [research 0004](0004-orca-run-contract.md) 2절. 행 `status`·`sidebarStatus`의 닫힌 목록은 남았다.
3. ~~에이전트가 할 일을 마쳤다는 가장 믿을 만한 신호.~~ [research 0004](0004-orca-run-contract.md) 3절. 대화형 에이전트는 일을 마쳐도 끝나지 않고 종료 코드는 Orca가 주지 않는다. 런 끝남과 정상·오류 종료를 무엇으로 정할지는 0037에서 정한다.
4. ~~`worktree create --agent --prompt --json`의 실제 출력 전체.~~ [research 0004](0004-orca-run-contract.md) 4절.
5. ~~`--prompt` 길이 제한과 줄바꿈·특수 문자가 ssh 인용을 거쳐 그대로 전달되는지.~~ [research 0004](0004-orca-run-contract.md) 5절. 인자마다 작은따옴표로 인용하면 그대로 가고, ssh 명령 문자열은 약 256 KiB가 한계다.
6. ~~ssh 비대화형 셸에서 `orca`가 런타임에 닿는지.~~ [research 0003](0003-orca-runner-contract.md) 6절에서 확인했다. 절대 경로로 부르면 닿고 ssh 세션 쪽에는 GUI 세션이 필요 없다. 콘솔 로그인 세션이 없을 때 서비스가 뜨는지는 남았다(0003 「아직 모르는 것」 7).
7. Linux 러너의 `orca` 설치 경로와 `orca serve` 서비스 구성. research 0003에서도 남았다(Linux 러너 준비 전).
8. ~~터미널이 아닌 chat(`structured`)으로 뜬 에이전트의 진행 감지 방법.~~ `--surface terminal`이면 terminal로 뜨고 `worktree ps`로 진행이 보였다([research 0004](0004-orca-run-contract.md) 8절). chat 경우는 확인하지 않았다.
9. `worktree rm` 출력과, 에이전트가 아직 도는 워크트리를 지울 때의 동작. 출력과 `--force` 동작은 [research 0003](0003-orca-runner-contract.md) 9절에서 확인했다. 턴이 끝나고 백그라운드 셸이 돌던 에이전트에만 시험했고, 턴 도중의 에이전트는 남았다(0003 「아직 모르는 것」 6).

**Linear**

10. `Issue` update webhook의 `updatedFrom`에 `labelIds`, `stateId`가 실제로 담기는지와 `data`의 정확한 필드 목록. 문서 예시에 없고, webhook 페이로드 스키마(https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/objects)는 열지 않았다. 확인 방법: 테스트 워크스페이스에 webhook을 만들고 라벨을 붙여 본다.
11. 라벨 추가가 `Issue` update 하나로 오는지, `IssueLabel` 이벤트로도 오는지.
12. 최대 페이지 크기(`first` 상한).
13. 개인 API 키로 만든 댓글·상태 변경이 Linear GitHub 통합의 자동 상태 전환(PR 병합 시 Done 등)과 충돌하는지.
14. `attachmentLinkGitHubPR`가 Linear GitHub 통합이 이미 붙인 링크와 중복되는지.

**GitHub**

15. fine-grained PAT로 GraphQL `statusCheckRollup`이 check run 결과까지 돌려주는지. 문서는 fine-grained PAT의 Checks API 사용을 한계로 적는다. 이번 실행은 다른 종류의 토큰이었다.
16. ~~런의 PR이 병합 없이 닫힌 경우(`CLOSED`)의 결과.~~ ADR 0004에서 Failed로 결정했다(사유: PR이 닫힘).
17. 에이전트가 브랜치 이름을 바꾸거나 다른 브랜치로 PR을 연 경우 런과 PR을 잇는 방법. 브랜치 외에 PR 본문의 티켓 키나 Linear 첨부로 보강할지.
18. GitHub GraphQL 요청에 ETag/304가 적용되는지. GraphQL 한도 문서에 언급이 없다.
