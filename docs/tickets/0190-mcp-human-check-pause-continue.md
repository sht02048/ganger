---
status: done
blocked_by: []
---

# 0190 MCP 쓰기에 Human Check 답하기·멈추기·재개·이어서 맡기기 더하기

## 목표

MCP 클라이언트가 머지 확인(Human Check)에 답하지 못하고, 화면에 있는 멈추기·재개·이어서 맡기기도 MCP에 없다. ADR 0013 결정 3("쓰기 도구는 화면의 쓰기 기능과 1:1")에 어긋난 빈틈이라 쓰기 도구를 더한다.

## 운영자 결정 (2026-11-23)

1. Human Check 답하기: 화면의 "확인했어요"·"고쳐 주세요"와 덧붙일 말(선택, 화면의 길이 규칙). 답할 Human Check가 없으면 이유와 함께 거절한다.
2. 멈추기·재개: 화면의 controlRun과 같은 규칙이다. 러너에서 실패한 재개는 같은 `requestId`로 다시 처리한다.
3. 이어서 맡기기: 워크트리가 남은 Failed 런에서만 한다(티켓 0111의 v1 규칙과 같다). 운영자의 말이 필수다. 서버가 막으면(`continueRunBlock`) 이유와 함께 거절한다.
4. 같은 맥의 stdio MCP만 다룬다. 원격(HTTP) MCP는 범위 밖이다.
5. 쓰기 허용 스위치는 지금 하나 그대로다. Human Check 승인용 스위치를 따로 만들지 않는다.
6. Human Check도 다른 쓰기와 같은 규칙이다. 도구 설명에 머지 승인 같은 확인이라 운영자에게 먼저 확인받는다고 적고, 작업 기록은 "MCP · 클라이언트 이름"이다. Ganger 화면 쪽 추가 승인은 없다.
7. 이번에는 이 셋만 더한다. 화면 쓰기 기능과 MCP 도구를 맞대 본 빈틈은 PR 본문에 후속 후보로 남긴다.

## 범위

- 쓰기 도구 `answer_human_check`, `pause_run`, `resume_run`, `continue_run`을 더한다.
- Human Check는 `onceForRun`과 화면의 핵심 함수 `submitHumanCheckAnswer`를 MCP 전용 action 이름으로 부른다. `questionId`를 생략할 수 있어 `answer_question`과 같은 방식이고, 다른 내용의 `requestId`를 `request-reused`로 거절한다.
- `controlRunOnce`·`continueRunOnce`에 선택 인자 `onReplay`만 더해 재처리를 작업 기록에 다시 남기지 않는다.
- 작업 기록의 도구 이름과 거절 이유 문구를 Run 상세와 Settings 메시지에 더한다.
- ADR 0013 결과 절과 `docs/guide/mcp.md`를 맞춘다. ADR 0013의 결정은 바꾸지 않는다.

## 완료 조건

- [x] 도구별로 허용 꺼짐이면 보이지 않고, 정상 처리하고, 상태가 맞지 않으면 이유와 함께 거절한다.
- [x] 같은 `requestId`는 한 번만 처리하고 다른 내용은 거절하며, MCP 작업 기록이 남는다.
- [x] 러너에서 실패한 재개를 같은 `requestId`로 다시 처리한다.
- [x] 읽기 도구가 Human Check 본문을 `external` 칸에 준다(기존 시험으로 확인).
- [x] 스크린숏: Run 상세에 MCP Human Check 답하기 기록이 보인다(PR 본문).
