---
status: done
blocked_by: []
---

# 0161 README를 짧게 다시 쓰고 나머지를 문서로 옮기기

## 목표

441줄·7,885낱말인 README를 처음 온 사람이 읽을 약 150줄·1,000낱말로 줄인다. 정보는 지우지 않고 사용자 문서, 출시 문서, 기여 문서로 옮긴다. 조사와 근거는 [research 0020](../research/0020-readme.md)에 있다.

## 운영자 결정(2026-11-21)

리서치 추천대로 한다.

- README 순서: 머리·링크 줄, 한 줄 소개, Dashboard 스크린숏, How it works, Features, Install, First run, 보안 안내, Documentation, Contributing, License.
- Self-hosting은 `docs/guide/`의 주제별 문서로, 데스크톱 사용은 `docs/guide/desktop.md`로, 출시 절차는 `docs/releasing.md`로, 구조·명령·개발·데스크톱 빌드는 `CONTRIBUTING.md`로 옮긴다.
- 새 사용자 문서는 영어로 쓰고(ADR 0005) 예시는 가상 값만 쓴다.

## 할 일

1. README를 다시 쓴다.
2. 옮기면서 낡은 내용을 지금 코드에 맞춘다(Structure 표의 Planned 표시, 빠진 `packages/log`, `/api/attention` 안내).
3. 데모 시드로 Dashboard를 1440 폭 다크로 찍어 `docs/assets/dashboard.png`에 둔다.
4. 옛 참조를 고친다: AGENTS.md, 출시 워크플로 세 곳의 오류 문구, ADR 0017, GLOSSARY.

## 완료 조건

- 옛 README의 정보가 새 문서 어딘가에 있다.
- Markdown 상대 링크와 앵커가 깨지지 않았다.
- 개인 정보, 실제 호스트, tailnet 주소, 로컬 경로가 없다.
- 코드 동작과 DB는 바뀌지 않는다(two-way).
