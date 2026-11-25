---
status: done
blocked_by: []
---

# 0230 Settings "다른 기기"를 "모바일"로: Tailscale 켜기 버튼 하나로 휴대폰 연결

## 배경

- 휴대폰을 연결하려면 운영자가 서버 Mac에서 `tailscale serve`를 직접 돌리고, 나온 https 주소를 Settings › 다른 기기 › 열 주소에 붙여 넣은 뒤 QR을 띄워야 했다. 운영자가 번거롭다고 했다(2026-11-25).
- Ganger는 이미 이 Mac의 Tailscale 상태를 읽는다(`packages/app/src/tailscale.ts`, `tailnet-hosts.ts`, webhook Funnel 안내의 `funnel-setup.ts`).

## 확정 시안(운영자, 2026-11-25)

보드 3장(켜기 전, 켠 뒤, Tailscale 없음).

- Settings 사이드바 메뉴와 페이지 제목을 "모바일"로. 경로 `/settings/devices` → `/settings/mobile`, 옛 경로와 옛 해시 링크는 새 경로로 옮긴다(0214 방식).
- 페이지에는 상자 하나. 구역 제목 없음. "컴퓨터" 구역은 없다.
- 켜기 전(Tailscale 있음): 한 줄. 왼쪽 굵은 "휴대폰에서 이 Mac 열기" + ⓘ와 그 아래 초록 체크 "Tailscale 연결됨 · {이 Mac의 MagicDNS 이름}". 오른쪽 노란 [켜기] 하나.
- 켠 뒤: 첫 줄 "휴대폰에서 이 Mac 열기" ⓘ, 그 아래 모노 글꼴 주소 `https://{이름}` · 켜짐, 오른쪽 [끄기]. 그 아래 QR이 페이지 안에 바로 펼쳐진다(대화상자 아님): QR 그림 + 안내 세 줄 + [새 QR 만들기]. 그 아래 연결한 휴대폰 목록(이름, "{연결} 연결 · {마지막 접속}", [연결 끊기]).
- Tailscale 없음(설치 안 됨·로그아웃·꺼짐): 제목·설명, 번호 두 단계, [Tailscale 받기 ↗](공식 다운로드 페이지) [다시 확인].
- 주소를 직접 넣는 UI는 없다(운영자 결정). "주소 바꾸기"도 없다.

## 할 일

1. 서버: "휴대폰에서 열기" 켜기·끄기·상태 읽기. Funnel은 쓰지 않는다. 443을 다른 대상이 쓰면 덮어쓰지 않고 이유를 보인다. webhook Funnel(8443 등)과 겹치지 않는지 확인한다.
2. 쓰기는 다른 Settings 쓰기와 같은 Origin·Host 검사를 지난다. CLI는 인자를 배열로 넘기고 출력은 zod로 파싱한다.
3. 이미 열 주소가 저장된 설치(Tailscale이 아닌 주소 포함)는 그 값을 계속 Host 검사·QR에 쓴다. 화면에서는 켠 상태처럼 주소와 [끄기](= 열 주소 비우기)를 보인다.
4. 웹 화면을 시안대로 만든다. QR은 기존 기기 연결 QR 흐름을 페이지 안에 펼쳐 쓴다. 휴대폰 목록은 휴대폰만 보인다.
5. 데스크톱 앱이 이 페이지를 그대로 쓰는지 확인한다.
6. 문구·용어(GLOSSARY, 사용자 문서, 앱·웹·데스크톱의 "Settings › 다른 기기" 안내)를 "Settings › 모바일"로 맞춘다.

## 결정

- **Tailscale 명령**: 이 Mac의 Tailscale 1.104.4 `tailscale serve --help`와 공식 문서([Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve), [CLI](https://tailscale.com/kb/1080/cli))로 확인했다.
  - 켜기: `tailscale serve --bg --yes --https=443 http://127.0.0.1:<port>`. `--bg`는 끌 때까지 백그라운드로 남고, `--yes`는 대화형 물음을 건너뛴다. 대상 호스트는 webhook Funnel과 같은 규칙(`funnelTargetHost`: 모든 주소 바인드면 127.0.0.1)을 쓴다.
  - 끄기: `tailscale serve --https=443 off`. 문서대로 켤 때의 포트 플래그에 `off`를 붙여 그 설정만 끈다. `tailscale serve reset`은 다른 설정까지 지워 쓰지 않는다.
  - 상태: `tailscale status --json`(설치·로그인·MagicDNS 이름)과 `tailscale serve status --json`(443 쓰임). 두 출력 모두 기존 zod 스키마(`parseTailnetStatus`, `parseServeStatus`)로 읽는다.
  - CLI는 기존 `findTailscaleCli`(알려진 세 경로, `GANGER_TAILSCALE_CLI`)로 찾고 `execFile`에 인자 배열로 넘긴다.
- **443 판정**: 443의 Web 설정이 `/` 하나이고 그 Proxy가 이 서버 대상이며 Funnel·TCP가 아니면 "우리 것"이다. 비었으면 켜고, 우리 것이면 명령 없이 주소만 저장하고, 그 밖(다른 대상, 443의 webhook Funnel 등)이면 덮어쓰지 않고 쓰는 곳을 보인다. Serve 상태를 읽지 못하면 덮어쓸까 봐 켜지 않는다. 켠 뒤 상태를 다시 읽어 우리 것일 때만 열 주소를 저장한다.
- **webhook Funnel과 겹침**: webhook Funnel은 8443 → 10000 → 443 순으로 빈 포트를 고르므로(`FUNNEL_PORTS_BY_PREFERENCE`) 보통 겹치지 않는다. Tailscale은 한 포트를 Serve와 Funnel에 함께 쓰지 못하니, webhook이 443을 쓰면 휴대폰 열기는 켜지 않고 그 쓰임을 보인다.
- **HTTPS 승인**: tailnet에서 HTTPS 인증서를 켜지 않았으면 CLI가 `login.tailscale.com` 주소를 낸다. 출력에서 그 호스트의 https 주소만 골라 실패 이유 옆 링크로 보인다.
- **끄기와 잠김**: 열 주소를 비우면 그 주소로 연 화면이 막히므로, 그 경우 끄지 않고 이유를 보인다(`saveAddresses`의 locks-out과 같은 판정). 저장된 주소가 이 Mac의 MagicDNS 주소이고 443이 우리 것일 때만 Serve를 끄고, 다른 주소(옛 저장값)는 비우기만 한다. Serve를 끄지 못하거나 Serve 상태를 읽지 못하면 열 주소를 그대로 둔다.
- **옛 저장값**: 열 주소가 저장돼 있으면 Tailscale 상태와 상관없이 켠 상태로 보인다. Tailscale이 켠 주소가 아니면 ⓘ 설명을 바꾼다. https가 아니면 QR을 만들지 않고 이유를 보인다. 데이터는 지우지 않는다.
- **휴대폰만 보이기**: `devices`에 기기 종류 칸 `kind`('phone'|'desktop', NOT NULL default 'phone')를 더했다(운영자 승인 2026-11-25). `/v1/connect`(QR)는 phone, `register-desktop`은 desktop으로 넣는다. 마이그레이션은 기존 행 중 이름이 `Ganger 데스크톱 (%`인 것만 desktop으로 채운다(데스크톱 앱이 등록 때 쓰는 이름, 한국어 하나뿐). 앞으로는 `kind`로만 가른다.
- **끈 상태의 휴대폰 목록**: 시안은 켠 뒤에만 목록을 그렸지만, 끈 상태나 Tailscale 없음에서도 연결한 휴대폰이 있으면 상자 아래에 목록을 둔다. 기기 토큰은 열 주소와 상관없이 살아 알림을 받으므로, 잃어버린 휴대폰을 언제든 끊을 수 있어야 한다.
- **데스크톱 기기**: 목록에서 빠져 이 페이지에서는 끊지 못한다. 지우는 곳은 후속 후보다.
- **QR 펼침**: 켠 상태로 페이지를 열면 누르지 않아도 QR을 만든다. 남은 시간은 초마다 줄고, 10분이 지나거나 휴대폰이 연결되면 QR을 내리고 [새 QR 만들기]를 남긴다. 끄거나 페이지를 떠나면 열어 둔 코드를 취소한다.
- **자동 허용 주소 줄**: 시안이 상자 하나라 다른 기기 페이지의 "자동으로 허용했어요" 줄은 없앴다. 허용 동작은 그대로다.
- **디자인 시스템**: `SettingsRow`에 `detailTone="pass"`(초록 글 + 확인 표시)를 더했다. 기존 값은 바뀌지 않는다.
- **데스크톱 앱**: 메인 창이 웹 화면을 그대로 띄우고, 트레이·앱 메뉴·딥링크는 `/settings/devices`를 가리키지 않는다(`apps/desktop/src` 확인). 데스크톱 화면 문구의 "Settings › 다른 기기" 안내만 고쳤다.

## 완료 조건

- 서버 시험: 켜기·끄기·상태(가짜 CLI로 성공, 443 충돌, CLI 없음, 로그아웃, 실패), 열 주소 저장·비움, 옛 저장값 유지.
- DB 시험: 기존 DB에 마이그레이션 적용(기기 유지, 데스크톱 이름만 desktop), 빈 DB에 적용.
- 웹 시험: 세 상태 화면, QR 펼침, 휴대폰만 목록, 옛 경로 이동.
- 스크린숏: 세 상태(가짜 Tailscale 상태로).
