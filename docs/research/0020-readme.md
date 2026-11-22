# Ganger README 다시 쓰기 조사

조사일 2026-11-21. 대상 저장소 `develop`(5611703)의 `README.md`. 저장소는 읽기만 했다.
표시: **[확인]** 파일·페이지를 직접 읽어 확인한 사실, **[추론]** 그 사실에서 끌어낸 판단·제안.
비교 README 원문은 `gh api repos/<owner>/<repo>/readme`로 받아 읽었고 저장소에는 넣지 않았다(줄·낱말 수는 `wc` 기준).

## 1. 지금 README (441줄, 7,885 낱말) [확인]

| 구역                                                     | 줄      | 낱말  | 담은 것                                                                                                 | 성격                                                                                                                                    |
| -------------------------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 머리(마스코트·워드마크) + 한 줄 소개                     | 1–10    | ~70   | "foreman of your software factory" 한 문장, 브랜드 가이드·GLOSSARY·ADR 링크                             | 새로 온 사람용. 다만 스크린샷·설치 링크 없음                                                                                            |
| Structure                                                | 11–30   | 273   | `apps/*`·`packages/*`·`e2e`·`demo` 표와 Started/Stub/Planned 상태                                       | 기여자용 참조. 이미 낡았다: "Planned"라 적은 `tracker-linear`·`runner-orca`·`codehost-github`가 실제로 있고, `packages/log`는 표에 없다 |
| Getting started                                          | 31–39   | 32    | Node 24, `nvm use`, `pnpm install`                                                                      | 사실상 _기여자_ 설정. 사용자 설치 경로가 아니다                                                                                         |
| Commands                                                 | 40–60   | 244   | `pnpm` 스크립트 14개 표, 브라우저 시험 설명                                                             | 기여자 참조                                                                                                                             |
| └ Development                                            | 61–84   | 1,015 | `pnpm dev`/`dev:web` 옵션, `/__dev`, Query devtools, `.dev/` 경로, worker 단독 실행, 훅·CI 잡 순서·샤드 | 기여자 how-to + 참조. README에서 가장 빽빽한 곳                                                                                         |
| Self-hosting 머리                                        | 85–98   | 414   | 배포물 미공개 안내, 설치 모형, 다른 Mac을 러너로 붙이는 두 방법, PR 제목 권고, `.env` 범위              | 설명 + how-to 섞임                                                                                                                      |
| └ Build a server bundle                                  | 99–120  | 183   | `pnpm bundle`, tarball 풀기, 업그레이드                                                                 | 운영자 how-to                                                                                                                           |
| └ Set up and start                                       | 121–136 | 402   | `init`/`start`, lock 파일, 환경 변수 우선순위, `caffeinate` 잠자기                                      | how-to + 참조                                                                                                                           |
| └ Open it from other devices                             | 137–147 | 577   | 로그인 없음 경고, Tailscale Serve, Host 검사, web address                                               | 보안상 핵심 경고 + how-to                                                                                                               |
| └ Turn on the webhook (+Funnel/Cloudflare/Reverse proxy) | 148–198 | 866   | Linear webhook 주소, 세 가지 공개 방법                                                                  | how-to                                                                                                                                  |
| └ Run as a service                                       | 199–207 | 174   | launchd/systemd 등록                                                                                    | how-to                                                                                                                                  |
| └ Server logs                                            | 208–240 | 455   | JSONL 위치·회전, `jq` 예시 3개                                                                          | 참조                                                                                                                                    |
| └ Connect an MCP client                                  | 241–265 | 604   | `ganger mcp`, 읽기/쓰기 도구 범위, 감사 기록, Hermes 설정 예시                                          | 참조                                                                                                                                    |
| Desktop app 머리 + Install                               | 266–275 | 81    | dmg 내려받기 3단계                                                                                      | **새로 온 사람이 가장 먼저 필요한 것**인데 266줄째에 있다                                                                               |
| └ Updates                                                | 276–283 | 238   | 6시간 확인, Settings > 업데이트, 0.1.0 이하 수동 교체                                                   | 사용자 참조                                                                                                                             |
| └ Which setup to choose                                  | 284–291 | 224   | 상시 기계=서비스 / 노트북=로컬 모드 / 원격 모드                                                         | 설명. 사실 README 앞쪽에 와야 할 "어떻게 쓰나" 갈림길                                                                                   |
| └ Build and run it locally / Build a release dmg         | 292–318 | 301   | Electron 내려받기, `package`, 서명 변수                                                                 | 기여자·관리자                                                                                                                           |
| └ Make a release / Automatic releases                    | 319–412 | 1,291 | 버전 PR, Prepare/Tag release, release-bot 앱·ruleset `gh api` 명령                                      | **관리자 전용**. 사용자에겐 쓸모없다                                                                                                    |
| └ First launch                                           | 413–423 | 333   | 로컬/원격 모드 선택, Tailscale 목록, 알림 종류                                                          | 사용자 tutorial                                                                                                                         |
| Work items                                               | 424–427 | 16    | `docs/tickets/` 링크                                                                                    | 기여자                                                                                                                                  |
| Contributing                                             | 428–438 | 91    | 저장소 이름 변경 후 `git remote set-url`                                                                | 일시적 안내. 기여 방법 자체는 없음                                                                                                      |
| License                                                  | 439–441 | 3     | MIT                                                                                                     | 유지                                                                                                                                    |

요약 [추론]

- 새로 온 사용자에게 필요한 내용(무엇인가, 어떤 모습인가, dmg 설치, 첫 실행, 갈림길)은 합쳐 ~700낱말이고 나머지 ~90%는 운영 참조·기여자·관리자 문서다.
- 설치 경로가 뒤집혀 있다: 첫 "Getting started"가 기여자용 `pnpm install`이고, 사용자 설치(dmg)는 266줄째다.
- 스크린샷이 없다. `docs/research/fixtures/0011/*.png`는 시험 입력이라 README에 쓰면 안 된다(AGENTS.md: fixtures는 시험 입력).

## 2. 비교한 README

| 저장소              | 줄/낱말     | 첫 화면                                                                       | 설치                                                                     | 자세한 내용                                                                                                              |
| ------------------- | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| stablyai/orca       | 339 / 1,838 | 로고+배지 6개, 굵은 한 줄 + 부제, "Download Orca" 링크, 히어로 스크린샷       | 다운로드 링크 + brew 한 줄(맥)                                           | 기능 13개를 짧은 문단+그림으로. 개발은 `.github/CONTRIBUTING.md` 한 줄 링크                                              |
| herdrdev/herdr      | 85 / 474    | 로고, 링크 줄(site·install·quick start·docs), 배지, 데모 영상, 굵은 한 줄     | `curl … \| sh` 한 줄 + 대안 한 줄 + 실행 `herdr`                         | "everything lives at herdr.dev/docs" 링크 줄. `agent instructions`(AGENTS.md·CONTRIBUTING.md 읽기) 구역, development 4줄 |
| supabase/supabase   | 288 / 1,133 | 로고, 한 줄, 기능 체크리스트(각 Docs 링크), 대시보드 스크린샷                 | README엔 없음 → docs                                                     | 셀프호스팅·설정 전부 docs 사이트                                                                                         |
| plausible/analytics | 143 / 1,627 | 아이콘, Live Demo·Docs·Contributing 링크 줄, 한 문단, 특징 5개, 대시보드 그림 | 클라우드 먼저, 셀프호스팅은 비교표 + 별도 저장소(community-edition) 링크 | 설치 절차 0줄                                                                                                            |
| coollabsio/coolify  | 252 / 1,359 | 배너, 배지, "What is" 3문단, 스크린샷 다수                                    | `curl … \| bash` 한 줄 + 설치 가이드·스크립트 링크                       | CLI·API·MCP 모두 docs 링크. 길이 대부분은 후원자 로고                                                                    |
| zed-industries/zed  | 48 / 298    | 배지 2개, 한 문장                                                             | 다운로드 링크 한 문장                                                    | 플랫폼별 빌드는 `docs/src/development/*.md` 링크 3개                                                                     |
| n8n-io/n8n          | 73 / 503    | 배너, 한 줄, 스크린샷, 능력 6개                                               | `curl` 한 줄 또는 `docker run` 두 줄 + 접속 주소                         | Resources 링크 목록                                                                                                      |
| astral-sh/uv        | 326 / 1,080 | 배지, 한 줄, 벤치마크 그림, Highlights 목록                                   | 설치 한 줄                                                               | 기능별 짧은 예시 + docs 링크. 길지만 전부 사용 예시                                                                      |
| oven-sh/bun         | 448 / 2,064 | 로고, "Read the docs →", What is                                              | 한 줄 + 대안                                                             | 길이 대부분은 docs 링크 목록(Quick links·Guides)                                                                         |
| juanfont/headscale  | 186 / 804   | 로고, 무엇인가·설계 목표                                                      | "Running headscale" = documentation 링크뿐                               | 셀프호스팅 정보 0줄, 개발 환경만 길다                                                                                    |
| tailscale/tailscale | 87 / 328    | 개요                                                                          | 빌드 방법                                                                | 사용법은 사이트 링크                                                                                                     |

뽑은 패턴 [확인 → 추론]

1. **첫 화면 = 이름·한 줄·그림·설치 링크.** orca·herdr·n8n·plausible·supabase 모두 첫 스크롤 안에 한 줄 소개와 스크린샷(또는 영상)이 있다. Ganger처럼 UI가 핵심인 앱은 그림 한 장이 문단 여럿을 대신한다 [추론].
2. **설치는 한 줄~세 단계.** 데스크톱 앱(orca, zed)은 "다운로드 링크 + brew" 한 덩어리, 서버(n8n, coolify)는 명령 한두 줄. 대안 경로는 한 줄에 몰거나 링크로 뺀다.
3. **셀프호스팅·설정 참조는 README 밖.** plausible·headscale·supabase·coolify 모두 README에는 링크만 둔다. 설치 위험(공개 노출 등)만 한두 문장 남긴다(headscale: reverse proxy 비권장 한 문단).
4. **기여자 내용은 CONTRIBUTING.md나 docs로.** orca·zed·n8n은 "Developing/Contributing" 한두 줄이 링크다. herdr는 development 4줄만 남겼다.
5. **배지는 0~6개**이고 라이선스·릴리스·CI 정도다. 없어도 좋은 README가 많다(tailscale, n8n, coolify 일부).
6. **문서 사이트가 없으면 repo 안 `docs/`로 링크한다**(zed의 `docs/src/development/*.md`, orca의 `.github/CONTRIBUTING.md`). Ganger는 문서 사이트가 없으니 이 방식이 맞다 [추론].
7. **에이전트용 안내 구역**(herdr `agent instructions`)은 Ganger처럼 에이전트가 작업하는 저장소에 맞는 작은 장치다 [추론].
8. 비교 대상 README는 50~450줄, 300~2,000낱말이다. 2,000낱말을 넘는 곳은 링크 목록·후원자 로고가 길이를 차지한다. 설명 산문이 7,900낱말인 README는 없다 [확인].

"hardr" [확인/추론]: GitHub에서 같은 이름의 에이전트 도구를 찾지 못했다. 이 저장소의 `docs/research/0009-herdr-runner.md`가 두 번째 러너 후보로 **herdr**(<https://github.com/herdrdev/herdr>, <https://herdr.dev/>)를 다룬다. 운영자가 말한 것은 herdr일 가능성이 높다 [추론]. 위 표의 herdr가 그것이다.

출처

- https://github.com/stablyai/orca · https://github.com/herdrdev/herdr · https://github.com/supabase/supabase
- https://github.com/plausible/analytics · https://github.com/coollabsio/coolify · https://github.com/zed-industries/zed
- https://github.com/n8n-io/n8n · https://github.com/astral-sh/uv · https://github.com/oven-sh/bun
- https://github.com/juanfont/headscale · https://github.com/tailscale/tailscale

## 3. 1차 자료의 지침 [확인]

- **GitHub Docs, About READMEs** (https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes): README는 무엇을 하는가·왜 쓸모 있나·어떻게 시작하나·어디서 도움을 받나·누가 관리·기여하나를 담는다. "A README should only contain information necessary for developers to get started using and contributing to your project. Longer documentation is best suited for wikis." 500 KiB 넘으면 잘린다. 제목으로 목차를 자동으로 만든다(따라서 손으로 쓴 목차가 필요 없다).
- **GitHub Docs, contributor guidelines** (https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors): CONTRIBUTING.md는 루트·`docs`·`.github`에 둘 수 있고, 이슈·PR을 열 때 링크와 Contributing 탭에 보인다. `.github` → 루트 → `docs` 순으로 찾는다.
- **Make a README** (https://www.makeareadme.com/): Name, Description, Badges, Visuals, Installation(+Requirements), Usage, Support, Roadmap, Contributing, Authors, License, Project status. 길면 지우지 말고 "consider utilizing another form of documentation rather than cutting out information". Usage는 가장 작은 예시만 두고 긴 예시는 링크한다.
- **Diátaxis** (https://diataxis.fr/start-here/): tutorial("takes a student by the hand"), how-to("addresses a real-world goal or problem"), reference("technical description"), explanation("context and background"). "Crossing or blurring the boundaries ... is at the heart of a vast number of problems in documentation." 지금 README의 Self-hosting·Development는 how-to·reference·explanation이 한 문단에 섞여 있다 [추론].

## 4. Ganger 제안 [추론]

### 4.1 목표 README 구성 (~130–170줄, ~900–1,200낱말)

| #   | 구역              | 길이  | 내용                                                                                                                                                                                                                                                 |
| --- | ----------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | 머리              | ~10줄 | 마스코트·워드마크(지금 것), 링크 줄: Download · Docs · Self-hosting · Contributing. 배지는 라이선스·최신 릴리스·CI 정도 0~3개                                                                                                                        |
| 1   | 한 줄 + 짧은 문단 | ~5줄  | "Ganger hands tracker tickets to coding agents on your own runners and shows every run." + 누구를 위한 것인가(자기 기계에서 돌리는 1인 운영자)                                                                                                       |
| 2   | 스크린샷          | 1장   | `pnpm dev` 시드 데이터의 Dashboard(개인 정보 없는 가상 값). `docs/assets/`에 새로 둔다. fixtures 그림은 쓰지 않는다                                                                                                                                  |
| 3   | How it works      | ~10줄 | Tracker(Linear) → Ganger(web+worker, SQLite) → Runner(Orca over ssh) → Code host(GitHub) 다섯 줄 목록이나 작은 그림. 용어는 GLOSSARY 링크                                                                                                            |
| 4   | Features          | 5–7줄 | 자동 할당, 런 상태·질문 답하기·취소, Stats, 데스크톱 알림·트레이, MCP 서버, 셀프호스팅(로그인 없음·tailnet 전제)                                                                                                                                     |
| 5   | Install           | ~15줄 | **Desktop (macOS, Apple silicon)**: Releases의 dmg 3단계 압축본. **Server (always-on machine)**: "build a server bundle → `ganger init` → `ganger start`" 세 줄 + docs/self-hosting.md 링크. 지금 "Which setup to choose"를 3줄 갈림길로 여기에 흡수 |
| 6   | First run         | ~8줄  | 로컬/원격 모드 고르기 → 온보딩(트래커 연결, GitHub 토큰, 러너, 워크스페이스) → 첫 티켓 할당. 자세한 것은 docs/desktop.md                                                                                                                             |
| 7   | Security note     | 2–3줄 | "The web app has no login. Keep it on 127.0.0.1 or a private network" — 꼭 README에 남길 경고(headscale 방식)                                                                                                                                        |
| 8   | Documentation     | ~10줄 | docs/ 링크 목록(아래 4.2)                                                                                                                                                                                                                            |
| 9   | Contributing      | ~5줄  | CONTRIBUTING.md 링크, `pnpm install && pnpm dev` 두 줄, AGENTS.md·GLOSSARY·ADR 링크(herdr의 agent instructions처럼)                                                                                                                                  |
| 10  | License           | 1줄   | MIT                                                                                                                                                                                                                                                  |

`Structure`·`Commands`·`Work items`는 README에서 빼고 CONTRIBUTING.md로 옮긴다. 저장소 이름 변경 안내(`git remote set-url`)는 기존 클론용 일시 안내라 CONTRIBUTING.md 끝이나 릴리스 노트로 옮기거나 지운다.

### 4.2 옮길 곳

문서 사이트가 없으니 `docs/` 아래 영어 사용자 문서로 둔다. 지금 `docs/`에는 adr·research·spec·tickets(한국어 내부 문서)만 있으므로, 섞이지 않게 `docs/guide/`(또는 `docs/user/`) 하위 폴더를 하나 두기를 권한다. 아래 경로는 그 전제다.

| 지금 README 구역 (줄)                                                                      | 옮길 곳                                                              | Diátaxis             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------- |
| Self-hosting 머리: 설치 모형, 배포물 미공개, `.env` 범위 (85–98)                           | `docs/guide/self-hosting.md` 앞머리                                  | explanation          |
| Self-hosting 머리: 다른 Mac을 러너로 붙이기 두 방법, PR 제목 권고 (85–98 일부)             | `docs/guide/runners.md`                                              | how-to               |
| Build a server bundle, Set up and start, Run as a service (99–136, 199–207)                | `docs/guide/self-hosting.md`                                         | how-to               |
| `init`/`start` 옵션, lock, 환경 변수 우선순위, `caffeinate` (121–136 목록)                 | `docs/guide/configuration.md` (CLI·환경 변수 참조 표)                | reference            |
| Open it from other devices, Turn on the webhook, Funnel·Cloudflare·Reverse proxy (137–198) | `docs/guide/networking.md` (web address·webhook 주소)                | how-to               |
| Server logs (208–240)                                                                      | `docs/guide/troubleshooting.md` (서버 로그, diagnostics bundle)      | reference/how-to     |
| Connect an MCP client (241–265)                                                            | `docs/guide/mcp.md`                                                  | reference            |
| Desktop app: Install·Updates·Which setup·First launch (266–291, 413–423)                   | `docs/guide/desktop.md` (README에는 요약만)                          | tutorial + reference |
| Desktop: Build and run it locally, Build a release dmg (292–318)                           | `CONTRIBUTING.md`의 "Desktop app" 절                                 | how-to(기여자)       |
| Make a release, Automatic releases (319–412)                                               | `docs/releasing.md` (관리자용, 영어)                                 | how-to               |
| Structure, Getting started, Commands, Development (11–84)                                  | `CONTRIBUTING.md` (구조 표·명령 표·`pnpm dev` 옵션·`/__dev`·CI 순서) | reference + how-to   |
| Work items (424–427)                                                                       | `CONTRIBUTING.md` 한 줄                                              | —                    |
| Contributing의 remote 변경 안내 (428–438)                                                  | `CONTRIBUTING.md` 끝 또는 삭제                                       | —                    |

`CONTRIBUTING.md`는 루트 또는 `.github/`에 둔다(GitHub가 PR·이슈 화면에 링크해 준다 [확인]). 루트에 두면 AGENTS.md에서 링크하기 쉽다 [추론]. 지금 `.github/`에는 PR 템플릿과 workflows만 있고 CONTRIBUTING.md는 없다 [확인].

### 4.3 함께 고칠 참조 [확인]

- `AGENTS.md` 3줄: "구조와 명령은 `[README.md](README.md)`" → 구조·명령이 CONTRIBUTING.md로 가므로 링크를 바꾼다.
- `AGENTS.md` 7줄: "작업 전에 README ... 확인" → "README와 CONTRIBUTING.md"로.
- `AGENTS.md` 작업 흐름의 CI 단계 목록은 README Development 끝 문단과 내용이 겹친다. 옮긴 뒤 한 곳(CONTRIBUTING.md)을 기준으로 삼으면 어긋남이 준다 [추론].
- `.github/workflows/prepare-release.yml:51`, `sync-develop.yml:48`, `tag-release.yml:45`: 오류 문구가 `Follow "Automatic releases" in README.md`라 `docs/releasing.md`로 바꿔야 한다.
- `docs/adr/0017-develop-branch-flow.md:25`: README "Automatic releases" 언급. ADR은 그때의 기록이라 본문은 두되, 위치가 옮겨졌다는 사실은 새 문서 쪽에서 알리면 된다 [추론].
- `GLOSSARY.md` 235·243·275·279·283: "화면·README에서는 ~로 쓴다" 표현. 낱말 규칙은 그대로 사용자 문서에도 적용되므로 "화면·사용자 문서"로 넓히면 된다 [추론].
- `demo/src/values.ts:30`의 "Read AGENTS.md and README.md"는 가짜 데이터 문구라 고칠 필요 없다.

### 4.4 쓸 때 지킬 것

- README·`docs/guide/*`·CONTRIBUTING.md·`docs/releasing.md`는 영어(ADR 0005). 내부 문서와 폴더를 섞지 않는다.
- 예시 값은 가상 값만: `example.com`, `acme`, `<owner>`. 지금 MCP 예시의 `/Users/you/.ganger`, `/opt/ganger-0.1.0` 같은 일반 경로는 괜찮지만 실제 tailnet·기기 이름은 넣지 않는다.
- 스크린샷은 데모 시드 데이터로 찍고 tailnet 주소·호스트명이 화면에 없는지 확인한다.
- 설치 경로는 하나를 먼저 보인다: dmg(사용자 대다수) → 서버 번들(상시 기계). 개발용 `pnpm dev`는 Contributing에만.
- 목표 총량: README ~150줄·~1,000낱말(지금의 약 1/7). 정보는 지우지 않고 옮긴다(Make a README 권고). 옮긴 문서 합계는 지금 분량과 비슷하다.
