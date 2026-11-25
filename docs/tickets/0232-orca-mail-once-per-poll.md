---
status: done
blocked_by: []
---

# 0232 Orca 메일을 폴링마다 Orca Run 별로 한 번만 읽기, 낡은 `check --peek` 문서 고치기

## 목표

한 러너의 Ganger 런들은 같은 Orca Run 과 mailbox 를 같이 쓴다. 0231 뒤로 `pollRun`이 런마다 따로 `inbox --terminal run:<runId>`를 불러, 동시에 도는 런이 N 개면 같은 inbox 를 N 번 읽었다(창이 가장 크면 런마다 4200행). 한 폴링 주기에서 같은 Orca Run 의 메일은 한 번만 읽고 그 Run 을 쓰는 모든 런이 나눠 쓰게 한다. 런마다 받는 메일은 0231 과 같아야 한다.

함께 0231 이 낡게 만든 [ADR 0009](../adr/0009-run-via-orca-orchestration.md)와 [research 0008](../research/0008-orca-orchestration-run.md)의 `check --peek` 서술을 지금 동작으로 고친다.

## 배경

- 0231 리뷰의 막지 않는 지적이다.
- Orca 1.4.253(코디네이터 확인, 2026-11-25): 메일 하나만 읽음 처리하거나 지우는 명령은 없다. `check`는 오래된 묶음 단위로 읽음 처리하고, `reset --messages`는 Run 의 메일을 모두 지운다. `inbox`는 읽음 여부와 상관없이 보여 주므로 읽음 처리로 읽는 양이 줄지 않는다. 그래서 정리(ack·삭제)는 하지 않는다(운영자 결정 2026-11-25).

## 고른 방향과 이유

### 주기의 경계: `watchActiveRuns` 한 바퀴

- `Runner`에 고를 수 있는 `beginPollCycle(agents)`와 `endPollCycle()`을 더했다. worker 의 `watchActiveRuns`가 런을 돌기 전에 러너마다 그 러너의 런 `agentRef`를 알리며 주기를 열고, 모든 런을 본 뒤 `finally`에서 닫는다.
- worker 는 `tick`마다 `watchActiveRuns`를 한 번 돈다. 같은 inbox 를 N 번 읽는 곳이 여기이므로 주기를 이 한 바퀴로 한정하면 캐시는 그 바퀴 안에서만 산다. 다음 `tick`은 새 주기로 다시 읽는다.
- 짧은 TTL 은 고르지 않았다. 한 바퀴에 걸리는 시간이 런 수와 ssh 지연에 따라 달라 TTL 로는 "한 주기"를 정확히 가를 수 없다.
- 같은 `tick`의 `processAgentMessages`(보내기 전 상태 확인)는 주기 밖이라 예전처럼 따로 읽는다. 런마다 한 번 겹쳐 읽는 문제가 아니고, 보내기 직전의 상태를 새로 보는 편이 맞다.
- 러너의 주기를 열지 못하면 `runner.poll_cycle_failed`(warn)를 남기고, 그 러너의 런은 주기 없이 0231 처럼 런마다 읽는다.
- 주기 밖에서 부른 `pollRun`(시험, 다른 호출자)은 0231 과 똑같이 부를 때마다 읽는다.

### 창 크기: 그 Orca Run 의 런들 중 가장 이른 Task 시작까지

- 주기 안에서 Orca Run 별로 창 하나를 둔다. 처음 읽는 런이 200행을 읽고, 창이 차지 않았으면 그것이 그 Run 의 메일 전부라 모든 런이 그대로 쓴다.
- 창이 찼으면 `task-list --run`을 한 번 불러 그 Run 의 Task 시작 시각을 기억하고, 주기에 알린 런들 중 가장 이른 Task 시작 앞의 메일이 창에 들어올 때까지 4배씩 넓힌다(200 → 800 → 3200). 그래서 늦게 시작한 런이 먼저 폴링해도 창을 덜 읽지 않는다.
- 주기에 알리지 않은 런이 더 이른 Task 시작으로 폴링하면 그 런을 위해 창을 더 넓혀 캐시를 바꾼다. 공유 창이 어떤 런의 0231 창보다 작아지는 일은 없다.
- 3200행 상한과 `runner.mail_window_short` 경고는 그대로다. 경고는 런마다 자기 Task 시작에 닿지 못했을 때 남긴다.
- Task 시작 시각은 바뀌지 않으므로 주기 안에서 기억해도 된다. Task `result`는 완료를 보려고 런마다 예전처럼 새로 읽는다.

### 결과가 0231 과 같은 이유

`inbox`는 최신 순이라 런의 Task 시작 앞의 메일이 든 창은 그 런의 메일을 모두 담는다. 공유 창은 각 런의 Task 시작에 닿거나(또는 그 Run 의 메일 전부이거나) 0231 과 같은 3200행 상한이다. `decideProgress`는 런의 `dispatchId` 메일만 보므로 창이 더 커도 결과가 같다.

## 할 일

- [x] 한 폴링 주기에서 같은 Orca Run 의 inbox 를 한 번 읽고 런들이 나눠 쓴다.
- [x] 창을 주기에 알린 런들 중 가장 이른 Task 시작까지 넓힌다.
- [x] 캐시 수명을 `watchActiveRuns` 한 바퀴로 한정한다.
- [x] ADR 0009, research 0008 의 `check --peek` 서술을 지금 동작으로 고친다.
- [x] 0231 티켓에 이 후속을 가리키는 줄을 더한다.

## 완료 조건

가짜 Orca(`ScriptedExec`, Orca Run 별 inbox 와 Task 시작)로:

- [x] 같은 Orca Run 의 런 3개를 한 주기에 폴링하면 `inbox`를 한 번 부르고, 런마다 받는 결과가 런을 따로 폴링한 0231 방식과 같다.
- [x] 늦게 시작한 런이 먼저 폴링해도 창을 가장 이른 Task 시작까지 넓힌다(200 → 800 두 번, `task-list` 한 번). 런마다 결과가 0231 방식과 같다.
- [x] 주기에 알리지 않은 더 이른 런도 자기 Task 시작까지 창을 넓혀 오래된 질문을 찾는다.
- [x] 워커가 ready 가 아니어서 런마다 Task 를 읽어도 inbox 는 한 번이고 결과가 0231 방식과 같다.
- [x] 공유 창이 3200행 상한에 닿으면 한 번만 읽고 런마다 `runner.mail_window_short`를 남긴다.
- [x] 다른 Orca Run 의 런은 그 Run 의 inbox 를 따로 읽는다.
- [x] 다음 주기에는 다시 읽어 그사이 온 메일을 본다. 주기 밖의 `pollRun`은 부를 때마다 읽는다.
- [x] worker 의 `watchActiveRuns`가 러너마다 그 러너의 런을 알리며 주기를 열고, 런을 모두 폴링한 뒤 닫는다.

DB 변경 없음.
