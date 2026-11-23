---
status: doing
blocked_by: [0200]
---

# 0201 런 패널에서 PR 머지하기

Dashboard 런 패널의 「PR」 탭(0199)에서 운영자가 PR을 바로 머지한다.

## 운영자 결정 (2026-11-23)

1. 「PR」 탭 맨 위(탭 바로 아래)에 노란 split 버튼을 둔다. 왼쪽은 "{방식} 머지", 오른쪽 ▾는 방식 메뉴다. 레포가 허용한 방식만 보인다(Squash 머지, Merge commit, 허용되면 Rebase). 처음 골라진 방식은 레포 기본(GitHub `viewerDefaultMergeMethod`)이고, 허용 방식은 `mergeCommitAllowed`·`squashMergeAllowed`·`rebaseMergeAllowed`로 안다. 메뉴에 "레포 기본" 표시는 하지 않는다.
2. 누르면 확인 단계 없이 바로 머지한다("…머지할까요?" 문구 없음).
3. 레포 규칙이 막으면(CI 실패·충돌·보호 규칙) 버튼을 끄고, 이유는 아래 줄 목록의 빨간 줄로 보인다. 버튼 아래 따로 문장을 두지 않는다.
4. GitHub 토큰에 쓰기 권한이 없으면 버튼을 끄고 "토큰에 머지 권한이 없어요 · Settings에서 바꾸기"를 보인다. Settings GitHub 토큰 안내에 쓰기 권한(pull_requests·contents write)을 적는다.
5. 머지하면 그 런이 기다리는 Human Check에 "확인했어요 · 운영자가 PR을 머지했어요"로 자동 답한다.
6. MCP에도 `merge_pr` 쓰기 도구를 연다. 쓰기 허용 스위치 뒤에 두고 requestId와 작업 기록을 남기며, 도구 설명에 "되돌리기 어려우니 운영자에게 먼저 확인받는다"를 적는다. 화면과 같은 핵심 함수를 쓴다.
7. 운영자가 화면·MCP로 머지하는 기능은 ADR 0004(에이전트가 자기 PR을 머지)를 넓히는 결정이라 새 ADR로 남긴다(왜, 범위, 권한, Human Check 연결).
8. 머지 결과(성공·실패 이유)는 토스트와 「PR」 탭 갱신으로 보인다. 런 결과(Succeeded 등) 판정은 ADR 0022 규칙을 따른다.

## 완료 조건

- [ ] 방식 메뉴(허용 방식만, 레포 기본 선택), 막힌 이유, 권한 없음 시험.
- [ ] 머지 성공·실패와 Human Check 자동 답 시험.
- [ ] MCP `merge_pr`의 쓰기 허용·requestId·작업 기록 시험.
- [ ] 새 ADR.
- [ ] 머지 버튼이 있는 「PR」 탭 스크린숏.
