---
status: done
blocked_by: []
---

# 0227 모바일: 서명된 개발 빌드를 EAS로 만들 준비

## 배경

- [0109](0109-mobile-push.md)의 「운영자 확인」(푸시·NSE·알림 버튼), [0222](0222-mobile-ticket-link-and-app-badge.md)의 앱 아이콘 배지, [0226](0226-mobile-first-paint.md)의 빌드에 넣은 폰트는 서명된 개발 빌드가 있어야 확인된다. Expo Go로는 확인할 수 없다.
- 운영자 Mac에는 Xcode가 없어 EAS 클라우드 빌드로 만든다(운영자 결정 2026-11-25).
- 저장소에 `apps/mobile/eas.json`과 `expo-dev-client`가 없었다. `app.config.ts`는 `GANGER_EXPO_PROJECT_ID`·`GANGER_IOS_BUNDLE_ID`·`GANGER_APPLE_TEAM_ID` 셋이 다 있을 때만 NSE 타깃·공유 키체인을 넣고, `extra.eas.build.experimental.ios.appExtensions`도 이미 선언한다.

## 할 일

1. `apps/mobile/eas.json`에 development 프로필을 둔다.
2. `expo-dev-client`를 SDK 58에 맞는 버전으로 더하고, Expo Go 개발 흐름(`pnpm dev:mobile`)이 깨지지 않게 한다.
3. pnpm 모노레포에서 EAS 클라우드 빌드가 의존성을 설치하고 `apps/mobile`을 빌드하는 조건을 Expo 문서대로 맞춘다.
4. 영어 사용자 문서에 운영자 절차를 적는다.
5. 0109 「운영자 확인」 준비 단계가 그 문서를 가리키게 한다.

## 결정

### 세 값을 두는 곳(운영자 결정 2026-11-25)

- 세 값은 운영자가 `apps/mobile/.env`(gitignore, Expo CLI가 자동으로 읽음)에 둔다. 저장소에는 넣지 않는다.
- 클라우드 빌드는 gitignore 된 파일을 올리지 않으므로 같은 값을 EAS `development` 환경 변수로도 둔다. 어긋나지 않게 순서를 하나로 정했다: `.env`를 먼저 고치고, 그 파일을 읽어 `eas env:set`으로 옮기고, `eas env:list`와 `npx expo config --type public`으로 맞는지 본다. 값을 바꿀 때도 같은 순서다.
- 문서는 `eas env:create` 대신 `eas env:set`을 쓴다. eas-cli 27.11.0의 `env:create --help`가 `env:create`를 deprecated로 적고 `env:set`(만들거나 고치기)을 권한다. 처음과 고칠 때 같은 명령이라 순서가 하나로 남는다.
- 공개 범위는 `plaintext`(또는 `sensitive`)다. EAS CLI가 Mac에서 app config를 풀 때 값을 읽어야 하고, `secret`은 읽지 못한다(Expo 문서 `eas/environment-variables/manage`). 세 값은 비밀이 아니다.

### `eas.json`

- `cli.version`은 `>= 24.12.1`, `cli.appVersionSource`는 `remote`다. `eas build:configure`가 만드는 기본값을 따랐다(Expo 문서 `tutorial/eas/configure-development-build`). `appVersionSource`를 빼면 EAS CLI가 경고하고 앞으로 필수가 된다(`eas/json`).
- `build.development`: `developmentClient: true`, `distribution: "internal"`, `environment: "development"`, `node: "24.22.3"`, `pnpm: "12.21.0"`, `env.GANGER_MOBILE_BUILD: "development"`.
  - `GANGER_MOBILE_BUILD`는 비밀도 계정 값도 아니라 `eas.json`에 둔다. 이 값이 있어야 개발 빌드에 ATS 로컬 네트워크 예외(Metro 접속)와 expo-notifications `mode: "development"`(APNs 개발 환경)가 들어간다. `env`의 값은 Mac에서 app config를 풀 때와 빌드 서버 양쪽에 쓰인다(`build/eas-json`).
  - Node는 `.nvmrc`(24)와 같은 메이저, pnpm은 루트 `packageManager`와 같은 버전이다. 루트 `pnpm-workspace.yaml`의 `engineStrict`가 Node 24 밖에서 설치를 실패시킨다. 시험이 둘을 비교한다.
- iOS 전용 키는 두지 않는다. `--platform ios`로 고르고, 기본값(`simulator: false`)이 실기기 빌드다.
- preview·production 프로필은 만들지 않는다. TestFlight·배포는 0112 몫이고, 그때 `autoIncrement`·`submit`과 함께 정한다. 쓰지 않는 프로필을 두면 잘못 고른 프로필로 출시 설정 빌드가 나갈 수 있다.
- eas-cli 27.11.0이 쓰는 `@expo/eas-json`의 `EasJsonUtils.getBuildProfileAsync`로 이 파일을 읽어 스키마 검사를 통과하는 것을 확인했다.

### 모노레포

- Expo 문서 `build-reference/build-with-monorepos`: EAS CLI 명령은 앱 폴더(`apps/mobile`)에서 돌리고, `eas.json`과 `credentials.json`은 앱 폴더에 둔다. 빌드 서버는 저장소 루트의 lockfile로 전체 워크스페이스를 설치한다.
- pnpm의 isolated 설치는 Expo가 그대로 지원한다(`guides/monorepos`). `packages/api`는 Metro가 소스로 읽어(`metro.config.cjs`) 따로 빌드할 단계가 없어 `postinstall`이 필요 없다.
- `.easignore`는 두지 않는다. 있으면 저장소 루트에서 모든 `.gitignore`를 대신해(`build-reference/easignore`) 두 목록을 함께 맞춰야 한다. Git이 추적하는 파일은 약 17MB이고, `apps/mobile/ios/`·`node_modules`·`.env`는 `.gitignore`가 이미 뺀다.

### Expo Go 흐름

- `expo-dev-client`가 있으면 `expo start`가 개발 빌드로 띄운다(Expo 문서 `more/expo-cli` 「Launch target」). 그래서 `pnpm dev:mobile`은 `expo start --go`로 Expo Go를 고정하고, `--dev-client`를 주면 `expo start --dev-client`로 띄운다. `--dev-client`는 데모 서버 인자로 넘기지 않는다(`mobileLaunch`, 시험 `demo/src/mobile-env.test.ts`).
- 버전은 SDK 58 `bundledNativeModules.json`의 `~58.0.21`이다.

### 문서

- 운영자 절차는 [`docs/guide/mobile.md`](../guide/mobile.md)(영어)에 둔다. README 문서 표와 CONTRIBUTING 명령 설명이 가리킨다.
- 순서: eas-cli 설치·로그인, `eas init`(app config가 코드라 EAS CLI가 프로젝트 ID를 써 넣지 못하고 출력한다), 세 값, `eas credentials`(APNs 키), `eas device:create`와 개발자 모드, `eas build --profile development --platform ios`, Mac의 Metro에 붙기(`pnpm dev:mobile --dev-client` 또는 `pnpm --filter @ganger/mobile start --dev-client`), tailnet HTTPS 서버에 QR로 연결.

## 범위 밖

- 실제 EAS 빌드와 실기기 설치·확인: 계정이 필요해 운영자가 한다(0109 「운영자 확인」).
- preview·production 프로필, TestFlight(0112).

## 완료 조건

- `apps/mobile/app.config.test.ts`: `eas.json` development 프로필의 값, Node·pnpm 버전이 저장소와 같음, `eas.json`에 계정 값이 없음, 세 값이 있을 때 개발 빌드에 NSE 타깃·공유 키체인·appExtensions가 들어가고 없을 때 빠지는 시험이 있다.
- `demo/src/mobile-env.test.ts`: `pnpm dev:mobile`이 기본으로 Expo Go(`--go`), `--dev-client`로 개발 빌드를 띄우는 시험이 있다.
- 기존 모바일 시험이 통과한다.

## 로컬 확인(2026-11-25)

- `apps/mobile`에서 가짜 세 값과 `GANGER_MOBILE_BUILD=development`로 `expo config --type public --json`을 돌리면 `ios.bundleIdentifier`, `ios.appleTeamId`, `keychain-access-groups`, `with-notification-service.cjs` 플러그인, `extra.eas.build.experimental.ios.appExtensions`(`GangerNotificationService`)가 나온다. 값 없이 돌리면 모두 빠지고 `extra.eas`가 빈 객체다.
- 같은 가짜 값을 `apps/mobile/.env`에만 두고 돌려도 같은 결과가 나온다(Expo CLI가 `.env`를 읽는다). 확인 뒤 파일을 지웠다.
- `pnpm dev:mobile`(`CI=1`)이 데모 서버와 `expo start --go`의 Metro를 띄운다.

## 남은 일

- 운영자가 문서대로 첫 개발 빌드를 만들어 0109·0222·0226의 실기기 확인을 한다. EAS 빌드 서버에서 루트 `prepare`(`lefthook install`)가 문제를 일으키면 그때 고친다.
