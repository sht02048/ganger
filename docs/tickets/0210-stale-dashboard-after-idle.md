---
status: done
blocked_by: []
---

# 0210 오래 둔 Dashboard 가 낡은 채 남는 문제

## 목표

한동안 들어가지 않다가 Dashboard 를 다시 보니 Queued·Running 에 아무것도 없었고, 새로고침(⌘R)하자 Queued 2개, Running 1개가 바로 보였다는 운영자 보고(2026-11-24)의 후속이다. 데스크톱 앱이었을 가능성이 높고, 맥이 잠들었는지는 확실하지 않다. 트래커가 아니라 Ganger DB(런) 데이터다.

## 운영자 결정(2026-11-24)

- 후보 상황을 하나씩 재현한다. 재현되면 원인을 고친다.
- 원인과 별개로 안전장치를 둔다: 창이 다시 보이거나 포커스를 얻을 때 마지막으로 서버에서 받은 지 60초가 넘었으면 보이는 화면 query 를 다시 읽는다.
- 재현하지 못해 코디네이터에게 알렸고, 찾은 틈(아래 D)을 막는 안전장치만 넣기로 했다. focus 는 visibilityState 와 관계없이 "보임"으로 다루고, 계기가 겹쳐도 한 번만 다시 읽고, 숨은 탭에서 focus 없이 연결을 새로 열지 않는다.

## 재현 절차와 결과

실제 Chrome, vite dev 서버, 실제 DB 로 브라우저 시험(`e2e/src/stale-after-idle.test.ts`)을 만들어 확인했다.

- A1 숨김(visibilitychange) → 그사이 런 추가 → 다시 보임: Last-Event-ID 로 이어 받아 1초 안에 그린다.
- A2 숨김 → 런 추가 → 변경 줄을 하루 넘겨 지움 → 다시 보임: reset 으로 모든 query 를 무효화해 그린다.
- B 잠듦 흉내(CDP 로 페이지를 얼렸다 풂): 그린다.
- C 서버 재시작(같은 포트, 같은 DB): EventSource 가 3초 retry 로 Last-Event-ID 를 붙여 다시 붙고 약 5초 안에 그린다.
- E 시간대 쿠키가 브라우저와 달라 query key 가 갈리는 0208 이전 코드: 열린 화면 변경과 숨김 → 보임 모두 그린다. 무효화가 `["dashboard"]` 접두어라 key 가 갈려도 놓치지 않는다.
- 코드: 런을 바꾸는 쓰기 경로는 모두 change_events 를 남기고, 침묵 판정·폴링·다시 연결 루프도 끊기지 않는다.
- D(틈): 새로 읽는 계기가 visibilitychange 뿐이었다. TanStack Query v5 의 refetchOnWindowFocus 는 window focus 를 듣지 않고, 변경 기록 통로도 visibilityState 만 따른다. visibilityState 가 hidden 으로 남은 채 창에 포커스만 오면 SSE 는 닫힌 채 폴링도 없어, 2분이 지나도 새 런을 그리지 않았다. macOS Electron 의 가림 판정이 실제로 이렇게 남는지는 직접 확인하지 못했다.

## 고친 것

- `ChangeChannel.show()` 는 마지막으로 서버에서 받은 때(연결 열림, ready, change, reset, heartbeat)가 60초(`SHOWN_REFRESH_AFTER_MS`)를 넘었으면 연결을 다시 붙이고 보이는 query 를 한 번 다시 읽는다. 숨어 있었으면 이어 받기로 다시 붙는다. heartbeat 가 15초마다 오므로 살아 있는 연결은 건드리지 않는다.
- `show()` 계기에 window focus 와 pageshow 를 더한다. focus 는 visibilityState 와 관계없이 보임으로 다루고, pageshow 는 visibilityState 를 따른다.
- 보이는 연결을 다시 붙일 때는 모아 둔 변경 줄을 먼저 무효화한다. 보이는 query 다시 읽기는 진행 중인 읽기를 취소하고 새로 읽는다. 잠듦 전에 시작돼 멈춘 요청에 합류하지 않기 위해서다. 그래서 TanStack 의 포커스 다시 읽기와 겹치면 요청이 하나 취소될 수 있다.

## 완료 조건

- 단위 시험: 1분 넘게 숨었다 보이면 한 번 다시 읽음, 1분 안이면 이어 받기만 함, heartbeat 를 받는 연결은 포커스에도 그대로, 타이머가 멈춘 채 시계만 흐른 뒤(잠듦) 포커스를 얻으면 다시 붙고 다시 읽음.
- 브라우저 시험: A1·A2·B·C 재현과 D 안전장치. 새 브라우저 시험은 부하 5회 규칙을 지킨다.
