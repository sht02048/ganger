---
status: done
blocked_by: []
---

# 0233 모바일 내부 배포 빌드(preview): 맥북 없이 받아서 연결하면 끝

## 배경

- [0227](0227-mobile-eas-dev-build.md)로 `apps/mobile/eas.json`에 development 프로필이 있다. 개발 빌드는 화면 코드를 맥북의 Metro에서 받아 와 맥북이 켜져 있고 폰이 닿아야 한다.
- 운영자는 받아서 연결하면 끝인 앱을 원한다(2026-11-25). TestFlight([0112](0112-mobile-testflight.md))는 아직 하지 않는다.

## 운영자 결정(2026-11-25)

EAS 내부 배포(ad hoc, 등록한 기기) preview 빌드를 더한다. JS 번들이 앱 안에 들어가 개발 서버가 필요 없다.

## 할 일

1. `eas.json`에 preview 프로필을 둔다: 내부 배포, 개발 클라이언트 없음, 출시 설정과 같은 앱 설정.
2. 같은 번들 ID라 개발 빌드와 preview 빌드가 한 기기에서 서로 덮어쓰는 점을 문서에 적는다.
3. preview 빌드의 푸시(APNs production)에 EAS 푸시 키를 그대로 쓰는지, 서버(worker)의 Expo Push 쪽에 바꿀 것이 있는지 확인한다.
4. 시험을 더한다.
5. [`docs/guide/mobile.md`](../guide/mobile.md)에 preview 빌드 절을 둔다.

## 결정

### `eas.json` preview 프로필

- `distribution: "internal"`, `environment: "preview"`, `node`·`pnpm`은 development와 같다, `env.GANGER_MOBILE_BUILD: "release"`.
- `developmentClient`가 없으면 EAS는 iOS Release 설정으로 빌드한다(Expo 문서 `build/eas-json`의 `buildConfiguration`). JS 번들이 앱에 들어가 개발 서버 없이 돈다(`tutorial/eas/internal-distribution-builds`). Release 번들은 `__DEV__`가 거짓이라 `bundledDevConnection`이 개발 자동 연결을 끈다(`dev-connection.ts`).
- `GANGER_MOBILE_BUILD`는 `buildVariantOf`가 `development`가 아닌 값을 모두 출시로 보므로 빼도 같지만, 프로필이 무엇을 내는지 파일에서 바로 보이게 `release`로 적었다. 이 값으로 expo-notifications `mode: "production"`(`aps-environment` production), ATS `NSAllowsArbitraryLoads: false`(로컬 네트워크 예외 없음), NSE `allowLocalNetworking: false`가 들어간다.
- `extends: "development"`는 쓰지 않는다. `developmentClient`를 물려받지 않게 하려면 거꾸로 꺼야 해 읽기 어렵다.
- 0227이 preview 프로필을 두지 않은 이유(잘못 고른 프로필로 출시 설정 빌드가 나감)는 내부 배포라 스토어로 가지 않아 해당하지 않는다. production 프로필·`submit`·`autoIncrement`는 여전히 0112 몫이다.

### EAS 환경: preview 환경을 쓴다

- 고른 것: Expo 문서(`eas/environment-variables/usage`)의 관례대로 preview 프로필은 `environment: "preview"`. 운영자는 세 값(`GANGER_EXPO_PROJECT_ID`·`GANGER_IOS_BUNDLE_ID`·`GANGER_APPLE_TEAM_ID`)을 `preview` 환경에도 한 번 더 둔다. 0227의 `.env` → 셸 → `eas env:set` 순서를 `for environment in development preview` 반복으로 바꿔 두 환경이 늘 같은 값을 받게 했다. 확인은 `eas env:list --environment preview`.
- 버린 것: preview 프로필이 `environment: "development"`를 다시 쓰는 방법. 운영자 등록은 한 번 줄지만, 개발 빌드 번들 ID에 접미사를 두는 날(아래) 두 빌드가 다른 값을 가져야 해 그때 환경을 다시 나눠야 한다. 이름과 쓰임이 어긋나 `eas env:list`로 무엇이 preview에 들어가는지 읽기도 어렵다.
- 세 값이 클라우드 빌드에 없으면 NSE와 공유 키체인이 빠진다. 그래서 문서에서 preview 빌드 전에 `eas env:list --environment preview`로 세 값을 확인하게 했다.

### 같은 번들 ID: 한 기기에 하나만

- 두 프로필 모두 `GANGER_IOS_BUNDLE_ID` 하나를 쓰니 한 iPhone에는 둘 중 하나만 있다. 설치하면 다른 쪽을 덮어쓴다. 시험이 두 설정의 번들 ID·키체인 그룹이 같음을 확인한다.
- 덮어써도 같은 팀·번들 ID라 키체인과 앱 파일이 남아 서버 연결이 이어진다. 푸시 주소가 바뀌면 알림이 켜져 있을 때 앱이 포그라운드로 올 때 서버에 다시 보낸다(`use-device-notifications.ts`의 `refresh`).
- 개발 빌드 번들 ID에 접미사(예: `.dev`)를 두는 방안은 바꾸지 않았다. NSE 번들 ID, 키체인 그룹 `<team>.<bundle>.shared`, EAS 자격 증명(번들 ID 단위), 기기마다 다른 푸시 주소가 함께 갈라져야 해 범위가 크다. 두 빌드를 함께 두고 싶다는 요구가 생기면 따로 티켓으로 한다.

### 푸시

- EAS는 iOS 자격 증명을 번들 ID 단위로 둔다(Expo 문서 `app-signing/app-credentials`). preview 빌드도 0227 4단계에서 만든 푸시 키를 쓴다. 처음 preview 빌드에서 EAS가 ad hoc 프로비저닝 프로필(앱·NSE)을 새로 만든다.
- APNs 키는 한 환경 전용으로 만들지 않았으면 개발·운영 두 환경에 보낸다. EAS가 만든 키는 그대로 된다. 운영자가 직접 올린 `.p8` 키라면 Apple Developer의 Keys에서 production을 허용하는지 보라고 문서에 적었다.
- 서버는 바꿀 것이 없다. worker(`apps/worker/src/push.ts`)는 모든 알림을 Expo Push(`https://exp.host/--/api/v2/push`)에 Expo 푸시 주소로 보낸다. 어느 APNs 환경으로 보낼지는 앱이 `getExpoPushTokenAsync`로 주소를 받을 때 Expo에 알린다(`ExpoPushTokenOptions.development`, 기본값은 `expo-application`의 `getIosPushNotificationServiceEnvironmentAsync`, 즉 서명된 `aps-environment`).

### 문서

- [`docs/guide/mobile.md`](../guide/mobile.md) 제목을 「iPhone builds」로 바꾸고 두 빌드를 처음에 나눴다. 1~5단계는 공통, 「Preview build (no Mac needed)」 절에 빌드(`eas build --profile preview --platform ios`), 설치(링크·QR, Developer Mode), 연결(QR), 개발 빌드와의 차이 표, 덮어쓰기를 적었다. README 문서 표와 CONTRIBUTING 링크 문구도 맞췄다.

## 범위 밖

- 실제 EAS preview 빌드와 실기기 설치·푸시 확인: 계정이 필요해 운영자가 머지 뒤 한다.
- 개발 빌드 번들 ID 접미사, TestFlight·production 프로필(0112).

## 완료 조건

- `apps/mobile/app.config.test.ts`: `eas.json` preview 프로필의 값(내부 배포, 개발 클라이언트 없음, preview 환경, `GANGER_MOBILE_BUILD=release`), 프로필마다 Node·pnpm이 저장소와 같음, preview 프로필 env로 만든 설정이 expo-notifications `mode: "production"`·ATS 예외 없음·NSE 로컬 네트워크 꺼짐·NSE 타깃을 내는 것, 두 프로필의 번들 ID·키체인 그룹이 같은 것을 시험한다.
- eas-cli 27.11.0의 `@expo/eas-json` `EasJsonUtils.getBuildProfileAsync`로 development·preview 프로필을 읽어 스키마 검사를 통과한다(로컬 확인).

## 로컬 확인(2026-11-25)

- `@expo/eas-json` 27.11.0: `preview` → `{"credentialsSource":"remote","distribution":"internal","environment":"preview","node":"24.22.3","pnpm":"12.21.0","env":{"GANGER_MOBILE_BUILD":"release"}}`, `development`도 통과.
- `apps/mobile`에서 가짜 세 값과 `GANGER_MOBILE_BUILD=release`로 `expo config --type public --json`: `ios.bundleIdentifier` `com.example.ganger`, ATS `{"NSAllowsArbitraryLoads":false}`, expo-notifications `production`, NSE 플러그인 `allowLocalNetworking: false`, `appExtensions`의 `GangerNotificationService`.

## 남은 일

- 운영자가 `eas env:set --environment preview`로 세 값을 두고 `eas build --profile preview --platform ios`로 첫 preview 빌드를 만들어 설치·연결·푸시를 확인한다.
