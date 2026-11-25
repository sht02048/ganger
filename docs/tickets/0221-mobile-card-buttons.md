---
status: done
blocked_by: []
---

# 0221 모바일 Question·Human Check 카드 버튼을 웹(0198)과 같은 모양으로

## 배경

웹은 [0189](0189-dashboard-human-check-card.md)·[0198](0198-question-paused-card-buttons.md)로 Dashboard의 답하지 않은 Question·Human Check 카드에서 요약 문구를 빼고, 카드 맨 아래 폭 전체 버튼을 알약과 같은 색 계열(`answer`·`check`)로 바꿨다. 0198 결정 4번은 모바일을 바꾸지 않는다고 적었다. 지금 모바일은 Question 카드가 질문 요약 첫 줄을, Human Check 카드가 본문 첫 줄을 보이고, 행동 버튼은 모두 무채색 `secondary`다. 모바일 `Button`에는 `answer`·`check` 변형이 없다.

## 운영자 결정 (2026-11-25)

모바일 카드도 웹과 같은 모양으로 맞춘다.

1. 답하지 않은 Question 카드는 질문 요약 문구를 빼고, "답하기"를 `answer` 색(바탕 `answerSoft`, 글자 `answer`) 버튼으로 둔다.
2. 답하지 않은 Human Check 카드는 확인할 내용 문구를 빼고, "확인하기"를 `check` 색(바탕 `checkSoft`, 글자 `check`) 버튼으로 둔다. 내용은 시트에서 본다.
3. 답한 Question·Human Check 카드는 지금 그대로("답을 보냈어요", 버튼 없음) 둔다.
4. Paused "재개하기"는 웹처럼 무채색(`secondary`) 폭 전체 버튼이다. 모바일은 이미 이 모양이라 바꾸지 않는다. Permission(거절, `danger`), Failed·Disconnected·모르는 상태(런 상세, 다시 맡기기)도 그대로 둔다.
5. 아랫줄(러너·에이전트, 시간)은 버튼 위에 그대로 둔다. 스크린 리더 이름은 버튼 글과 같다("답하기", "확인하기").

## 완료 조건

- [x] 모바일 `Button`에 `variant="answer"`·`"check"`를 선택 속성으로 더하고, 기존 사용처는 바꾸지 않는다. `apps/mobile/DESIGN.md`에 적는다.
- [x] 단위 시험: 새 버튼 변형의 바탕·글자 색
- [x] 단위 시험: 답하지 않은 Question·Human Check 카드에 요약 문구 없음·`answer`·`check` 색 버튼, 답한 카드와 Paused·Permission 카드는 그대로
- [x] 스크린숏은 찍지 않는다. 실기기 확인은 운영자가 머지 뒤 한다.

## 결정

- 모바일 버튼 높이는 웹의 36px(`controlLarge`)을 따르지 않고 누르는 곳 최소 44(`touchTarget`)를 지킨다. 모바일 카드 버튼은 이미 카드 폭 전체라 `block` 같은 속성을 더하지 않는다.
- 누를 때는 다른 버튼처럼 투명도로 보인다. 웹의 hover 색(`answerSoftHover`·`checkSoftHover`)은 모바일에 없어 옮기지 않는다.
- ADR 0010 6번은 카드 행동을 보조 버튼이라 하고, 모바일 예외 절과 스펙 0002에는 카드 버튼 색·요약 문구 규칙이 없어 고치지 않는다.
