# 모바일 디자인 시스템

Ganger iOS 앱의 토큰과 컴포넌트 규칙이다. 웹의 `packages/ui`를 가져오지 않고 따로 둔다(스펙 [0002](../../docs/spec/0002-mobile.md) M1·M20). 낱말과 상태 색의 뜻은 웹과 같다([ADR 0010](../../docs/adr/0010-ui-words-and-visual-rules.md), [브랜드 가이드](../../packages/ui/brand/README.md)).

## 토큰

토큰은 `src/design/tokens.ts` 한 파일에 둔다. 색 값을 직접 쓸 수 있는 앱 파일은 이것뿐이고, `pnpm check:colors`가 나머지를 막는다. React Native는 oklch를 못 써서 웹 토큰을 sRGB로 바꾼 값을 적는다. `tokens.test.ts`가 웹 토큰·브랜드 가이드의 값과 같은지 비교하므로, 웹 색이 바뀌면 이 시험이 실패한다.

| 토큰      | 값                                                            |
| --------- | ------------------------------------------------------------- |
| 둥글기    | 카드 10, 버튼·세그먼트 바깥 8, 세그먼트 안 6, 시트 16, 알약 6 |
| 글꼴      | Pretendard Regular·Medium·SemiBold                            |
| 누르는 곳 | 최소 44                                                       |

## 색

- 상태 색은 ADR 0010 5번을 따른다. 보라는 사람이 답·허용, 청록은 사람이 확인, 빨강은 문제, 초록은 진행·정상, 파랑은 성공, 회색은 대기·멈춤이다.
- 뜻을 모르는 상태(`unknown`)는 어떤 상태 색도 빌리지 않고 컨트롤 면과 비활성 글자색을 쓴다.
- 노랑(Ganger Yellow)은 주 버튼, 고른 칸, 처리할 일 배지, 대상 링크(`ExternalLink`, ADR 0010 2026-11-25 갱신)에만 쓴다. 상태 색으로 쓰지 않는다.
- 노랑 위 글자는 Ink다.

## 컴포넌트

`src/design/components.tsx`와 `src/design/text.tsx`에 있다. 화면은 여기 있는 것을 쓰고, 없는 모양이 필요하면 화면에서 우회하지 않고 여기를 넓힌다.

| 컴포넌트        | 쓰는 곳                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Text`          | 모든 글자. `variant`로 역할을, `tone`으로 색을 고른다                                                                                                                                                                                                                                    |
| `Card`          | 런·러너 카드. 멈춘 기다림과 러너 문제는 `emphasis="problem"`                                                                                                                                                                                                                             |
| `Segment`       | Dashboard의 Queued · Running · Done                                                                                                                                                                                                                                                      |
| `TodoBadge`     | 처리할 일이 있는 칸에만 붙는 노란 수                                                                                                                                                                                                                                                     |
| `IssueBadge`    | Runners 버튼의 문제 러너 수. 버튼 전체를 빨갛게 하지 않는다                                                                                                                                                                                                                              |
| `StatusPill`    | 점 + 상태 이름. 카드 하나에 상태 하나만 보인다. 모르는 값은 `unknown`                                                                                                                                                                                                                    |
| `Chip`          | 선행 티켓과 PR 칩. CI 실패·충돌은 `problem`, 뒤처짐은 중립색. 런 상세 PR 상자는 Merged에 `merged`, CI 통과에 `progress`를 쓰고 첫 줄 높이를 맞추려 `size="row"`(22)를 쓴다                                                                                                               |
| `ExternalLink`  | 대상 자체가 링크인 이름(런 상세의 "PR #412"). 노란 글씨, 굵게, ↗. 줄 높이는 그대로 두고 `hitSlop`으로 누르는 곳을 44 가까이 넓힌다                                                                                                                                                       |
| `RaisedBox`     | 시트 안에서 한 대상을 묶는 상자(런 상세 PR 상자). 시트와 같은 `bgRaised` 면에 `borderDefault` 테두리(안의 무채색 칩 면과 갈리도록), 안쪽 여백 14, 안 간격 12                                                                                                                             |
| `SplitButton`   | 방식을 고를 수 있는 주 행동 하나(런 상세 PR 상자의 머지). 노란 면 하나에 높이 44, 둥글기 button. 왼쪽 넓은 칸은 행동 이름(Ink, 굵게), 오른쪽 44 칸은 ⌄(12, 방식 목록 열기), 사이에 Ink 25% 세로선(위아래 10 띄움). 방식이 하나면 ⌄ 칸 없이 버튼 하나다. 꺼지면 컨트롤 면에 비활성 글자다 |
| `Button`        | `primary`는 화면의 주 행동 하나, 카드 행동은 `secondary`, 위험은 `danger`. 답하지 않은 Question 카드의 "답하기"는 `answer`, Human Check 카드의 "확인하기"는 `check`(알약과 같은 색 계열, 티켓 0221)                                                                                      |
| `BackButton`    | 하위 화면 머리의 뒤로 버튼                                                                                                                                                                                                                                                               |
| `Meter`         | 러너의 공급자 사용량 막대                                                                                                                                                                                                                                                                |
| `SwitchRow`     | 한 줄을 다 쓰는 스위치(설정). 이름은 왼쪽, 스위치는 오른쪽 끝                                                                                                                                                                                                                            |
| `InlineSwitch`  | 다른 글 옆에 두는 스위치. 이름과 붙어 있고 이름을 눌러도 바뀐다                                                                                                                                                                                                                          |
| `TextField`     | 이름이 붙은 입력. 답·덧붙일 말은 `multiline`을 쓴다                                                                                                                                                                                                                                      |
| `RadioRow`      | 질문 선택지와 머지 방식 고르기(팝오버가 생기기 전까지 `Sheet` 안). 모두 같은 모양이고 고르기만 해서는 보내지 않는다                                                                                                                                                                      |
| `TextLink`      | 글 안의 웹 주소. 노랑을 쓰지 않고 밑줄로 보인다                                                                                                                                                                                                                                          |
| `CameraFrame`   | QR을 읽는 카메라 미리 보기의 정사각형 틀                                                                                                                                                                                                                                                 |
| `NoticeBand`    | 화면 맨 위 연결 문제 띠("n분 전 기준", Host 거절, 업데이트 안내)                                                                                                                                                                                                                         |
| `Sheet`         | 아래에서 올라오는 레이어. 안의 주 행동 하나는 노란 버튼을 쓸 수 있다                                                                                                                                                                                                                     |
| `SheetBody`     | `composed` 시트의 스크롤 영역                                                                                                                                                                                                                                                            |
| `SheetFooter`   | `composed` 시트 아래에 고정한 안내와 보내기                                                                                                                                                                                                                                              |
| `RestingMascot` | 빈 상태에만 쓴다. 목록 행, 상태 알약, 러너 문제 카드 곁에 두지 않는다                                                                                                                                                                                                                    |

## 문구

화면 문구는 `messages/ko.json`에 둔다(ADR 0005). 상태 이름은 GLOSSARY의 영어 용어이고, 설명 문장은 해요체다. Dashboard 머리 요약과 Queued 이유는 웹 `apps/web/messages/ko/home.json`의 문장과 같게 쓴다.

## 데모 데이터

앱 안 데모 데이터는 `src/demo/`에 둔다. 저장소의 `demo/` 패키지를 import 하지 않는다(M44, 티켓 0047). Dashboard와 Runners 데이터는 `@ganger/api`의 `V1Dashboard`, `V1Runner` 모양이고, 화면은 모르는 값까지 담는 `AppDashboard`, `AppRunner`로 읽는다.

## 서버 연결

연결과 갱신은 `src/connection/`에 둔다. 기기 토큰은 iOS 키체인(`expo-secure-store`, 이 기기에서만)에 두고, Expo web에서는 메모리에만 둔다. 개발 연결은 `__DEV__`일 때만 `EXPO_PUBLIC_GANGER_DEV_SERVER`·`EXPO_PUBLIC_GANGER_DEV_TOKEN`을 읽는다. ATS 예외는 `GANGER_MOBILE_BUILD=development`일 때만 `app.config.ts`가 더한다.

마지막 Dashboard와 런 상세의 디스크 캐시는 `src/connection/offline-cache.ts`에 둔다(M56). iOS는 백업되지 않는 캐시 폴더에 쓰고, Expo web은 탭을 닫으면 사라지는 `sessionStorage`에 쓴다. 캐시 내용은 읽을 때 `@ganger/api`의 `app*` 스키마로 다시 검사한다.
