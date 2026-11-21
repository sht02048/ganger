---
status: done
blocked_by: []
---

# 0169 squash·rebase 머지된 PR의 워크트리 지우기

## 목표

대상 저장소가 squash·rebase 머지를 쓰고 머지 때 원격 브랜치를 지워도, 런의 PR이 머지되면 worker가 워크트리를 지운다.

## 배경

운영자 보고(2026-11-22). 다른 프로젝트에서 Ganger가 만든 런 워크트리 2개가 PR 머지 뒤에도 남았다. 두 PR 모두 squash 머지였고 머지 때 원격 브랜치가 지워졌다. 워크트리의 커밋과 squash 커밋의 patch-id가 같아 잃을 작업은 없었다.

지우기 전 확인(스펙 [0005](../spec/0005-run-outcome.md) 10절, R7-1)은 `git rev-list --count HEAD --not --remotes`로 어느 원격 추적 브랜치에도 없는 커밋을 센다. squash·rebase 머지는 새 커밋을 만들어 원래 커밋이 base에 들어가지 않고, 원격 브랜치가 지워지면 원래 커밋은 어디에도 없어 `unpushed-commits`로 남는다.

## 운영자 결정(2026-11-22)

스펙 0005 3절의 R8을 따른다.

## 할 일

- [x] 러너의 `checkWorktreeWork`가 워크트리의 HEAD를 함께 돌려준다(Orca 러너, 가짜 러너).
- [x] worker가 PR이 머지된 런에서 HEAD와 PR head가 같으면 원격에 없는 커밋을 남길 이유로 보지 않는다.
- [x] 스펙 0005의 머리말, 3절, 10절에 R8을 적는다.

코드 호스트는 고치지 않는다. `PullRequestSnapshot.headCommit`이 이미 있고 GitHub 어댑터가 zod로 파싱한 `headRefOid`를 넣는다. head 커밋은 기존 JSON 기록 `runs.pr_signals`에 저장돼 DB 마이그레이션이 없다.

## 완료 조건

- [x] squash 머지 + 원격 브랜치 지워짐 + HEAD가 PR head와 같음 → 지운다.
- [x] HEAD가 PR head와 다름 → `unpushed-commits`로 남긴다.
- [x] 커밋하지 않은 변경 → 남긴다.
- [x] PR이 머지되지 않고 닫힘 → R7-1대로 남긴다.
- [x] head 커밋을 모름 → R7-1대로 남긴다.
- [x] 일반 머지 → 지금처럼 지운다.

## 범위 밖

이미 `worktree_kept = unpushed-commits`로 적힌 런은 다시 판정하지 않는다. 운영자는 Run 상세의 워크트리 지우기를 쓴다.
