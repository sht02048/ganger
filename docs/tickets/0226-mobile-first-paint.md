---
status: done
blocked_by: [0224]
---

# 0226 모바일: 첫 화면 빨리 띄우기

## 배경

모바일 성능 점검(2026-11-25). 첫 화면 전에 세 단계를 차례로 기다렸다.

- `apps/mobile/src/App.tsx`: `useFonts` 가 Pretendard OTF 3개(Regular·Medium·SemiBold, 각 약 1.58MB)를 다 불러올 때까지 `null`.
- `connection/app-root.tsx`: `store.load()`(SecureStore)까지 다시 `null`.
- `live-screens.tsx`: 그다음 캐시 읽기 → `JSON.parse` → Workspace 마다 대시보드와 런 상세 최대 20개를 zod 로 동기 파싱(`offline-cache.ts`).
- expo-splash-screen 을 쓰지 않아 스플래시가 내려간 뒤 빈 화면이 보일 수 있었다.

## 할 일

1. 폰트를 expo-font config plugin 으로 빌드에 넣어 런타임 `useFonts` 대기를 없앤다. Expo Go 에서는 플러그인이 적용되지 않으므로 개발 중에는 지금처럼 `useFonts` 로 불러온다.
2. expo-splash-screen 으로 저장된 연결 정보와 캐시 첫 화면이 준비될 때까지 스플래시를 유지한다(상한 시간을 둔다).
3. 캐시는 지금 보는 Workspace 대시보드부터 파싱하고, 런 상세는 열 때 파싱한다.
4. 0224 의 캐시 쓰기 묶음과 맞춘다.

## 결정

### 폰트

- `app.json` 에 `expo-font` config plugin 을 두고 Pretendard OTF 3개를 넣는다. iOS 는 파일에서 PostScript 이름(`Pretendard-Regular` 등)을 읽고, 이 이름이 디자인 토큰 `fontFamily` 와 같다. 시험(`font-gate.test.tsx`)이 플러그인의 파일 이름과 토큰을 비교한다.
- 근거(Expo 문서 `develop/user-interface/fonts`): 플러그인으로 넣은 폰트는 앱이 켜질 때 바로 쓸 수 있고 불러오는 코드가 필요 없다. Expo Go 에서는 적용되지 않는다. expo-font 의 `getLoadedFonts`·`isLoaded` 는 빌드에 넣은 폰트도 불러온 것으로 본다.
- 앱은 모듈을 읽을 때 `isLoaded` 로 세 굵기가 이미 있는지 한 번 본다(`fontsBuiltIn`). 있으면(개발·출시 빌드) 기다리지 않고 그리고, 없으면(Expo Go, 웹) 지금처럼 `loadAsync` 를 끝낼 때까지 기다린다(`FontGate`). 불러오기에 실패해도 기본 글꼴로 그린다.
- 서브셋·woff 는 쓰지 않는다. 문서 표로는 iOS 가 woff·woff2 를 읽고, `pretendard` 패키지의 `woff2-subset` 은 굵기마다 약 264KB 로 작다. 그런데 이 서브셋은 자주 쓰는 한글 음절만 담아, 티켓 제목·Workspace 이름처럼 서버가 보내는 임의의 글자는 빠진 음절만 시스템 글꼴로 섞여 보인다. 빌드에 넣은 폰트는 켤 때 읽는 시간이 아니라 앱 크기에만 들어, 서브셋으로 얻는 것이 작다.
- `runtime-fonts.ts` 가 OTF 를 import 해 출시 번들에도 Metro 애셋으로 한 벌 더 들어간다(약 4.7MB). 출시 빌드는 이 애셋을 읽지 않는다. `if (__DEV__) require(...)` 로 감싸도 `expo export --platform ios` 의 애셋 수가 3개로 같아 지우지 못했다(아래 남은 일).

### 스플래시

- `expo-splash-screen` `~58.0.14` 를 더한다. Expo SDK 58(`expo/bundledNativeModules.json`)이 정한 버전이다. 스플래시를 앱이 내릴 때까지 붙잡으려면 이 모듈이 필요하다. `app.json` 플러그인에는 화면 바탕색(`#090909`, `bgCanvas`)만 둔다.
- `App.tsx` 가 모듈을 읽을 때 `preventAutoHideAsync()` 를 부르고(Expo 권장: 전역에서, 기다리지 않고) 스플래시 게이트(`createSplashGate`)를 만든다. 게이트는 첫 화면 준비를 받으면 한 번 `hide()` 하고, 받지 못하면 `SPLASH_MAX_MS`(2초) 뒤에 내린다.
- 첫 화면 준비(`useFirstPaint`)는 이렇다.
  - 저장된 연결이 없으면 연결 화면, 데모면 데모 화면을 그린 뒤.
  - 저장된 연결이 있으면 캐시 파일을 읽어 보는 Workspace 대시보드를 세션에 넣은 뒤. 캐시가 없어도 읽기를 마치면 준비로 본다. 서버 응답은 기다리지 않는다(첫 읽기가 캐시보다 먼저 끝나면 그때).
  - 폰트를 기다리는 동안(Expo Go, 웹)은 아무것도 그리지 않으므로 준비 신호도 없다. 상한 시간이 지켜 준다.

### 캐시

- 캐시 파일을 읽을 때는 `JSON.parse` 와 바깥 모양(버전, 서버, 항목의 `fetchedAt`)만 검사하고 7일이 지난 항목을 버린다. 대시보드와 런 상세는 계약(zod)으로 파싱하지 않은 채 둔다. 런 상세는 겹침을 가리려고 `id` 만 본다.
- `load(workspaceId)` 는 보는 Workspace 대시보드 하나만 파싱해 돌려준다. 다른 Workspace 로 가면 `contentFor(workspaceId)` 로 그 대시보드를 그때 파싱해 세션에 넣는다(세션에 이미 있으면 넣지 않는다). 런 상세는 `cachedRun` 으로 열 때 파싱한다. 한 번 파싱한 것은 다시 파싱하지 않고, 계약에 맞지 않으면 그때 버린다.
- 0224 의 쓰기 묶음(30초, 백그라운드 때 `flush`, 받은 때만 고친 것)과 원자적 쓰기, 상한(Workspace 마다 런 20개, 7일)은 그대로다. 파일을 다시 쓸 때 파싱하지 않은 항목은 받은 그대로 다시 쓴다.

## 완료 조건

폰트·스플래시 모듈은 가짜로 시험한다.

- 스플래시가 첫 화면 준비 뒤 내려간다(`app-root.test.tsx` "첫 화면과 스플래시": 저장된 연결과 캐시, 연결 화면).
- 준비가 늦으면 상한 시간에 내려간다(`splash-gate.test.ts`, 연결 정보를 읽지 못하는 경우).
- 캐시를 다 읽기 전에는 내리지 않는다.
- 캐시는 보는 Workspace 대시보드만 먼저 파싱하고, 다른 대시보드와 런 상세는 쓸 때 한 번 파싱한다(`offline-cache.test.ts` "지연 파싱"). 오프라인으로 켜도 다른 Workspace 의 캐시 대시보드를 그 Workspace 로 갈 때 보인다.
- 빌드에 폰트가 있으면 불러오지 않고, 없으면 불러온 뒤(실패해도) 그린다(`font-gate.test.tsx`).

실기기 첫 화면 시간은 운영자가 서명된 빌드로 머지 뒤 확인한다. 스크린숏은 필요 없다.

## 남은 일

- 출시 번들에 런타임용 OTF 3개(약 4.7MB)가 한 벌 더 들어간다. 지우려면 Expo Go·웹 경로의 폰트를 플랫폼별 파일이나 빌드 설정으로 나눠야 한다.
- 실기기에서 첫 화면 시간과 스플래시가 내려간 뒤 빈 화면이 없는지 운영자가 확인한다.
