---
status: done
blocked_by: []
---

# 0229 모바일: iOS 앱 아이콘을 브랜드 아이콘으로

## 배경

- 운영자가 EAS 개발 빌드([0227](0227-mobile-eas-dev-build.md))를 실기기에 설치해 보니(2026-11-25) 앱 아이콘이 Expo 기본인 흰 바탕이었다. `apps/mobile/app.json`에 `icon`이 없었다.
- 브랜드 원본은 `packages/ui/brand/app-icon.svg`(1024 정사각, 모서리 없음, 배경 + 호루라기 몸통·마우스피스 층)이다. `pnpm --filter @ganger/desktop brand-assets`(`apps/desktop/scripts/brand-assets.ts`)가 이 원본에서 데스크톱·웹 아이콘을 만들지만 모바일 출력은 없었다.

## 할 일

1. 같은 원본에서 iOS 앱 아이콘을 만든다. 1024×1024 PNG, 알파 없음(App Store 요구), 모서리는 iOS가 그려 정사각이다. 기존 brand-assets 스크립트에 모바일 출력을 더해 한 원본 → 여러 출력 규칙을 지킨다. 출력은 `apps/mobile/assets/`에 둔다.
2. `app.json`에 아이콘을 건다. iOS 18의 어두운·색조 아이콘을 넣을지 정한다.
3. 브랜드 README의 출력 목록에 모바일 출력을 적는다.

## 결정

- **스크립트**: 새 스크립트를 만들지 않고 `brand-assets.ts`에 모바일 출력 셋을 더했다. 데스크톱 `AppIcon.icon`이 쓰던 몸통·마우스피스 층 추출과 캔버스(`translate(194.56 174.08) scale(6.5536)`)를 함께 쓴다.
- **설정 키**: Expo SDK 58의 `ios.icon`에 `{ light, dark, tinted }` 객체를 건다(`@expo/config-types` 58의 `IOSIcons`). 플랫폼이 iOS와 web뿐이라 최상위 `icon`은 두지 않는다. `ios.icon`이 최상위 `icon`보다 앞선다.
- **어두운·색조 아이콘을 넣는다.** 근거:
  - SDK 58의 `withIosIcons`가 `dark`·`tinted`를 `AppIcon.appiconset`의 `luminosity` 모양으로 넣는다. 넣지 않으면 iOS가 밝은 아이콘에서 알아서 만든다.
  - 색조 모양을 iOS에 맡기면 노란 마우스피스와 흰 몸통이 밝기만 남아 섞인다. 브랜드 README가 노랑을 못 쓰는 곳에 쓰는 한 색 마크(`mark-mono.svg`)와 같은 모양을 직접 주는 쪽이 의도에 맞다.
  - 원본의 층을 다시 쓰므로 그림을 새로 그리지 않고, 원본을 고치면 스크립트 한 번으로 셋이 함께 바뀐다.
- **각 출력의 모양**:
  - `icon.png`: 원본 그대로, 불투명 RGB.
  - `icon-dark.png`: 배경 층을 뺀 몸통·마우스피스(원래 색), 투명 바탕. Apple 지침대로 iOS가 어두운 바탕을 깐다. Expo도 dark만 투명도를 남긴다.
  - `icon-tinted.png`: 원본 배경색 바탕에 몸통·마우스피스를 몸통 색(Paper) 한 색으로, 불투명 RGB. Expo가 tinted의 투명한 곳을 흰색으로 채우므로 투명 바탕을 쓰면 흰 마크가 사라진다.
- **Liquid Glass(`.icon`)는 이번에 넣지 않는다.** SDK 58은 `ios.icon`에 `.icon` 폴더를 받지만, 그러면 PNG 아이콘 셋을 쓰지 않고 빌드에 Xcode 26이 필요하다. 이 티켓은 흰 기본 아이콘을 브랜드 아이콘으로 바꾸는 범위로 둔다.

## 후속 후보

- 스플래시(`expo-splash-screen`, 지금은 배경색만)에 마크를 넣기.
- iOS 26 Liquid Glass 아이콘(`.icon`): 데스크톱 `AppIcon.icon`의 `supported-platforms`에 iOS를 더해 같은 문서를 쓰는 방안.

## 완료 조건

- [x] `pnpm --filter @ganger/desktop brand-assets`가 `apps/mobile/assets/icon.png`·`icon-dark.png`·`icon-tinted.png`를 만든다.
- [x] 시험(`apps/mobile/app-icon.test.ts`): `app.json`의 `ios.icon`이 세 파일을 가리키고, 밝은·색조 아이콘은 알파 없는 1024 정사각 PNG, 어두운 아이콘은 알파 있는 1024 정사각 PNG다.
- [x] `npx expo config --type public --json`의 `ios.icon`에 세 경로가 나온다.
- [x] 브랜드 README 「App icon」 출력 목록에 모바일 출력을 적었다.
- [ ] 실기기 아이콘은 새 EAS 빌드가 있어야 보여 운영자가 머지 뒤 확인한다.
