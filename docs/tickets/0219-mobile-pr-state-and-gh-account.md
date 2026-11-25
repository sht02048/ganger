---
status: doing
blocked_by: []
---

# 0219 모바일 런 상세에 PR 상태·읽기 진단, Runners에 러너 gh 계정 보이기

## 배경

앱·모바일 차이 점검(2026-11-25) 결과다. 모바일이 쓰는 v1 계약(`packages/api`)은 0194 뒤로 바뀌지 않았고, 그 뒤 웹에 생긴 것이 모바일에 없다.

- 모바일 런 상세의 PR 구역은 번호·CI·문제 칩·열기만 보인다. v1 런 상세 `pullRequest`에 PR 상태가 없어, 병합됐거나 닫힌 PR도 상세에서는 "CI 통과"로만 보인다(카드 줄은 "병합됨"을 보인다).
- v1 Dashboard에 `prReadError`가 있지만 런 상세에는 없고, 웹이 0207로 보이는 PR 읽기 실패 진단(러너와 서버의 gh 계정 차이)도 없다.
- 웹 Runners는 0205·0207로 러너의 gh 계정과 만료 표시를 보인다. v1 runners 계약에는 없다.

## 운영자 결정 (2026-11-25)

모바일도 이 셋을 보인다.

1. 런 상세 PR 구역의 PR 상태(열림·병합됨·닫힘)와 런이 끝난 뒤 병합·닫힘을 본 시각.
2. PR을 읽지 못한 이유와 웹 0207과 같은 진단 문장.
3. Runners 러너 카드의 gh 계정과 만료 표시.

## 할 일

1. v1 계약을 넓힌다(`packages/api`).
   - 런 상세 `pullRequest`에 `state`(`open`·`merged`·`closed`·`unknown`)와 `stateSince`(`{ at, agoMs }`, 런이 끝난 뒤 병합·닫힘을 본 때)를 더한다.
   - 런 상세에 `prReadError`(`no-access`·`other`)와 `prReadDiagnosis`(0207 진단)를 더한다. PR을 읽지 못한 런은 PR 기록이 없을 수 있어 `pullRequest` 밖 최상위에 둔다.
   - runners의 러너에 `ghAccounts`(읽은 때, 상태, 계정 목록과 사용 중·만료)를 더한다.
   - 서버는 웹이 쓰는 모델과 진단 함수(`loadRunDetail`의 `serverGitHub`, `ghAccountsView`)를 그대로 써서 매핑한다.
2. 호환 범위(0194): 더하기만 하는 변경이라 `CONTRACT_VERSION`을 2로 올리고 `MIN_CLIENT_CONTRACT_VERSION`과 앱의 `MIN_SERVER_CONTRACT_VERSION`은 1로 둔다. 앱 스키마는 새 필드가 없는 계약 1 서버 응답도 읽는다(없으면 보이지 않는다).
3. 모바일 런 상세 PR 구역에 상태·시각·읽기 실패 이유·진단을, Runners 러너 카드에 gh 계정과 만료 표시를 보인다. 문구는 웹 `run.json`·`runners.json`·`domain.json`의 0205·0207 문구에 맞춰 `apps/mobile/messages/ko.json`에 둔다. 데모 데이터에 각 경우를 넣는다.
4. 스펙 `docs/spec/0002-mobile.md`의 Runners 설명과 M37을 고친다.

## 완료 조건

- [ ] v1 매핑 단위 시험: PR 상태·시각, 읽기 실패와 진단, 러너 gh 계정(토큰 없음)
- [ ] 앱 스키마 시험: 새 필드, 계약 1 서버 응답(새 필드 없음), 모르는 값
- [ ] 모바일 화면 시험: PR 병합됨·닫힘·읽기 실패와 진단, 러너 gh 계정 만료
- [ ] 데모에 각 경우
- [ ] 스펙 0002 Runners·M37
