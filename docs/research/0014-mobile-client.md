# 모바일 클라이언트 탐색 (기술 제약·사용자 흐름)

조사일 2026-11-19. 운영자가 모바일 앱을 계획하려 한다. 운영자 결정(같은 날): Ganger 웹 화면을 그대로 가져가지 않고, 모바일 UI는 모바일에 맞게 따로 설계한다. 낱말은 GLOSSARY를 그대로 쓴다. 이 문서는 기술 선택지와 제약, 모바일에서 할 일과 흐름을 사실로 정리한다. 제품 코드는 바꾸지 않았다. 결정은 운영자 몫이라 ADR은 쓰지 않고 권장안과 남은 결정만 적는다. 서버 발견·페어링은 research [0013](0013-remote-client-pairing.md)을 잇는다. 1·4·6절의 서버 현황(공개 경로, `/api/attention` 폴링, GLOSSARY의 Runner Issue)은 티켓 0103 머지 전 기준이다. 아래 「남은 결정」은 운영자가 2026-11-19에 정했거나 미뤘고, 그 결과는 스펙 [0002](../spec/0002-mobile.md)와 ADR [0015](../adr/0015-device-token-pairing.md)·[0016](../adr/0016-mobile-push-via-expo.md)에 있다.

**갱신 메모(2026-11-23, 티켓 [0188](../tickets/0188-mobile-plan-refresh.md)).** 아래 본문은 조사일의 기록이라 고치지 않는다. 그 뒤 달라진 사실은 다음과 같고, 지금 기준은 스펙 0002다.

- 1절의 공개 경로: 지금은 알림 사건(`/api/notification-events`), 변경 기록 SSE(`/api/change-events/stream`), `/api/build`, 진단, 러너 등록 경로도 있다. `/api/attention`은 v0.4.0에도 남아 있지만 데스크톱 앱은 알림 사건 경로를 쓴다.
- 6절의 결과와 Human Check: 요약 결과는 Succeeded·Failed·Canceled이고 병합은 PR 정보다(ADR [0022](../adr/0022-run-outcome-from-agent-report.md)). Human Check는 PR 확인이 아니라 에이전트가 `decision_gate`로 요청하는 Waiting for Input 종류이고, 앱에서 답한다(ADR [0023](../adr/0023-human-check-request.md), 스펙 0002 M22).
- 6절의 쓰기: 재개(`controlRun`), 이어서 맡기기(`continueRunFrom`)가 생겼고 런 쓰기는 `requestId`로 한 번만 처리한다(티켓 0156). Paused 상태도 새로 생겼다(티켓 0118).

출처 표시는 research 0004·0009·0012·0013을 따른다.

- **[문서]** 공식 문서와 공식 저장소. 링크를 문장 옆에 단다. 2026-11-19에 찾았다.
- **[코드]** 이 저장소의 파일. 경로를 단다.
- **[추정]** 문서나 코드로 확인하지 않은 판단. 그렇다고 적는다.

## 요약

| 절  | 질문           | 결론                                                                                                                                                                                                                  |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 먼저 필요한 것 | 어떤 모바일이든 **서버 인증·기기 페어링**, **버전이 붙은 공개 API**, **알림 보내기**가 먼저다. 지금 서버에는 로그인이 없고, 공개 HTTP 경로는 셋뿐이며, 푸시 코드는 없다 **[코드]**                                    |
| 2   | 기술           | 별도 모바일 UI 전제에서 **React Native(Expo)** 가 노력 대비 가치가 가장 크다. 타입·zod 스키마·순수 모델을 공유한다. StyleX와 UI SDK는 쓸 수 없어 스타일은 따로 쓴다. 디자인 토큰은 중립 원본에서 웹·모바일로 생성한다 |
| 3   | 서버에 닿기    | 휴대폰의 Tailscale 앱 + Tailscale Serve의 MagicDNS HTTPS 주소. iOS는 평문 http를 막아 HTTPS가 사실상 필수다                                                                                                           |
| 4   | 푸시           | APNs 키는 앱 게시자 팀에 묶인다. 셀프호스팅 서버마다 키를 줄 수 없어 중앙 릴레이, ntfy 연동, 웹 푸시 중에서 고른다. 중앙 릴레이는 ADR 0005와 부딪히는지 따져야 한다                                                   |
| 5   | 배포           | Apple Developer 계정, 심사용 데모(데모 모드나 데모 서버), iOS 서명 자격 증명이 필요하다                                                                                                                               |
| 6   | 할 일과 흐름   | 폰에 오는 이유는 거의 알림이다. 탭 셋(처리할 일·진행·Runners), 알림에서 바로 행동, 바텀 시트, 위험 행동은 확인을 거친다. 온보딩·러너 등록·비밀 값·Mapping 편집은 넣지 않는다                                          |

## 1. 모바일보다 먼저 필요한 것

- **인증이 없다.** README는 "The web app has no login"이라고 적는다 **[코드: README.md 128행]**. tailnet에 닿는 기기는 누구나 쓰기를 할 수 있다. 막는 것은 Host·Origin 허용 목록뿐이고 **[코드: packages/app/src/request-guard.ts]**, README는 이것이 브라우저를 지키는 장치이지 접근 제어가 아니라고 적는다 **[코드: README.md 135행]**. 폰을 잃어버리면 그 기기가 런에 답하거나 취소할 수 있다.
- **페어링·토큰이 없다.** 데스크톱 원격 모드는 `tailscale status --json`으로 기기를 읽고 각 기기에 `GET /api/identity`를 보내 서버를 찾는다. iOS·Android 기기는 일부러 목록에서 뺀다 **[코드: apps/desktop/src/core/tailscale.ts, remote.ts]**.
- **공개 API가 좁다.** 공개 HTTP 경로는 `GET /api/identity`, `GET /api/attention`(데스크톱 알림이 폴링), webhook 셋이다 **[코드: apps/web/src/routes/api/]**. 나머지는 TanStack Start 서버 함수 39개다 **[코드: apps/web/src/server/\*functions.ts]**. 서버 함수는 빌드마다 바뀌는 내부 RPC라 모바일이 기댈 계약이 못 된다.
- **MCP도 아직 같은 기계 전용이다.** ADR [0013](../adr/0013-mcp-client-scope.md)은 HTTP MCP와 다른 기기 클라이언트를 "서버 인증이 생긴 뒤 다시 정한다"고 미뤘다.
- **로직 재사용 범위.** `packages/app`의 `load.ts`·`actions.ts`는 `@ganger/db`를 직접 부른다 **[코드]**. 모바일이 그대로 쓸 수 있는 것은 `model.ts`의 타입·순수 함수, `@ganger/core` 타입, zod 스키마다. 새 API 계약을 DB에 기대지 않는 순수 패키지(가칭 `packages/api`)로 두면 서버와 모바일이 함께 쓴다 **[추정]**.

## 2. 기술 선택지 (별도 모바일 UI 기준)

| 선택지                 | 장점                                                                                                  | 단점                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) 별도 모바일 웹·PWA | 스토어 심사가 없다. TS·zod를 그대로 쓰고 같은 서버가 내려 출처가 같다                                 | iOS 웹 푸시는 홈 화면에 추가했을 때만 된다(iOS 16.4부터) **[문서]**([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). 백그라운드가 없고 저장소가 비워질 수 있다. 서버가 HTTPS여야 한다 |
| (b) Capacitor로 감싸기 | 네이티브 APNs를 붙일 수 있다                                                                          | 웹뷰 UI라 "모바일에 맞게"라는 결정과 맞지 않는다. Tauri mobile은 덜 성숙하다 **[추정]**                                                                                                                                 |
| (c) React Native·Expo  | 타입·zod·순수 모델을 공유하고 한 언어로 일한다. EAS로 빌드·제출·OTA, Android도 함께 나온다 **[문서]** | StyleX는 RN에서 못 쓴다. react-strict-dom은 실험 단계(0.0.55, 2026-01)다 **[문서]**([react-strict-dom](https://github.com/facebook/react-strict-dom)). `@ui-sdk/react`도 재사용하지 못한다                              |
| (d) SwiftUI            | 가장 네이티브답다. 알림 액션·위젯·Live Activity·App Intents가 자연스럽다                              | 코드를 공유하지 못해 API 스키마를 OpenAPI 등으로 내보내 Swift 코드를 생성해야 한다. Android는 따로 만들고, pnpm·oxlint·CI 툴체인과 떨어진다                                                                             |

**디자인 토큰 공유.** `packages/ui/src/tokens.stylex.ts`의 값(oklch)을 JSON 같은 중립 원본으로 옮기고, StyleX `defineVars`와 RN·Swift 상수를 그 원본에서 생성한다. RN·SwiftUI용은 생성 단계에서 sRGB로 바꾼다 **[추정]**.

## 3. 서버에 닿기

- 휴대폰에 Tailscale 앱을 깔고, README가 권하는 Tailscale Serve의 MagicDNS HTTPS 주소로 붙는다. iOS ATS가 평문 http를 막아 HTTPS가 사실상 필수다 **[추정]**. research 0013의 Buzz 이슈도 VPN 안 릴레이를 모바일이 "HTTPS여야 한다"로 거절한 예다.
- iOS는 VPN을 한 번에 하나만 켠다. 회사 VPN과 함께 쓰기 어렵다는 점을 사용자 문서에 적는다 **[추정]**.
- 인증 후보는 둘이다. 데스크톱 화면의 QR 페어링으로 기기별 토큰을 발급·폐기하거나, Tailscale Serve가 붙이는 신원 헤더에 기댄다(Serve를 거칠 때만 된다) **[추정]**.

## 4. 푸시 알림

APNs 키(.p8)는 앱 게시자의 Apple 팀에 묶인다. 셀프호스팅 서버마다 키를 줄 수 없으니 선택지는 넷이다.

1. **프로젝트가 운영하는 중앙 릴레이.** Home Assistant가 이 방식이다(공식 릴레이, 기기 하나당 하루 500건 제한, 옵트아웃과 Android 로컬 푸시) **[문서]**([HA 알림](https://contributors.home-assistant.io/companion/mobile-app-api/notifications/)). 운영 부담이 있고, ADR 0005(필수 의존성은 Orca, GitHub, Linear뿐)와 부딪히는지 따져야 한다. 릴레이를 둔다면 페이로드에 티켓 제목을 넣지 않고 "확인할 일 있음" 신호만 보내, 앱이 tailnet으로 내용을 가져온다.
2. **각자 빌드·서명.** 사용자 부담이 너무 크다.
3. **ntfy·Pushover 연동.** 서버가 `/api/attention`과 같은 사건을 ntfy 토픽으로 보내는 설정이다. 앱 없이 바로 쓸 수 있고 가장 싸다 **[추정]**.
4. **PWA 웹 푸시.** 브라우저 공급자의 푸시 서비스만 거친다. (a)를 고를 때만 의미가 있다.

## 5. 배포

- Apple Developer 계정(연 99달러)이 필요하다. 셀프호스팅 클라이언트는 심사(가이드라인 2.1)에서 데모 서버나 데모 모드를 요구받는 일이 흔하다 **[추정]**. 제품 앱은 `demo/`를 import 하지 않으므로(티켓 0047), 앱 안 데모 모드의 데이터는 따로 둬야 한다(스펙 0002 열린 질문 16). 공개 데모 서버는 `demo/`를 쓸 수 있다.
- TestFlight 외부 테스트도 베타 심사를 거친다 **[추정]**.
- CI 서명은 `.github/workflows/release.yml`이 쓰는 App Store Connect API 키를 다시 쓸 수 있다. iOS 배포 인증서와 프로비저닝 프로파일은 따로 더한다(fastlane match나 EAS credentials) **[코드][추정]**.

## 6. 모바일에서 할 일과 흐름

### 할 일 (빈도·긴급도 순)

| #   | 할 일                                                                        | 쓰기      | 지금 서버 함수                            |
| --- | ---------------------------------------------------------------------------- | --------- | ----------------------------------------- |
| 1   | Question 알림을 받고 답하기                                                  | 예        | `answerQuestion`                          |
| 2   | Permission 거절(허용은 러너 화면에서만, ADR 0009)                            | 예        | `denyPermission`                          |
| 3   | Human Check PR 확인(GitHub Mobile로 넘김)                                    | 아니요    | `getHomePage`의 PR 링크                   |
| 4   | Failed 보고 다시 맡기기(Disconnected는 끝나지 않은 런이라 다시 맡길 수 없다) | 예        | `assignTicket`, `getRunDetail`            |
| 5   | Runner Issue 확인                                                            | 다시 확인 | `getRunnersPage`, `requestRunnerCheckNow` |
| 6   | 오늘 진행 훑기                                                               | 아니요    | `getHomePage`, `getStatsPage`             |
| 7   | 티켓 할당, 런 취소                                                           | 예        | `assignTicket`, `cancelRun`               |

넣지 않는 것: 온보딩, 러너 추가·ssh 대상 바꾸기, 비밀 값 저장(트래커 키, GitHub 토큰), MCP 쓰기 허용, Mapping 편집, Stats 세부 표. ssh와 비밀 값은 ADR 0013이 MCP에서 막은 이유와 같다.

### 정보 구조 (모바일 고유)

웹의 칸반·레일·목록 + 패널(ADR 0007)은 가져오지 않는다.

- **처리할 일**(배지): To do 다섯 종류를 시간순 피드 하나로 보인다. 칩으로 거른다(답이 필요해요 / 확인해 주세요 / 멈췄어요).
- **진행**: Queued·Running 목록과 경과 시간. 맨 위 오늘 요약 한 줄. 오른쪽 위 "맡기기"로 할당.
- **Runners**(Runner Issue면 점): Online·Offline과 공급자 사용량, "다시 확인".
- Tickets와 Stats는 탭이 아니라 진행 탭에서 연다. Runner Issue는 To do가 아니라 처리할 일 탭에 섞지 않는다(GLOSSARY).

### 패턴

- **알림에서 바로 행동.** Question은 선택지가 셋 이하면 알림을 길게 눌러 고른다. Permission 거절은 앱을 열어 확인을 받는다. Human Check는 GitHub Mobile로 넘긴다.
- **스와이프.** 오른쪽은 안전한 기본 행동(PR 보기, 다시 맡기기 시트). 왼쪽은 알림만 숨기기(런 상태는 그대로). 거절·취소는 스와이프에 두지 않는다.
- **바텀 시트.** Question 시트는 질문 전문, 라디오 선택지, 직접 쓰기, 아래쪽에 고정한 "보내기". 고르기만 해서는 보내지 않는다(ADR 0010 6번).
- **위험 행동 확인.** 거절·취소·할당은 Face ID 확인을 둘 수 있다.
- **선택.** 잠금 화면 위젯, 런 하나를 지켜보는 Live Activity.

### 흐름

| 흐름         | 알림                                                        | 처리                                                  |
| ------------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| Question     | "Question · ACME-12 결제 재시도" / "에이전트가 질문했어요." | 알림에서 고르거나 시트에서 "보내기" → "답을 보냈어요" |
| Permission   | "Permission · ACME-7" / "러너 화면에서 허용해 주세요."      | 거절하기 → 확인 → "거절했어요"                        |
| Human Check  | "Human Check · ACME-3" / "PR이 열렸어요. 확인해 주세요."    | GitHub Mobile. 병합하면 피드에서 빠진다               |
| Failed       | "Failed · ACME-9" / "완료 보고 없이 멈췄어요."              | 두 축으로 이유 → "다시 맡기기"                        |
| Runner Issue | "Runner Issue · 러너 1곳" / "GitHub 인증을 확인해 주세요."  | Runners 탭 → "다시 확인" 또는 "Mac에서 고쳐 주세요"   |

### 서버에 닿지 않을 때

마지막으로 받은 피드를 "n분 전 기준" 띠와 함께 보이고, 행동 버튼과 스와이프를 끈다. 오프라인에서 한 쓰기는 대기열에 쌓지 않는다. 늦게 간 답이 이미 다른 상태가 된 런에 닿을 수 있어서다.

## 7. 레퍼런스

- **Orca** iOS·Android 컴패니언 앱: 에이전트 지켜보기, 주의 알림, 후속 지시 **[문서]**([App Store](https://apps.apple.com/app/id6766130217)). Ganger 모바일 범위와 거의 같다. 연결 방식은 출처마다 달라 확인하지 못했다.
- **GitHub Mobile**: 데스크톱 전체가 아니라 알림·리뷰·짧은 답장에 집중한다 **[추정]**.
- **Linear 모바일**: 받은편지함 우선, 스와이프로 미루기 **[추정]**.
- **Happy**(`slopus/happy`)·Claude Code 원격 세션: 권한 요청을 푸시로 받아 시트에서 허용·거절한다 **[추정]**. Ganger는 허용을 의도적으로 막았다(ADR 0009·0013).

## 권장 순서

1. 서버 인증·기기 페어링, 버전이 붙은 공개 API, ntfy 알림 연동. one-way라 ADR이 필요하다. 모바일 없이도 가치가 있다.
2. 모바일 흐름 시안(탭 셋, 처리할 일 피드, 답하기 시트, 알림 문구).
3. Expo iOS 앱: 읽기 + 답하기·거절부터. 그다음 푸시 경로, Android.
4. SwiftUI는 위젯·Live Activity가 핵심 가치일 때만.

## 남은 결정

1. 서버 인증 방식(기기 토큰 + QR 페어링 vs Tailscale 신원)과 기기 폐기 화면
2. 모바일 범위(알림·보기·답하기·거절만 vs 할당·취소까지)
3. 푸시 경로(ntfy만, 중앙 릴레이, 웹 푸시)와 알림 본문에 티켓 제목을 넣을지
4. RN vs SwiftUI, Android 시기
5. Apple 계정 명의와 심사용 데모 방식
6. API 계약을 순수 패키지로 나눌지
7. 알림에서 바로 답하기, 왼쪽 스와이프(알림 숨기기), 위험 행동 Face ID 확인
8. 공급자 사용량 한도를 Runner Issue 알림에 넣을지(지금 GLOSSARY 정의에는 없다)
