---
status: done
blocked_by: []
---

# 0216 상대 시간 뒤에 붙은 낱말 빼기("Just now 확인" → "Just now")

## 배경

운영자가 2026-11-24에 "Just now 확인", "1 min ago 읽음"이 너무 이상하다고 보고했다. 영어 상대 시간(ADR 0010 7번, 티켓 0162) 뒤에 한국어 낱말 하나를 붙인 문구가 여러 화면에 있다.

- Runners 러너 상세: 머리의 확인 시각(`runners.panel.checkedAgo` "{time} 확인"), 부하·GitHub (gh)·사용량 구역의 읽은 시각(`readAgo` "{time} 읽음")
- Run 상세: PR 카드의 읽은 시각(`run.pr.readAt` "{time} 읽음"), 끝난 런 상태 줄의 끝난 시각(`run.when.endedAgo` "{time} 끝남")
- Runs 패널: PR 구역의 읽은 시각(`runs.panel.prSection.readAt` "{time} 읽음"), 끝난 런의 끝난 시각(`runs.panel.endedAgo` "{ago} 끝남 · {duration} 걸림")
- Settings 러너 확인: 확인 시각(`settings.runners.check.checkedAt` "{time} 확인")
- Dashboard 런 시트 머리: 끝난 시각(`home.sheet.since.ended` "{ago} 끝났어요")
- `/ds` 미리보기 PanelSection 예시: `ds.signals.meta` "5 min ago 읽음", `ds.usage.panelMeta` "3 min ago 읽었어요"(`packages/ui/DESIGN.md` 예시도 같음)
- Run 상세 터미널 끝부분: `run.log.fetched` "{time} 가져온 {count}줄"

Settings 서버의 업데이트 확인 줄은 낱말 없이 시간만 보였지만, 줄 이름이 "업데이트"라 무엇의 시간인지 화면이 말하지 않았다.

## 운영자 결정(2026-11-24)

- 낱말을 빼고 시간만 보인다("Just now", "1 min ago"). 무엇의 시간인지는 줄 이름·옆 라벨이 이미 말하면 그대로 두고, 말하지 않으면 시간 요소의 툴팁(title)으로 알린다. 화면에 새 낱말을 붙이지 않는다.
- 스크린 리더에는 뜻이 남게 한다(숨긴 글로 "마지막으로 읽은 때 1 min ago").
- 시간 표기 함수와 ADR 0010 시간 규칙은 바꾸지 않는다. ADR 0010 7번에 "상대 시간 뒤에 한국어 낱말을 붙이지 않는다"를 더한다.

## 한 일

- `apps/web/src/format/labeled-time.tsx`의 `LabeledTime`이 `<time dateTime title="뜻">`에 숨긴 글(`VisuallyHidden`) "뜻 "과 시간을 담는다. 화면에는 시간만 보이고, 마우스를 올리면 뜻이 툴팁으로, 스크린 리더는 "뜻 시간"으로 읽는다.
- 위 문구를 시간만 보이게 바꾸고 뜻을 메시지 키로 옮겼다: `checkedLabel` "마지막으로 확인한 때", `readLabel` "마지막으로 읽은 때", `endedLabel` "끝난 때". Runs 패널 끝난 런 줄은 `endedLabel`, `took` "{duration} 걸림", `metaSeparator`로 나눴다.
- Dashboard 런 시트 머리의 끝난 시각은 `home.sheet.since.endedLabel` "끝난 때", `/ds` 예시는 `ds.signals.metaLabel` "마지막으로 읽은 때"를 단 `LabeledTime`으로 바꿨다.
- Run 상세 터미널 끝부분은 "가져온 {count}줄 · <시간>"으로 바꾸고 시간에 "가져온 때"(실패면 "가져오려 한 때")를 달았다. `/ds`의 사용량 예시와 DESIGN.md 예시도 시간만 남겼다.
- Settings 서버 업데이트 확인 줄의 시간에 `checkedLabel` "마지막으로 확인한 때"를 달았다. 쓰이지 않던 `settings.updates.lastChecked`는 이 키로 바꿨다.
- en 메시지 파일은 저장소에 없어(`apps/web/messages/ko`만 있음) 맞출 키가 없다. 데스크톱(`apps/desktop/messages`)과 `packages`에는 같은 모양의 문구가 없다. `apps/mobile`은 손대지 않았다.

## 완료 조건

- [x] 바뀐 화면마다 보이는 글이 시간만이고 접근 이름(숨긴 글)과 툴팁에 뜻이 남는다는 시험(`labeled-time.test.tsx`, Runners·Run 상세·Runs·Dashboard 시트·/ds·Settings 러너 확인·업데이트 시험).
- [x] 관련 기존 시험 기대값 갱신.
- [x] ADR 0010 7번에 한 줄 더하기.
- [x] 스크린숏: Runners 러너 상세의 확인·읽음 줄, Run 상세의 읽음, Settings 서버의 업데이트 확인 줄(PR 본문).
