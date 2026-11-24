---
status: done
blocked_by: []
---

# 0211 데스크톱 알림 설정: 권한 상태·시험 알림·웹 Settings 입구

## 목표

운영자 보고(2026-11-24): 알림이 딱히 울리지 않는데 어떻게 설정해야 할지 모르겠다. 지금 데스크톱 앱의 알림 창은 트레이 메뉴 "알림 설정…"으로만 열리고, macOS 권한은 실제 알림의 show/failed 결과로만 짐작해 "unknown"에 머물기 쉽다. 시험 알림이 없다. Electron 42+ 에서 서명하지 않은 빌드는 알림이 failed 로 끝난다.

알림 창 맨 위에서 macOS 알림 권한을 직접 읽어 보이고, 그 자리에서 허용을 요청하거나 시험 알림을 보내 확인할 수 있게 한다. 웹 Settings 에도 알림 입구를 둔다.

## 운영자 결정(2026-11-24, 시안 그대로)

1. 알림 창 맨 위 권한 상태 카드. 창을 열 때와 다시 보일 때 macOS 알림 권한을 직접 읽는다.
   - 허용(A): "macOS에서 알림을 허용했어요" + ⓘ 툴팁(배너가 안 보이면 알림 스타일과 집중 모드 확인) + "시험 알림 보내기" + "시스템 설정 열기".
   - 아직 안 물음(B): "아직 알림을 허용하지 않았어요 · 허용하기 전에는 이 Mac에 알림이 오지 않아요" + 노란 "알림 허용하기"(누를 때 macOS 권한 요청).
   - 꺼짐(C): 지금의 문제 안내 + "시스템 설정 › 알림 › Ganger에서 '알림 허용'을 켜요" + "시스템 설정 열기". 돌아오면 다시 읽어 상태를 바꾼다.
2. 시험 알림(D): 실제 알림과 같은 경로로 하나 보낸다. 보냈으면 "시험 알림을 보냈어요"와 안 보였을 때 확인 순서 셋(스타일, 집중 모드·방해 금지 + 집중 모드 설정 링크, 소리). 실패면 서명 문제인지 권한 문제인지 갈라 알린다.
3. 앱을 켤 때 묻지 않는다. "알림 허용하기"를 누를 때와 사용자가 알림 받기를 처음 켤 때만 요청한다.
4. 시스템 설정 열기는 `?id=<번들 ID>`를 먼저 시도하고, 동작을 직접 확인할 수 없으면 지금 링크(앱 미선택)를 쓴다.
5. 웹 Settings 입구: 데스크톱 앱 안에서 연 Settings 에 "알림" 줄(지금 상태 한 줄 + "알림 설정 열기"), 브라우저에서 연 Settings 에는 데스크톱 앱에서 받는다는 한 줄. 트레이 메뉴는 그대로.

## 찾은 것

- Electron 45 의 `NotificationPresenterMac` 생성자가 `requestAuthorizationWithOptions`를 부른다(electron/electron `shell/browser/notifications/mac/notification_presenter_mac.mm`, v45.2.3). 이 생성자는 `Notification.isSupported()`, `new Notification()`, `Notification.getHistory()`, `Notification.remove()`가 처음 불릴 때 돈다. 그래서 지금 시작 경로(첫 알림 묶음의 `getHistory`, 버전 알림의 `isSupported`)가 macOS 권한 창을 띄운다.
- 서명하지 않은 Electron(개발 실행)에서 알림을 보내면 `failed`가 `UNErrorDomain 오류 1`로 온다. 같은 빌드에서 권한 상태는 `not-determined`로 읽힌다.
- Electron 에는 권한 상태를 읽는 API 가 없다. `node-mac-permissions`는 알림 권한을 지원하지 않고, GitHub `desktop-notifications`는 초기화하면 `UNUserNotificationCenter`의 delegate 를 가져가 Electron 의 알림 클릭 처리를 깬다.

## 고친 방법

- 자체 N-API 애드온(`apps/desktop/native/notification-permission.mm`)으로 권한 상태 읽기, 권한 요청, 팀 서명 여부, 번들 ID 를 얻는다. npm 의존성을 더하지 않는다. `scripts/package.ts`가 `xcrun clang++`로 빌드해 `Resources/notification-permission.node`에 넣고, 개발 실행은 `pnpm --filter @ganger/desktop build:native`로 `dist/native`에 만든다. 애드온이 없으면 지금처럼 동작한다(권한 unknown, 알림 센터를 바로 쓴다).
- `NotificationAccess`(core)가 애드온 포트를 감싸 권한을 읽기 전과 아직 묻지 않았을 때 알림 센터(`Notification.*`)를 건드리지 않게 막는다. 시험 알림 결과도 여기서 가른다.
- 시스템 설정 링크는 `?id=`를 직접 확인하지 못해 지금 링크를 그대로 쓴다.

## 할 일

- [x] 권한 상태 카드 A·B·C 와 읽지 못함 상태
- [x] 알림 허용하기 → macOS 권한 요청, 알림 받기를 처음 켤 때 요청
- [x] 시험 알림과 성공·서명·권한·그 밖의 실패 갈래
- [x] 시작 경로에서 권한 요청 없애기
- [x] 웹 Settings "기기 연결" 구역의 알림 줄(데스크톱 안/브라우저)
- [x] 시험: 권한 세 상태 화면, 허용하기 → 요청, 시스템 설정 링크, 시험 알림 갈래, 시작 경로 무요청, 웹 입구
- [x] 스크린숏 A·B·C·D 와 웹 Settings 입구

## 결정에 없던 경계 사례

- 권한을 읽지 못한 상태(애드온이 없거나 macOS 가 unknown 을 줌)는 "macOS 알림 권한을 읽지 못했어요"와 시험 알림·시스템 설정 버튼을 보인다.
- 시험 알림이 5초 안에 show 도 failed 도 내지 않으면 보낸 것으로 보고 확인 순서를 보인다.
- 아직 묻지 않았을 때 서버에서 온 알림은 보이지 않는다(허용 전에는 macOS 가 보여 주지 않으므로). Dock 배지는 그대로 바뀐다.
- 웹 Settings 에는 "이 Mac" 구역이 없어 데스크톱 기기와 가장 가까운 "기기 연결" 구역 맨 위에 둔다. 상태 점(●)은 DESIGN.md 가 화면이 색을 고르지 못하게 해 쓰지 않고, 꺼짐만 `detailTone="problem"`으로 빨갛게 보인다.

## 확인하지 못한 것

- `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=<번들 ID>`가 실제로 앱을 미리 고르는지(화면 기록 권한이 없어 시스템 설정 화면을 볼 수 없었다).
- 서명한 출시 앱에서 권한 요청 창, 허용·거절 뒤 상태 읽기, 집중 모드 중 시험 알림 동작. 이 Mac 에서는 서명하지 않은 빌드만 돌릴 수 있었다.
