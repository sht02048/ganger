# 런 결과는 PR 상태가 아니라 에이전트 보고로 정한다

요약 결과(Merged·Human Check·Failed·Canceled)는 에이전트 결과와 PR 상태 두 축에서 계산했다. 그래서 worker는 런을 끝내기 전에 코드 호스트에서 PR을 읽어야 했고, DB도 PR 상태 없이 런을 끝낼 수 없게 막았다(`runs_pr_state_iff_ended`). 2026-11-20 org 비공개 저장소의 런에서 GitHub 토큰이 그 저장소를 볼 수 없어 PR 읽기가 실패하자, 에이전트가 끝났다고 보고했는데도 런이 Running으로 남아 러너 자리를 차지했고 화면에는 원인이 보이지 않았다. 같은 날 운영자가 R1~R6을 정했다(스펙 [0005](../spec/0005-run-outcome.md) 3절).

## 결정

- **런 결과는 에이전트 보고로만 정한다: Succeeded / Failed / Canceled(R1).** PR은 결과를 정하지 않고 정보(PR #n Open·Merged·Closed)로 붙는다. Human Check는 나중에 에이전트가 요청하는 Waiting for Input 종류로 돌아온다(이번 범위 밖).
- **PR을 읽지 못해도 런은 바로 끝나고 러너 자리를 비운다(R2).** PR 상태는 `unknown`("못 읽음")으로 두고 이유(`no-access`·`other`)를 함께 저장한다. worker가 간격을 늘려 가며 다시 읽어 채운다(R4). 못 읽음은 런과 Settings에 보인다(R3).
- **두 티켓으로 나눈다(R6).** 0144가 끝내기에서 PR 읽기를 떼고 `unknown`을 더한다. 결과 이름은 바꾸지 않고, `unknown`의 요약 결과는 지금 이름 체계에서 가장 덜 틀린 값(보고한 런은 Human Check)으로 둔다. 0145가 요약 결과 이름을 Succeeded·Failed·Canceled로 바꾼다.
- **PR이 병합되면 Failed 런을 To do에서 빼지만 결과는 바꾸지 않는다(티켓 0235).** 운영자가 "확인했어요"로 뺀 런도 같다. 빼는 규칙은 To do 계산만 바꾸고 요약 결과·Stats·MCP `summary`는 Failed 그대로다.
- **[ADR 0010](0010-ui-words-and-visual-rules.md)의 상태 이름·색 규칙 중 바뀌는 부분은 0145에서 고친다.** 요약 결과 Merged·Human Check는 Succeeded가 되고, To do 종류에서 Human Check가 빠진다. 0144는 ADR 0010을 고치지 않는다.

## 되돌리기 어려운 이유

결과 이름에 화면 이름(상태 알약, Runs 필터, Dashboard 꼬리표), Stats의 의미(성공률을 무엇으로 세는지), 알림 사건 종류(Human Check 알림), MCP 출력(`summary` 값), 사용자의 기대(Merged면 끝, Human Check면 내가 볼 일)가 기댄다. 이름과 뜻을 다시 바꾸면 이 모두와 쌓인 사용자의 습관이 함께 바뀐다. 또 `unknown`을 더하는 마이그레이션은 one-way다. 새 버전이 `unknown` 행을 쓰고 나면 옛 버전은 그 값을 읽지 못한다(되돌리는 법은 티켓 [0144](../tickets/0144-end-run-without-pr.md)).

## 고려한 대안

- **지금 이름(Merged·Human Check·Failed·Canceled)을 유지하고 끝내기만 떼기.** 러너 자리 문제는 풀지만, 결과가 계속 PR 상태에 기대므로 PR을 못 읽은 런이나 PR 없이 끝나는 일(문서만 고치는 티켓 등)의 결과가 늘 틀린 이름을 얻는다. 에이전트는 성공했다고 보고했는데 PR이 없다는 이유로 Failed가 되고, Stats의 성공률이 코드 호스트 권한에 따라 흔들린다. 0144는 이 안을 임시로 거치지만 머물지 않는다.
- **몇 번 더 시도하고 끝내기.** 끝내기 전에 PR 읽기를 몇 번(예: 3번, 몇 분) 더 시도한 뒤 끝낸다. 권한 오류는 다시 시도해도 풀리지 않고, 그동안 러너 자리를 계속 잡는다. 결국 못 읽은 채 끝내는 경로가 필요해 `unknown` 같은 값을 피할 수 없고, 시도 횟수만큼 지연이 늘어난다.

## 결과

- `packages/core` `PR_STATES`에 `unknown`, `PR_READ_ERRORS`(`no-access`·`other`)가 생긴다. 못 읽은 런의 워크트리 처리는 PR이 열린 런과 같은 남김(`keep-until-pr-settles`)이다. DB `runs`에 `pr_read_error` 열과 제약이 생긴다.
- worker 끝내기는 코드 호스트를 읽지 못해도 멈추지 않는다. 다시 읽기는 1분에서 30분까지 두 배씩 늘리고 토큰이 바뀌면 바로 한다. 못 읽은 동안 워크트리를 지우지 않는다.
- 0144와 0145 사이에는 PR을 못 읽은 보고 런이 Human Check로 To do에 오른다. 0145 뒤에는 Succeeded·Failed와 "PR 정보를 읽지 못했어요"로 보인다.
- GLOSSARY의 PR 상태는 0144에서 `unknown`을 더하고, 요약 결과·To do·Assignable·끝남은 0145에서 고친다.
