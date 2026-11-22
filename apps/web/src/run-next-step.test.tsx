import { RUN_NEXT_STEP_KINDS } from "@ganger/app/run-next-step";
import type { RunNextStep } from "@ganger/app/run-next-step";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import domain from "../messages/ko/domain.json" with { type: "json" };
import { useRunNextStepText } from "./run-next-step";
import type { RunNextStepText } from "./run-next-step";

function textOf(kind: RunNextStep): RunNextStepText | null {
  let result: RunNextStepText | null = null;
  function Probe() {
    result = useRunNextStepText()(kind);
    return null;
  }
  renderToStaticMarkup(
    <IntlProvider locale="ko" messages={{ domain }} timeZone="UTC">
      <Probe />
    </IntlProvider>,
  );
  return result;
}

describe("useRunNextStepText", () => {
  it.each<[RunNextStep, string, string | null]>([
    ["pr-ci-failed", "PR의 CI가 실패해서 확인이 필요해요.", "실패한 검사 보기"],
    ["pr-conflict", "PR이 base와 충돌해요. 충돌을 풀어 주세요.", "PR에서 충돌 보기"],
    ["question", "에이전트가 질문했어요. 답해 주세요.", "답하기"],
    ["permission", "에이전트가 권한 허용을 기다려요. 러너 화면에서 허용해 주세요.", null],
    ["human-check", "에이전트가 확인을 요청했어요. 내용을 보고 답해 주세요.", "확인하기"],
    ["paused", "멈춰 둔 런이에요. 재개하면 같은 러너와 워크트리에서 이어서 해요.", "재개하기"],
    ["disconnected", "러너에 닿지 않아요. 러너가 켜져 있고 ssh로 닿는지 확인해 주세요.", null],
    ["failed", "런이 실패했어요. 원인을 확인하고, 필요하면 티켓을 다시 맡겨 주세요.", null],
  ])("%s의 문장과 주 버튼", (kind, body, action) => {
    expect(textOf(kind)).toEqual({ kind, body, action });
  });

  it("처리할 일이 없으면 문장을 만들지 않아요", () => {
    expect(textOf("none")).toBeNull();
  });

  it("모든 종류에 문장이 있어요", () => {
    for (const kind of RUN_NEXT_STEP_KINDS) {
      if (kind === "none") continue;
      expect(textOf(kind)?.body).toBe(domain.runNextStep.body[kind]);
    }
  });
});
