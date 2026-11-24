---
status: done
blocked_by: []
---

# 0215 흔들리는 Dashboard Workspace 알약 움직임 시험 지우기

## 목표

`e2e/src/screen-motion.test.ts`의 「Dashboard 움직임(브라우저, 0153) > Workspace 를 바꿨다 돌아오면 그사이 생긴 알약이 움직이지 않는다」가 PR과 상관없이 CI에서 실패해 `check`를 막는다. 운영자 결정(2026-11-20)대로 고치지 않고 지우고, 잃은 확인 범위를 여기에 남긴다.

## 실패 근거

- PR #273(0214 Settings 개편, Dashboard 움직임을 건드리지 않음)의 CI run 45329433768 첫 시도(head `26f2b06c`), 잡 `browser (2)`에서 실패했다.
- 실패는 시간 초과가 아니라 `expectQuiet`의 단언 실패다. 돌아온 뒤 그 런 카드의 알약 커짐(`pill: true`, `transform`) 1번이 기록됐다. 뒤따른 `page.screenshot` 오류는 브라우저가 이미 닫혀 난 2차 오류다.
- 같은 시험은 로컬에서 단독으로 3번 돌려 3번 통과했다.
- 같은 파일에서 Runs 쪽 같은 모양의 시험(「Runs 움직임(브라우저, 0153) > Workspace 를 바꿨다 돌아오면 그사이 바뀐 상태와 새 행이 움직이지 않는다」)을 0168에서 같은 까닭으로 지웠다.

## 할 일

- [x] 그 시험 하나만 지운다. 같은 파일의 다른 시험은 그대로 둔다.
- [x] 쓰지 않게 된 도우미·import를 확인한다. 그 시험이 쓰던 `switchWorkspace`, `expectQuiet`, `clearCalls`는 「전체에서 한 Workspace 로 바꾸며 상태가 달라진 카드도 움직이지 않는다」 등 다른 시험도 쓰고, `otherWorkspaceName`은 시드가 써서 지울 것이 없다.
- [x] `scripts/browser-test-times.json`은 파일 단위 기록이라 바꾸지 않는다.
- [x] 잃은 확인 범위를 적는다.

## 잃은 확인 범위

Dashboard에서 다른 Workspace로 바꿨다 돌아왔을 때, 나가 있는 동안 상태가 바뀌어 새로 생긴 카드의 상태 알약이 움직임 없이 나타나는지를 이제 어떤 시험도 확인하지 않는다. 0168로 Runs 쪽 같은 경우도 이미 빠져서, 한 Workspace에서 다른 Workspace로 갔다 돌아오는 전환은 두 화면 모두 브라우저 시험이 없다.

같은 동작을 덮는 단위 시험은 없다. `MotionList`의 `resetKey` 처리(`packages/ui/src/components/motion.tsx`)를 보는 단위 시험이 없고, `packages/ui/src/motion-plan.test.ts`는 움직임 계획만 본다.

가까운 확인으로 남는 브라우저 시험은 둘이고, 모두 잃은 범위를 대신하지 못한다.

- 「Dashboard 움직임(브라우저, 0153) > 전체에서 한 Workspace 로 바꾸며 상태가 달라진 카드도 움직이지 않는다」: Workspace 전환 뒤 상태가 바뀐 카드의 알약이 움직이지 않는지 Dashboard에서 본다. 다만 전체에서 한 Workspace로 한 번 바꾸는 경우이고, 다른 Workspace에 나가 있다 돌아오는 경우는 아니다.
- 「Dashboard 움직임(브라우저, 0153) > 다른 보기에 있는 동안 생긴 알약은 돌아와도 움직이지 않는다」: 보이지 않는 동안 생긴 알약이 돌아왔을 때 움직이지 않는지 본다. Workspace가 아니라 To do 보기와 전체 보기를 오가는 경우다.

## 남은 의문

실패 기록의 움직임은 돌아온 카드의 알약 커짐 1번으로, 시험이 움직이면 안 된다고 본 바로 그 동작이다. 0168의 Runs 실패와 모양이 같다. 그래서 시험만의 문제가 아니라 돌아온 직후 SSE 변경 기록이나 다시 읽기가 늦게 닿아 화면이 실제로 움직이는 제품 쪽 경쟁 상태일 수 있다. 재현하지 않았고 원인은 확인하지 않았다.

## 완료 조건

- 그 시험 하나만 빠지고 `e2e/src/screen-motion.test.ts`의 나머지 시험이 통과한다.
- 새 시험을 더하지 않는다.
- `scripts/browser-test-times.json`은 바꾸지 않는다.
- 화면 변경 없음. DB 변경 없음. two-way.
