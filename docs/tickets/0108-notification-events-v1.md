---
status: done
blocked_by: [0104]
---

# 0108 모바일 5: 알림 사건을 v1로 옮기고 데스크톱 인증

## 목표

티켓 0103의 알림 사건 목록과 SSE를 `/api/v1` 아래에 두고 데스크톱과 모바일이 함께 쓴다(스펙 [0002](../spec/0002-mobile.md) M6). 데스크톱 앱도 v1 인증을 거친다. 앱은 사건 번호 하나로 그 사건의 제목과 대상을 읽을 수 있다(푸시의 NSE가 쓴다).

## 범위

- 알림 사건 목록, SSE를 v1 계약(`packages/api`)으로 둔다. 사건 하나 읽기는 지금 없어 새로 만든다. 종류는 지금 8종 그대로다(M29). v1 경로는 `/api/v1/notification-events`다. 옛 `/api/notification-events`와 `/api/attention`은 v0.6.0까지 두고 지운다(M42). 지우는 일은 v0.6.0 출시 때 잊지 않게 이 티켓 PR에 적는다.
- 데스크톱 앱(같은 기계 모드, 원격 모드)의 v1 인증. 데스크톱도 기기 토큰을 쓰고 첫 연결 때 자동 등록한다(M39).
- 알림 사건 동기화를 클라이언트 요청과 상관없이 worker가 주기적으로 돌린다(M43). 지금은 `/api/notification-events`, 그 SSE, `/api/attention`에 요청이 올 때만 돌아(`apps/web/src/notifications/server.ts`), 요청이 없으면 사건이 생기지 않는다. `syncNotifications`는 지금 `apps/web`에 있고 `apps/worker`는 `@ganger/app`에 기대지 않아, 동기화 코드를 둘 자리와 의존성도 이 티켓에서 고친다.

## 운영자 결정

- 데스크톱 자동 등록(M39)은 저장한 기기 토큰이 없을 때(처음)만 한다. 토큰이 있는데 거절되면(지운 뒤) 조용히 다시 등록하지 않고 "다시 연결" 안내를 띄워, 사용자가 눌러야 다시 등록한다(스펙 0002 M48).

## 범위 밖

- 푸시 보내기(0109).

## 결정과 구현

- **공용 스트림 닫기.** `packages/app/src/devices/streams.ts`의 `DeviceStreams`가 기기별 열린 스트림을 들고 있다. v1 SSE는 `getDeviceStreams().track(deviceId, stream)`으로 감싸 응답한다. 기기를 지우는 두 길(웹 Settings, `DELETE /api/v1/devices/me`)은 모두 `removeDeviceAndCloseStreams`를 지난다.
- **데스크톱 토큰 저장.** 앱 설정 파일에 Electron `safeStorage`(macOS 키체인)로 암호화한 값만 서버 `instanceId`별로 둔다. 암호화를 쓸 수 없으면 파일에 쓰지 않고 메모리에만 둔다. 이때는 앱을 다시 켤 때 새 기기로 등록된다. 저장한 값을 풀 수 없으면 토큰 거절과 같게 "다시 연결" 안내를 띄운다.
- **안내 위치.** 웹 화면은 토큰 없이 계속 쓸 수 있어 창을 가리지 않는다. 시스템 알림 한 번, 알림 설정 창의 안내, 메뉴의 "다시 연결"로 알린다.
- **옛 서버.** 등록 경로가 없는 서버(0108 이전)에는 옛 알림 경로로 붙는다. 이 대체 경로도 v0.6.0에 지운다(`docs/releasing.md`).
- **동기화.** worker가 틱마다 동기화한다(`packages/app/src/notifications/sync.ts`). SSE가 붙어 있으면 web도 지금처럼 2초마다 동기화해 알림이 늦지 않는다. 두 프로세스의 쓰기는 `BEGIN IMMEDIATE` 트랜잭션으로 나뉜다.

## 완료 조건

- 데스크톱 알림이 v1 SSE로 그대로 동작하는 시험이 있다(0103의 시험을 옮긴다).
- 토큰 없는 v1 사건 요청이 거절되고, 사건 하나 읽기가 기기 토큰으로 되는 시험이 있다.
- 기기를 지우면 그 토큰으로 열린 v1 SSE 연결이 닫히는 시험이 있다(ADR 0015).
- 데스크톱 클라이언트가 하나도 붙어 있지 않아도 사건이 생기고 해결되는 시험이 있다.
