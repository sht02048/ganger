import { toRunId, toTicketKey } from "@ganger/core";
import { describe, expect, it } from "vitest";
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import type { HomeRun } from "@ganger/app/home/model";
import type { PrReadDiagnosis } from "@ganger/app/pr-read-diagnosis";
import { renderWithMessages } from "../testing/render";
import { homeMessages } from "./messages";
import { PrTabContent } from "./sheet-pr-tab";

const unusedMerge = () => Promise.reject(new Error("unused"));

function unread(prReadDiagnosis: PrReadDiagnosis | null): HomeRun {
  return {
    id: toRunId("run-1"),
    ticketId: "ticket-ACME-1",
    ticketKey: toTicketKey("ACME-1"),
    ticketTitle: "결제 재시도",
    trackerProject: "Web",
    workspace: { id: "ws-commerce", name: "Commerce" },
    runner: { name: "runner-a", online: true },
    agent: "claude",
    waitMs: 0,
    executionMs: 60_000,
    pullRequest: null,
    cancelling: false,
    control: null,
    state: "ended",
    agentResult: "reported-success",
    prState: "unknown",
    prReadError: "no-access",
    prReadDiagnosis,
    summary: "succeeded",
    endedAt: "2026-11-23T00:00:00.000Z",
    endedAgoMs: 60_000,
  };
}

function text(run: HomeRun): string {
  return renderWithMessages(
    <PrTabContent run={run} onMerge={unusedMerge} onLoadCommits={unusedMerge} />,
    homeMessages,
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("「PR」 탭 읽기 실패 진단 (0207)", () => {
  it("러너와 서버의 계정이 다르면 읽기 실패 안내 아래에 두 계정을 함께 보인다", () => {
    const shown = text(
      unread({
        kind: "different",
        runner: "runner-a",
        runnerLogin: "acme-dev",
        server: { kind: "gh", logins: ["my-personal"] },
      }),
    );
    expect(shown).toContain(homeJson.sheet.pr.unread);
    expect(shown).toContain(
      "러너(runner-a)는 acme-dev, 서버는 my-personal 계정으로 읽어요. 서버 계정이 이 저장소를 볼 수 없어요.",
    );
  });

  it("서버가 붙여 넣은 토큰으로 읽으면 토큰 값 없이 토큰이라고만 말한다", () => {
    const shown = text(
      unread({
        kind: "different",
        runner: "runner-a",
        runnerLogin: "acme-dev",
        server: { kind: "token" },
      }),
    );
    expect(shown).toContain(
      "러너(runner-a)는 acme-dev 계정, 서버는 붙여 넣은 토큰으로 읽어요. 붙여 넣은 토큰이 이 저장소를 볼 수 없어요.",
    );
  });

  it("러너 계정을 모르면 서버 계정만 말하고 견줘 보지 못했다고 한다", () => {
    const shown = text(
      unread({
        kind: "runner-unknown",
        runner: "runner-a",
        server: { kind: "gh", logins: ["my-personal", "jane-doe"] },
      }),
    );
    expect(shown).toContain(
      "서버는 my-personal, jane-doe 계정으로 읽어요. 러너(runner-a)의 gh 계정을 아직 몰라 서버 계정과 견줘 보지 못했어요.",
    );
  });

  it("계정이 같아 진단이 없으면 지금 안내만 보인다", () => {
    const shown = text(unread(null));
    expect(shown.trim()).toBe(homeJson.sheet.pr.unread);
  });
});
