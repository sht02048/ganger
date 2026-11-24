---
status: done
blocked_by: []
---

# 0212 레일 Dashboard 아이콘에 처리할 일 수 배지

## 배경

운영자 요청(2026-11-24): 알림이 올 만한 일이 생기면 왼쪽 레일 아이콘에도 보였으면 한다. 예: Dashboard 아이콘에 "1".

지금 레일은 Runners 아이콘에만 러너 문제 수를 빨간 점 숫자로 보인다(`apps/web/src/shell/app-shell.tsx`의 `issues`, `packages/ui`의 `RailLinkContent`).

## 운영자 결정 (2026-11-24)

1. Dashboard 레일 아이콘에 처리할 일(To do) 수를 숫자 배지로 보인다. 수는 Dashboard 머리의 "처리할 일만 N"과 같은 값·같은 계산을 쓴다. 범위도 머리와 같다(티켓 단위 To do, 지금 고른 Workspace 기준, 전체를 고르면 전체). 0이면 배지를 숨긴다. 99를 넘으면 "99+"로 보인다.
2. 색: 러너 문제(빨강, problem)와 구분해 처리할 일은 강조색(accent, 노랑)을 쓴다. 모바일의 노란 처리할 일 배지(스펙 0002 M19, ADR 0010 모바일 예외)와 같은 뜻이다. 웹에서 이 용도를 ADR 0010·`packages/ui/DESIGN.md`에 더한다. `RailLinkContent`에 배지 종류(문제/할 일)를 고르는 선택 속성을 더해 넓힌다.
3. 갱신: 셸 데이터(shell query)와 변경 이벤트로 Dashboard와 같은 때 바뀐다. 수가 바뀔 때 움직임은 넣지 않는다.
4. 접근성: 숫자는 `aria-hidden`이고, 링크 접근 이름에 "처리할 일 N개"를 더한다(Runners의 지금 방식과 같게).

- Tickets·Runs 등 다른 아이콘은 이번에 바꾸지 않는다. 데스크톱 Dock 배지는 지금 그대로다.
- DB 변경 없음.

## 완료 조건

- [x] 배지 수는 Dashboard 머리의 처리할 일 수와 같은 함수로 센다(한 Workspace, 전체)
- [x] 0이면 배지를 숨기고, 99를 넘으면 "99+"로 보인다
- [x] 배지 색 종류: 처리할 일은 강조색, 러너 문제는 문제색
- [x] 링크 접근 이름에 "처리할 일 N개"가 붙고 숫자는 `aria-hidden`이다
- [x] 런 변경 이벤트 뒤 셸 데이터를 다시 읽어 배지가 바뀐다
- [x] ADR 0010·DESIGN.md·`/ds`에 처리할 일 배지를 더한다
- [x] 새 브라우저 시험 부하 5회 결과를 PR 본문에
- [x] 스크린숏: 레일에 Dashboard 배지와 Runners 배지가 함께 보이는 화면
