---
status: done
blocked_by: []
---

# 0214 Settings 개편: 페이지로 나누기, 겹침 없애기, 알림을 앱 안 페이지로

## 목표

Settings(`apps/web/src/settings/settings-page.tsx`)는 Workspace·프로젝트·연결·이 서버·기기 연결·서버 로그와 진단·고급을 한 페이지에 늘어놓고 왼쪽 목차로 건너뛴다. 같은 설정이 여러 곳에 겹친다. 데스크톱 알림 설정은 트레이 "알림 설정…"이 여는 따로 뜨는 창이고, 웹 Settings에는 그 창을 여는 줄만 있다(0211).

한 설정은 한 곳에만 두고, 메뉴 묶음이 적용 범위를 말하게 Settings를 페이지로 나눈다. 알림 설정 창은 없애고 웹 Settings 안 페이지로 옮긴다. 시안(운영자 승인): 보드 Main(알림), Connections, Workspace(일반), Projects, ProjectDetail, Devices, Server.

## 운영자 결정(2026-11-24)

1. Settings 메뉴와 페이지마다 자기 주소.
   - `Workspace · <이름>`: 일반(`/settings/general`) / 프로젝트(`/settings/projects`, 상세 `/settings/projects/$connectionId/$projectId`)
   - `설치 전체`: 연결(`/settings/connections`, 상세 `/settings/connections/$connectionId`) / 다른 기기(`/settings/devices`) / 서버(`/settings/server`) / MCP(`/settings/mcp`)
   - `이 Mac`: 알림(`/settings/notifications`, 데스크톱 앱 안에서만 메뉴에 보임)
   - 확인할 것이 있는 페이지는 메뉴 옆 빨간 점. `?ws=`는 그대로 잇는다.
   - `/settings`는 첫 페이지(일반, Workspace가 없거나 전체 보기면 연결)로, 예전 `/settings#<구역>` 링크는 맞는 페이지로 보낸다.
   - 화면 머리는 페이지 제목 하나. 보조 설명은 ⓘ 툴팁.
2. 일반: 이름, 최대 실행 시간, 그 아래 에이전트 지시(운영자 확인 뒤 합침). Workspace 없음/전체 보기 안내도 여기.
3. 연결: Linear 머리에 "+ Linear 연결 더하기", 맨 위 "webhook 받을 주소" 한 줄(모든 Linear 연결이 같이 씀), 연결마다 상자(이름 + 다시 확인, API 키 + 키 바꾸기(값·상태 글 없음), webhook + 상태 문장 + 설정). 상태 알약과 러너 줄은 없앤다. GitHub: gh 계정 줄 + 계정 보기, 토큰 줄(ⓘ) + 토큰 넣기/바꾸기.
4. 프로젝트: 머리 "+ 트래커 프로젝트 넣기", 트래커 연결별 묶음("<연결> 연결"), 묶음 맨 위 바로 할당 라벨(프로젝트 상세에서 옮김), 그 아래 프로젝트 줄 → 상세.
5. 프로젝트 상세: 이동 경로 "프로젝트 › <연결> 연결", 저장소, Linear 티켓 상태, 이 Workspace에서 빼기.
6. 다른 기기: 맨 위 열 주소(자동 허용 tailnet 주소 포함), 그 아래 연결한 기기와 QR.
7. 서버: 버전과 업데이트, 잠들지 않게, 로그와 진단.
8. MCP: Settings 메뉴 안 페이지.
9. 에이전트 지시: 처음에는 따로 페이지(`/settings/brief`)로 두었다가, 운영자 확인(2026-11-24) 뒤 일반 페이지의 이름·최대 실행 시간 아래로 합쳤다. 메뉴 항목은 없애고 `/settings/brief`는 `/settings/general`로 보낸다.
10. 알림: 데스크톱 별도 창을 없애고 웹 Settings 안 페이지로. 권한 상태 카드, 알림 받기 스위치와 들여 쓴 종류 5개. 트레이 "알림 설정…"은 메인 창을 열고 `/settings/notifications`로 보낸다. 권한 묻는 시점(앱 켤 때 묻지 않음)은 0211 그대로.
11. 시안에 없는 새 기능은 넣지 않는다.
12. (범위 추가, 운영자 승인 2026-11-24) 연결 상세의 "Linear에서 webhook 만들기" 단계에 Linear 폼 칸별 값(Label, URL, Data change events, 팀)을 짧게 보이고 긴 설명은 ⓘ로. "signing secret 넣고 켜기" 단계는 Linear가 webhook을 만든 뒤 보여 준 signing secret(lin_wh_…)이고 API 키와 다른 값이라고 드러낸다.

## 고친 방법

- `packages/ui`: `SettingsNav`(묶음 이름 + 페이지 링크, `aria-current="page"`, 문제 점), `SettingsRow inset`(딸린 줄 들여 쓰기), `PageHeader titleId`(다른 화면에서 옮겨 온 뒤 제목에 포커스). DESIGN.md·`/ds`·시험을 같이 고쳤다.
- `apps/web`: `settings.tsx`가 공통 데이터를 읽는 레이아웃 라우트가 되고 페이지마다 자식 라우트를 둔다. 서버 페이지 파일은 `settings.[server].tsx`다(`*.server.*` 파일은 클라이언트에서 import를 막는 규칙 때문). 페이지 화면은 `workspace-pages.tsx`, `projects-page.tsx`, `connections-page.tsx`, `devices-page.tsx`, `server-page.tsx`, `notifications-page.tsx`, 틀과 메뉴는 `settings-frame.tsx`.
- 알림: `@ganger/app/notifications/desktop`에 알림 설정 스키마를 모으고, preload가 서버 화면에 설정 읽기·저장·권한 요청·시험 알림·시스템 설정 열기·다시 연결을 연다(controller는 서버 화면에서 온 요청만 받는다). 트레이·앱 메뉴·알림 클릭은 `openDesktopPage`로 메인 창을 띄우고 `desktop:open-page`를 보낸다. 창 렌더러·창 옵션·창 메시지는 지웠다.

## 할 일

- [x] 메뉴와 페이지 라우트, `/settings` 기본 이동과 예전 해시 링크 이동
- [x] 일반(에이전트 지시 포함)·프로젝트·프로젝트 상세·연결·연결 상세·다른 기기·서버·MCP·알림 페이지
- [x] webhook 받을 주소를 연결 페이지 한 줄로, 연결 상세 webhook 단계는 주소를 보여 주고 그 줄로 안내
- [x] 바로 할당 라벨을 프로젝트 묶음으로 옮기고 상세에서 빼기
- [x] 알림 창 없애고 웹 페이지로, 트레이가 메인 창의 알림 페이지를 엶
- [x] webhook 만들기 단계의 Linear 폼 칸별 값과 signing secret 안내
- [x] 예전 `/settings#…` 링크를 쓰는 곳 고치기(Dashboard PR 탭, 새 Workspace 만들기 뒤 이동)
- [x] 시험: 페이지별 렌더(메뉴 현재 표시, 빨간 점), 기본 이동과 예전 해시 이동, 라벨이 프로젝트 묶음에 있고 상세에 없음, webhook 주소를 연결 페이지 한 줄에서 저장, API 키 줄에 키 값 없음, 다른 기기의 열 주소, 서버의 로그, 알림 페이지(다리 있음/없음, 권한 상태별, 스위치 저장), 트레이가 메인 창 알림 페이지를 엶(가짜 포트)

## 결정에 없던 경계 사례

- 브라우저에서는 `이 Mac` 묶음을 메뉴에서 숨기고, `/settings/notifications`로 직접 오면 "알림은 Ganger 데스크톱 앱에서 받아요." 한 줄을 보인다.
- Workspace가 없거나 전체 보기면 `Workspace` 묶음에 일반만 남기고, 에이전트 지시·프로젝트 주소로 직접 오면 일반과 같은 안내를 보인다.
- 연결 페이지의 빨간 점은 연결 없음, webhook 서명 실패, GitHub 미연결, 읽지 못한 PR만 본다. 러너 줄을 없애면서 러너 수·Runner Issue는 점 조건에서 뺐다(레일 Runners가 보인다).
- 연결 상세 라우트는 남겼다. 이름 바꾸기와 webhook 단계(만들기·secret·끄기)를 둔다. API 키는 연결 페이지에서만 바꾼다.
- 예전 `#project-<연결>-<프로젝트>` 링크는 프로젝트 페이지의 그 줄로, `#connection-<id>`는 그 연결 상세로 보낸다.
- `/settings`는 해시를 서버가 모르므로 화면이 뜬 뒤 브라우저에서 한 번만 맞는 페이지로 옮긴다(앱 안에서 `/settings`로 가도 같다). 라우트 `beforeLoad`에서 옮기면 hydration 뒤 다시 도는 읽기가 해시를 잃고 일반으로 한 번 더 보내 쓰지 않았다.
- 트레이 "알림 설정…"을 눌렀을 때 서버 화면이 아직 없으면(모드 고르기 같은 앱 화면) 창만 띄운다. 서버 화면을 읽는 중이면 다 읽은 뒤에 보낸다.
- 서버가 앱보다 오래돼 알림 페이지를 모르면(그 화면이 2초 안에 듣지 않으면) 없는 주소로 옮기지 않고 "이 서버에서는 알림 설정을 열 수 없어요 · 서버를 업데이트하면…" 안내 창을 띄운다(독립 리뷰 지적). 옛 서버 웹 Settings의 알림 줄은 바뀐 다리 모양을 읽지 못해 "데스크톱 앱에서 받아요" 한 줄로 보인다.
- 알림 페이지의 "다시 연결" 결과 문장(role="status")에 포커스를 둔다(창에서는 제목에 두었다).
