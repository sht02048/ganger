---
status: done
blocked_by: []
---

# 0203 흔들리는 Tickets 브라우저 시험 지우기

## 목표

`e2e/src/tickets.test.ts`의 「Tickets 수동 할당(브라우저, 0054) > 보내는 중에는 Esc 나 취소로 창이 닫히지 않는다」가 PR과 상관없이 CI에서 실패해 `check`를 막는다. 운영자 결정(2026-11-20)대로 고치지 않고 지우고, 잃은 확인 범위를 여기에 남긴다.

## 실패 근거

- PR #259(0200, Tickets를 건드리지 않음)의 CI run 45168074435 첫 시도(head `bb702450`), 잡 `browser (1)`에서 `expect.poll() function didn't resolve in time`으로 실패했다. 다시 돌린 두 번째 시도에서는 통과했다.
- 실패 위치는 시험의 마지막 단언인 「할당 뒤 포커스가 '런 보기'로 간다」 poll(`expect.poll(focused).toBe(tickets.panel.openRun)`)이다. 그 앞의 「보내는 중」 버튼, Esc·취소 뒤 창이 남는 일, 알림, 창 닫힘 단언은 통과했다.
- 같은 시험은 로컬에서 단독으로 3번 돌려 3번 통과했다.
- 이 파일은 0110 때도 흔들렸고, 0192에서 상위 이슈 한 번에 할당 시험 하나를 이미 지웠다. 0181 때는 Tickets 목록을 쓰는 `e2e/src/navigation-back.test.ts`가 흔들렸다.

## 할 일

- [x] 그 시험 하나만 지운다. 같은 describe의 다른 시험은 그대로 둔다.
- [x] 쓰지 않게 된 도우미·import를 지운다. 그 시험만 쓰던 `holdNextServerCall`과 `Route` 타입 import를 지웠다. 나머지 도우미(`hydrated`, `fill`, `focused`)와 메시지 import는 다른 시험도 써서 남긴다.
- [x] 잃은 확인 범위를 이미 지키는 부분과 아무도 지키지 않는 부분으로 나눠 적는다.

## 잃은 확인 범위

지운 시험은 실제 브라우저에서 할당 요청을 붙잡아 둔 채, 단일 할당 대화상자(`apps/web/src/tickets/assign-dialog.tsx`의 `AssignDialog`)가 「보내는 중」 버튼으로 바뀌고, 그동안 Esc나 「취소」로 닫히지 않고, 요청이 끝나면 알림과 함께 닫히고 포커스가 「런 보기」로 가는지를 이어서 봤다.

### 이미 지키는 부분

- 단일 할당 뒤 알림이 뜨고 창이 닫히고 포커스가 「런 보기」로 가는 일: `e2e/src/tickets.test.ts`의 「Tickets 수동 할당(브라우저, 0054) > 할당할 수 있음 필터에서 할당하면 창이 닫히고, 그 티켓을 고른 채 '런 보기'로 포커스가 간다」. 지운 시험이 실패한 단언과 같은 단언이다.
- 브라우저에서 할당 대화상자를 열어 할당하면 창이 닫히고 런이 생기는 일: 같은 파일의 「저장소 라벨이 붙은 티켓은 그 저장소를 골라 둔 채 창이 열리고, 할당하면 그 저장소로 런이 생긴다(0115)」, `e2e/src/operator-actions.test.ts`, `e2e/src/worker-wake.test.ts`.
- 보내는 동안 닫기를 눌러도 닫히지 않고, 끝나면 닫히는 같은 모양의 동작: `apps/web/src/tickets/bulk-assign-dialog.test.tsx`의 「할당과 닫기(0176) > 보내는 동안에는 닫기를 눌러도 닫히지 않는다」. 다른 컴포넌트(`BulkAssignDialog`)의 단위 시험이다.

### 아무도 지키지 않는 부분

- 단일 할당 대화상자가 보내는 동안 Esc나 「취소」(`DialogClose`)로 닫히지 않는 일(`AssignDialog`의 `onOpenChange`에서 `pending`이면 닫지 않음). `AssignDialog` 컴포넌트(보내는 중 처리)에는 단위·컴포넌트 시험이 없다. 같은 파일의 `AssignForm`과 `runnerOptionsFor`만 `apps/web/src/tickets/tickets-screen.test.tsx`가 본다.
- 보내는 동안 주 버튼이 「보내는 중」 문구로 바뀌고 막히는 일(`disabled={pending}`).
- 보내는 동안 Esc를 누른 뒤에도 요청이 끝나면 알림과 함께 닫히고 포커스가 「런 보기」로 가는 일. 요청이 늦게 끝나는 경우의 포커스 이동은 브라우저로 보지 않는다.
- 어느 화면에서든 Esc로 막힌 창이 닫히지 않는지 보는 시험. 일괄 할당 단위 시험도 「닫기」 버튼만 누른다.

## 남은 의문

- 할당 뒤 포커스가 「런 보기」로 가지 않은 까닭은 재현하지 않아 확인하지 못했다. 포커스는 할당 뒤 다시 읽은 티켓의 `assignability`가 `active-run`이 되어 「런 보기」 버튼이 그려져야 옮겨 간다(`tickets-screen.tsx`의 `focusOpenRun` 효과). CI 부하로 다시 읽기가 늦었는지, 제품 쪽 경쟁 상태인지는 가리지 못했다.
- 이 파일의 `expect.poll`은 모두 제한 시간을 주지 않아 vitest 기본값(1초)을 쓴다(`e2e/vitest.config.ts`는 `testTimeout`만 정한다). 다시 읽은 뒤에야 맞는 단언이 많아 CI 부하에서 같은 방식으로 흔들릴 위험이 있다. 특히 같은 「런 보기」 포커스 poll을 쓰는 「할당할 수 있음 필터에서 할당하면 창이 닫히고, 그 티켓을 고른 채 '런 보기'로 포커스가 간다」, 관계 행을 누른 뒤 제목 포커스를 보는 「관계 행은 그 티켓을 고르고 제목으로 포커스를 옮기고, …(0164, 0181)」, 할당 뒤 DB의 런을 보는 「저장소 라벨이 붙은 티켓은 …(0115)」이 그렇다. 이 티켓에서는 고치지 않는다.

## 완료 조건

- 그 시험 하나만 빠지고 `e2e/src/tickets.test.ts`의 나머지 13개 시험이 통과한다.
- 새 시험을 더하지 않는다.
- `scripts/browser-test-times.json`은 바꾸지 않는다.
- 화면 변경 없음. DB 변경 없음. two-way.
