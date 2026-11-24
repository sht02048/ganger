import { toRunId, toTicketKey } from "@ganger/core";
import { describe, expect, it } from "vitest";
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import type { HomeRun } from "@ganger/app/home/model";
import { labeledTimesOf } from "../testing/labeled-times";
import { renderWithMessages } from "../testing/render";
import { homeMessages } from "./messages";
import { SheetStatus } from "./run-sheet";

const ended: HomeRun = {
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
  prState: "none",
  prReadError: null,
  prReadDiagnosis: null,
  summary: "succeeded",
  endedAt: "2026-11-23T00:00:00.000Z",
  endedAgoMs: 60_000,
};

describe("시트 머리의 끝난 때(0216)", () => {
  it("끝난 런은 시간만 보이고 뜻은 숨긴 글과 툴팁에 둔다", () => {
    const html = renderWithMessages(<SheetStatus run={ended} status="succeeded" />, homeMessages);
    const label = homeJson.sheet.since.endedLabel;
    expect(labeledTimesOf(html)).toEqual([
      { dateTime: ended.endedAt, title: label, hidden: label, visible: "1 min ago" },
    ]);
    expect(html).not.toContain("끝났어요");
  });
});
