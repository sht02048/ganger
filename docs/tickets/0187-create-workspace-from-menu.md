---
status: done
blocked_by: []
---

# 0187 Workspace 메뉴에서 새 Workspace 만들기

Workspace가 하나라도 있으면 새 Workspace를 만드는 길이 없었다. Settings의 "Workspace 만들기"는 Workspace가 없을 때만 보이고, 레일의 Workspace 바꾸기 메뉴에는 Workspace 목록과 "전체"만 있었다(운영자 보고 2026-11-22).

## 운영자 결정 (2026-11-22)

- 메뉴: "전체" 아래 구분선, 맨 끝에 "+ 새 Workspace"(더하기 아이콘 + 글, 메뉴 항목). 전체 보기에서 열어도 같다.
- 누르면 그 자리에서 대화상자를 연다. 이름과 넣을 트래커 프로젝트를 고른다. 버튼은 "닫기"와 "만들기"다.
- 다른 Workspace에 있는 트래커 프로젝트는 흐리게, 고를 수 없게 두고 "{Workspace}에 있어요"라고 쓴다. 이름과 프로젝트 하나 이상이 있어야 만들 수 있다.
- 고를 수 있는 프로젝트가 하나도 없으면 "모든 트래커 프로젝트가 다른 Workspace에 있어요. Settings에서 빼면 넣을 수 있어요."를 보이고(Settings는 링크) 만들기를 막는다.
- 만든 뒤 새 Workspace로 바꾸고 Settings의 프로젝트 구역으로 간다. 알림은 "{이름} Workspace를 만들었어요"다.
- 입구는 이 메뉴 하나다. Workspace가 없을 때 Settings의 "Workspace 만들기"는 남기되 같은 대화상자를 연다. 처음 설치의 온보딩 4단계는 그대로다.
- 범위 밖: Workspace 지우기, 트래커 프로젝트를 다른 Workspace로 옮기기. 이름 바꾸기는 지금처럼 Settings에서 한다.

## 결정

- 온보딩의 `setUpFirstWorkspace`는 Workspace가 있으면 첫 Workspace를 고쳐 써서 재사용할 수 없다. 코디네이터 답(2026-11-22)대로 얇은 서버 함수 둘만 더한다. `createWorkspace`는 항상 새 id로 만들고, 프로젝트 묶기 검사를 온보딩과 같은 코드로 한 트랜잭션에서 하며, 서버에서도 프로젝트 하나 이상을 요구한다. `getWorkspaceProjectChoices`는 `loadTrackerProjectChoices(context, null)`을 그대로 부른다.
- 두 함수는 다른 서버 함수와 같이 서버 입구의 `guardRequest`(Host·Origin 검사)를 지난다. DB 스키마와 온보딩 동작은 바꾸지 않는다.
- 기본 `MenuSeparator`의 색(`borderSubtle`)은 메뉴 면(`bgRaised`)과 같아 선이 보이지 않는다. 기존 사용처를 바꾸지 않도록 선택 속성 `strong`(`borderDefault`)을 더해 Workspace 메뉴에만 쓴다.

## 경계 사례

- 같은 이름의 Workspace는 지금 저장 규칙처럼 막지 않는다.
- 대화상자를 연 사이 다른 곳에서 프로젝트를 가져가면 서버가 `taken`으로 거절하고, 문구를 보인 뒤 목록을 다시 읽는다.
- 한 트래커 연결을 읽지 못하면 "모든 프로젝트가 다른 Workspace에 있어요"라고 단정하지 않고 읽지 못했다고 보인다.
- 트래커 연결이 없으면 Settings 링크가 있는 안내를 보이고 만들기를 막는다.
- 보내는 동안에는 대화상자를 닫을 수 없다. 저장한 요청의 결과를 놓치지 않기 위해서다.
- Settings에 저장하지 않은 편집이 있으면 Workspace는 만들고 대화상자를 닫되, 이미 경고를 받은 편집이어도 새 Workspace로 옮기지 않고 편집 칸에 머문다. 초안이 새 Workspace의 저장 대상으로 넘어가지 않고, 새 Workspace는 메뉴에서 고를 수 있다.
- 온보딩의 Settings 돌아가기(0181)는 그대로 둔다. Settings의 빈 상태가 더는 온보딩으로 보내지 않아 지금은 `from=settings` 주소로 직접 열 때만 보인다.

## 완료 조건

- 단위: 메뉴 항목, 이름·프로젝트 검증, 다른 Workspace 프로젝트 비활성, 고를 것 없음 안내, 만든 뒤 Workspace 바뀜·Settings 이동·알림, Settings 빈 상태 입구가 같은 대화상자.
- 브라우저: 메뉴 → + 새 Workspace → 이름·프로젝트 → 만들기 → 새 Workspace의 Settings. 부하 5회.
- 스크린숏: 메뉴, 대화상자, 고를 것 없음.
