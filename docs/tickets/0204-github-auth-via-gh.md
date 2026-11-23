---
status: done
blocked_by: []
---

# 0204 GitHub 인증을 서버 기계의 gh 로그인 우선으로

지금 Ganger 서버는 Settings·온보딩에 붙여 넣은 GitHub 토큰 하나로 PR을 읽고(0200) 머지한다(0201, [ADR 0024](../adr/0024-operator-merges-pr-from-ganger.md)). Orca는 그 기계의 GitHub CLI 로그인을 `gh auth token --user <계정>`으로 빌려 쓴다(gh 2.40 이상). Ganger도 같은 방식을 기본으로 하고 토큰 붙여 넣기는 대체 수단으로 남긴다. 회사·개인 GitHub 계정을 함께 쓸 때 토큰 하나만 넣을 수 있던 문제도 이걸로 푼다.

## 운영자 결정 (2026-11-23)

1. 서버 기계의 `gh`(서버 프로세스를 돌리는 사용자의 로그인)를 먼저 쓴다. gh가 없거나 로그인이 없거나 그 계정이 저장소를 볼 수 없으면 Settings에 붙여 넣은 토큰을 쓴다. 둘 다 안 되면 지금처럼 PR을 읽을 수 없다고 안내한다.
2. gh 계정이 여럿이면 저장소를 볼 수 있는 계정을 자동으로 고른다. 못 고르면 활성 계정. 저장소별로 손으로 묶는 설정은 넣지 않는다. 고른 결과는 캐시하되 실패하면 다시 고른다.
3. 서비스·원격 서버는 그 서버를 돌리는 사용자의 gh 로그인만 쓴다. 없으면 Settings·온보딩에 "이 서버 기계에서 `gh auth login`을 하거나 토큰을 붙여 넣어 주세요"를 안내한다.
4. gh 토큰에 머지 권한이 없으면 0201처럼 버튼을 끈다. 붙여 넣은 토큰으로 넘어가지 않는다. 출처 전환은 1번 규칙(없음·로그인 없음·저장소 접근 불가)에서만 한다.
5. 화면: 온보딩 2단계 제목 "GitHub에 연결해요", 설명에 gh를 먼저 쓴다는 말. 상태 A(gh로 연결됨, 계정 목록과 각 계정이 볼 수 있는 곳, 활성 표시, 다시 확인), B(gh 로그인 없음, `gh auth login` 복사 칸, 다시 확인), C(gh 없음, 토큰 칸 펼침). 모든 상태에 "대신 토큰 붙여 넣기" 펼침. 토큰 칸 안내는 읽기만은 읽기 권한, 머지까지는 Pull requests·Contents 쓰기 권한. Settings의 GitHub 구역도 같은 모양이다.

- gh 호출은 `gh --version`, `gh auth status`, `gh auth token` 같은 공식 명령만 고정 인자로 부르고, 출력은 경계에서 zod로 파싱한다. gh 버전이 낮으면(`--user` 없음) 활성 계정 하나만 쓰고 그 사실을 화면에 적는다. 토큰 값은 로그·화면·MCP 응답에 내보내지 않는다.
- 데모(`demo/`)에서 세 상태를 볼 수 있게 가짜 gh를 둔다.
- 인증 출처 순서와 이유는 새 ADR로 남긴다([ADR 0025](../adr/0025-github-auth-prefers-gh-login.md)).

## 한 일

- `packages/codehost-github`: `gh-cli.ts`(gh 찾기·버전·상태·토큰 읽기), `auth.ts`(`GitHubAuth`: 출처 순서, 저장소별 계정 고르기와 캐시, 화면용 상태). `GitHubCodeHost`는 호출마다 저장소에 맞는 자격을 받는다. 저장 연결에 토큰이 없어도 만들고, 토큰만으로 확인할 때는 `config.credentials = "token"`을 준다.
- `packages/app`: `settings/github-auth.ts`(`loadGitHubAuthView`, `checkGitHubConnection`). gh 로그인으로 다시 확인하면 토큰 없는 코드 호스트 연결을 저장해 온보딩 GitHub 단계를 마친다. 설치 설정에 `githubConnected`(연결 있음)를 더하고 `githubToken`은 붙여 넣은 토큰이 있는지로 바꿨다.
- web: 온보딩 GitHub 단계와 Settings GitHub 줄이 같은 `GitHubAuthPanel`을 쓴다. `packages/ui`의 `Disclosure`에 `defaultOpen`을 더했다.
- MCP `check_github_token`이 같은 확인을 쓴다. 도구 이름은 그대로다.
- 데모는 `GANGER_DEMO_GH`(`connected`·`logged-out`·`missing`)와 개발 도구 페이지의 "서버 기계의 gh 상태 바꾸기"로 세 상태를 보인다. e2e는 `GANGER_GH_CLI`를 없는 경로로 두어 이 기계의 gh를 쓰지 않는다.

## 완료 조건

- [x] 출처 순서 시험: gh 있음, 로그인 없음, gh 없음, 저장소 접근 불가 → 토큰.
- [x] 계정 자동 고르기 시험(두 계정·저장소 주인), 캐시와 실패 뒤 다시 고르기.
- [x] 낮은 gh 버전 시험, 권한 없음은 넘어가지 않는 시험.
- [x] 토큰이 화면 상태·오류에 나오지 않는 시험(가짜 gh 실행기).
- [x] 화면 시험: 온보딩·Settings 세 상태, 토큰 펼침.
- [x] ADR, `docs/guide` gh 로그인 안내.
- [x] 스크린숏: A·B·C, Settings.
