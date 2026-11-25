# Orca 오케스트레이션으로 런 돌리기 검증

> 이 문서의 「운영자가 정할 것」 1~6은 운영자가 2026-11-17에 정했다(Q82.1~Q82.7). 결정은 [ADR 0009](../adr/0009-run-via-orca-orchestration.md)와 [1단계 스펙](../spec/0001-phase-1.md) 3절에 있다. 아래 본문은 조사 당시의 기록이다.
>
> 메일 읽기는 조사 당시 제안한 `check --terminal <우편함> --peek`에서 바뀌었다. `--peek`은 안 읽은 메일을 오래된 것부터 100개만 줘서 쌓인 메일 뒤의 새 질문을 놓쳤다. 지금은 `inbox --terminal run:<runId> --full`을 최신 순 창(200 → 800 → 3200행, 런의 Task 시작 앞 메일이 들어올 때까지)으로 읽고 읽음 처리하지 않는다. Orca에 메일 하나만 처리됨으로 바꾸는 명령이 없고 `inbox`는 읽음 여부와 상관없이 메일을 주기 때문이다(「운영자가 정할 것」 4, 「아직 모르는 것」 11에 대한 답. 티켓 [0231](../tickets/0231-orca-mailbox-backlog.md)). 한 폴링 주기에는 Orca Run마다 한 번만 읽어 그 Run의 런들이 나눠 쓴다(티켓 [0232](../tickets/0232-orca-mail-once-per-poll.md)). 아래 2절 「읽는 방법」의 제안과 「제안: Runner 어댑터 계약」 표의 `check --peek`은 조사 당시의 제안이다.

조사일 2026-11-17. 티켓 없음. 운영자는 에이전트를 비대화형(`claude -p`, [research 0007](0007-headless-agent-run.md))으로 띄우는 대신, 대화형 에이전트를 Orca 오케스트레이션(`Task`·`Dispatch`, `worker_done`, `ask`/`reply`)으로 띄우는 방식을 골랐다(운영자 결정 Q82 개정, 2026-11-17. 코디네이터 대화에서 정했고 spec에는 아직 기록하지 않았다). 이유는 에이전트가 묻는 결정을 이 오케스트레이터 화면에서 운영자가 답하게 하려는 것이다. 에이전트의 `ask` → 오케스트레이터가 받아 화면에 보임 → 운영자가 답 → 오케스트레이터가 ssh로 `reply` → 에이전트가 이어 감 → 에이전트의 `worker_done`으로 끝. 이 문서는 그 흐름을 오케스트레이터 기계에서 비대화형 ssh만으로 돌릴 수 있는지 확인한다.

출처 표시는 research 0004를 따른다.

- **[실행]** 테스트 러너에서 직접 돌린 명령의 결과. macOS(arm64) 러너, Orca 1.4.258, 오케스트레이터 기계에서 비대화형 `ssh <host> '<command>'`로 실행했다.
- **[스키마]** `orca orchestration <command> --help`, `orca skills get orchestration`(가이드)과 그 `--reference` 문서, `orca agent-context --json`.

### 낱말

Orca 오케스트레이션의 낱말은 이 저장소의 낱말과 겹친다. 이 문서에서는 다음처럼 가른다.

| 이 문서의 표기     | 뜻                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 런, Run            | GLOSSARY의 Run. 티켓 하나를 러너에 맡긴 한 번의 시도                                                                          |
| 오케스트레이션 Run | Orca의 `Run`(`run_…`). 메일함 하나와 `Task` 묶음의 이름공간. 스케줄링은 하지 않는다 **[스키마]**                              |
| `Task`             | Orca의 오케스트레이션 작업 단위(`task_…`). 사양(spec)과 상태, `worker_done` 보고를 담는다                                     |
| `Dispatch`         | Orca가 `Task`를 에이전트 터미널 하나에 맡긴 한 번의 시도(`ctx_…`). GLOSSARY는 Run의 뜻으로 이 낱말을 피하라고 한다            |
| 에이전트           | `worker-start`로 뜬 코딩 에이전트(GLOSSARY의 Agent). Orca는 worker라 부르지만 이 문서는 명령·필드 이름 밖에서 에이전트로 쓴다 |
| 코디네이터         | `Task`를 만들고 메일을 받는 쪽. 이 방식에서는 오케스트레이터다                                                                |
| 우편함 터미널      | 이 검증에서 오케스트레이터가 코디네이터 신원으로 쓰려고 러너에 띄운 셸 터미널(1절)                                            |

### 실행

research 0004·0007과 같은 버려도 되는 테스트 저장소(`sandbox`)에 워크트리 셋을 `worker-start --worktree new-top-level`로 만들고 Claude Code(Haiku 모델)를 하나씩 띄웠다. 에이전트를 띄운 것은 세 번이다.

| 실행 | 사양(요약)                                                                     | 이 문서에서 본 것                                                       |
| ---- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| R1   | `ask`로 README에 더할 문구 A·B를 묻고, 답대로 고쳐 커밋·push·PR, `worker_done` | 시작, 질문 읽기·답하기, 끝, 메일 소비, push·PR                          |
| R2   | `touch` 실행(권한 프롬프트가 뜨도록 준비), 그 뒤 `sleep 600`                   | 권한 프롬프트 escalation, ssh로 `deny`, `worker-stop`                   |
| R3   | `kill -TERM $PPID`로 자기 프로세스를 죽임                                      | `worker_done` 없이 죽은 에이전트, 남은 셸을 닫은 뒤의 `lost` escalation |

사양은 오케스트레이터 기계에서 ssh stdin으로 러너의 임시 폴더에 올리고(`ssh <host> 'cat > <runDir>/r1-spec.md' < r1-spec.md`, 올린 파일과 원본의 SHA-256이 같았다) `--spec-file <runDir>/r1-spec.md`로 넘겼다. R1은 sandbox에 PR을 열었고, 확인 뒤 PR을 닫고 브랜치를 지웠다. R2를 위해 만든 sandbox 브랜치도 지웠다. 끝난 뒤 정리한 것은 7절에 적는다.

예시와 픽스처의 로컬 경로, 호스트명, 사용자명, 계정은 `<path>`, `<host>`, `<user>`, `acme`로 바꿨다. 저장소 이름은 `sandbox`로 썼다. UUID와 `ctx_`·`task_`·`run_`·`msg_`·`apr_`·`wtr_` 식별자는 가상 값이고, 같은 대상은 `fixtures/0008/` 파일끼리 같은 값을 쓴다(`term_…01`이 우편함 터미널, `ctx_…01`·`term_…02`가 R1, `ctx_…02`·`term_…03`이 R2, `ctx_…03`·`term_…04`가 R3다). 다른 research의 픽스처와는 따로 바꿨으므로 한 테스트에 섞지 않는다. 시각은 실제 값이다. 에이전트 상태 표시 줄은 `<agent-status-line>`으로 줄였다. 픽스처는 [`fixtures/0008/`](fixtures/0008/)에 있다.

## 요약

| #   | 항목          | 결론                                                                                                                                                                                                                                                                                         |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 시작          | ssh 호출자는 Orca 터미널 밖이라 `worker-start`·`run-create`가 `no_active_sender_terminal`로 거절된다. 러너에 셸 터미널 하나(우편함 터미널)를 띄워 그 핸들을 `--from`으로 주면 된다. `worker-start`가 오케스트레이션 Run을 만들고 `dispatchId`·`taskId`·`runId`·`terminal`·`workspace`를 준다 |
| 2   | 질문과 답     | `check --terminal <우편함> --peek`과 `inbox --terminal run:<runId>`는 메일을 소비하지 않는다. `--peek` 없는 `check`는 FIFO 묶음을 처리됨으로 바꾼다. 답은 `reply --from <우편함> --id <msgId> --body <답>`. 답해도 질문은 처리됨이 되지 않는다                                               |
| 3   | 끝            | 성공 `worker_done`이 오면 `Task` `status`가 `completed`가 되고(실패 보고 때 값은 미확인), `task-list --full`의 `result`에 `outcome`·보고 본문·`filesModified`·`reportPath`가 남는다. 에이전트 프로세스는 끝나지 않는다                                                                       |
| 4   | 권한 프롬프트 | 이 러너의 Orca는 Claude Code를 권한 우회로 띄운다. 프로젝트 설정으로 우회를 막자(실행 인자는 그대로) Orca가 `stopReason: "needs-input"`과 `approval`이 든 escalation을 보냈다. ssh로는 `deny`만 된다. 허용은 사람만 한다                                                                     |
| 5   | 이상 종료     | 에이전트만 죽고 셸이 남으면 약 3분 동안 escalation이 없고 `liveness: "unverifiable"`이다. 터미널까지 끝나면 `stopReason: "lost"` escalation이 오고 `Task`가 `ready`로 돌아간다                                                                                                               |
| 6   | 멈추기        | `worker-stop --dispatch <id>`가 `--from` 없이 에이전트 터미널을 닫는다. `Task`는 `blocked`, `Dispatch`는 `stopped`. 메일은 오지 않는다                                                                                                                                                       |
| 7   | 정리, push·PR | `worker-release` → `worktree rm --force` → 로컬 브랜치 지우기. 오케스트레이션 Run 기록 하나만 지울 명령은 없다. 에이전트가 러너의 비대화형 세션에서 push하고 `gh pr create`로 PR을 열었다                                                                                                    |

## 1. 시작

### Orca 터미널 밖에서는 코디네이터 신원이 없다

가이드의 형태 그대로 ssh로 불렀다 **[실행]**.

```
orca orchestration worker-start --spec-file <runDir>/r1-spec.md --task-title fo-orch-r1 \
  --worktree new-top-level --repo id:<repoId> --name fo-orch-r1 --agent claude --model haiku --json
```

종료 코드 1, 다음 오류다. `run-create --objective <text>`와 `run-current`도 같았다. 픽스처: [`run-create-no-from-error.json`](fixtures/0008/run-create-no-from-error.json).

```json
{
  "ok": false,
  "error": {
    "code": "no_active_sender_terminal",
    "message": "Could not determine the calling terminal for this orchestration command. Pass --from with your own terminal's handle — another pane's handle would act on its mailbox — or run the command inside a live Orca terminal with ORCA_TERMINAL_HANDLE set."
  }
}
```

코디네이터는 "터미널 핸들"로 정해진다. 오케스트레이션 Run을 만들고 메일을 받는 주체가 그 터미널이다 **[실행]**. `--run`만 주는 길도 없다. `run-create` 자체가 호출 터미널을 요구한다.

### 우편함 터미널

그래서 러너의 등록된 저장소(기본 워크트리)에 에이전트 없는 터미널 하나를 띄웠다 **[실행]**.

```
orca terminal create --worktree path:<path>/sandbox --title fo-orch-mailbox --command 'cat > /dev/null' --json
```

결과의 `handle`을 `--from`으로 주자 `worker-start`가 됐다. 픽스처: [`mailbox-terminal-create.json`](fixtures/0008/mailbox-terminal-create.json).

- `cat > /dev/null`은 터미널에 무언가 입력되더라도 셸 명령으로 돌지 않게 하려고 골랐다. 검증 내내(약 7분, `run:` 메일함에 메일 다섯 통) 이 터미널의 `terminal read` `tail`에는 처음 명령 줄 하나만 있었다 **[실행]**. Orca가 ssh 코디네이터를 깨우려고 터미널에 무언가를 입력하는 일은 보지 못했다.
- 우편함 터미널을 `terminal close`로 닫은 뒤에도 `check --terminal <그 핸들> --peek`이 메일을 돌려줬다 **[실행]**. 메일함은 핸들 문자열에 묶인다. 닫힌 핸들로 `worker-start`·`reply`를 부르는 경우는 시험하지 않았다.
- 에이전트가 받는 머리말(preamble)은 우편함 터미널 핸들을 "coordinator's terminal handle"로 적는다 **[실행]**(`worker-read`로 읽은 첫 사용자 메시지).
- 우편함 터미널에 `cat` 말고 무엇을 띄울지, 런타임이 다시 떠 핸들이 바뀌면 어떻게 할지는 정하지 않았다(아래 "아직 모르는 것").

### `worker-start` 결과

```
orca orchestration worker-start --from <우편함 핸들> --spec-file <runDir>/r1-spec.md --task-title fo-orch-r1 \
  --worktree new-top-level --repo id:<repoId> --name fo-orch-r1 --agent claude --model haiku --json
```

종료 코드 0, 약 4.6초 걸렸다 **[실행]**. 픽스처: [`worker-start.json`](fixtures/0008/worker-start.json).

```json
{
  "ok": true,
  "result": {
    "dispatchId": "ctx_000000000001",
    "taskId": "task_000000000001",
    "runId": "run_000000000001",
    "runCreated": true,
    "state": "ready",
    "agent": "claude",
    "model": "haiku",
    "mode": "terminal",
    "terminal": "term_00000000-0000-4000-8000-000000000002",
    "workspace": "<repoId>::<path>/workspaces/sandbox/fo-orch-r1",
    "keptOpen": true,
    "next": "Orca wakes you when workers report; end your turn when you're done."
  }
}
```

- 묶인 오케스트레이션 Run이 없어서 하나를 만들었다(`runCreated: true`). Run의 `objective`는 첫 `Task` 제목(`fo-orch-r1`)이 됐다 **[실행]**. 같은 우편함으로 R2·R3를 시작할 때 `--run run_…`을 줬고 같은 Run에 들어갔다.
- `workspace`는 `worktree ps`의 `worktreeId`와 같은 `<repoId>::<path>` 형태다. `terminal`은 에이전트 터미널 핸들이다.
- `state: "ready"`는 사양이 에이전트 입력으로 들어갔다는 뜻이다(`worker-show`의 `stage: "input_accepted"`) **[실행]**. help는 `ready`면 종료 코드 0, 실패·`outcome_unknown`이면 1이라고 적는다 **[스키마]**.
- `new-top-level`로 띄운 에이전트는 늘 열린 채 남는다(`keptOpen: true`). `worker_done` 뒤에도 에이전트 프로세스가 살아 있다 **[실행]**(3절). 그래서 7절의 `worker-release`가 필요하다.
- 에이전트는 Orca 설정의 기본 권한(`full-access`)대로 `--dangerously-skip-permissions`로 떴다(4절) **[실행]**.
- `--model haiku`는 `worker-show --full`의 `startOptions.launch.effective.model`에 그대로 남았다 **[실행]**.

### 결정적 이름으로 다시 찾기

- 워크트리 폴더와 표시 이름은 `--name` 값(`fo-orch-r1`)이었다. `worktree show --worktree name:fo-orch-r1`이 그 워크트리를 돌려줬고, `worktree rm --worktree name:fo-orch-r1`도 됐다 **[실행]**.
- 브랜치는 `<접두사>/<name>`(`acme/fo-orch-r1`)이다. research 0004와 같다. `worker-start`에는 `worktree create`의 `--branch`가 없다 **[스키마]**. 브랜치 이름을 정확히 정하려면 러너의 접두사 설정에 기대거나, `--name`에 접두사를 넣고 PR을 브랜치가 아닌 다른 길(티켓 키)로 찾아야 한다. 0006의 PR 찾기(브랜치 이름 1순위)와 맞추려면 정할 것이 남는다.
- 런 레코드에는 `runId`(오케스트레이션 Run), `taskId`, `dispatchId`, `workspace`, `terminal`을 둔다. 다시 찾는 열쇠는 `dispatchId`(`worker-*` 명령의 기준)와 `--name`(워크트리)이다.

### 호출자 신원이 필요한 명령

| 명령                                                                                                                                                       | 호출자 지정                          | ssh에서                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `run-create`, `run-current`, `worker-start`                                                                                                                | `--from <handle>`                    | 없으면 `no_active_sender_terminal` **[실행]**                       |
| `reply`, `deny`                                                                                                                                            | `--from <handle>`                    | 우편함 핸들로 됐다 **[실행]**                                       |
| `check`                                                                                                                                                    | `--terminal <handle>`(`--from` 없음) | `--run`만 주면 `no_active_sender_terminal` **[실행]**               |
| `inbox --terminal run:<id>`, `task-list --run`, `run-show`, `run-list`, `worker-show`, `worker-read`, `worker-list --run`, `worker-stop`, `worker-release` | 필요 없음                            | 됐다 **[실행]**. `worker-stop`에 `--from`을 주면 `invalid_argument` |

## 2. 질문과 답

### 질문이 오는 곳

R1은 시작 약 8초 뒤 `orca orchestration ask --question "..." --options "A,B"`를 불렀다 **[실행]**. 질문은 `to: "run:<runId>"`, `type: "question"`인 메일이 됐다. 픽스처: [`inbox-question-full.json`](fixtures/0008/inbox-question-full.json).

```json
{
  "id": "msg_000000000001",
  "run_id": "run_000000000001",
  "from_handle": "dispatch:ctx_000000000001",
  "to_handle": "run:run_000000000001",
  "subject": "Question",
  "body": "Which line should I add to README.md? A: 'Verified by an orchestration run.' B: 'Orchestration check passed.'",
  "type": "question",
  "payload": "{\"taskId\":\"task_000000000001\",\"dispatchId\":\"ctx_000000000001\",\"question\":\"…\",\"options\":[\"A\",\"B\"]}",
  "read": 0,
  "sequence": 1,
  "created_at": "2026-11-17T14:07:35Z"
}
```

- `--full`의 `payload`는 JSON이 든 **문자열**이다. 한 번 더 파싱한다. `--full` 없는 `inbox`와 `check`는 `payload`를 객체로 준다 **[실행]**.
- `options`는 `ask --options`로 준 선택지다. 화면에서 버튼으로 보일 수 있다.
- 기다리는 동안 `worker-show`는 `activity: "idle"`, `attention: ["input"]`이다 **[실행]**([`worker-show-asked.json`](fixtures/0008/worker-show-asked.json)). `--full`의 `observation.agentWait`는 `null`이다(간단 출력에는 이 필드가 없다). 같은 때 `--full`의 `projection.stage.activity`는 `"done"`이었다([`worker-show-full-asked.json`](fixtures/0008/worker-show-full-asked.json)). 간단 출력과 `--full`이 다른 값을 주므로 어댑터는 한쪽을 기준으로 정해 읽는다. `ask`로 묻고 턴을 끝낸 에이전트는 권한 프롬프트(4절)와 달리 "사람 입력 대기"로 보이지 않는다. 질문 대기는 메일로 판단한다.

### 읽는 방법: 무엇이 메일을 소비하는가

| 명령                                              | 소비       | 돌려주는 것                                                                                         | 근거                                                                                                                                                |
| ------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check --terminal <우편함> --peek --json`         | 안 함      | 아직 처리되지 않은 메일 전부. 본문 전체, `payload`(객체, `options`·`outcome` 포함)                  | **[실행]** [`check-peek-question.json`](fixtures/0008/check-peek-question.json)                                                                     |
| `inbox --terminal run:<runId> --limit <n> --json` | 안 함      | 최근 메일과 `handled`. 본문은 200자로 잘리고 `payload`는 id만                                       | **[실행]** [`inbox-question.json`](fixtures/0008/inbox-question.json)                                                                               |
| `inbox ... --full --json`                         | 안 함      | 메일 행 전체(`read`, `sequence`, `created_at`, `payload` 문자열)                                    | **[실행]** [`inbox-question-full.json`](fixtures/0008/inbox-question-full.json)                                                                     |
| `check --terminal <우편함> --all --json`          | 안 함      | 처리 여부와 상관없이 최근 메일                                                                      | **[실행]**, **[스키마]**                                                                                                                            |
| `check --terminal <우편함> --json`                | **소비함** | 가장 오래된 미처리 FIFO 묶음 전체. 돌려준 묶음을 처리됨으로 바꾼다. 다음 `check`·`--peek`은 빈 목록 | **[실행]** [`check-consume.json`](fixtures/0008/check-consume.json), [`check-peek-after-consume.json`](fixtures/0008/check-peek-after-consume.json) |
| `task-list --run <runId>`, `worker-show`          | 안 함      | `Task`·에이전트 상태. 질문 본문은 없다                                                              | **[실행]**                                                                                                                                          |

소비한 뒤 `inbox`의 `handled`가 두 메일 모두 `true`가 됐다 **[실행]**. help와 가이드는 "watch 스크립트의 plain `check`는 에이전트가 볼 메일을 가져간다. 지켜보기만 하는 스크립트는 `--peek`(`--peek --wait` 포함)만 쓰고 `--ack`하지 않는다"고 적는다 **[스키마]**. `--peek --wait`는 시험하지 않았다(ssh를 붙잡으므로 폴링에는 맞지 않는다).

오케스트레이터는 Orca가 깨워 주는 세션이 아니므로 다음처럼 읽는 것을 제안한다.

- 폴링은 `check --terminal <우편함> --peek --json`(전체 본문)으로 한다. 메일을 잃지 않는다.
- 오케스트레이터가 본 메일 id를 DB에 두고 중복을 거른다. `--peek`은 처리되지 않은 메일을 매번 다시 준다.
- 처리 여부는 오케스트레이터 DB가 기준이다. Orca의 `handled`를 바꾸려면 소비하는 `check`밖에 없고, 그것은 묶음 단위라 질문 하나만 처리됨으로 바꿀 수 없다. 메일을 DB에 저장한 다음에만 소비하는 `check`를 부르는 길도 있으나, 응답을 잃으면 `--retry-request`로 같은 묶음을 다시 받아야 한다 **[스키마]**. 처리됨이 쌓이지 않으면 `--peek` 응답이 길어진다. 어느 쪽으로 할지는 정할 것으로 남긴다.
- 메일을 놓쳤을 때는 `inbox --terminal run:<runId> --limit <n> --full`로 이미 처리된 메일까지 다시 읽는다 **[스키마]**(가이드 "Lost track?").

### 답하는 방법

```
orca orchestration reply --from <우편함 핸들> --id msg_000000000001 --body 'A' --json
```

종료 코드 0, `{"messageId":"msg_000000000002","next":"Finish the rest of your mail."}` **[실행]**. 픽스처: [`reply.json`](fixtures/0008/reply.json).

- 답은 `to: "dispatch:<dispatchId>"`, `type: "status"`, `subject: "Re: Question"`인 메일이 된다. `inbox --terminal dispatch:<dispatchId>`에서 보였고, 에이전트가 받아 `handled: true`였다 **[실행]**([`inbox-dispatch-reply.json`](fixtures/0008/inbox-dispatch-reply.json)).
- 답한 뒤에도 질문 메일은 `run:` 메일함에서 `handled: false`로 남았다 **[실행]**([`inbox-after-reply.json`](fixtures/0008/inbox-after-reply.json)). "답했음"은 Orca가 기록해 주지 않으므로 오케스트레이터가 기록한다.
- 에이전트는 답 A대로 이어 갔다. 답한 뒤 첫 폴링에서 `activity: "working"`이었고, 그다음 폴링(15초 간격)에서 `Task`가 `completed`였다 **[실행]**.
- 본문은 ssh 명령 문자열의 인자로 간다. research 0004의 인자별 인용과 약 256 KiB 한계가 그대로 걸린다. `reply`에는 파일·stdin 입력이 없다 **[스키마]**.

## 3. 끝: `worker_done`

R1은 `send --type worker_done --outcome succeeded`를 보냈다 **[실행]**. 관측한 것:

- `task-list --run <runId> --full`: `status: "completed"`([`task-list-full-done.json`](fixtures/0008/task-list-full-done.json)).
- `task-list --run <runId> --full --json`의 `tasks[].result`(JSON이 든 문자열)에 보고 전체가 남는다.

```json
{
  "provenance": "worker_report",
  "outcome": "succeeded",
  "messageId": "msg_000000000003",
  "subject": "Verification PR opened",
  "body": "Coordinator answered A, so I appended … I opened PR https://github.com/acme/sandbox/pull/17 against main …",
  "filesModified": ["README.md"],
  "reportPath": "https://github.com/acme/sandbox/pull/17",
  "completedAt": "2026-11-17T14:08:38.076Z"
}
```

- `worker-show`: `state: "succeeded"`, `stage: "settled"`, `liveness: "live"`, `activity: "idle"`([`worker-show-done.json`](fixtures/0008/worker-show-done.json)). 에이전트 프로세스는 끝나지 않고 다음 입력을 기다린다(research 0004 3절과 같다).
- `run:` 메일함에 `type: "worker_done"` 메일이 온다. `--peek`은 `payload`에 `outcome`, `filesModified`, `reportPath`를 객체로 주고, 일을 더 주는 `send` 명령을 `followUp`으로 붙인다 **[실행]**([`check-peek-done.json`](fixtures/0008/check-peek-done.json)).

보고 본문은 오케스트레이터가 읽을 수 있다. 끝의 기준으로는 메일보다 `Task` `status`가 낫다. 메일은 `--peek`이 다시 주고 소비하면 사라지지만, `Task`의 `status`와 `result`는 그대로 남는다. `outcome: "failed"`인 `worker_done`은 보지 못했다. help는 `--outcome failed`도 `Task`를 끝낸다고 적고, 가이드는 "보고된 실패를 completed로 바꾸지 말라"고 적는다 **[스키마]**. 그때의 `Task` `status` 값은 확인하지 않았다.

`outcome`은 에이전트가 스스로 적은 값이다. 종료 코드가 아니다. GLOSSARY의 에이전트 결과는 종료 코드로 정상·오류 종료를 가르므로 맞춰야 한다(아래 대응표).

## 4. 권한 프롬프트

### 이 러너는 권한을 묻지 않게 띄운다

러너 Orca 설정에 `agentPermissionDefault: "full-access"`가 있고, Claude Code는 `--dangerously-skip-permissions`로 떴다 **[실행]**(R1 터미널 미리보기 `bypass permissions on`, R3 터미널의 실행 인자). research 0007이 소스에서 찾은 예전 기본값(`yolo`)과 같은 결과다. 설정은 러너 전체에 걸리고 사람이 그 러너에서 띄우는 에이전트도 바뀐다.

### 재현: 프로젝트 설정으로 우회를 끔

러너 설정을 바꾸지 않으려고, sandbox에 일회용 브랜치를 만들어 다음 `.claude/settings.json`을 커밋하고 `worker-start --base-branch origin/<그 브랜치>`로 R2를 띄웠다 **[실행]**.

```json
{
  "permissions": {
    "disableBypassPermissionsMode": "disable",
    "ask": ["Bash(touch:*)"]
  }
}
```

에이전트가 `touch`를 부르자 권한 프롬프트가 떴다. 화면에는 "Ask rule Bash(touch:\*) overrides auto mode for this command"가 보였다 **[실행]**. 우회 모드가 막혀 자동(auto) 모드로 뜬 것으로 보인다. 두 설정 가운데 무엇이 프롬프트를 띄웠는지는 가르지 않았다.

### Orca가 알리는 방법

프롬프트가 뜬 지 1초 안에 `run:` 메일함에 escalation이 왔다 **[실행]**. 픽스처: [`escalation-needs-input-full.json`](fixtures/0008/escalation-needs-input-full.json).

```json
{
  "id": "msg_stop_000000000000000000000001",
  "type": "escalation",
  "priority": "high",
  "subject": "Worker is waiting for permission",
  "body": "Worker term_… is waiting for permission while running task \"fo-orch-r2\" (task_…): Allow Bash? … No one has been shown this prompt in Orca. … `orchestration deny --dispatch ctx_… --prompt apr_… --reason \"<what to do instead>\"`.\nWorker's screen:\n …",
  "payload": {
    "taskId": "task_000000000002",
    "dispatchId": "ctx_000000000002",
    "handle": "term_00000000-0000-4000-8000-000000000003",
    "stopReason": "needs-input",
    "approval": {
      "v": 1,
      "approvalId": "apr_0000000000000001",
      "state": "open",
      "summary": { "title": "Allow Bash?", "detail": "touch perm-test.txt", "reason": null },
      "allowedActions": ["allow", "deny"]
    }
  }
}
```

(`payload`는 `--full`에서 문자열이다. 위는 파싱한 모양이다.)

- 메일 id가 `msg_stop_`로 시작한다. 본문에 에이전트 화면이 붙는다. "No one has been shown this prompt in Orca"는 러너에서 Orca 화면을 보는 사람이 없었다는 뜻으로 보인다.
- 같은 때 `worker-show`: `activity: "waiting"`, `waitingOnHuman: "interactive prompt (via hook)"`(간단 출력, 픽스처 없음), `--full`의 `observation.agentWait: { "source": "hook", "since": <ms> }` **[실행]**([`worker-show-full-waiting-permission.json`](fixtures/0008/worker-show-full-waiting-permission.json)).
- 같은 때 `worktree ps --agent-wait`: 행 `status: "permission"`, `agents[0].state: "waiting"`, `programStatus: { "state": "blocked", "kind": "permission" }` **[실행]**([`worktree-ps-permission.json`](fixtures/0008/worktree-ps-permission.json)). research 0004에서 보지 못한 `kind: "permission"`을 관측했다.

### ssh로 할 수 있는 일: `deny`만

```
orca orchestration deny --from <우편함 핸들> --dispatch ctx_… --prompt apr_… --reason '<사유>' --json
```

`{"approvalId":"apr_…","denied":"Deny"}`, 종료 코드 0 **[실행]**. 픽스처: [`deny.json`](fixtures/0008/deny.json).

- 에이전트의 도구 호출이 `--reason` 문자열을 결과로 받아 실패했고, 에이전트는 다음 단계로 갔다 **[실행]**(`worker-read`의 transcript).
- `run:` 메일함에 `type: "status"`, `subject: "Worker approval answered"`, `approval.state: "answered"` 메일이 왔다 **[실행]**([`status-approval-answered-full.json`](fixtures/0008/status-approval-answered-full.json)). escalation 본문의 "You'll get a message when it's answered"가 이것이다.
- 허용은 CLI에 없다. help는 "Only a person can allow a prompt; agents can only deny one"이라고 적는다 **[스키마]**. 허용하려면 사람이 러너의 Orca 화면이나 에이전트 터미널에서 눌러야 한다. 터미널에 키를 보내는 것(`terminal send`)은 가이드가 막는 "에이전트 터미널로 조종하기"(Steer through a worker's terminal)다. 시험하지 않았다.

Waiting for Input의 원래 뜻(권한 프롬프트 등)에서 오케스트레이터 화면이 할 수 있는 것은 "거절하고 이렇게 하라"뿐이다. "허용"을 화면에서 하려면 권한을 미리 허용해 프롬프트가 뜨지 않게 하는 쪽이 현실적이다.

### 미리 허용하는 방법

- Orca 러너 설정: `agentPermissionDefault`(`full-access`면 우회)와 에이전트별 `agentPermissionOverrides` **[실행]**(설정 값 확인). 러너 전체에 걸린다.
- 대상 저장소의 `.claude/settings.json` `permissions.allow`: 프로젝트 설정이다. 이번에는 반대로 `ask`·`disableBypassPermissionsMode`가 동작하는 것만 확인했다 **[실행]**. `allow`는 시험하지 않았다. 이 제품은 프로젝트의 에이전트 설정을 고치지 않으므로(ADR 0004, spec 9절) 운영자가 저장소에 둔다.
- 사용자 설정(`~/.claude/settings.json`)도 같은 형식이지만 러너의 모든 에이전트에 걸린다. 시험하지 않았다.
- `worker-start`에는 에이전트 인자나 권한 모드를 넘기는 플래그가 없다 **[스키마]**.

## 5. 이상 종료: `worker_done` 없이 멈춤·죽음

### 에이전트만 죽고 셸이 남음

R3는 `kill -TERM $PPID`로 자기를 죽였다. 에이전트 터미널에는 로그인 셸 프롬프트가 남았다 **[실행]**(research 0004 3절과 같다). 그 뒤 약 3분 동안:

- `run:` 메일함에 아무 메일도 오지 않았다.
- `Task` `status: "dispatched"` 그대로였다.
- `worker-show`: `state: "ready"`, `liveness: "unverifiable"`, `attention: ["unverifiable"]`. `--full`의 `projection.liveness`는 `{ "verdict": "unverifiable", "reason": "missing_status" }`, `observation.status`는 `live`(셸이 살아 있으므로) **[실행]**. 픽스처: [`worker-show-agent-exited-shell-live.json`](fixtures/0008/worker-show-agent-exited-shell-live.json), [`worker-list-unverifiable.json`](fixtures/0008/worker-list-unverifiable.json).
- `worktree ps`: `agents: []`, `liveTerminalCount: 1` **[실행]**.

가이드는 "Silence, a timeout, or `unverifiable` liveness alone never proves exit"라고 적는다 **[스키마]**. Orca는 이 상태를 끝으로 보지 않는다. 오케스트레이터가 끝을 알려면 research 0004의 신호(`worktree ps` 행의 `agents`에서 그 에이전트가 사라짐)를 함께 봐야 한다.

### 터미널이 끝남

남은 셸 터미널을 `terminal close`로 닫자 30초 안에 escalation이 왔다 **[실행]**. 픽스처: [`escalation-lost-full.json`](fixtures/0008/escalation-lost-full.json).

```json
{
  "type": "escalation",
  "priority": "high",
  "subject": "Worker lost without reporting",
  "body": "Worker term_… is gone (it was closed in Orca) without sending worker_done for task \"fo-orch-r3\" (task_…).\nIts Dispatch is closed as failed. Start it again with … `orchestration worker-start --task task_…` …\nLast output:\n…",
  "payload": { "taskId": "task_…", "dispatchId": "ctx_…", "handle": "term_…", "stopReason": "lost" }
}
```

- `Task` `status`가 `ready`로 돌아갔다 **[실행]**([`task-list-after-lost.json`](fixtures/0008/task-list-after-lost.json)). 다시 맡길 수 있는 상태다. 오케스트레이터가 다시 시작하지 않으면 그대로 남는다.
- `worker-show`: `state: "failed"`, `stage: "process_exited"`, `liveness: "exited"`, `attention: ["failure", "interruption"]`, `lastError: "Terminal closed by operator request"` **[실행]**([`worker-show-lost.json`](fixtures/0008/worker-show-lost.json)).
- 본문에 마지막 출력이 붙는다.

가이드의 `stopReason`에는 `exited`도 있다 **[스키마]**. 이번에는 `lost`(터미널을 닫음)와 `needs-input`(4절)만 관측했다. 에이전트가 턴을 끝냈는데 `worker_done`을 보내지 않은 경우(대화형 에이전트가 일을 마치고 쉼)도 만들지 않았다.

## 6. 멈추기: 취소·시간 초과

### `worker-stop`

R2가 `sleep 600`을 돌던 중에 불렀다 **[실행]**. 픽스처: [`worker-stop.json`](fixtures/0008/worker-stop.json).

```
orca orchestration worker-stop --dispatch ctx_… --json
```

```json
{
  "ok": true,
  "result": {
    "dispatchId": "ctx_000000000002",
    "state": "stopped",
    "alreadySettled": false,
    "processAction": "closed_agent_terminal",
    "close": { "handle": "term_…", "tabId": "…", "ptyKilled": true },
    "mutation": { "requestId": "…", "replayed": false }
  }
}
```

- `--from`이 없는 명령이다. ssh에서 그대로 됐다 **[실행]**.
- 에이전트 터미널이 닫혔고 `sleep` 프로세스도 사라졌다. `worktree ps` 행은 `inactive`, `liveTerminalCount: 0`, `agents: []` **[실행]**.
- `Task` `status: "blocked"`, `worker-show` `state: "stopped"`, `stage: "process_stopped"`, `liveness: "exited"`, `attention: ["failure"]`, `worker-list`의 `outcome: "failed"` **[실행]**([`worker-show-after-stop.json`](fixtures/0008/worker-show-after-stop.json), [`task-list-after-stop.json`](fixtures/0008/task-list-after-stop.json)).
- 메일은 오지 않았다. 멈춘 쪽이 오케스트레이터이므로 결과로 판단한다.
- 워크트리는 남는다. help는 "Never deletes the worktree"라고 적는다 **[스키마]**. research 0003의 `terminal close`와 같은 성격이고, 시간 초과 런도 PR 상태를 판정할 수 있다.
- 멈출 수 없음을 증명하지 못하면 `stop_unknown`, 종료 코드 1이다 **[스키마]**. 관측하지 못했다.

`worker-stop` 전에 로그를 남기려면 `worker-read --dispatch <id>`를 먼저 부른다. 다만 `worker-read`는 터미널을 놓은 뒤에도 보관본을 읽는다고 help가 적는다 **[스키마]**. `worker-release`의 결과는 R1·R2가 `archive: "transcript [captured]"`, R3(에이전트가 보고 없이 죽은 런)가 `archive: "terminal [empty]"`였다 **[실행]**. 이상 종료 런은 보관본이 비어 있을 수 있으므로 놓기 전에 `worker-read`로 읽어 둔다.

### 그 밖의 멈춤 명령

- `worker-abandon`: 프로세스·파일에 손대지 않고 `Dispatch`만 끝낸다 **[스키마]**. 취소를 대신하지 않는다고 가이드가 적는다. 시험하지 않았다.
- `terminal close`: 5절처럼 `lost` escalation과 `Task` `ready`를 낳는다 **[실행]**. 취소에는 `worker-stop`이 맞다.

## 7. 정리와 push·PR

### push·PR

R1은 답대로 README에 한 줄을 더해 커밋하고, 브랜치를 push하고, `gh pr create`로 sandbox에 PR을 열었다 **[실행]**. 러너의 비대화형 세션에서 에이전트가 push·PR까지 한 첫 런이다(research 0003 "러너의 GitHub 인증"의 해결을 실제 런으로 확인했다). PR은 기준 브랜치(`main`)를 향했고, 확인 뒤 오케스트레이터 기계에서 닫고 원격 브랜치를 지웠다.

### 정리 순서

| 순서 | 명령                                                  | 결과 **[실행]**                                                                                                                                                                                    |
| ---- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `orchestration worker-release --dispatch <id> --json` | R1 `processAction: "closed_agent_terminal"`(열려 있던 에이전트 종료), R2 `none`, R3 `closed_exited_terminal`. 모두 `state: "released"`. [`worker-release.json`](fixtures/0008/worker-release.json) |
| 2    | `worktree rm --worktree name:<name> --force --json`   | 셋 모두 `removed: true`. R1 워크트리에는 러너 에이전트 플러그인의 untracked 폴더가 있었다(research 0003 9절)                                                                                       |
| 3    | 러너 등록 저장소에서 `git branch -D <접두사>/<name>`  | 로컬 브랜치 셋을 지웠다. `worktree rm`은 `--delete-branch` 없이 브랜치를 남긴다                                                                                                                    |
| 4    | `terminal close --terminal <우편함 핸들>`             | 우편함 터미널을 닫았다                                                                                                                                                                             |

- `worker_done` 뒤에는 `autoReleaseAt`(약 2분 뒤 자동 놓기)이 붙는다고 help가 적지만 **[스키마]**, `new-top-level`로 띄운 에이전트는 열린 채 남는다 **[스키마]**. R1은 `worker_done` 뒤 약 6분 동안 `worker-show`·`worker-list`에 `autoReleaseAt`이 보이지 않았고, 1번을 부를 때까지 에이전트 터미널이 열려 있었다(`processAction: "closed_agent_terminal"`) **[실행]**. 그래서 1번을 직접 부른다.
- 오케스트레이션 Run 기록은 남는다. 하나만 지우는 명령이 없고, `orchestration reset --all|--tasks|--messages`는 러너 전체의 오케스트레이션 상태를 지운다 **[스키마]**. 다른 코디네이터의 상태까지 지우므로 쓰지 않았다. 워크트리를 지운 뒤에도 `run-list`에 Run이, `task-list --run`에 `Task` 셋이 남았다 **[실행]**. 쌓이는 기록을 어떻게 다룰지는 정할 것으로 남긴다.

## 제안: Runner 어댑터 계약

결정은 운영자 몫이다. 확인한 사실로 짤 수 있는 안을 적는다. 모든 명령은 research 0002·0004대로 `--json`을 주고 `ok`·`error.code`로 가른다.

### 러너 준비(온보딩 또는 러너 등록 때)

- `mailboxHandle`: 러너마다 우편함 터미널 하나를 띄워 핸들을 러너 설정에 둔다. `terminal create --worktree <등록 저장소> --title <이름> --command 'cat > /dev/null' --json`. 런타임이 다시 떠 핸들이 사라지면 다시 만든다(그 뒤 이전 핸들의 메일을 읽을 수 있는지는 확인하지 않았다).
- 오케스트레이션 Run: 러너마다 하나를 두고 `runId`를 러너 설정에 둔다(첫 `worker-start`의 `runCreated`로 얻는다). 런마다 오케스트레이션 Run을 하나씩 만드는 안도 있다. 그러면 메일이 런별로 갈리지만 `run-list`가 런 수만큼 쌓인다.

### 계약

| 동작       | 명령                                                                                                                                                                                                                                                                           | 결과로 쓰는 값                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `startRun` | 사양을 ssh stdin으로 `<runDir>/spec.md`에 올린 뒤 `worker-start --from <mailbox> --run <runId> --spec-file <runDir>/spec.md --task-title <런 id> --worktree new-top-level --repo id:<repoId> --name <결정적 이름> [--base-branch <ref>] --agent <agent> [--model <id>] --json` | `dispatchId`, `taskId`, `runId`, `terminal`, `workspace`. 종료 코드 1이면 `failedStage`·`recovery`를 런 상세에 남기고 다시 부르지 않는다(가이드) |
| `pollRun`  | `task-list --run <runId> --json`(또는 `--full`) + `worker-show --dispatch <id> --json` + `check --terminal <mailbox> --peek --json` + `worktree ps --agent-wait --json`                                                                                                        | `Task` `status`, `worker-show`의 `state`·`liveness`·`activity`·`attention`·`waitingOnHuman`, 새 메일, `agents[]`                                 |
| 질문 읽기  | `check --terminal <mailbox> --peek --json`에서 `type: "question"`, `payload.dispatchId`가 이 런인 메일                                                                                                                                                                         | `id`, `body`, `payload.options`. 본 id를 DB에 두고 거른다                                                                                        |
| 답하기     | `reply --from <mailbox> --id <msgId> --body <답> --json`                                                                                                                                                                                                                       | `messageId`. 답했음은 DB에 기록한다(Orca의 질문은 `handled: false`로 남는다)                                                                     |
| 권한 거절  | `deny --from <mailbox> --dispatch <id> --prompt <approvalId> --reason <사유> --json`                                                                                                                                                                                           | `denied`. 허용은 없다                                                                                                                            |
| 끝         | `Task`의 `result.provenance: "worker_report"`(성공 보고 때 `status: "completed"`, 실패 보고 때 `status`는 미확인)                                                                                                                                                              | `result.outcome`, `body`, `reportPath`, `filesModified`, `completedAt`                                                                           |
| 멈추기     | `worker-stop --dispatch <id> --json`                                                                                                                                                                                                                                           | `state: "stopped"`, `processAction`. `stop_unknown`(종료 코드 1)이면 `worker-show`로 확인하고 런 상세에 남긴다                                   |
| 정리       | `worker-release --dispatch <id> --json` → `worktree rm --worktree <workspace 선택자> --force --json` → (선택) 로컬 브랜치 지우기                                                                                                                                               | `state: "released"`, `removed: true`                                                                                                             |

로그 꼬리는 `worker-read --dispatch <id> --limit <n> --json`이 transcript(에이전트 대화)나 터미널 출력을 준다 **[실행]**. 터미널을 놓은 뒤에도 읽힌다고 help가 적지만 **[스키마]**, R3는 보관본이 비어 있었다(`terminal [empty]`) **[실행]**. 그래서 `worker-release`·`worker-stop` 전에 읽어 런 레코드에 둔다.

### `pollRun` 판정 순서(제안)

1. `Task`의 `result.provenance`가 `"worker_report"`이고 `result.outcome`이 있음 → Ended(`outcome: "succeeded"`일 때 `status`는 `completed`였다. `"failed"`일 때의 `status`는 확인하지 않았다). 에이전트 결과는 아래 대응표.
2. 새 `escalation` 메일 중 `stopReason: "lost"`(또는 `exited`) → 에이전트가 보고 없이 사라졌다. Ended.
3. `stopReason: "needs-input"` escalation(답이 오지 않음) 또는 오케스트레이터 DB에 답했음이 기록되지 않은 `question` 메일 → Waiting for Input. Orca의 `handled`는 답해도 바뀌지 않으므로 기준으로 쓰지 않는다.
4. `worker-show` `liveness: "unverifiable"`이고 `worktree ps` 행에서 전에 본 에이전트가 사라짐 → 에이전트가 보고 없이 죽고 셸이 남았다. Orca는 알리지 않으므로 오케스트레이터가 판정한다. 이 경우 Ended로 볼지, 터미널을 닫아 `lost`를 받을지는 정할 것이다.
5. 그 밖 → Running. 모르는 값은 research 0004대로 진행 중으로 본다.

## GLOSSARY 상태와의 대응

### 런 상태

| GLOSSARY 상태     | 오케스트레이션에서 본 신호                                                                                                                                                                                            | 비고                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Queued            | `worker-start` 전                                                                                                                                                                                                     | Orca 쪽 `Task`는 아직 없다                                                                                  |
| Running           | `Task` `status: "dispatched"`, `worker-show` `state: "ready"`, `activity: "working"`                                                                                                                                  |                                                                                                             |
| Waiting for Input | ① 오케스트레이터 DB에 답했음이 기록되지 않은 `question` 메일(`worker-show` `activity: "idle"`, `attention: ["input"]`) ② `needs-input` escalation과 `approval.state: "open"`(`activity: "waiting"`, `waitingOnHuman`) | GLOSSARY는 "권한 프롬프트 등"이라 둘 다 들어간다. ①은 오케스트레이터 화면에서 답할 수 있고, ②는 거절만 된다 |
| Disconnected      | ssh 실패                                                                                                                                                                                                              | 오케스트레이션과 상관없다. 다시 닿으면 위 판정으로 돌아간다                                                 |
| Ended             | `Task` `result`의 `worker_report`(성공 때 `completed`), `lost`/`exited` escalation, `worker-stop`, 시간 초과, 워크트리 사라짐                                                                                         |                                                                                                             |

### 에이전트 결과

| GLOSSARY 에이전트 결과 | 오케스트레이션에서 본 신호                                                                      | 맞지 않는 점                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 정상 종료              | `worker_done --outcome succeeded`                                                               | GLOSSARY는 "종료 코드 0으로 끝났다". 오케스트레이션에는 종료 코드가 없고 프로세스도 끝나지 않는다. `outcome`은 에이전트가 스스로 적은 값이다 |
| 오류 종료              | `worker_done --outcome failed`. 보고 없이 사라짐(`lost`/`exited`)을 여기에 넣을지는 정해야 한다 | 같다. 보고 없이 사라진 경우는 GLOSSARY에 자리가 없다(research 0007 "파일 없이 터미널이 사라짐"과 같은 문제)                                  |
| 시간 초과              | Running 중 최대 실행 시간 → `worker-stop`                                                       |                                                                                                                                              |
| 입력 기다리다 멈춤     | Waiting for Input 중 최대 실행 시간 → `worker-stop`                                             |                                                                                                                                              |
| 러너 연결 끊김         | ssh                                                                                             | 오케스트레이션과 상관없다                                                                                                                    |
| 워크트리 없음          | `worktree ps`·`worktree show`로 판단                                                            | 에이전트가 도는 워크트리를 지울 때 Orca가 무엇을 알리는지는 확인하지 않았다                                                                  |
| 운영자가 취소함        | `worker-stop`                                                                                   | Q77은 Queued·Running만 취소할 수 있다. 질문에 답하지 않고 취소하고 싶은 Waiting for Input은 spec 열린 질문 1번과 같다                        |

## 운영자가 정할 것

1. **코디네이터 신원.** ssh 호출자는 우편함 터미널 핸들을 `--from`으로 써야 한다. 우편함 터미널을 러너마다 하나 두는지, 그 터미널이 무엇을 돌리는지, 런타임이 다시 뜬 뒤 어떻게 되살리는지.
2. **끝과 에이전트 결과.** 대화형 에이전트는 `worker_done` 뒤에도 끝나지 않으므로 GLOSSARY의 "종료 코드 0/0이 아님"을 `worker_done`의 `outcome`으로 바꿀지. 보고 없이 사라진 에이전트(`lost`, 셸만 남음)를 어떤 결과로 둘지.
3. **권한 프롬프트.** 오케스트레이터 화면은 질문에는 답하지만 권한은 거절만 한다. 권한을 러너·프로젝트 설정으로 미리 허용할지(지금 러너는 전체 우회), 허용은 사람이 러너 화면에서 한다고 둘지.
4. **메일 처리 표시.** `--peek`만 쓰고 오케스트레이터 DB를 기준으로 할지, 저장한 뒤 소비하는 `check`로 Orca의 `handled`를 맞출지.
5. **브랜치 이름.** `worker-start`에는 `--branch`가 없어 브랜치가 `<러너 접두사>/<name>`이 된다. PR을 브랜치로 찾는 0006 방식과 어떻게 맞출지.
6. **오케스트레이션 Run 단위와 쌓이는 기록.** 러너당 하나인지 런당 하나인지. 지울 수 없는 Run·`Task` 기록을 어떻게 둘지.

## 아직 모르는 것

1. 에이전트가 턴을 끝내고 `worker_done`을 보내지 않은 경우(쉼)에 Orca가 escalation을 보내는지, `stopReason`이 무엇인지. `exited`를 관측하지 못했다.
2. `worker_done --outcome failed`일 때의 `Task` `status` 값.
3. 런타임이 다시 뜬 뒤 우편함 핸들과 그 메일함, 진행 중인 `Dispatch`가 어떻게 되는지.
4. 닫힌 우편함 핸들로 `worker-start`·`reply`를 부를 때의 동작.
5. `.claude/settings.json`의 `permissions.allow`로 미리 허용했을 때 프롬프트 없이 지나가는지, `disableBypassPermissionsMode`와 `ask` 가운데 무엇이 이번 프롬프트를 띄웠는지.
6. 사람이 러너 화면에서 권한을 허용했을 때 오는 메일(`approval.state`).
7. 에이전트가 도는 워크트리를 지웠을 때(워크트리 없음)의 escalation.
8. `check --peek --wait`의 동작. ssh를 붙잡으므로 폴링에는 쓰지 않을 생각이라 시험하지 않았다.
9. Codex 등 다른 에이전트. Claude Code만 띄웠다.
10. Linux 러너.
11. 처리하지 않은 메일이 많이 쌓였을 때 `check --peek` 응답 크기.

## 픽스처

[`fixtures/0008/`](fixtures/0008/)의 파일은 실제 출력에서 값만 바꿨다. `worktree-ps-permission.json`은 `worktree ps --agent-wait --json` 결과에서 테스트 워크트리 행만 남기고 `totalCount`를 다시 셌다. `worker-show-full-waiting-permission.json`은 `worker-show --full --json`의 `observation`·`projection`·`terminal`만 남겼다. `worker-show-agent-exited-shell-live.json`과 `worker-list-unverifiable.json`은 실행 중 화면에 찍은 출력을 옮겨 적은 것이다. `worker-release.json`은 세 번 부른 결과를 배열로 묶었다.

| 파일                                       | 상황                                                    |
| ------------------------------------------ | ------------------------------------------------------- |
| `run-create-no-from-error.json`            | ssh에서 `--from` 없이 `run-create`                      |
| `mailbox-terminal-create.json`             | 우편함 터미널 만들기                                    |
| `worker-start.json`                        | `worker-start --from <우편함>` 결과(R1)                 |
| `worker-show-asked.json`                   | `ask`하고 답을 기다리는 에이전트                        |
| `worker-show-full-asked.json`              | 같은 때 `worker-show --full`                            |
| `task-list-dispatched.json`                | 같은 때 `task-list`                                     |
| `inbox-question.json`                      | 질문이 온 `inbox`(소비 안 함)                           |
| `inbox-question-full.json`                 | 같은 메일의 `inbox --full`                              |
| `check-peek-question.json`                 | 같은 메일의 `check --peek`                              |
| `check-peek-run-error.json`                | `--terminal` 없이 `check --run --peek`                  |
| `reply.json`                               | `reply --from <우편함>`                                 |
| `inbox-after-reply.json`                   | 답한 뒤에도 `handled: false`인 질문                     |
| `inbox-dispatch-reply.json`                | 에이전트 메일함(`dispatch:`)의 답(`Re: Question`)       |
| `task-list-full-done.json`                 | `worker_done` 뒤 `task-list --full`(보고 본문)          |
| `worker-show-done.json`                    | `worker_done` 뒤 `worker-show`                          |
| `inbox-done.json`                          | `worker_done` 메일이 온 `inbox`                         |
| `check-peek-done.json`                     | 같은 때 `check --peek`                                  |
| `check-consume.json`                       | 소비하는 `check`                                        |
| `check-peek-after-consume.json`            | 소비한 뒤 빈 `check --peek`                             |
| `escalation-needs-input-full.json`         | 권한 프롬프트 escalation(`needs-input`, `approval`)     |
| `worker-show-full-waiting-permission.json` | 권한 프롬프트 중 `worker-show --full` 일부              |
| `worktree-ps-permission.json`              | 권한 프롬프트 중 `worktree ps` 행                       |
| `deny.json`                                | `deny --from <우편함>`                                  |
| `status-approval-answered-full.json`       | 거절 뒤 `Worker approval answered` 메일                 |
| `worker-stop-from-error.json`              | `worker-stop`에 `--from`을 준 오류                      |
| `worker-stop.json`                         | `worker-stop` 결과                                      |
| `worker-show-after-stop.json`              | 멈춘 뒤 `worker-show`                                   |
| `task-list-after-stop.json`                | 멈춘 뒤 `task-list`(`blocked`)                          |
| `worker-show-agent-exited-shell-live.json` | 에이전트만 죽고 셸이 남은 `worker-show`(`unverifiable`) |
| `worker-list-unverifiable.json`            | 같은 때 `worker-list`                                   |
| `escalation-lost-full.json`                | 터미널을 닫은 뒤 `lost` escalation                      |
| `worker-show-lost.json`                    | 같은 때 `worker-show`                                   |
| `task-list-after-lost.json`                | 같은 때 `task-list`(`ready`)                            |
| `worker-release.json`                      | 세 에이전트의 `worker-release`                          |
