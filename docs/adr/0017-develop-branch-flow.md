# 기능 작업은 develop에 모으고 main은 출시와 hotfix로만 바꾼다

0087부터 버전이 바뀐 PR이 `main`에 머지되면 태그와 Release가 저절로 나온다. 그런데 기능 PR도 모두 `main`으로 가서, 출시할 때 `main`에는 아직 함께 내고 싶지 않은 변경이 섞여 있었다. 운영자와 정했다(2026-11-19, 티켓 [0114](../tickets/0114-develop-branch-flow.md)).

## 결정

- **기능 작업의 베이스는 `develop`이다.** `develop`이 저장소 기본 브랜치다. 기능 PR은 `develop`으로 간다.
- **`main`은 출시와 hotfix로만 바뀐다.** 출시는 Prepare release가 `develop`에서 `release/v<version>`을 따 버전을 올리고 `main`으로 여는 PR이다. hotfix는 `main`에서 딴 `hotfix/*`를 `main`으로 바로 PR한다. 버전을 올린 hotfix는 Prepare release의 `source` 입력으로 그 브랜치에 버전 커밋을 더한다. `main`에 머지되면 0087의 Tag release → `release.yml`이 그대로 릴리스한다. 버전이 안 바뀐 머지는 태그를 만들지 않는다.
- **`develop`은 언제나 `main`의 모든 커밋을 담는다.** Sync develop 워크플로가 `main` push마다 release-bot 앱 토큰으로 GitHub merges API를 불러 `main`을 `develop`에 머지 커밋으로 합친다. 충돌이면 `develop`에 아무것도 넣지 않고 `sync/main-to-develop` → `develop` PR을 열어 사람이 푼다.
- **`main`으로 가는 PR은 CI 잡 `main-pr`이 지킨다.** head가 이 저장소의 `release/*`나 `hotfix/*`이고 최신 `main`을 담아야 통과한다. 뒤처진 `develop`에서 딴 출시가 hotfix를 덮어쓰지 않게 한다. `develop`이 원격에 없으면 건너뛰어, 이 흐름을 들이는 PR과 그 전의 PR을 막지 않는다.
- **hotfix 브랜치의 코드는 앱 토큰으로 실행하지 않는다.** Prepare release는 `develop`에서 돌고, 자기 체크아웃의 `scripts/release-version.ts`로 hotfix 체크아웃의 버전 파일만 바꾼다. `hotfix/*`는 보호되지 않는 브랜치라 그 코드를 돌리면 쓰기 권한만 있는 사람이 앱의 태그·`develop` 우회 권한에 닿는다.

## 고려한 대안

- **`main` 하나로 계속 간다.** 단순하지만 출시 때 섞인 변경을 골라낼 수 없다.
- **출시 브랜치를 오래 둔다(git-flow의 release 단계).** 안정화 기간이 필요할 만큼 크지 않다. `release/v<version>`은 버전 PR 하나로만 산다.
- **역병합을 사람이 한다.** 잊으면 `develop`이 hotfix를 잃고, 다음 출시가 그 hotfix를 덮어쓴다. 그래서 자동으로 하고 `main-pr`로 한 번 더 막는다.
- **역병합을 `GITHUB_TOKEN`으로 한다.** 그 push는 CI를 시작하지 않고, 보호된 `develop`을 우회할 수 없다.

## 결과

- release-bot 앱 권한이 넓어진다. Workflows read and write가 더해진다(워크플로 파일이 바뀐 `main`을 `develop`에 합치려면 필요하다). 앱은 `develop` 보호 ruleset의 bypass에 들어가, PR 없이 `develop`에 머지 커밋을 넣을 수 있다. `release-bot` environment는 `main`과 `develop` 둘에서 쓸 수 있다. 그래서 `develop`에 머지할 수 있으면 앱 토큰에 닿는다. `develop`도 `main`처럼 PR과 `check`로만 바뀌게 보호한다.
- 0087의 신뢰 경계("`main`에 머지할 수 있으면 서명할 수 있다")는 그대로다. 서명 secret은 `v*` 태그만 쓰는 `release` environment에 남는다.
- `main-pr`은 PR이 열릴 때, 새 커밋이 올 때, 베이스를 바꾸는 등 PR을 고칠 때 돈다. `develop`으로 연 PR의 베이스를 `main`으로 바꿔도 다시 돈다. PR이 열린 동안 `main`이 움직이는 경우는 `main` 보호의 "branches up to date"가 그 브랜치에 `main`을 합치게 한다.
- 저장소 설정(기본 브랜치, `develop` 보호, `main` required check에 `main-pr`과 up to date 요구, 앱 권한, environment 배포 브랜치)은 [`docs/releasing.md`](../releasing.md) "Automatic releases"의 단계로 운영자가 한다.
