---
status: done
blocked_by: []
---

# 0189 Dashboard Human Check 카드: 알약·제목 간격과 확인하기 버튼

## 배경

운영자 보고(2026-11-23): Dashboard 카드에서 상태 알약 줄과 제목 사이가 붙어 있고, Human Check 카드의 "확인하기" 버튼이 좁은 칸에서 아랫줄 밑 오른쪽에 혼자 떠 어색하다.

## 운영자 결정 (2026-11-23)

1. 알약 줄과 제목 사이 간격을 2px에서 6px(`space.px6`)로 넓힌다. `KanbanCard`의 키 있는 카드 모두에 적용한다.
2. 답하지 않은 Human Check 카드는 확인할 내용 문구를 빼고, 내용은 "확인하기"로 연 시트에서 본다.
3. "확인하기"는 카드 맨 아래 폭 전체 버튼이고 색은 Human Check 알약과 같은 계열(`check`·`checkSoft`), 높이는 36px이다. 아랫줄(러너 · 에이전트, 시간)은 버튼 위에 두고, 카드 넓이와 상관없이 모양이 같다.
4. 답한 Human Check 카드는 지금 그대로 둔다(문구 + "답했어요").
5. Question·Paused 등 다른 action 카드의 모양은 바꾸지 않는다.
6. 버튼의 `aria-describedby=titleId`를 유지한다. 카드 열기(요약)와 확인하기(답하기 시트)는 다른 동작이다.

## 완료 조건

- [x] 단위 시험: 키 있는 카드 rowGap, Human Check 카드에 detail 없음·폭 전체 확인하기, 답한 Human Check·Question·Paused 카드는 그대로
- [x] 기존 Dashboard 브라우저 시험 통과
- [x] 스크린숏: Running 칸의 Human Check 카드(좁은 칸, 넓은 칸), 그대로인 Question 카드

## 결정

- 36px 높이는 입력칸 토큰을 빌리지 않고 `size.controlLarge`로 새로 둔다. hover 색은 `checkSoftHover`로 둔다.
- `Button`은 `variant="check"`와 `block`, `KanbanCard`는 `actionFullWidth`를 선택 속성으로 더해 다른 카드의 모양을 바꾸지 않는다.
