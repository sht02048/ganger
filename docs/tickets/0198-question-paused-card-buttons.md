---
status: done
blocked_by: []
---

# 0198 Dashboard Question·Paused 카드 버튼을 Human Check 모양으로

## 배경

티켓 [0189](0189-dashboard-human-check-card.md)에서 답하지 않은 Human Check 카드를 문구 없이 카드 맨 아래 폭 전체 버튼으로 바꿨다. 같은 "버튼이 아랫줄 밑에 떠 있는" 모양이 Question 카드의 "답하기"와 Paused 카드의 "재개하기"에 남아 있다.

## 운영자 결정 (2026-11-23)

1. 답하지 않은 Question 카드는 질문 요약 문구를 빼고, "답하기"를 카드 맨 아래 폭 전체 버튼으로 둔다. 색은 Question 알약과 같은 계열(`answer`·`answerSoft`)이다. 아랫줄(러너·에이전트, 시간)은 버튼 위에 그대로 둔다. 답한 Question 카드는 지금 그대로 둔다.
2. Paused 카드는 "재개하기"를 카드 맨 아래 폭 전체 버튼으로 둔다. 색은 지금처럼 무채색(`secondary`)이다. 멈춘 이유와 아랫줄, 보내는 중 표시, 거절 문구 동작은 그대로 둔다.
3. 카드 넓이와 상관없이 같은 모양이다. 0193의 "보내면 패널 닫기"와 포커스 규칙은 그대로 둔다.
4. Permission, Running 메뉴, Failed, Disconnected 카드와 모바일 앱은 바꾸지 않는다.

## 완료 조건

- [x] 단위 시험: Question 카드에 detail 없음·폭 전체 answer 색 버튼, Paused 폭 전체 재개하기, 답한 Question과 기존 Human Check는 그대로
- [x] 기존 Dashboard 브라우저 시험 통과
- [x] 스크린숏: Running 칸의 Question·Human Check·Paused 카드가 함께 보이는 좁은 칸

## 결정

- `Button`에 `variant="answer"`를 선택 속성으로 더하고, hover 색은 `checkSoftHover`와 같은 방식으로 `answerSoftHover` 토큰을 둔다.
