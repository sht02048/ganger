---
status: doing
blocked_by: []
---

# 0235 Failed 런을 To do 에서 치우기: PR 이 머지되면 자동, 그 밖에는 "확인했어요"

## 배경

- 운영자 보고(2026-11-25): 한 런이 시간 제한(timed-out)으로 Failed 가 됐고, 뒤에 그 런의 PR 이 머지됐다. Ganger 도 PR 이 Merged 인 걸 안다.
- [ADR 0022](../adr/0022-run-outcome-from-agent-report.md)대로 결과는 에이전트 보고로만 정해져 Failed 그대로이고, To do 의 "멈춘 런"(Failed 꼬리표)에 계속 남았다. 운영자가 할 일이 없는데 Dashboard 배지·레일 배지·모바일 배지·알림 수에 1 이 남았다.
- Failed 카드에는 "런 상세"와 "다시 맡기기"뿐이고 치우는 길이 없었다. MCP 에도 없었다.

## 운영자 결정(2026-11-25)

둘 다 한다.

1. 자동: Failed 런의 PR 이 Merged 가 되면 그 런은 To do 에서 빠진다. 결과(Failed)는 바꾸지 않는다. Done 칸에서는 결과와 함께 PR 병합됨이 보인다.
2. 수동: Failed 카드에 "확인했어요"(To do 에서 치우기)를 더한다. 누르면 To do 에서 빠지고, 다시 맡기기는 그대로 할 수 있다. MCP 에도 같은 쓰기 도구를 [ADR 0013](../adr/0013-mcp-write-tools.md) 규칙대로 더한다. 모바일 v1 쓰기도 같은 핵심 함수로 한다(0194 호환 규칙, 계약 N 올림).
3. 저장: `runs.todo_settled_at`(nullable 시각) 열 하나를 더하는 마이그레이션을 승인했다. 자동 규칙의 범위(끝난 Failed 만)도 승인했다.

## 결정

### 범위: 끝난 Failed 만

To do 종류 중 끝난 런은 Failed 뿐이다. Disconnected 와 Waiting for Input 은 런이 아직 러너 자리(capacity)를 잡고 있고 에이전트 세션도 살아 있을 수 있어, PR 이 머지됐다고 To do 에서 빼면 자리를 잡은 런이 화면에서 사라진다. 그래서 빼지 않는다.

### 계산은 한 곳

- `packages/app/src/todo-cleared.ts` 의 `todoClearedOf(run, records)` 가 끝난 Failed 런의 치운 까닭을 낸다: PR 이 병합됐으면 `pr-merged`, 운영자가 치웠으면 `operator`, 아니면 null. PR 병합은 Dashboard 「PR」 탭과 같은 `latestPrStateOf`(끝난 뒤 본 병합·닫힘 → 끝날 때 PR 상태 → PR 신호의 settled 순)로 읽는다. Succeeded·Canceled 런은 늘 null 이다.
- `packages/app/src/home/model.ts` 의 `isOpenFailed` 가 "Failed 이고 치우지 않음"을 정하고, `needsAttention`·`todoGroupOf`·`todoTagOf`·Tickets `isTodo`·런 단위 처리할 일(`runNextStep`)이 모두 이 함수를 쓴다.
- 레일 배지(`loadShell`)는 `listRunsWithRecords` 로 같은 치운 까닭을 읽는다. 그래서 Dashboard 머리, 레일 배지, 모바일·데스크톱 배지, 알림 사건, v1 Dashboard, MCP `get_dashboard` 가 같은 수를 낸다(0208 원칙).

### 수동 치우기

- DB: `runs.todo_settled_at` 열(시각, 기본 null). `settleRunTodo` 는 끝난 Failed 런에만 쓰고 이미 치웠으면 처음 시각을 둔다. 다른 상태는 `not-failed` 로 거절한다.
- 기존 칸으로 풀 수 있는지 먼저 봤다. `run_action_requests` 는 `requestId` 중복 막기 기록이라 action 이름이 해시 안에만 있고 행이 지워지기도 한다. `mcp_actions` 는 MCP 기록뿐이고, `notification_events.resolved_at` 은 원인에서 다시 계산해 다음 바퀴에 다시 열린다. 그래서 열을 더했다.
- 핵심 함수 `clearTodoOnce`(`packages/app/src/run-detail/actions.ts`)를 웹 서버 함수 `clearRunTodo`, v1 `POST /api/v1/runs/:id/clear-todo`, MCP `clear_todo` 가 함께 쓴다. 같은 `requestId` 는 한 번만 처리한다(`run_action_requests`, 티켓 0156).
- MCP `clear_todo` 는 쓰기 허용 스위치 뒤에 있고 작업 기록을 남긴다. Settings 「MCP」 최근 작업과 Run 상세 타임라인에 "To do에서 치우기"로 보인다.

### 알림

치운 런은 Dashboard To do 에서 빠지므로 알림 원인(`notificationCauses`)에서도 빠지고, 다음 동기화에서 열린 Failed 알림 사건이 해결된다. 해결된 사건은 기존 규칙대로 데스크톱 알림을 지우고 모바일에 조용한 지우기 푸시를 보낸다(M33). 따로 고친 것은 없다.

### 화면

- 웹: Dashboard 런 패널의 Failed 버튼 줄에 "Tickets에서 다시 맡기기" 옆 "확인했어요"(보조 버튼)를 둔다. 웹 Dashboard 의 Failed 카드에는 지금도 버튼이 없고 패널에서 행동하므로 카드에 버튼을 더하지 않았다(0198 의 카드 한 행동 규칙). 누르면 답하기와 같이 패널을 닫고 토스트("{key} 런을 To do에서 뺐어요")를 띄우고 Done 칸으로 옮긴 카드로 포커스를 돌린다. 실패하면 패널에 남아 `role="status"` 문장으로 알리고 그 문장으로 포커스를 옮긴다. 패널 "지금" 문장에 「확인했어요」로 뺄 수 있다는 안내를 더했다.
- 웹 Done 칸: PR 병합으로 치운 Failed 카드는 "Failed · PR #n 병합됨"으로 보인다. 다른 끝난 카드의 PR 줄은 그대로다.
- 모바일: To do 의 Failed 카드 "…" 팝오버에 "확인했어요"(체크 아이콘)를 둔다. 끝난 런이라 "런 취소" 자리에 온다(M58). 카드 버튼 줄은 "런 상세"·"다시 맡기기" 두 칸이 이미 차 있어(0221) 팝오버를 골랐다. 보내면 화면 읽기에 "To do에서 뺐어요"를 알리고, 거절·연결 실패는 알림 시트로 말한다.
- 모바일 Done 줄: PR 병합으로 치운 Failed 런은 끝날 때 PR 이 열려 있었어도 "PR #n 병합됨"을 보인다.

### v1 계약

- `CONTRACT_VERSION` 3 → 4. 경로 `clear-todo` 와 Dashboard 끝난 런의 `todoCleared` 를 더했다. 빼거나 뜻을 바꾼 것은 없어 M·S 는 그대로다(0194).
- 앱은 `todoCleared` 칸을 선택으로 읽는다. 칸이 없으면(계약 3 이하 서버) 치우기를 받지 않는 서버로 보고 "확인했어요"를 두지 않는다.

## 머지 위험

- one-way: 마이그레이션(`ALTER TABLE runs ADD todo_settled_at`)이 들어간 DB 는 `migrate.ts` 가 모르는 마이그레이션이 있다며 옛 버전이 열지 않는다. 되돌리려면 새 버전을 다시 설치한다.
- blast radius: 작음. 열 하나를 비워 더하는 변경이라 기존 행을 바꾸지 않고, 표를 다시 만들지 않는다. To do 계산은 끝난 Failed 런에만 영향이 있다.

## 완료 조건

- [x] To do 계산 시험: Failed + PR Merged 빠짐, Failed + PR Open·닫힘 남음, 치운 Failed 빠짐, 치운 뒤 다시 맡긴 새 런은 다시 To do, Succeeded 는 치운 까닭 없음.
- [x] 모든 수가 같음: 레일 배지, Dashboard, v1 Dashboard 요약.
- [x] Runs 목록 처리할 일 표시와 Run 상세 런 단위 처리할 일에서 빠짐.
- [x] 알림 사건 해결(치움·PR 병합).
- [x] MCP `clear_todo`: requestId 재전송, 작업 기록, 거절, `get_dashboard` 에서 빠짐.
- [x] v1 `clear-todo`: requestId 재전송, 400·409 거절, Dashboard `todoCleared`.
- [x] 마이그레이션: 기존 DB 에 적용, 빈 DB.
- [x] 웹 화면: 패널 버튼 줄, 누른 뒤 패널 닫기·토스트·포커스, 실패 문장, Done 카드 "PR 병합됨".
- [x] 모바일 화면: 팝오버 항목, 옛 서버에는 없음, 쓰기·거절·데모, Done 줄 "PR 병합됨", 앱 스키마 호환.
- [x] 스크린숏: 웹 Failed 패널, 모바일 팝오버, Done 의 머지된 Failed(웹·모바일).
- [x] ADR 0022 한 줄, GLOSSARY "To do에서 치움", 스펙 0002(M60, v1 쓰기), MCP 안내서.
