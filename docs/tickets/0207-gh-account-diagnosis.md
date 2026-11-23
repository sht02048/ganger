---
status: done
blocked_by: []
---

# 0207 러너·서버 gh 계정 진단과 만료된 계정 표시

## 배경

0204(PR #263, [ADR 0025](../adr/0025-github-auth-prefers-gh-login.md))로 서버는 서버 기계의 gh 로그인을 먼저 쓰고, 0205(PR #262)로 러너의 gh 계정(`runners.gh_accounts`)을 읽는다. 두 PR이 남긴 후속이 둘이다.

1. 서버가 저장소(PR)를 읽지 못할 때 원인이 러너와 서버의 계정 차이인지 알려 주는 진단이 없다.
2. 로그인이 만료·실패한 gh 계정도 정상 계정처럼 보인다.

## 운영자 결정 (2026-11-24)

1. PR을 읽지 못한 런, Settings GitHub 구역, 런 패널 「PR」 탭의 읽기 실패 안내에 서버가 쓴 계정과 그 런 러너의 gh 계정을 함께 보인다. 예: "러너(runner-a)는 acme-dev, 서버는 my-personal 계정으로 읽어요. 서버 계정이 이 저장소를 볼 수 없어요." 계정이 같으면 계정 문장은 빼고 지금 안내만 둔다. 해요체, 메시지 파일.
2. 러너·서버 양쪽에서 `gh auth status`가 로그인 실패·만료로 알리는 계정은 "로그인이 만료됐어요"로 흐리게 보이고, 서버 쪽은 그 계정을 자동 고르기에서 뺀다. 러너 상세의 GitHub (gh) 구역과 Settings·온보딩 계정 목록 모두.
3. 토큰 값은 어디에도 내보내지 않는다(기존 규칙).

## 한 일

- `packages/codehost-github`: gh 계정에 `expired`를 더했다. `gh auth status --json`의 `state: "error"`와 글 출력의 `Failed to log in to github.com account …`를 만료로 읽는다. 시간이 끝난 계정(`timeout`)은 지금처럼 목록에서 빼고, 그 뒤의 `Active account` 줄이 앞 계정에 붙지 않게 했다. 만료된 계정은 자동 고르기, 저장소 없는 호출의 활성 계정, 토큰 읽기, 볼 수 있는 곳 읽기에서 모두 빠진다.
- `packages/runner-orca`·`packages/core`·`packages/db`: 러너 gh 계정에도 `expired`를 더했다. 저장한 JSON에 이 값이 없던 옛 행은 만료되지 않은 것으로 읽는다(열을 더하지 않아 마이그레이션은 없다).
- `packages/app`: `pr-read-diagnosis.ts`가 러너의 사용 중 계정과 서버가 쓰는 계정을 견준다. Dashboard 로더(`loadHomePage`의 `serverGitHub`)는 끝난 런에 `prReadDiagnosis`를 싣고, Settings의 `loadGitHubAuthView`는 러너별 `prReadDiagnoses`를 싣는다. web 서버는 저장소를 볼 수 없어 PR을 못 읽은 런이 있을 때만 gh 상태를 읽는다.
- web: 「PR」 탭 읽기 실패 안내 아래 진단 줄, Settings GitHub 패널의 "PR을 읽지 못한 러너" 목록, Settings·온보딩 계정 목록과 러너 상세 GitHub (gh) 구역의 만료 표시. 진단 문구는 두 화면이 함께 써서 `domain.json`에 둔다.

## 경계 사례

- 진단은 `prReadError`가 `no-access`일 때만 한다. `other`는 계정 차이가 원인이 아니라 지금 안내만 둔다.
- 서버 계정은 만료되지 않은 gh 계정 전부다. 쓸 gh 계정이 없거나 토큰만 쓰는 연결이면 "붙여 넣은 토큰"이라고 한다. gh 계정과 붙여 넣은 토큰이 함께 있으면 gh 계정 이름을 말한다. 서버 쪽 인증이 하나도 없으면 진단하지 않는다.
- 러너 계정은 github.com의 사용 중이고 만료되지 않은 계정이다. 그런 계정이 없으면(읽지 않음, gh 없음, 로그인 안 됨, 사용 중 계정 만료) "러너 gh 계정을 아직 몰라요"로 말한다.
- 서버 gh 계정 가운데 러너 계정과 이름이 같은(대소문자 무시) 계정이 있으면 계정이 같다고 보고 진단 문장을 뺀다.
- 모든 gh 계정이 만료되면 Settings·온보딩은 "gh 계정의 로그인이 모두 만료됐어요"와 `gh auth login` 명령을 보이고, 출처는 토큰이나 없음으로 본다.
- Run 상세 화면과 Runs 패널의 읽기 실패 안내는 이 티켓의 고칠 곳 밖이라 바꾸지 않았다.

## 완료 조건

- [x] 만료·실패 계정 파싱 시험(러너, 서버의 JSON·글 형식)
- [x] 만료 계정이 서버의 자동 고르기·활성 계정 대신 쓰기에서 빠지는 시험
- [x] 진단 문장 시험: 계정 다름, 같음, 러너 계정 모름
- [x] 토큰이 진단·화면 상태에 나오지 않는 시험
- [x] 화면 시험: 러너 상세·Settings 계정 목록의 만료 표시, PR 탭·Settings의 진단 문장
