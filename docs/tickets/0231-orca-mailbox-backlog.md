---
status: done
blocked_by: []
---

# 0231 러너 mailbox 에 안 읽은 메일이 100개를 넘으면 새 질문·Human Check·권한 요청을 놓치는 문제

## 목표

Orca 러너의 에이전트가 보낸 질문, Human Check(`decision_gate`), 막힘·권한 대기·정지 escalation 이 앞에 쌓인 메일 수와 상관없이 다음 폴링에서 보이게 한다.

## 운영자 보고(2026-11-25)

- 에이전트가 `orca orchestration ask`로 보낸 질문 두 개가 Dashboard·런 상세에 뜨지 않았다. Orca inbox 에는 `type=question`, `handled=false`, 런의 dispatch 와 같은 `payload.dispatchId`로 있었고 `run_questions`에는 행이 없었다. worker 로그에 오류는 없었다.
- 원인: `readMail`이 우편함과 런이 같은 Orca Run 이면 `check --terminal <우편함> --peek --full`로 읽었다. `--peek`은 안 읽은 메일을 오래된 것부터(FIFO) 최대 100개 주고 읽음으로 바꾸지 않는다. Ganger 는 메일을 소비하지 않으므로(ADR 0009) 2026-11-19 부터 안 읽은 메일 104개가 쌓였고, 러너의 모든 런이 같은 Orca Run 을 같이 쓰므로 끝난 런의 메일이 앞자리 100개를 차지해 새 메일이 응답에 들어오지 않았다.

## Orca CLI 근거(Orca 1.4.253, 2026-11-25 확인)

- `orchestration check --help`: 기본은 "가장 오래된 안 읽은 FIFO 묶음을 돌려주고 처리됨으로 바꾼다". `--peek`은 안 읽은 메일만, 읽음으로 바꾸지 않는다. `--all`은 "최근 메일", 읽음으로 바꾸지 않는다. `--ack <delivery_id>`는 옛 Orca 의 묶음을 처리됨으로 바꾼다. `--types`는 `--peek`·`--all`의 행만 거른다. `--limit`, dispatch·task 로 거르는 옵션은 없다. 같은 help 는 "지켜보기만 하는 스크립트는 `--peek`만 쓰고 `--ack`하지 않는다"고 적는다.
- 메일을 하나씩 처리됨으로 바꾸는 명령은 없다(`orchestration --help` 명령 목록). 처리됨은 소비하는 `check`가 돌려준 묶음 단위로만 바뀐다(research 0008 2절).
- `orchestration inbox --help`: `--limit <n>`, `--terminal <handle>`, `--full`만 있다. 실측: `inbox --limit 5000 --full`이 2037행을 다 줬다(100에서 자르지 않는다). 행은 `sequence` 내림차순, 곧 최신 순이다. 읽은 메일(`read: 1`)과 안 읽은 메일(`read: 0`)을 모두 준다. `--terminal run:<runId>`는 그 Run 앞으로 온 메일만 준다.
- `orchestration task-list --full --brief`의 Task 행에 `created_at`(UTC, `YYYY-MM-DD HH:MM:SS`)이 있다. 한 dispatch 의 메일은 모두 그 Task 가 생긴 뒤에 온다.

## 고른 방향과 이유

### 읽는 쪽: 두 경로 모두 `inbox --terminal run:<runId>`를 최신 순 창으로 읽는다

- 우편함과 런의 Orca Run 이 같든 다르든 `inbox --terminal run:<agent의 runId> --limit <n> --full`로 읽는다. 읽음 여부와 상관없이 최신 메일부터 오므로 새 메일은 언제나 창 맨 앞에 있다.
- 창은 200행에서 시작한다. 돌려받은 행이 한도보다 적으면 그 Run 의 메일 전부다. 한도를 채웠으면 런의 Task `created_at`을 보고, 창에 그보다 앞선 메일이 있으면 런의 메일이 모두 창 안에 있다. 아니면 창을 4배로 넓혀(200 → 800 → 3200) 다시 읽는다. 오래 기다리는 질문도 Task 시작까지 거슬러 읽으므로 놓치지 않는다.
- `task-list`는 창이 찼을 때만 부른다. 같은 폴링에서 완료 보고를 보려고 이미 읽었으면 다시 부르지 않는다.
- 4절(`mailbox.runId !== agent.runId`, 예전 `inbox --limit 500`)도 같은 한도 문제가 있었다. 런이 시작된 Run 에 500행 넘게 메일이 오면 오래된 질문이 창 밖으로 밀렸다. 같은 창 넓히기로 맞췄다.
- 폴링이 우편함 터미널을 쓰지 않게 됐다. 우편함 바인딩은 틱마다 `ensureMailbox`가 확인하므로(`tick`이 `context.mailboxes`를 비운다) `check --peek`의 `consumer_fenced`로 우편함을 다시 만들던 길은 필요 없다.

### 쌓이지 않게: ack 하지 않는다

티켓을 열 때는 "저장 뒤 ack"를 후보로 적었으나 근거에 따라 ack 하지 않는 쪽을 골랐다.

- ADR 0009 가 "메일은 소비하지 않고 읽는다. 처리 여부는 오케스트레이터 DB가 기준이다"로 정했다. 이 결정을 바꿀 근거가 새로 생기지 않았다.
- Orca 에는 메일 하나를 처리됨으로 바꾸는 명령이 없다. 소비하는 `check`는 가장 오래된 FIFO 묶음 전체를 처리됨으로 바꾸므로 "끝난 런의 메일만", "저장한 메일만" 고를 수 없다. 아직 답하지 않은 다른 런의 질문까지 함께 처리됨이 된다.
- worker 는 폴링마다 받은 질문·권한 대기 목록으로 상태를 정한다(`resolveRunProgress`, `resolvePermissionWaits`). 메일이 응답에서 빠지면 답하지 않은 질문이 있는 런이 `running`으로 돌아가고 열린 권한 대기가 풀린 것으로 기록된다. 소비하면 `--peek`에서 빠지므로 이 위험이 생긴다. 고친 읽기는 읽은 메일도 주는 `inbox`라 소비 여부가 결과를 바꾸지 않는다. 그래서 소비해 얻는 것은 Orca 의 안 읽음 숫자뿐이고, 되돌릴 수 없는 Orca 상태 변경을 감수할 까닭이 없다.
- 우편함 터미널은 Ganger 가 만든 `cat > /dev/null` 터미널이고 Ganger 만 쓴다. 그래도 위 이유로 ack 하지 않는다.

### 이미 쌓인 메일

수동 단계는 없다. 고친 worker 의 첫 폴링에서 기다리는 런의 질문이 최신 순 창에 들어오므로 Dashboard·런 상세에 뜬다. 끝난 런의 메일은 Orca 에 안 읽음으로 남지만 읽기 결과에 영향이 없다.

### 한도 경고

창을 3200행까지 넓혀도 Task 시작 앞의 메일이 보이지 않으면(또는 Task 의 `created_at`을 알 수 없으면) 읽은 만큼으로 진행하고 worker 로그에 `runner.mail_window_short`(warn, `orcaRunId`, `count`, `reason`)를 남긴다.

## 할 일

- [x] Orca CLI 의 `check`·`inbox` 옵션, 한도, 정렬을 help 와 실측으로 확인해 근거를 적는다.
- [x] `readMail`을 두 경로 모두 최신 순 `inbox` 창으로 읽고 Task 시작까지 창을 넓힌다.
- [x] 창이 가장 커도 Task 시작에 닿지 못하면 경고를 남긴다.
- [x] ack 여부를 근거로 정하고 이유를 적는다.

## 완료 조건

가짜 Orca(`ScriptedExec`가 `--limit`만큼 최신 메일을 주는 inbox)로 두 경로(우편함이 런의 Orca Run 에 묶임, 다른 Run 으로 바뀜) 모두에서:

- [x] 끝난 런의 메일 254개 뒤의 새 question·decision_gate·막힘 escalation·권한 대기 escalation 이 모두 보인다. 소비하는 `check`·`--ack`를 부르지 않는다.
- [x] 첫 창보다 오래된 질문을 창을 넓혀 찾는다(200 → 800).
- [x] 쌓인 메일 뒤의 `lost` escalation 으로 런이 보고 없이 끝난다.
- [x] 한도보다 적게 오면 한 번만 읽고 `task-list`를 부르지 않는다.
- [x] 3200행을 채워도 Task 시작에 닿지 못하면 `runner.mail_window_short`를 남긴다.

`worker_done`은 메일이 아니라 Task `result`로 안다(ADR 0009, `completionReport`). 운영자 보고의 런도 그렇게 끝났으므로 메일 쪽 시험은 따로 두지 않는다. "저장 뒤에만 ack", "저장 실패면 ack 안 함", "끝난 런 메일 정리" 시험은 ack 하지 않기로 해서 두지 않는다.
