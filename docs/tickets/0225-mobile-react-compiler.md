---
status: done
blocked_by: [0221, 0222, 0224]
---

# 0225 모바일: React Compiler 켜고 다시 그리기 줄이기

## 배경

모바일 성능 점검(2026-11-25) 결과다.

- React Compiler 가 꺼져 있었다(`app.json`·`app.config.ts` 에 `experiments.reactCompiler` 없음).
- `RunCard`·`SettledRow` 에 memo 가 없고, `RunList` 가 렌더마다 새 함수를 넘겼다.
- 읽기 성공마다 새 상태 객체 → snapshot 새 객체 → `buildBoard` 재실행 → 선택된 칸의 카드 전부와 Segment·Sheet 를 다시 그렸다.
- `useClock(30_000)` 이 띠가 없는 live 상태에서도 30초마다 `LiveScreens` 전체를 다시 그렸다.
- `Text` 가 렌더마다 스타일 배열을 새로 만들었다.
- 화면 전환으로 Runners·설정에서 돌아오면 대시보드를 다시 마운트해 스크롤 위치를 잃었다.

운영자 결정(2026-11-25): React Compiler 를 켠다.

## 할 일

1. Expo SDK 58 방식대로 모바일 앱에만 React Compiler 를 켠다. 웹(`apps/web`)은 범위 밖이다.
   - `app.json` `expo.experiments.reactCompiler: true`. Expo CLI 가 이 값을 Metro 변환 옵션 `transform.reactCompiler` 로 넘기고(`@expo/metro-config` `rewriteRequestUrl`), `babel-preset-expo` 가 caller 의 `supportsReactCompiler` 를 보고 `babel-plugin-react-compiler` 를 `target: "19"` 로 붙인다. SDK 51부터 이 설정이 켜는 스위치다(`babel-preset-expo` README `react-compiler` 옵션).
   - `babel-preset-expo@58.0.26` 이 `babel-plugin-react-compiler@^1.0.0` 을 의존성으로 들고 있어(설치된 것은 1.0.0) 앱 의존성을 따로 더하지 않는다. React 19.3 은 `react/compiler-runtime` 을 내장해 `react-compiler-runtime` 도 필요 없다.
   - 저장소에 `babel.config.js` 가 없어 preset 기본값을 그대로 쓴다.
2. 컴파일러가 건너뛰는 컴포넌트를 컴파일러 진단으로 찾아 고친다. 린트 도구는 더하지 않는다(oxlint 그대로).
   - 시험에서도 컴파일러를 켠다. `apps/mobile/react-compiler.mts` 의 vite 플러그인이 `apps/mobile/src` 의 앱 소스(시험과 `src/testing` 제외. 워크스페이스 패키지 소스는 넣지 않는다)를 `babel-plugin-react-compiler` 로 변환하고, logger 로 받은 `CompileError`·`PipelineError`·`CompileSkip` 이 있으면 변환을 실패시킨다. 그래서 모바일 시험은 컴파일된 코드로 돌고, 건너뛴 컴포넌트가 생기면 그 파일을 import 하는 시험이 실패한다.
   - `react-compiler.test.ts` 는 앱 소스 파일마다 건너뛴 함수가 없는지 따로 본다(시험이 import 하지 않는 파일도 잡는다).
   - 찾아 고친 것: `dashboard-screen.tsx`·`use-device-notifications.ts` 의 catch 없는 `try/finally`(컴파일러 1.0 이 아직 못 다루는 문법이라 `Promise.prototype.finally` 로), `run-sheets.tsx` 가 `useContext` 로 받은 ref 의 `.current` 를 바꾸던 것(보내는 중 잠금을 `held`·`hold`·`release` 를 가진 잠금 객체로).
   - 시험용 개발 의존성: `@babel/core`, `babel-plugin-react-compiler`(preset 과 같은 1.0.0), `@types/babel__core`.
3. 0224 의 "같은 응답이면 상태 그대로" 위에서 런 id 별로 이전 런 객체를 재사용한다(`connection/reuse-runs.ts` `reuseRuns`).
   - 대시보드가 바뀐 때 새 응답의 런마다 같은 id 의 이전 런과 `sameValue` 로 비교해 같으면 이전 객체를 쓴다. 칸을 옮긴 런도 내용이 같으면 이전 객체다.
   - 칸 배열은 담긴 런 참조가 모두 같으면 이전 배열을 쓴다. 전체가 같으면 이전 대시보드를 쓴다.
   - 대시보드 카드는 `memo` 로 감싼 `RunItem`·`SettledItem` 으로 그린다. 카드 콜백은 `(run, action)` 하나를 넘겨 런마다 새 함수를 만들지 않는다. 그래서 바뀐 런의 카드만 다시 그린다.
   - 컴파일러는 큰 JSX 묶음 안의 인라인 화살표 함수를 그 묶음과 같이 다시 만든다. 대시보드의 메뉴 콜백(`openRunMenu`)을 따로 꺼내 보드가 바뀌어도 같은 함수를 넘긴다.
4. 띠의 시계는 띠를 보일 때만 돈다.
   - `LiveScreens` 는 시계를 들지 않는다. 띠는 `ConnectionBand` 컴포넌트로 나눠 띠가 있는 상태(stale, host-blocked, incompatible)에서만 마운트한다.
   - stale 띠(`StaleBand`)는 30초 간격 대신 "n분 전" 이 바뀌는 때(`nextStaleBandChangeIn`)에 맞춰 한 번씩 다시 그린다. 지연은 그때의 현재 시각으로 잡는다. 받은 때가 바뀌면(Workspace 바꾸기 등) 띠를 새로 마운트해 현재 시각부터 센다.
5. 화면 전환 때 대시보드를 다시 마운트하지 않는다(`kept-screen.tsx` `KeptScreen`).
   - Runners·설정을 보는 동안 대시보드를 `display: "none"` 으로 숨겨 두고 `aria-hidden` 을 붙인다. React Native 는 `aria-hidden` 을 iOS `accessibilityElementsHidden`, Android `importantForAccessibility="no-hide-descendants"` 로 바꿔 VoiceOver·TalkBack 이 숨긴 화면을 읽지 않는다.
   - `Sheet`·`PopoverMenu` 는 떠 있는 `Modal` 이라 부모의 `display: "none"`·`aria-hidden` 을 따르지 않는다. 시트를 연 채 알림을 눌러 Runners 로 가면 숨긴 대시보드의 시트가 위에 남는다. `KeptScreen` 이 `ScreenShown` 문맥을 내려 숨긴 화면 안의 시트·팝오버는 보이지 않는다. 열렸는지는 부른 쪽이 지녀 돌아오면 다시 열리지만, `Modal` 이 닫히며 내용을 언마운트해 시트 안의 입력은 처음부터 시작한다(`apps/mobile/DESIGN.md`).
   - 숨긴 대시보드에는 띠를 넘기지 않는다. 띠는 보이는 화면에만 있다.
   - 데모 화면(`app-screens.tsx`)도 같은 방식이다.
6. `Text` 의 스타일 배열은 컴파일러가 `variant`·`weight`·`tone` 이 바뀔 때만 다시 만든다. 손으로 고치지 않았다.

## 완료 조건

- `react-compiler.test.ts`: `app.json` 에서 켬, 앱 소스만 컴파일, 규칙 위반을 건너뜀으로 알림, 앱 소스 파일마다 건너뛴 함수 없음.
- 모든 모바일 시험이 컴파일러를 거친 코드로 돈다(`vitest.config.mts` 플러그인).
- 렌더 횟수 시험(`app-root.test.tsx` "다시 그리기 줄이기(티켓 0225)", 가짜 변경 스트림):
  - 같은 응답을 다시 받으면 커밋·대시보드·카드 렌더가 0번.
  - 한 런만 바뀌면 그 런의 카드만 다시 그린다.
  - 띠가 없으면 5분이 흘러도 커밋 0번(시계를 `LiveScreens` 로 되돌리면 실패하는 것을 확인했다).
  - Runners·설정에 갔다 와도 같은 대시보드 노드고, 가 있는 동안 `aria-hidden`.
- `components.test.tsx`: 숨긴 화면 안의 열린 시트는 그리지 않고, 화면이 돌아오면 그린다.
- `reuse-runs.test.ts`: 같은 내용이면 이전 대시보드, 바뀐 런만 새 객체, 칸을 옮긴 런 재사용.
- `expo export --platform ios` 번들에서 대시보드 컴포넌트가 컴파일러 런타임(`react/compiler-runtime`)을 쓴다.

스크린숏은 필요 없다. 실기기 체감 확인은 운영자가 머지 뒤 한다.

## 남은 일

- 실기기 확인(운영자, 머지 뒤): 대시보드를 스크롤하고 Runners·설정에 갔다 오면 위치가 그대로인지. iOS Fabric 은 `display: none` 인 뷰를 내렸다가 돌아올 때 새로 만들고, ScrollView 는 상태에 저장된 `contentOffset` 으로 위치를 되돌린다. jsdom 시험은 같은 노드인지만 본다. 위치를 잃으면 `onScroll` 로 위치를 기억했다가 되돌린다.
- stale 띠가 "n시간 전"·"n일 전" 일 때도 1분마다 다시 그린다. 띠가 보일 때만이라 그대로 두었다.

- 한 런이 바뀌면 보드가 새로 만들어져 칸 고르기(Segment)와 개수 줄은 다시 그린다. 개수가 바뀔 수 있어 그대로 두었다.
- 띠를 보이는 동안에는 대시보드와 Runners·설정을 오갈 때 띠가 새로 마운트돼 시계도 새로 시작한다. 현재 시각으로 시작하므로 표시는 맞다.
- 숨긴 화면 안의 팝오버가 닫히는 것은 jsdom 시험으로 따로 확인하지 않았다(시트와 같은 `ScreenShown` 을 본다). 시트가 열린 상태에서 화면이 바뀌는 동작(jsdom 은 react-native-web 의 닫힘 애니메이션 끝을 알리지 않는다)은 실기기에서 확인한다.
- 시험용 의존성을 더하며 lockfile 에서 `babel-plugin-react-compiler@1.0.0` 이 쓰는 `@babel/types` 가 7.29.14 → 7.29.15(패치)로 맞춰졌다. 앱 번들의 컴파일러 플러그인도 같은 것을 쓴다.
