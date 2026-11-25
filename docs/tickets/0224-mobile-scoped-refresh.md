---
status: doing
blocked_by: []
---

# 0224 모바일: 변경 기록에 맞춰 필요한 만큼만 새로 읽기

## 배경

모바일 성능 점검(2026-11-25, 읽기만 한 감사) 결과다. 운영자가 성능 티켓 진행을 정했고, 이 티켓은 1순위(배터리·네트워크)다.

코드로 확인한 것:

- `apps/mobile/src/connection/change-stream.ts` 의 `dispatch` 가 `change`·`reset` 줄의 data(종류, workspaceId)를 버리고 `onChange()` 만 불렀다.
- `session.ts` 의 `#readAll` 이 변경 줄마다 dashboard·workspaces·runners·thisDevice 4개를 모두 다시 읽었다(300ms 디바운스).
- 서버 변경 피드는 1초마다 읽는다(`apps/web/src/change-events/feed.ts` `CHANGE_POLL_MS = 1_000`). 런이 활발하면 1~2초마다 4개 요청과 zod 파싱, 디스크 캐시 전체 `JSON.stringify` 쓰기(`live-screens.tsx` 의 읽기 성공마다 `cache.saveDashboard`)가 돌았다.
- 다른 Workspace 의 변경도 전체 새로 읽기를 일으켰다. 서버는 런·배정 변경에 그 런의 `workspaceId` 를 싣는다(`packages/db/src/change-events.ts` `recordRunChange`, `runs.ts` 의 `assignment`).
- 러너 부하 수치 변경: worker 가 60초마다 부하를 읽고(`apps/worker/src/runner-check.ts` `RUNNER_CHECK_INTERVAL_MS`), `recordRunnerLoad`(`packages/db/src/settings.ts`)가 저장한 JSON 이 달라지면 `recordRunnerChange` 로 `runner` 변경(`workspaceId: null`)을 남긴다. 감사의 추정이 맞다. 모바일 계약의 러너(`appRunnerSchema`)에는 부하 값이 없다.
- AppState 가 잠깐 `inactive`(제어 센터, 알림 센터, Face ID, 앱 전환기)만 돼도 스트림·타이머를 정리하고, 돌아오면 `setForeground` 와 `onReady` 의 새로 읽기가 두 번 돌았다. 처음 마운트 기준(`!== "background"`)과 변경 기준(`=== "active"`)이 달랐다.
- 서버에 닿지 않으면 15초마다 4개 요청을 끝없이 보냈다(백오프 없음).
- `use-device-notifications.ts` 가 전면 복귀마다 `deviceNotifications` 와 `getExpoPushTokenAsync` 를 불렀다.

서버가 보내는 변경 종류(`packages/db/src/change-events-model.ts` `CHANGE_KINDS`): `run`, `runner`, `assignment`, `workspace`, `settings`, `tracker`. 부분(`CHANGE_PARTS`)은 `log` 하나다. 웹은 `log` 부분이면 런 상세만, `tracker` 면 트래커만 무효화한다(`apps/web/src/change-events/invalidation.ts`).

## 할 일

1. 변경 기록 줄의 종류·workspaceId·부분을 경계에서 zod 로 파싱하고(`changeNoticeOf`), 다시 읽을 범위를 고른다(`read-scope.ts` `readScopeOf`).
   - `run`·`assignment`: 보는 Workspace(또는 모든 Workspace 보기)의 것만 대시보드. `log` 부분은 읽지 않는다(웹과 같다. 모바일 대시보드에 에이전트 로그가 없고, 런 상세 시트는 세션과 따로 읽는다).
   - `runner`: runners 와 대시보드(요약의 `limitedRunners`·`runnerIssues` 와 대기 사유가 러너 상태를 쓴다).
   - `workspace`: workspaces. 보는 Workspace 거나 모든 Workspace 보기면 대시보드도.
   - `settings`: dashboard·workspaces·runners. `tracker`: 읽지 않는다(모바일에 트래커 화면이 없다).
   - 모르는 종류, 모양이 다른 줄, `reset`: 지금처럼 전체(thisDevice 포함).
   - thisDevice 는 연결(스트림 준비)·전면 복귀·전체 새로 읽기 때만 읽는다. 폴링은 dashboard·workspaces·runners 만 읽는다.
   - 한 번도 읽지 못했으면 전체를, `live` 가 아니면 서버 내용 3개를 더해 읽어 되살린다.
2. 응답이 이전과 같으면 상태를 바꾸지 않는다. 같음은 파싱한 값의 구조 비교(`same-value.ts`)로 가린다. 직렬화 없이 첫 차이에서 멈추고 메모리를 더 쓰지 않아, 다시 `JSON.stringify` 하는 것보다 싸다. 바뀐 부분만 새 값으로 바꾸고 나머지 참조는 그대로 둔다. 같은 내용으로 확인만 한 때는 Workspace 별로 기억해 두었다가 연결이 끊겨 stale 이 되면 띠의 "받은 때"로 쓴다. 사용자가 직접 다시 읽기를 누르거나 쓰기 뒤 다시 읽을 때(`refresh()`)는 내용이 같아도 받은 때를 새로 쓴다(알림을 눌러 연 런을 기다리는 `openRunSettled` 가 받은 때를 본다).
3. 디스크 캐시 쓰기를 묶는다(`offline-cache.ts`).
   - 세션은 대시보드나 Workspace 목록이 바뀐 때만 `saveDashboard` 를 부르고, 같으면 `confirmDashboard` 로 받은 때만 메모리에서 고친다.
   - 바뀐 내용은 마지막 쓰기에서 30초(`CACHE_WRITE_INTERVAL_MS`)가 지났으면 바로, 아니면 30초가 될 때 한 번 쓴다.
   - 백그라운드로 갈 때 `flush()` 로 기다리던 쓰기와 받은 때만 고친 것을 바로 쓴다.
   - 0195 의 원자적 쓰기(`offline-cache-files.ts`)와 상한(Workspace 마다 런 상세 20개, 7일)은 그대로다.
4. AppState: `background` 일 때만 스트림·타이머를 정리하고 `inactive` 에서는 유지한다(`app-state.ts` `followForeground`). 처음 마운트와 변경 모두 `!== "background"` 로 가린다. 전면 복귀 때 스트림을 열고 `ready` 를 받으면 한 번 읽는다.
   - 스트림이 `STREAM_READY_WAIT_MS`(2초) 안에 준비되지 않으면 기다리지 않고 읽는다. 그 뒤 늦게 준비되면 한 번 더 읽는다.
   - "읽고 나서 준비되면 준비 때 읽기를 건너뛰기" 대신 이 방식을 고른 까닭: 모바일은 스트림을 이어 받을 번호 없이 열어 서버는 연결 때의 최신 번호부터 보낸다. 읽기 응답과 준비 사이에 생긴 변경을 놓칠 수 있다. 준비를 먼저 기다리면 놓치는 틈이 없다.
   - 스트림이 바로 끊기면 기다리지 않고 읽는다. 이미 폴링 중이던 스트림 재시도가 끊긴 것은 놓친 변경이 없어 다시 읽지 않는다.
5. 서버에 닿지 않을 때 폴링 간격은 15→30→60초(상한 60초, `RETRY_MAX_MS`)로 늘고, 읽기가 성공하면 15초로 돌아간다. 스트림 다시 붙기도 15→30→60초로 늘고, 스트림이 준비되면 15초로 돌아간다. 전면 복귀 때 둘 다 처음 간격부터 센다. 전에는 스트림 재시도가 늘 60초였다.
6. 알림 설정·푸시 주소 확인은 마운트(앱을 켜거나 연결) 때와, 마지막 확인에서 하루(`PUSH_CHECK_INTERVAL_MS`)가 지난 뒤의 전면 복귀 때만 한다. 읽지 못했으면 다음 전면 복귀 때 다시 읽는다.
   - 근거(Expo 문서 `push-notifications/faq`): `ExpoPushToken` 은 만료되지 않고 앱 업데이트 뒤에도 같다. Android 에서 앱을 다시 설치하거나 applicationId·experienceId 를 바꿀 때 바뀐다. 다시 설치하면 앱을 새로 켜므로 마운트 때 확인으로 잡힌다.
   - 실행 중에 푸시 서비스가 토큰을 바꾸는 드문 경우는 `addPushTokenListener` 로 받을 수 있다. `PushDevicePort` 를 넓히는 일이라 이 티켓에서는 하지 않았다.
7. 러너 부하 수치만 바뀐 경우: 위 1·2로 모바일은 runners 와 대시보드 두 요청만 보내고, 응답이 같아 상태·캐시는 바뀌지 않는다. 요청 자체를 없애려면 서버가 부하 변경을 다른 부분으로 나눠야 한다. 그런데 `change_events.part` 에 `CHECK (part IN ('log'))` 제약이 있어 DB 마이그레이션이 필요하다. 이 PR 에서는 서버를 바꾸지 않았다(아래 남은 일).

## 완료 조건

가짜 시계·가짜 스트림 시험:

- 종류별로 다시 읽는 요청 수(`session.test.ts` "변경 종류에 맞춰 필요한 만큼만 다시 읽기"): 보는/다른 Workspace 의 런·배정, `log` 부분, 러너, Workspace 목록, 설정, 트래커, 모르는 종류, reset, 묶인 변경, stale 뒤 되살리기.
- 같은 응답이면 상태 객체와 구독 알림이 그대로고, 바뀐 부분만 새 참조다. stale 띠가 확인한 때를 쓴다. 직접 다시 읽기는 받은 때를 새로 쓴다.
- 캐시 쓰기 횟수(`offline-cache.test.ts` "쓰기 묶기"): 30초 안의 여러 변경은 한 번, 확인만 한 것은 백그라운드 때 한 번, 백그라운드 때 기다리던 쓰기를 바로.
- `inactive` 에서 스트림 유지(`app-state.test.ts`), 전면 복귀 때 한 번만 읽음, 준비가 늦거나 끊길 때(`session.test.ts` "전면 복귀와 연결").
- 백오프 간격: 폴링 15→30→60→60초와 성공 뒤 15초, 스트림 다시 붙기 15→30→60→60초와 준비 뒤 15초.
- 알림 설정·푸시 주소를 하루 안에는 다시 읽지 않고, 하루 뒤나 읽기 실패 뒤에는 읽는다(`use-device-notifications.test.tsx`).
- `change-stream.test.ts`: 변경 줄의 종류·Workspace·부분 파싱, 모르는 모양은 null.

스크린숏은 필요 없다.

## 남은 일

- 러너 부하 수치만 바뀐 변경을 서버가 따로 보내면(예: `runner` 종류에 부하 부분) 모바일이 요청도 건너뛸 수 있다. `change_events.part` 의 CHECK 제약을 넓히는 DB 마이그레이션이 필요해, 운영자 결정 뒤 따로 한다.
- 다시 그리기 줄이기(`dashboard-screen.tsx`·`run-card.tsx`)는 0225 에서 한다.
