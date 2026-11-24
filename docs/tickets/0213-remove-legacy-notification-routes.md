---
status: done
blocked_by: []
---

# 0213 v0.6.0 에 지우기로 한 옛 알림 경로 지우기

## 배경

`docs/releasing.md` 「Removals due in a release」에 v0.6.0 에서 옛 `/api/notification-events`, `/api/notification-events/stream`, `/api/attention` 경로와 데스크톱 앱이 그 경로로 되돌아가는 동작(`apps/desktop/src/core/device-link.ts`의 `legacy`)을 지운다고 적혀 있다. 클라이언트는 티켓 0108 부터 기기 토큰으로 `/api/v1/notification-events`를 쓴다(스펙 0002 M42). v1 등록 경로는 v0.5.0 에 처음 들어갔다.

## 운영자 결정 (2026-11-24)

1. v0.6.0 으로 출시하면서 옛 경로 셋과 데스크톱 앱의 대체 동작을 함께 지운다.
2. 공용 로직(알림 사건 읽기, SSE 응답, 동기화)은 v1 경로가 그대로 쓰게 둔다.
3. 데스크톱 앱이 v1 이 없는 옛 서버(v0.5.0 이전)에 붙으면 알림을 받을 수 없다고 안내한다. 화면 문구는 메시지 파일에 해요체로 둔다.
4. 공개 경로를 지우는 변경이라 되돌리기 어렵다(one-way). 사람이 머지한다.

- DB 변경 없음.

## 할 일

- 웹: route 파일 셋(`routes/api/attention.ts`, `routes/api/notification-events/index.ts`·`stream.ts`)과 옛 경로 전용 도우미(`legacyAlerts`), 전용 시험을 지운다. 공용 경로 상수(`NOTIFICATION_FEED_PATH`, `NOTIFICATION_STREAM_PATH`)도 지운다.
- 데스크톱: `FeedConnection`의 `legacy`를 `unsupported`로 바꾸고, 피드는 옛 경로로 돌아가지 않고 멈춰 한 번 알린다. 기기 연결 상태에 `unsupported`를 더해 알림 설정 창의 안내와 시스템 알림, 트레이의 다시 연결 메뉴로 보인다.
- 시험: e2e 알림 사건 시험을 v1 경로와 기기 토큰으로 옮기고, 옛 경로가 404 인지 본다.
- 문서: `docs/releasing.md`의 v0.6.0 항목, `docs/guide/desktop.md`, 스펙 0002·0003 을 맞춘다.

## 완료 조건

- [x] 옛 경로 셋이 404 를 준다(e2e)
- [x] v1 알림 사건 목록·SSE·Host 가드 시험이 기기 토큰으로 통과한다(e2e)
- [x] 데스크톱 피드는 v1 이 없는 서버에서 옛 경로로 요청하지 않고 한 번 알린다(단위)
- [x] 알림 설정 창이 `unsupported`일 때 서버 업데이트 안내와 다시 연결 버튼을 보인다(브라우저)
- [x] 모바일과 MCP 가 옛 경로를 쓰지 않는다(모바일은 v1 만 쓰고, MCP 패키지는 없다)
- [x] 서버 배포물(`bundle`, `smoke:bundle`)과 데스크톱 패키징이 깨지지 않는다
- [x] `docs/releasing.md`, guide, 스펙 0002·0003 을 맞춘다
