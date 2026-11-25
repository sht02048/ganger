---
status: done
blocked_by: []
---

# 0228 흔들리는 Run 상세 다시 보내기 시험 지우기

## 목표

`e2e/src/run-detail.test.ts`의 「Run 상세 보내기 뒤 포커스와 안내(브라우저, 0051) > 저장된 뒤 응답만 끊겨 다시 보내도 말은 한 번만 남는다(0147)」가 PR과 상관없이 CI에서 실패해 `check`를 막는다. 운영자 결정(2026-11-20)대로 고치지 않고 지우고, 잃은 확인 범위를 여기에 남긴다.

## 실패 근거

- PR #287(0225, `apps/mobile`만 바꿈)의 CI run 45592206740 첫 시도, 잡 `browser (3)`에서 실패했다. 그 PR은 `apps/web`·`packages`·`e2e`를 바꾸지 않았다.
- 실패는 두 번째 보내기 뒤 `expect.poll(() => input.inputValue()).toBe("")`의 시간 초과다(`Matcher did not succeed in time`). 입력칸에 「한 번만 갈 말」이 남아 있었다. 말이 두 번 저장됐는지 보는 단언까지는 가지 못했다.
- 같은 시험은 그 PR의 워커가 로컬에서 단독으로 3번 돌려 3번 통과했다.

## 할 일

- [x] 그 시험 하나만 지운다. 같은 파일의 다른 시험과 공용 도우미는 그대로 둔다.
- [x] 그 시험만 쓰던 런(`retriedRun`, 시드의 `ACME-27`)을 함께 지운다. `listRunAgentMessages`와 `open`은 다른 시험도 써서 남긴다.
- [x] `scripts/browser-test-times.json`은 파일 단위 기록이라 바꾸지 않는다.
- [x] 잃은 확인 범위와 같은 규칙을 덮는 단위 시험을 적는다.

## 잃은 확인 범위

Run 상세의 에이전트에게 보내기(0147)에서, 서버가 말을 저장한 뒤 응답만 잃은 쓰기를 운영자가 같은 글로 다시 보냈을 때 같은 requestId로 보내 말이 한 번만 남고, 그 다시 보내기가 성공하면 입력칸이 비는지를 이제 브라우저 시험이 끝까지 확인하지 않는다.

같은 규칙을 나눠 덮는 시험은 남아 있다.

- 서버 쪽: `apps/worker/src/agent-messages.test.ts`의 「에이전트에게 보내기(0147) > 같은 요청 ID로 다시 보내면 한 번만 저장하고 한 번만 전한다」가 `requestAgentMessage`(`packages/db/src/agent-messages.ts`)에 같은 requestId를 두 번 넣어도 한 번만 저장하고 같은 결과를 돌려주는지 본다. 「이미 실패로 끝난 요청 ID로 다시 보내면 새로 저장하지 않고 실패했다고 답한다」도 같은 규칙의 실패 쪽이다.
- 화면 쪽: 같은 파일의 브라우저 시험 「응답이 끊긴 말이 실패로 끝났으면 실패를 보이고 다음 보내기를 새 말로 저장한다(0147)」가 같은 방식으로 응답을 끊은 뒤 다시 보내 말이 하나뿐인지 본다. 다시 보내기가 새 requestId를 썼다면 말이 둘이 되므로, 응답을 잃은 뒤 같은 requestId를 다시 쓰는 화면 동작은 여기서 확인된다. 다만 앞선 말이 실패로 끝난 경우이고, 다시 보내기가 성공해 입력칸이 비는 경우는 아니다.

화면의 requestId 재사용(`apps/web/src/run-detail/agent-message-form.tsx`의 `pendingRequestRef`)을 직접 보는 단위 시험은 없다. `apps/web/src/query/run-action-request-ids.test.ts`의 「런 동작 요청 ID > 응답을 못 받아 다시 보내면 같은 ID를 쓴다」는 같은 규칙이지만 다른 런 동작(`withRunActionRequestId`)용이고 에이전트에게 보내기는 그 함수를 쓰지 않는다.

## 남은 의문

`expect.poll`의 기본 대기는 1초다. CI 부하에서 두 번째 서버 함수 응답과 다시 읽기가 1초 안에 끝나지 않아 입력칸이 늦게 비었을 수 있다. 재현하지 않았고 원인은 확인하지 않았다.

## 완료 조건

- 그 시험 하나만 빠지고 `e2e/src/run-detail.test.ts`의 나머지 시험이 통과한다.
- 새 시험을 더하지 않는다.
- `scripts/browser-test-times.json`은 바꾸지 않는다.
- 화면 변경 없음. DB 변경 없음. two-way.
