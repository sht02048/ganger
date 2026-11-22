import { listRuns } from "@ganger/db";
import { toTicketKey } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { bulkAssignInput, submitBulkAssignment } from "@ganger/app/tickets/assign";
import {
  assignableChildCount,
  blockerReadTargets,
  blockerWaitHint,
  bulkAssignmentsFor,
  bulkChoices,
} from "@ganger/app/tickets/bulk-assign";
import type { BulkAssignment } from "@ganger/app/tickets/bulk-assign";
import { loadTicketsPage } from "@ganger/app/tickets/load";
import type { TicketRun, TicketView } from "@ganger/app/tickets/model";
import { renderWithMessages } from "../testing/render";
import { BulkAssignOutcome, BulkChoiceList } from "./bulk-assign-dialog";
import { ticketsMessages } from "./messages";
import { connection, docsProject, now, setupTickets, webProject, webRepo } from "./test-fixtures";

const defaults = { runnerProject: "github:acme/web", agent: "claude", repos: [] };

function child(key: string, overrides: Partial<TicketView> = {}): TicketView {
  return {
    id: JSON.stringify(["conn-acme", key]),
    connection: "conn-acme",
    key,
    title: `${key} 제목`,
    url: null,
    trackerProject: { id: "tp-web", name: "Web" },
    trackerState: { name: "Todo", category: "unstarted" },
    priority: "none",
    ancestors: [],
    isParentIssue: false,
    blockerWait: null,
    waitingTickets: [],
    labels: [],
    runs: [],
    mapping: defaults,
    assignability: { kind: "ready", defaults },
    ...overrides,
  };
}

function ended(summary: "failed" | "canceled" | "succeeded"): TicketRun {
  return {
    id: `run-${summary}`,
    runnerName: "runner-a",
    state: "ended",
    endedAt: now.toISOString(),
    endedAgoMs: 0,
    agentResult: "reported-failure",
    prState: "none",
    laterPrState: null,
    pullRequest: null,
    summary,
  };
}

const queued: TicketRun = {
  id: "run-queued",
  runnerName: null,
  state: "queued",
  elapsedMs: 0,
  waitingOn: null,
};

function assignment(key: string, overrides: Partial<BulkAssignment> = {}): BulkAssignment {
  return {
    connection,
    ticketKey: key,
    ticketTitle: `${key} 제목`,
    trackerProject: webProject,
    runnerProject: webRepo,
    runnerId: null,
    agent: "claude",
    ...overrides,
  };
}

function parsed(assignments: BulkAssignment[]) {
  return bulkAssignInput.parse({ assignments });
}

describe("하위 티켓 처음 선택(0172)", () => {
  it("할당 전은 체크하고, 지난 런 Failed·Canceled는 고를 수 있지만 체크하지 않는다", () => {
    const [ready, failed, canceled] = bulkChoices([
      child("ACME-1"),
      child("ACME-2", { runs: [ended("failed")] }),
      child("ACME-3", { runs: [ended("canceled")] }),
    ]);
    expect(ready).toMatchObject({ kind: "ready", selectable: true, initiallySelected: true });
    expect(failed).toMatchObject({ kind: "failed", selectable: true, initiallySelected: false });
    expect(canceled).toMatchObject({
      kind: "canceled",
      selectable: true,
      initiallySelected: false,
    });
  });

  it("선행 티켓을 기다리면 체크한 채 그 키를 안내한다", () => {
    const ticket = child("ACME-1");
    const [choice] = bulkChoices([ticket], new Map([[ticket.id, { key: "ACME-9", rest: 0 }]]));
    expect(choice).toMatchObject({
      kind: "waiting",
      initiallySelected: true,
      waitingOn: { key: "ACME-9", rest: 0 },
    });
  });

  it("끝나지 않은 런이 있는 티켓과 하위가 있는 상위 이슈는 목록에서 뺀다", () => {
    const choices = bulkChoices([
      child("ACME-1", { runs: [queued], assignability: { kind: "active-run", runId: "r" } }),
      child("ACME-2", { isParentIssue: true }),
      child("ACME-3"),
    ]);
    expect(choices.map((choice) => choice.ticket.key)).toEqual(["ACME-3"]);
  });

  it("Done·트래커 Canceled·Mapping 없음·지난 런 Succeeded는 고를 수 없다", () => {
    const choices = bulkChoices([
      child("ACME-1", { trackerState: { name: "Done", category: "completed" } }),
      child("ACME-2", { trackerState: { name: "Canceled", category: "canceled" } }),
      child("ACME-3", { mapping: null, assignability: { kind: "no-mapping" } }),
      child("ACME-4", { runs: [ended("succeeded")] }),
    ]);
    expect(choices.map((choice) => choice.kind)).toEqual([
      "done",
      "done",
      "no-mapping",
      "succeeded",
    ]);
    expect(choices.every((choice) => !choice.selectable && !choice.initiallySelected)).toBe(true);
  });

  it("N은 고를 수 있는 하위 티켓만 세고, 선행 티켓은 할당 전 티켓만 읽는다", () => {
    const children = [
      child("ACME-1"),
      child("ACME-2", { runs: [ended("failed")] }),
      child("ACME-3", { trackerState: { name: "Done", category: "completed" } }),
      child("ACME-4", { mapping: null, assignability: { kind: "no-mapping" } }),
    ];
    expect(assignableChildCount(children)).toBe(2);
    expect(blockerReadTargets(children).map((ticket) => ticket.key)).toEqual(["ACME-1"]);
  });

  it("끝나지 않은 선행 티켓의 첫 키와 나머지 수를 알려 주고, 취소된 선행 티켓이 있으면 알리지 않는다", () => {
    expect(
      blockerWaitHint([
        { key: "ACME-7", stateCategory: "completed" },
        { key: "ACME-8", stateCategory: "started" },
        { key: "ACME-9", stateCategory: "unstarted" },
      ]),
    ).toEqual({ key: "ACME-8", rest: 1 });
    expect(blockerWaitHint([{ key: "ACME-8", stateCategory: "canceled" }])).toBeNull();
  });

  it("고른 티켓만 자기 트래커 프로젝트와 Mapping 값으로 보낸다", () => {
    const web = child("ACME-1");
    const docs = child("DOC-1", {
      trackerProject: { id: "tp-docs", name: "Docs" },
      assignability: {
        kind: "ready",
        defaults: { runnerProject: "github:acme/docs", agent: "codex", repos: [] },
      },
    });
    const skipped = child("ACME-2");
    const sent = bulkAssignmentsFor(
      bulkChoices([web, docs, skipped]),
      new Set([web.id, docs.id]),
      [],
    );
    expect(sent.map((one) => [one.ticketKey, one.trackerProject, one.agent])).toEqual([
      ["ACME-1", "tp-web", "claude"],
      ["DOC-1", "tp-docs", "codex"],
    ]);
    expect(sent.every((one) => one.runnerId === null)).toBe(true);
  });
});

describe("한 번에 할당(0172)", () => {
  it("티켓별 결과를 돌려주고 일부가 실패해도 다른 티켓의 런은 남는다", () => {
    const { db } = setupTickets();
    const { results } = submitBulkAssignment(
      db,
      parsed([
        assignment("ACME-6"),
        assignment("DOC-1", { trackerProject: docsProject }),
        assignment("ACME-4"),
      ]),
      now,
    );
    expect(results).toMatchObject([
      { ticketKey: "ACME-6", ok: true },
      { ticketKey: "DOC-1", ok: false, reason: "no-mapping" },
      { ticketKey: "ACME-4", ok: false, reason: "active-run" },
    ]);
    const runs = listRuns(db, { ticket: { connection, key: toTicketKey("ACME-6") } });
    expect(runs.map((run) => run.state)).toEqual(["queued"]);
  });

  it("같은 요청이 두 번 들어와도, 한 요청에 같은 티켓이 두 번 있어도 런은 하나다", () => {
    const { db } = setupTickets();
    const input = parsed([assignment("ACME-6"), assignment("ACME-6")]);
    expect(submitBulkAssignment(db, input, now).results).toMatchObject([{ ok: true }]);
    expect(submitBulkAssignment(db, input, now).results).toMatchObject([
      { ok: false, reason: "active-run" },
    ]);
    expect(listRuns(db, { ticket: { connection, key: toTicketKey("ACME-6") } })).toHaveLength(1);
  });

  it("한 티켓에서 예외가 나도 다음 티켓을 할당하고 그 티켓만 실패로 돌려준다", () => {
    const { db } = setupTickets();
    db.$client.exec(
      "CREATE TRIGGER refuse_acme_6 BEFORE INSERT ON runs WHEN NEW.ticket_key = 'ACME-6' BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );
    const { results } = submitBulkAssignment(
      db,
      parsed([assignment("ACME-6"), assignment("ACME-77")]),
      now,
    );
    expect(results).toMatchObject([
      { ticketKey: "ACME-6", ok: false, reason: "failed" },
      { ticketKey: "ACME-77", ok: true },
    ]);
    expect(listRuns(db, { ticket: { connection, key: toTicketKey("ACME-6") } })).toHaveLength(0);
    expect(listRuns(db, { ticket: { connection, key: toTicketKey("ACME-77") } })).toHaveLength(1);
  });

  it("빈 요청과 러너를 직접 고른 요청은 받지 않는다", () => {
    expect(bulkAssignInput.safeParse({ assignments: [] }).success).toBe(false);
    expect(
      bulkAssignInput.safeParse({
        assignments: [{ ...assignment("ACME-6"), runnerId: "runner-a" }],
      }).success,
    ).toBe(false);
  });

  it("단일 할당과 같은 Mapping 값으로 Queued 런을 만든다", async () => {
    const { db, context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const ticket = page.tickets.find((candidate) => candidate.key === "ACME-6");
    if (ticket === undefined) throw new Error("no ACME-6");
    const assignments = bulkAssignmentsFor(
      bulkChoices([ticket]),
      new Set([ticket.id]),
      page.runners,
    );
    expect(submitBulkAssignment(db, parsed(assignments), now).results).toMatchObject([
      { ok: true },
    ]);
    const [run] = listRuns(db, { ticket: { connection, key: toTicketKey("ACME-6") } });
    expect(run).toMatchObject({ state: "queued", runnerProject: webRepo, agent: "claude" });
  });
});

describe("하위 티켓 할당 대화상자(0172)", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("체크 기본값과 고를 수 없는 이유를 보인다", () => {
    const tickets = [
      child("ACME-1"),
      child("ACME-2", { runs: [ended("failed")] }),
      child("ACME-3", { mapping: null, assignability: { kind: "no-mapping" } }),
      child("ACME-4", { trackerState: { name: "Done", category: "completed" } }),
    ];
    const choices = bulkChoices(tickets);
    const selected = new Set(
      choices.filter((choice) => choice.initiallySelected).map((choice) => choice.ticket.id),
    );
    const html = renderWithMessages(
      <BulkChoiceList choices={choices} selected={selected} disabled={false} onToggle={() => {}} />,
      ticketsMessages,
    );
    expect([...html.matchAll(/aria-checked="(true|false)"/g)].map((m) => m[1])).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    expect(text(html)).toContain("지난 런이 Failed예요");
    expect(text(html)).toContain("Mapping이 없어요");
    expect(text(html)).toContain("이미 끝난 티켓이에요");
  });

  it("선행 티켓 안내를 해요체로 보인다", () => {
    const ticket = child("ACME-1");
    const choices = bulkChoices([ticket], new Map([[ticket.id, { key: "ACME-9", rest: 1 }]]));
    const html = renderWithMessages(
      <BulkChoiceList
        choices={choices}
        selected={new Set([ticket.id])}
        disabled={false}
        onToggle={() => {}}
      />,
      ticketsMessages,
    );
    expect(text(html)).toContain("ACME-9 외 1개 티켓이 끝날 때까지 Queued로 남아요");
  });

  it("결과를 role=status로 티켓별로 알리고 단일 할당 오류 문구를 다시 쓴다", () => {
    const html = renderWithMessages(
      <BulkAssignOutcome
        outcome={{
          kind: "results",
          results: [
            { connection, ticketKey: "ACME-21", ok: true, runId: "r1" },
            { connection, ticketKey: "ACME-22", ok: false, reason: "active-run" },
          ],
        }}
      />,
      ticketsMessages,
    );
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("1개 할당했어요.");
    expect(text(html)).toContain(
      "ACME-22 티켓은 할당하지 못했어요. 그사이 이 티켓에 진행 중인 런이 생겼어요.",
    );
  });

  it("결과가 없으면 알림 자리만 비워 둔다", () => {
    const html = renderWithMessages(<BulkAssignOutcome outcome={null} />, ticketsMessages);
    expect(html).toContain('role="status"');
    expect(text(html).trim()).toBe("");
  });
});
