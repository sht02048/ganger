---
status: done
blocked_by: []
---

# 0217 모바일 데모 모드가 iPhone 에서 Render Error 로 열리지 않는 것 고치기

## 배경

운영자가 2026-11-25에 iPhone 의 Expo Go(SDK 58, `pnpm dev:mobile`)에서 "데모로 둘러보기"를 누르면 Render Error 가 난다고 보고했다.

```
Render Error
undefined is not a function
Source: apps/mobile/src/demo/data.ts (118:34)
readUsage (apps/mobile/src/demo/data.ts:118)
busySnapshot (apps/mobile/src/demo/data.ts:308)
useMemo$argument_0 (apps/mobile/src/app-screens.tsx:17)
AppScreens (apps/mobile/src/app-screens.tsx:16)
```

118:34 는 `windows.toSorted(...)` 다. 기기의 Hermes 에 `Array.prototype.toSorted`(ES2023)가 없다. 모바일 시험은 Node(jsdom)에서 돌고 모바일 tsconfig 가 `lib: ["es2024", "dom"]` 라 시험과 타입 검사 모두 놓쳤다.

react-native 0.88.1 은 Hermes V1 `hermes-v260318099.0.5`(`react-native/sdks/.hermesv1version`)를 쓴다. 그 태그의 Hermes 소스를 보면 다음과 같다.

- `include/hermes/VM/PredefinedStrings.def` 에 `toSorted` 가 없다. `toReversed`, `toSpliced`, `with`, `findLast`, `findLastIndex`, `at` 은 있고 `lib/VM/JSLib/Array.cpp` 가 등록한다. ES2023 배열 메서드 가운데 `toSorted` 만 빠졌다.
- `Array.fromAsync`, `ArrayBuffer.prototype.transfer`·`resize`, RegExp `v` 플래그도 찾지 못했다.
- `doc/Features.md` 는 ES2022 의 RegExp `d` 플래그, ES2021 의 `WeakRef` 를 지원한다고 적고, `FinalizationRegistry` 와 배열 묶기(`groupBy`)는 계획 중이라고 적는다. 표준 라이브러리 지원이 언어 기능보다 늦을 수 있다고도 적는다.

## 할 일

1. `apps/mobile/src/demo/data.ts` 의 `toSorted` 를 복사한 배열의 `sort` 로 바꾼다.
2. `apps/mobile/tsconfig.json` 의 `lib` 를 `es2022` 로 낮춰, 모바일 번들에 들어가는 코드가 ES2023 이후 내장 API 를 쓰면 `pnpm run typecheck` 가 막게 한다.
   - `@ganger/api` 는 `exports` 가 `./src/index.ts` 라 모바일 typecheck 가 그 소스를 모바일 설정으로 함께 검사한다(`tsc --listFiles` 로 확인). 모바일이 import 하는 공유 패키지는 지금 `@ganger/api` 하나다. 다른 공유 패키지를 소스로 import 하게 되면 같은 방식으로 함께 검사된다.
   - lib 를 낮춰 새로 걸린 곳은 `toSorted` 한 곳이다.
3. `apps/mobile/src/demo/data.test.ts` 에서 `Array.prototype.toSorted`, `Array.fromAsync`, `Object.groupBy`, `Map.groupBy` 를 지운 채 `busySnapshot`, `emptySnapshot` 과 각 Workspace 의 Dashboard 를 만든다.

## 남은 위험

- `lib` 는 ES 판 단위로만 고를 수 있다. `es2022` 는 Hermes 에 있는 `findLast`·`toReversed` 도 막아 보수적이고, 반대로 `FinalizationRegistry`(`es2021.weakref`)처럼 `es2022` 안에 있지만 Hermes 문서가 아직 없다고 적은 API 는 막지 못한다.
- `dom` lib 와 `@types/node` 가 선언하는 전역(`structuredClone` 등)은 Hermes 가 아니라 React Native 가 주는지에 따라 달라 이 검사로 막지 못한다.
- 실기기 확인은 머지 뒤 운영자가 Expo Go 로 한다.

## 완료 조건

- 데모 스냅숏을 만드는 함수가 `toSorted` 없는 런타임에서 돈다는 단위 시험이 통과한다.
- 모바일 코드나 `@ganger/api` 에서 `toSorted` 같은 ES2023 이후 내장 API 를 쓰면 `pnpm run typecheck` 가 실패한다.
