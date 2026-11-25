---
status: doing
blocked_by: [0219]
---

# 0220 모바일 런 상세에서 PR 머지하기

## 배경

ADR [0024](../adr/0024-operator-merges-pr-from-ganger.md)(티켓 0201)로 운영자는 Dashboard 런 패널 「PR」 탭과 MCP `merge_pr`로 런의 PR을 머지한다. 둘은 같은 핵심 함수 `mergeRunPullRequest`를 쓴다. 모바일에는 머지가 없고 스펙 [0002](../spec/0002-mobile.md) 2절 "할 수 있는 일"(M3)에도 없다. 0219가 v1 런 상세에 PR 상태를 더했다.

## 운영자 결정 (2026-11-25)

모바일에서도 런 상세의 PR 구역에서 PR을 머지한다.

## 할 일

1. v1 쓰기에 머지(`POST /api/v1/runs/:id/merge`)를 더한다. 같은 핵심 함수 `mergeRunPullRequest`를 쓰고, 다른 v1 쓰기와 같은 요청 번호·재전송 규칙(0194, ADR 0024 결정 7)을 따른다. 본문은 `requestId`, 고른 방식 `method`, 화면이 본 head 커밋 `expectedHead`다(ADR 0024 결정 2).
   - 거절 이유는 그 함수의 이유 값을 v1 거절 값에 더해 그대로 돌려준다. GitHub이 준 문장은 `error.message`에 싣는다. GitHub에 닿지 못한 거절(`unauthorized`, `rate-limited`, `network`)은 502, 없는 런은 404, 그 밖은 409다. 런은 있는데 GitHub에 PR이 없으면 런 없음과 가르려고 `pr-not-found`(409)로 돌려준다.
2. v1 런 상세 `pullRequest`에 `merge`(허용 방식, 레포 기본 방식, 막는 이유, 권한 거절, 본 head 커밋)를 더한다. 웹 「PR」 탭과 같은 `mergeViewOf`로 만들고, 다른 런이 워크트리를 이어받은 런과 열리지 않은 PR은 비운다.
   - 호환 범위(0194): 더하기만 하는 변경이라 `CONTRACT_VERSION`을 3으로 올리고 `MIN_CLIENT_CONTRACT_VERSION`과 앱의 `MIN_SERVER_CONTRACT_VERSION`은 1로 둔다. 앱 스키마는 `merge`가 없는 계약 1·2 서버 응답도 읽고(머지 버튼이 없다), 모르는 방식은 빼고 모르는 막는 이유는 `unknown`으로 읽는다.
3. 모바일 런 상세 PR 구역(0219가 만든 상자)에 머지 버튼을 둔다. ADR 0024 결정을 그대로 따른다.
   - 확인 단계 없이 바로 머지한다.
   - 막힌 PR은 버튼을 끄고 이유를 보인다. 권한이 없으면 버튼을 끄고 권한 거절 문장을 보인다.
   - 방식은 레포가 허용한 것만 보이고, 처음은 레포 기본이다.
   - 실패는 이유를 알린다. 머지하면 기다리는 Human Check에 같은 답이 간다(서버 함수가 한다).
   - 문구는 웹 「PR」 탭 문구(`apps/web/messages/ko/home.json`의 `home.sheet.pr.merge`)와 맞춰 `apps/mobile/messages/ko.json`에 둔다. 데모 모드에서는 보내지 않는다(기존 `demoAction` 규칙).
4. 스펙 0002(M3와 2절 "할 수 있는 일", 6절 읽기·쓰기, M37, 새 M57)와 ADR 0024(모바일 길 더하기), GLOSSARY Human Check를 고친다.

## 확정 시안 (운영자, 2026-11-25)

런 상세 PR 구역 상자 안, 첫 줄(PR 번호 링크·칩) 아래:

- 머지 버튼은 하나로 붙은 분할 버튼이다. 노란(accent) 면 하나, 높이 44, 둥글기 button. 왼쪽 넓은 칸은 '{방식} 머지'(예: 'Squash 머지', 글자 textOnAccent 굵게), 오른쪽 44 폭 칸은 ⌄ 아이콘(접근 이름 '머지 방식 바꾸기'), 사이에 얇은 세로선(textOnAccent 25% 정도, 위아래 10 띄움). 묶음 접근 이름은 '머지'. 레포가 허용한 방식이 하나면 ⌄ 칸 없이 버튼 하나다.
- ⌄를 누르면 허용 방식 목록을 연다.
- 버튼 바로 아래(6) 안내 문장(12, textTertiary): 기다리는 Human Check가 있으면 '머지하면 기다리는 Human Check에 "확인했어요"로 답해요'.
- 막힌 PR: 같은 자리에 꺼진 버튼(bgControl 면, textDisabled 글자)과 그 아래(6) 이유 문장(problem 색), 예 '충돌이 있어 머지할 수 없어요'.
- 첫 줄과 버튼 묶음 사이 12. 머지된·닫힌 PR에는 버튼이 없다.

## 완료 조건

- [ ] v1 머지 쓰기 시험: 성공, 막힘, head 바뀜, 같은 요청 재전송, 다른 방식으로 같은 요청, 허용하지 않은 방식, 없는 런, 잘못된 요청
- [ ] v1 런 상세 머지 정보 시험: 열린 PR, 막힘·권한 거절, 머지한 PR
- [ ] 앱 스키마 시험: 머지 정보, 계약 2 서버 응답(머지 정보 없음), 모르는 방식·막는 이유, 거절 문장
- [ ] 앱 쓰기 시험: 머지 요청 본문, 같은 머지 다시 보내기의 같은 ID, 거절 문장
- [ ] 모바일 버튼 시험: 켜짐·꺼짐·이유·실패 알림·데모에서 안 보냄
- [ ] 스펙 0002, ADR 0024, GLOSSARY
