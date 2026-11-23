---
status: done
blocked_by: [0106]
---

# 0107 모바일 4: 앱에서 답하기·Human Check·거절·재개·취소

## 목표

앱에서 Question과 Human Check에 답하고, Permission을 거절하고, Paused 런을 재개하고, 런을 취소한다. 답을 보내면 그 런이 다시 Running이 된다(스펙 [0002](../spec/0002-mobile.md) 1절 둘째 완료 기준, M3·M22·M24).

## 범위

- v1 쓰기 계약: 답하기(`answerQuestion`), Human Check 답하기(`answerHumanCheck`), Permission 거절(`denyPermission`), 재개(`controlRun`의 `resume`만), 런 취소(`cancelRun`). 지금 서버 함수와 같은 규칙을 쓴다.
- 모든 v1 쓰기는 `requestId`가 필수다(M25). `denyPermission`에는 아직 이 보호가 없어 이 티켓에서 더한다(0156의 `handleRunActionOnce`). 거절은 이유 값으로 돌려주고 앱이 문장으로 보인다.
- 이 화면들이 읽는 v1 계약: 답하기 시트의 질문과 선택지(`readQuestion`, 선택지는 글뿐이다), Human Check 내용, "런 상세"의 처리할 일 띠(`runNextStep`)·요약·PR 구역(M37). 타임라인과 터미널은 열지 않는다.
- 답하기 시트: 질문, 맥락 한 줄, 선택지, "직접 쓰기", 아래에 고정한 "보내면 되돌릴 수 없어요"와 "보내기". 고르기만 해서는 보내지 않는다(ADR 0010 6번).
- Human Check 시트(M22): 무엇을 확인할지, 덧붙일 말(선택), "확인했어요"와 "고쳐 주세요". Running 칸 맨 위 "확인해 주세요" 묶음의 카드 "확인하기"로 연다.
- Paused 카드의 "재개하기"(M24). 멈추기는 넣지 않는다.
- Permission 카드의 "거절"과 "허용은 러너의 Orca에서 해요" 안내(ADR 0009).
- Queued·Running 카드 메뉴의 "Linear에서 열기"와 "런 취소". 취소는 확인 시트를 거친다.
- Failed·Disconnected 카드의 "런 상세"(M37).

## 범위 밖

- Failed 다시 맡기기, 이어서 맡기기(0111).
- 멈추기(M24), 기다리지 않고 시작과 에이전트에게 보내기(M28).

## 완료 조건

- v1 쓰기 계약으로 Question과 Human Check("확인했어요", "고쳐 주세요")에 답해 런이 Running으로 돌아가는 e2e 시험(가짜 어댑터)과, 앱 답하기·Human Check 시트의 컴포넌트 시험이 있다. 앱 전체를 도는 e2e 도구는 이 티켓에서 정하지 않는다.
- 거절, 재개, 취소가 서버에 반영되는 시험이 있다. 이미 다른 상태가 된 런에 늦게 간 쓰기는 거절되고 앱이 그 이유를 보인다.
- 모든 v1 쓰기에서 `requestId`가 없으면 거절되고, 같은 ID와 내용은 한 번만 처리되며, 같은 ID에 다른 내용은 거절되는 시험이 있다(Permission 거절 포함). 이유 값은 답하기·Human Check가 `already-answered`, 그 밖의 쓰기가 `request-reused`다. 러너에서 실패한 재개는 같은 ID로 다시 처리되는 시험도 있다.
- v1에 멈추기(`pause`)가 열리지 않는 시험이 있다.
- 런 상세가 처리할 일 띠·요약·PR 구역을 보이고 타임라인과 터미널을 싣지 않는 시험이 있다.
