---
status: done
blocked_by: []
---

# 0163 Dashboard Done 칸을 7일로

## 목표

Dashboard의 Done today 칸은 오늘(운영자 시간대) 끝난 런만 보여서, 아침에는 어제 끝난 일이 바로 사라진다. 운영자 결정(2026-11-21)으로 칸 이름을 `Done`으로 바꾸고 최근 7일 동안 끝난 런까지 보여 준다.

## 결정

- 칸 이름은 `Done`이다. "Done today"를 쓰는 화면 문구(빈 칸 문장, Running 안내 "끝나면 Done today로 옮겨요" 등)도 맞춘다. 빈 칸 문장은 "최근 7일 동안 끝난 런이 없어요".
- 7일은 운영자 시간대로 오늘을 포함한 7개 날짜다(오늘과 앞선 6일). 그보다 앞서 끝난 런은 칸에 넣지 않는다.
- To do 꼬리표가 붙은 끝난 런(Failed)은 지금처럼 날짜와 상관없이 칸 맨 위에 남는다.
- 보이는 카드 수 제한(`DONE_TODO_VISIBLE`, 처리할 일 없이 끝난 카드 `SETTLED_VISIBLE`)과 "모두 보기" 링크는 그대로 둔다. 칸 머리 개수는 7일 안의 전체 개수다.
- 카드의 시간은 지금처럼 끝난 지 얼마나 됐는지(`ago`)다. 하루가 넘으면 날짜로 보인다.
- "모두 보기" 링크가 Runs의 기간 필터를 오늘로 걸고 있다면 최근 7일로 맞춘다. 맞출 수 없으면 PR 본문에 적는다.
- 코드의 이름(`doneToday`, `endedToday`, `DONE_TODAY_LIMIT`)도 뜻에 맞게 바꾼다(`done`, `endedRecently` 등). 다른 화면이 "오늘 끝난 런"을 따로 쓰고 있으면(머리 요약 문장 등) 그 뜻은 바꾸지 않는다.

## 할 일

- [ ] `packages/app/src/home/` 의 Done 칸 데이터를 최근 7일로 넓힌다.
- [ ] 칸 이름·문구를 `apps/web/messages/ko/home.json`에서 바꾼다.
- [ ] ADR 0010(2·4·10번과 0100 갱신의 "Done today")에 갱신을 적고, ADR 0007·`packages/ui/DESIGN.md`·GLOSSARY의 "Done today"를 맞춘다.

## 완료 조건

- 시험: 오늘, 6일 전, 7일 전(넣지 않음) 끝난 런, 시간대 경계(운영자 시간대 자정 앞뒤), 7일보다 오래된 To do 꼬리표 런(남음), 칸 머리 개수.
- 스크린숏: Dashboard Done 칸(오늘·어제·며칠 전 런이 섞인 상태). 가상 데이터.
- DB 변경 없음. two-way.
