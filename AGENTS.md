# AGENTS.md

트래커의 티켓을 러너에 맡기고 런의 현황과 통계를 보여 주는 셀프호스팅 오케스트레이터 저장소다. 제품 소개는 [README.md](README.md), 구조와 명령은 [CONTRIBUTING.md](CONTRIBUTING.md), 설치·운영은 [`docs/guide/`](docs/guide/), 출시는 [`docs/releasing.md`](docs/releasing.md), 용어는 [GLOSSARY.md](GLOSSARY.md), 주요 결정은 [`docs/adr/`](docs/adr/)를 본다.

## 작업 근거

- 작업 전에 README, CONTRIBUTING, 대상 코드, 관련 테스트와 ADR을 확인한다. 현재 동작은 코드와 테스트로 확인하고, 설계 의도나 완료 상태를 추측해 단정하지 않는다.
- 용어는 GLOSSARY를 따르고 `_Avoid_`에 적힌 낱말은 쓰지 않는다. 같은 것을 여러 이름으로 부르면 코드와 화면이 어긋난다.

## 문서 위치

- 낱말 정의는 [GLOSSARY.md](GLOSSARY.md)에 둔다.
- 되돌리기 어려운 결정과 그 이유는 `docs/adr/NNNN-slug.md`에 둔다.
- 조사·스파이크 결과는 `docs/research/NNNN-slug.md`에 둔다.
- 일감은 트래커가 아니라 `docs/tickets/NNNN-slug.md` 로컬 티켓으로 관리한다. 형식은 [`docs/tickets/README.md`](docs/tickets/README.md)를 따른다.
- 내부 설계 문서(GLOSSARY, ADR, 티켓)는 한국어로, README, CONTRIBUTING과 사용자 문서(`docs/guide/`, `docs/releasing.md`)는 영어로 쓴다(ADR 0005).

## 공개 저장소

이 저장소는 공개 오픈소스이고, 다른 사람이 설치해 자기 환경으로 설정해 쓰는 제품이다(ADR 0005).

- 실명, 이메일, 호스트명, tailnet 주소, 기기 이름, 계정, 로컬 경로, 토큰을 코드·문서·설정·커밋 메시지 어디에도 넣지 않는다. 공개 이력에 한 번 들어간 값은 지우기 어렵다.
- 환경 값은 설정으로 받는다. 예시에는 가상 값(`example.com`, `acme`)을 쓴다.

## 작업 흐름

- 기본 브랜치는 `develop`이다. 작업은 최신 `develop`에서 짧게 사는 기능 브랜치로 하고 `develop`으로 PR한다([ADR 0017](docs/adr/0017-develop-branch-flow.md)).
- `main`과 `develop`은 PR 머지로만 바꾼다. 직접 push하지 않는다. 예외는 release-bot 앱이 `main`을 `develop`에 다시 합치는 것뿐이다.
- `main`으로 가는 PR은 출시(`release/v<version>`, Prepare release가 `develop`에서 딴다)와 hotfix(`hotfix/*`, `main`에서 딴다)뿐이다. CI 잡 `main-pr`(`.github/workflows/main-pr.yml`)이 다른 브랜치와 최신 `main`을 담지 않은 브랜치를 막는다. `main`에 머지되면 버전이 바뀐 경우 자동으로 릴리스된다.
- `develop`은 언제나 `main`의 모든 커밋을 담는다. `main`에 무엇이 머지되든 Sync develop 워크플로가 `main`을 `develop`에 다시 합치고, 충돌이면 `sync/main-to-develop` PR을 연다. 그 PR을 먼저 푼다.
- PR은 머지 커밋으로 병합한다. squash·rebase 병합은 쓰지 않는다.
- `main`과 `develop`에 머지하려면 CI `check`가 통과해야 한다. CI 잡 `static`은 typecheck → lint(디자인 시스템 규칙 포함: `apps/web`의 글자·면·색·움직임 토큰 import와 `button`·`input`·`select`·`textarea`·`table`·`h1`~`h3` 직접 사용 금지) → 색 검사(`pnpm run check:colors`) → 길이 값 검사(`pnpm run check:lengths`) → format check → 단위 시험(`e2e`·`demo` 밖 vitest project) → build → 웹 프로덕션 실행 시험(`pnpm run smoke:web`) → CLI 실행 시험(`pnpm run smoke:cli`) → 서버 배포물 만들기(`pnpm run bundle`) → 서버 배포물 실행 시험(`pnpm run smoke:bundle`)을 돈다. 같은 때 잡 `browser`가 `e2e`·`demo` 브라우저 시험을 shard 4개로 나눠 돈다(`vitest --shard`, 티켓 0143). 나누는 기준은 `scripts/browser-test-times.json`의 파일별 시간이고, 성공한 CI 실행으로 `pnpm run update:browser-times <run-id>...`를 손으로 가끔 돌려 다시 잰다(티켓 0158). 잡 `check`는 모든 잡을 기다려 하나라도 실패·취소되거나 건너뛰면 실패한다. `.md` 파일만 바꾼 변경은 다른 잡을 건너뛰고 `check`가 통과한다. 문서의 형식 검사는 커밋 훅이 맡는다. `docs/research/fixtures/`의 JSON은 시험 입력이라 건너뛰지 않는다.
- PR 본문의 머지 위험이 one-way이고 blast radius가 큼인 PR은 자동으로 병합하지 않고 사람이 직접 병합한다. 그 밖의 PR은 게이트(독립 리뷰와 CI `check`)를 통과한 뒤 병합할 수 있다.
- 커밋 훅(lefthook pre-commit: lint, format check, typecheck, 색 검사, 길이 값 검사)을 우회하지 않는다. `--no-verify`를 쓰지 않는다.
- 새 워크트리에서는 커밋 전에 `pnpm install`을 돌린다. 훅이 `node_modules`의 도구를 쓴다.

## TypeScript와 워크스페이스

- Node 24(`.nvmrc`, `engines`)와 `package.json` `packageManager`의 pnpm을 쓴다.
- pnpm 워크스페이스다. 앱은 `apps/*`(`web`, `worker`, `cli`, `desktop`), 공유 패키지는 `packages/*`(`core`, `db`, `ui`)에 둔다. 개발 진입점(`pnpm dev`는 데스크톱 앱, `pnpm dev:web`은 브라우저, 티켓 0140)의 가짜 어댑터·시드는 `demo/`에만 두고 제품 앱이 import 하지 않는다(티켓 0047). 데스크톱 앱은 개발 서버 주소를 환경 변수 `GANGER_DESKTOP_DEV_SERVER`로만 받는다. 패키지별 typecheck는 Turborepo가 돌린다.
- 공용 설정 `tsconfig.base.json`은 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`를 켠다. 패키지 설정에서 끄지 않는다.
- oxlint type-aware 모드가 `no-explicit-any`, `no-unsafe-*`, `no-floating-promises`, `switch-exhaustiveness-check`를 error로 막는다. 경고도 실패다.
- 외부 입력(webhook, ssh로 받은 출력, API 응답, 환경 변수)은 경계에서 스키마로 파싱해 타입을 얻는다. `as` 단언으로 타입을 붙이지 않는다. 단언은 검증 없이 타입만 바꿔 잘못된 값이 안쪽까지 들어온다. 스키마 검증기는 스파이크에서 zod로 확인했다([`docs/research/0001`](docs/research/0001-web-stack-spike.md)).
- 코드에 주석을 쓰지 않는다. 기존 코드에도 주석이 없다. 설명이 필요하면 테스트, 함수·변수 이름, 코드 구조로 드러내고 테스트로 검증한다. 주석은 코드와 따로 유지보수해야 하고 최신인지 보장되지 않아, 에이전트가 낡은 주석을 근거 삼아 엉뚱한 작업을 한다. 테스트와 이름은 코드와 함께 검증된다.
- 예외는 도구가 요구하는 지시문이다(`oxlint-disable`, `@ts-expect-error`, `/// <reference>`, `@vitest-environment`, 번들러 매직 주석, JS 파일의 JSDoc 타입 주석 등).

## UI

- 화면 구조는 목록 + 오른쪽 상세 패널이다(ADR 0007).
- 상태 이름·색·버튼·시간 표기·제목·둥글기와 Dashboard·Run 상세·Runners·온보딩의 바뀐 구조는 [ADR 0010](docs/adr/0010-ui-words-and-visual-rules.md)을 따른다.
- 화면 문구는 컴포넌트에 직접 쓰지 않고 메시지 파일로 분리한다(ADR 0005). 나중에 뽑아내는 일은 화면이 늘수록 비싸진다.
- 한국어 문구는 해요체 UX 라이팅으로 쓴다.
- 디자인 시스템(`packages/ui`)이 생기면 토큰과 컴포넌트를 거기서 먼저 찾아 쓴다(ADR 0003).
- `apps/web` 화면은 [`packages/ui/DESIGN.md`](packages/ui/DESIGN.md)의 역할과 컴포넌트만 쓴다. 글자·면·색·움직임 토큰 import, 직접 쓴 `button`·`input`·`select`·`textarea`·`table`·`h1`~`h3`, px·rem·em 길이는 lint와 `check:lengths`가 막는다. 필요한 속성이나 모양이 없으면 화면에서 우회하지 않고 `packages/ui`를 넓힌다.
