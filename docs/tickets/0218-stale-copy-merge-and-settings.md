---
status: done
blocked_by: []
---

# 0218 낡은 안내 문구 고치기: "Ganger는 머지하지 않아요"와 0214 전 Settings 메뉴 이름

## 목표

앱·모바일 차이 점검(2026-11-25)에서 지금 사실과 다른 안내 문구를 찾았다. 문구만 고친다. 화면 구조와 기능은 바꾸지 않는다.

1. ADR 0024(티켓 0201)부터 운영자가 Ganger에서 PR을 머지한다. 그런데 Human Check 답하기 안내(웹 `question.json` `after`, 모바일 Human Check 시트 `after`)가 아직 "Ganger는 머지하지 않아요."라고 한다.
2. 티켓 0214로 Settings가 페이지로 나뉘어 "기기 연결"·"주소" 메뉴가 없어졌다. 지금은 Settings › 다른 기기 페이지에 "열 주소"와 QR이 있고, webhook 받을 주소는 Settings › 연결 페이지 맨 위에 있다. 낡은 이름을 가리키는 문구가 웹(`hostBlocked`, `runnerSetup`), 데스크톱(`screens`), 모바일(연결 화면, host-blocked 두 곳), 서버의 Host 거절 본문(`Settings > Addresses`)에 남아 있다.
3. 모바일 알림 종류 이름 "Failed·Disconnected"를 웹과 같은 "Failed · Disconnected"로 맞춘다.

## 할 일

- [x] Human Check 안내에서 "Ganger는 머지하지 않아요." 문장을 빼고 웹·모바일을 같은 문장으로 맞추기
- [x] "Settings › 주소", "Settings > 주소", "Settings › 기기 연결", "Settings > Addresses"를 지금 페이지 이름(Settings › 다른 기기의 열 주소, webhook 받을 주소는 Settings › 연결)으로 고치기
- [x] runnerSetup의 `invalid-webhook-address`에 남은 _Avoid_ 낱말 "webhook 공개 주소"를 "webhook 받을 주소"로
- [x] 모바일 알림 종류 이름 띄어쓰기
- [x] 이 문구를 기대하는 시험 기대값 고치기

## 범위 밖

- 모바일 화면 제목 "설정", 낡은 데이터 띠 "n분 전 기준"(스펙 0002 M31)은 그대로 둔다.
- 문구가 아닌 시험 이름·DESIGN.md 설명의 "Failed·Disconnected"는 화면 문구가 아니라 그대로 둔다.

## 완료 조건

- 관련 단위 시험(모바일 vitest, 웹·`packages/app` 해당 시험)이 통과한다. 스크린숏은 필요 없다.
