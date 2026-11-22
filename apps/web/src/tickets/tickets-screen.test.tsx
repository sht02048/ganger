import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { AUTO_RUNNER, AssignForm, runnerOptionsFor } from "./assign-dialog";
import { loadTicketsPage, ticketId } from "@ganger/app/tickets/load";
import type { TicketListView } from "@ganger/app/tickets/groups";
import { ticketsMessages } from "./messages";
import type {
  RunnerChoice,
  TicketFilter,
  TicketRun,
  TicketView,
  TicketsPage,
} from "@ganger/app/tickets/model";
import { now, setupTickets } from "./test-fixtures";
import { TicketRelations, TicketsScreen } from "./tickets-screen";
import type { BlockerRead } from "./tickets-screen";

const noop = () => {};

function render(
  page: TicketsPage,
  options: { filter?: TicketFilter; selectedId?: string; view?: TicketListView } = {},
) {
  return renderWithMessages(
    <TicketsScreen
      page={page}
      workspaces={[
        { id: "ws-commerce", name: "Acme Commerce" },
        { id: "ws-labs", name: "Acme Labs" },
      ]}
      filter={options.filter ?? "all"}
      view={options.view ?? "grouped"}
      selectedId={options.selectedId}
      onFilterChange={noop}
      onSelect={noop}
      onPickWorkspace={noop}
      onOpenRun={noop}
      onOpenRuns={noop}
      onAssign={() => Promise.resolve({ ok: false, reason: "active-run" })}
      onAssigned={noop}
      onReadBlockers={() => Promise.resolve({ ok: true, blockers: [] })}
      onReread={() => Promise.resolve()}
    />,
    ticketsMessages,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function rowTexts(html: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const chunk of html.split('role="listitem"').slice(1)) {
    const row = text(chunk);
    const key = /ACME-\d+|DOC-\d+/.exec(row)?.[0];
    if (key !== undefined && !rows.has(key)) rows.set(key, row);
  }
  return rows;
}

function variants(html: string): string[] {
  return [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1] ?? "");
}

function panelText(html: string): string {
  return text(html.split("<aside")[1] ?? "");
}

describe("Tickets 화면", () => {
  it("티켓이 하나도 없으면 쉬는 반장을 장식으로 두고, 티켓이 있으면 두지 않는다(0077)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const empty = render({ ...page, tickets: [], errors: [] });
    expect(empty).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-mascot="resting"/);
    expect(render(page, { filter: "done" })).not.toContain("data-mascot");
  });

  it("행은 키 · 제목 · 런을 보이고, 트래커 상태는 런 칸에 쓰지 않는다", async () => {
    const { context } = setupTickets();
    const rows = rowTexts(render(await loadTicketsPage(context, undefined, now)));
    expect(rows.get("ACME-1")).toContain("PR 머지");
    expect(rows.get("ACME-2")).toContain("Failed");
    expect(rows.get("ACME-3")).toContain("Running");
    expect(rows.get("ACME-4")).toContain("Queued");
    expect(rows.get("ACME-5")).toContain("Waiting for Input");
    expect(rows.get("ACME-6")).toContain("할당 전");
  });

  it("머리는 Tickets 와 할당할 수 있는 티켓 수 요약이다", async () => {
    const { context } = setupTickets();
    const html = render(await loadTicketsPage(context, undefined, now));
    const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
    expect(text(heading).trim()).toBe("Tickets");
    expect(text(html)).toContain("할당할 수 있는 티켓이 3개 있어요.");
  });

  it("트래커 프로젝트가 있으면 머리 오른쪽에 Linear에서 다시 읽기를 두고, 없으면 두지 않는다(0122)", async () => {
    const { context } = setupTickets();
    const html = render(await loadTicketsPage(context, undefined, now));
    const button = /<button[^>]*data-variant="secondary"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(text(button?.[1] ?? "")).toContain("Linear에서 다시 읽기");
    expect(html).toMatch(/<\/button><span[^>]*><span role="status"><\/span><\/span>/);
    expect(html).toContain('aria-busy="false"');

    const empty = render({
      ...(await loadTicketsPage(context, undefined, now)),
      tickets: [],
      trackerProjectCount: 0,
    });
    expect(empty).not.toContain("Linear에서 다시 읽기");
  });

  it("필터는 한 줄 묶음 탭이고 각 개수를 보인다", async () => {
    const { context } = setupTickets();
    const html = render(await loadTicketsPage(context, undefined, now));
    const tabs = [...html.matchAll(/role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      text(m[1] ?? "").trim(),
    );
    expect(tabs).toEqual(["모두 7", "할당할 수 있음 3", "처리할 일 2", "진행 중 2", "끝남 1"]);
  });

  it.each<[TicketFilter, string[]]>([
    ["all", ["ACME-5", "ACME-2", "ACME-6", "ACME-4", "ACME-3", "ACME-1", "DOC-1"]],
    ["assignable", ["ACME-2", "ACME-6", "DOC-1"]],
    ["todo", ["ACME-5", "ACME-2"]],
    ["in-progress", ["ACME-4", "ACME-3"]],
    ["done", ["ACME-1"]],
  ])("필터 %s 는 그 티켓만 목록에 보인다", async (filter, keys) => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    expect([...rowTexts(render(page, { filter })).keys()]).toEqual(keys);
  });

  it("목록에는 런 상태 알약·우선순위·트래커 프로젝트 칸이 없다(0171)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const list = render(page).split("<aside")[0] ?? "";
    expect(rowTexts(list).get("ACME-6")).not.toContain("Web");
    expect(text(list)).not.toContain("트래커 프로젝트");
    expect(text(list)).not.toContain("우선순위");
    expect(list).not.toContain("data-pill");
  });

  it("읽지 못한 트래커 프로젝트를 알린다", async () => {
    const { context } = setupTickets();
    const html = render(await loadTicketsPage(context, undefined, now));
    expect(text(html)).toContain("Broken 티켓을 읽지 못했어요. 트래커가 API 키를 받지 않았어요.");
    expect(html).not.toContain('role="alert"');
  });

  it("상한에 닿아 잘린 트래커 프로젝트를 목록 위에 알린다(0054)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const html = render({ ...page, truncated: [{ trackerProject: "Web", limit: 1000 }] });
    expect(text(html)).toContain(
      "Web 티켓이 많아 1,000개만 보여요. 나머지는 트래커에서 찾아 주세요.",
    );
    expect(text(render(page))).not.toContain("개만 보여요");
  });

  it("행이 많아도 처음에는 일부만 그린다(0054)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const base = page.tickets[0];
    if (base === undefined) throw new Error("no ticket");
    const tickets = Array.from({ length: 1000 }, (_, i) => ({
      ...base,
      id: `t-${i}`,
      key: `ACME-${1000 + i}`,
    }));
    const html = render({ ...page, tickets });
    expect(html.split('role="listitem"').length - 1).toBeLessThanOrEqual(30);
    expect(text(html)).toContain("1000");
  });

  it("고른 티켓이 필터에서 빠져도 패널은 그 티켓을 보인다(0054)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const acme3 = page.tickets.find((t) => t.key === "ACME-3");
    const html = render(page, { filter: "assignable", selectedId: acme3?.id ?? "" });
    expect(panelText(html)).toContain("ACME-3 제목");
    expect(html.split("<aside")[0]).not.toContain('aria-current="true"');
  });

  it("트래커 열기는 머리의 아이콘 링크이고 이름과 새 탭을 가진다(0164)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const aside = render(page, { selectedId: page.tickets[0]?.id ?? "" }).split("<aside")[1] ?? "";
    const link = /<a [^>]*aria-label="트래커에서 열기 \(새 탭에서 열려요\)"[^>]*>/.exec(aside)?.[0];
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noreferrer"');
    expect(link).toContain('href="https://linear.example.com/acme/issue/ACME-6"');
    expect(aside.indexOf("트래커에서 열기")).toBeLessThan(aside.indexOf("<h2"));
  });

  it("할당 전 티켓은 할당 버튼과 Mapping 기본값을 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const panel = panelText(render(page, { selectedId: page.tickets[0]?.id ?? "" }));
    expect(panel).toContain("ACME-6 제목");
    expect(panel).toContain("할당하기");
    expect(panel).toContain("아직 런이 없어요");
    expect(panel).toContain("acme/web · Claude Code");
    expect(panel).not.toContain("github:");
    expect(panel).toContain("factory · 자동 할당");
  });

  it("진행 중인 런이 있는 티켓은 할당 버튼 대신 런 보기를 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const acme3 = page.tickets.find((t) => t.key === "ACME-3");
    const panel = panelText(render(page, { selectedId: acme3?.id ?? "" }));
    expect(panel).toContain("에이전트가 작업하고 있어요.");
    expect(panel).toContain("런 보기");
    expect(panel).not.toContain("할당하기");
    expect(panel).not.toContain("새 런 시작");
  });

  it("Ended 뒤의 티켓은 새 런을 시작할 수 있다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const acme1 = page.tickets.find((t) => t.key === "ACME-1");
    const panel = panelText(render(page, { selectedId: acme1?.id ?? "" }));
    expect(panel).toContain("새 런 시작");
    expect(panel).toContain("런 보기");
    expect(panel).toContain("런 2");
    expect(panel).not.toContain("런 수");
  });

  it("마지막 런 상자는 결과 곁에 PR 정보를 보이고, PR 이 없으면 보이지 않는다 (0145)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const panelOf = (key: string, changed: TicketsPage = page): string =>
      panelText(
        render(changed, { selectedId: changed.tickets.find((t) => t.key === key)?.id ?? "" }),
      );
    expect(panelOf("ACME-1")).toContain("Succeeded");
    expect(panelOf("ACME-1")).toContain("PR 병합됨");
    expect(panelOf("ACME-1")).toContain(
      "에이전트가 성공을 보고했어요. 사람이 더 확인할 것이 없어요.",
    );
    expect(panelOf("ACME-2")).toContain("PR 열림");
    const withNumber: TicketsPage = {
      ...page,
      tickets: page.tickets.map((t) =>
        t.key === "ACME-2"
          ? {
              ...t,
              runs: t.runs.map((run) =>
                run.state === "ended"
                  ? { ...run, pullRequest: "#12", laterPrState: "merged" as const }
                  : run,
              ),
            }
          : t,
      ),
    };
    expect(panelOf("ACME-2", withNumber)).toContain("PR #12 병합됨");
    expect(panelOf("ACME-6")).not.toContain("PR ");
  });

  it("목록은 우선순위와 기다림, 멈춘 기다림을 구분하고 패널은 끝난 선행 티켓까지 보인다(0160)", async () => {
    const { context } = setupTickets();
    const loaded = await loadTicketsPage(context, undefined, now);
    const blocker = (key: string, stateName: string, stateCategory: string) => ({
      key,
      title: `${key} 제목`,
      stateName,
      stateCategory,
    });
    const page: TicketsPage = {
      ...loaded,
      tickets: loaded.tickets.map((ticket) => {
        if (ticket.key === "ACME-3")
          return {
            ...ticket,
            priority: "high" as const,
            blockerWait: {
              kind: "blockers-waiting" as const,
              blockers: [blocker("ACME-11", "In Progress", "started")],
              finished: [blocker("ACME-9", "Done", "completed")],
            },
            waitingTickets: [{ key: "ACME-20", title: "뒤 티켓" }],
          };
        if (ticket.key === "ACME-6") {
          const canceled = blocker("ACME-10", "Canceled", "canceled");
          return {
            ...ticket,
            blockerWait: {
              kind: "blockers-stuck" as const,
              cause: "canceled" as const,
              blocker: canceled,
              blockers: [canceled],
            },
          };
        }
        return ticket;
      }),
    };
    const selected = page.tickets.find((ticket) => ticket.key === "ACME-3");
    const html = render(page, { selectedId: selected?.id ?? "" });
    const listHtml = html.split("<aside")[0] ?? "";

    expect(listHtml).toContain('data-blocker-state="active"');
    expect(listHtml).toContain('data-blocker-state="canceled"');
    expect(text(listHtml)).not.toContain("High");
    const panel = panelText(html);
    expect(panel).toContain("ACME-3 · Web");
    expect(panel).toMatch(/Todo High/);
    expect(panel).toContain("ACME-11");
    expect(panel).toContain("ACME-9");
    expect(panel).toContain("ACME-20 뒤 티켓");
  });

  it("첫 관계 읽기에 실패한 런은 선행 티켓이 없다고 말하지 않는다(0160)", async () => {
    const { context } = setupTickets();
    const loaded = await loadTicketsPage(context, undefined, now);
    const page: TicketsPage = {
      ...loaded,
      tickets: loaded.tickets.map((ticket) =>
        ticket.key === "ACME-3"
          ? {
              ...ticket,
              blockerWait: {
                kind: "blockers-stuck" as const,
                cause: "unreadable" as const,
                blocker: null,
                blockers: [],
              },
            }
          : ticket,
      ),
    };
    const selected = page.tickets.find((ticket) => ticket.key === "ACME-3");
    const panel = panelText(render(page, { selectedId: selected?.id ?? "" }));

    expect(panel).toContain("먼저 끝나야 하는 티켓을 읽지 못했어요.");
    expect(panel).not.toContain("먼저 끝나야 하는 티켓 없어요");
  });

  it("패널은 키 · 트래커 프로젝트 줄과 제목, 상태 칩, 마지막 런 카드를 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const acme3 = page.tickets.find((t) => t.key === "ACME-3");
    if (acme3 === undefined) throw new Error("no ACME-3");
    const html = render(page, { selectedId: acme3.id });
    const aside = html.split("<aside")[1] ?? "";
    const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(aside)?.[1] ?? "";
    expect(text(heading).trim()).toBe(acme3.title);
    const panel = panelText(html);
    expect(panel).toContain("ACME-3 · Web");
    expect(panel).toContain("Todo");
    expect(aside).toContain('aria-label="마지막 런"');
    expect(panel).toMatch(/Running runner-a \d+ hr \d+ min/);
    expect(aside).toMatch(/data-slot="time"/);
    expect(panel).toContain("Mapping acme/web · Claude Code");
  });

  it("노란 주 버튼은 화면에 하나 이하다(ADR 0010 6번)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    for (const ticket of page.tickets) {
      const all = variants(render(page, { selectedId: ticket.id }));
      expect(all.filter((v) => v === "primary").length).toBeLessThanOrEqual(1);
    }
    const ready = page.tickets.find((t) => t.assignability.kind === "ready");
    expect(variants(render(page, { selectedId: ready?.id ?? "" }))).toContain("primary");
  });
});

describe("Tickets 상세 패널(0164)", () => {
  async function loaded() {
    const { context } = setupTickets();
    return loadTicketsPage(context, undefined, now);
  }
  const ticketOf = (page: TicketsPage, key: string): TicketView => {
    const found = page.tickets.find((ticket) => ticket.key === key);
    if (found === undefined) throw new Error(`no ${key}`);
    return found;
  };
  const relations = (page: TicketsPage, ticket: TicketView, read: BlockerRead) =>
    renderWithMessages(
      <TicketRelations
        ticket={ticket}
        tickets={page.tickets}
        read={read}
        onRead={noop}
        onSelectTicket={noop}
      />,
      ticketsMessages,
    );
  const withTicket = (page: TicketsPage, key: string, change: Partial<TicketView>) => {
    const tickets = page.tickets.map((t) => (t.key === key ? { ...t, ...change } : t));
    const changed = { ...page, tickets };
    return panelText(render(changed, { selectedId: ticketOf(changed, key).id }));
  };

  it("읽기 전에는 그 사실과 읽기 버튼을 보인다", async () => {
    const page = await loaded();
    const shown = text(relations(page, ticketOf(page, "ACME-6"), { status: "idle" }));
    expect(shown).toContain("먼저 끝나야 하는 티켓 아직 읽지 않았어요");
    expect(shown).toContain("선행 티켓 읽기");
  });

  it("읽는 중에는 진행 문장과 바쁜 버튼을 보인다", async () => {
    const page = await loaded();
    const html = relations(page, ticketOf(page, "ACME-6"), { status: "reading" });
    expect(text(html)).toContain("트래커에서 읽고 있어요");
    expect(html).toContain('aria-busy="true"');
  });

  it("읽기에 실패하면 이유와 다시 읽기를 보인다", async () => {
    const page = await loaded();
    const shown = text(
      relations(page, ticketOf(page, "ACME-6"), {
        status: "done",
        result: { ok: false, reason: "network" },
      }),
    );
    expect(shown).toContain("선행 티켓을 읽지 못했어요. 트래커에 닿지 않았어요.");
    expect(shown).toContain("다시 읽기");
  });

  it("관계가 없으면 두 소제목 모두 없어요를 쓴다", async () => {
    const page = await loaded();
    const shown = text(
      relations(page, ticketOf(page, "ACME-6"), {
        status: "done",
        result: { ok: true, blockers: [] },
      }),
    );
    expect(shown).toContain("먼저 끝나야 하는 티켓 없어요");
    expect(shown).toContain("이 티켓을 기다리는 티켓 없어요");
  });

  it("끝난 선행 티켓을 포함해 행을 보이고, 목록에 없는 티켓은 누를 수 없다", async () => {
    const page = await loaded();
    const html = relations(page, ticketOf(page, "ACME-6"), {
      status: "done",
      result: {
        ok: true,
        blockers: [
          { key: "ACME-3", title: "진행 티켓", stateName: "In Progress", stateCategory: "started" },
          { key: "ACME-99", title: "끝난 티켓", stateName: "Done", stateCategory: "completed" },
        ],
      },
    });
    const shown = text(html);
    expect(shown).toContain("먼저 끝나야 하는 티켓 2");
    expect(shown).toContain("ACME-3 진행 티켓 In Progress");
    expect(shown).toContain("ACME-99 끝난 티켓 Done");
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1] ?? "");
    expect(buttons.some((button) => button.includes("ACME-3"))).toBe(true);
    expect(buttons.some((button) => button.includes("ACME-99"))).toBe(false);
    const titleClass = (title: string) =>
      new RegExp(`<span title="${title}" class="([^"]+)"`).exec(html)?.[1] ?? "";
    expect(titleClass("끝난 티켓")).not.toBe(titleClass("진행 티켓"));
  });

  it("기다리는 티켓은 목록의 지금 제목과 상태를 쓰고, 목록에 없으면 저장된 제목에 상태 칸을 비운다", async () => {
    const page = await loaded();
    const ticket = {
      ...ticketOf(page, "ACME-6"),
      waitingTickets: [
        { key: "ACME-4", title: "아는 티켓" },
        { key: "OTHER-1", title: "모르는 티켓" },
      ],
    };
    const shown = text(relations(page, ticket, { status: "idle" }));
    expect(shown).toContain("이 티켓을 기다리는 티켓 2");
    expect(shown).toContain("ACME-4 ACME-4 제목 Queued");
    expect(shown).not.toContain("아는 티켓");
    expect(shown).toMatch(/OTHER-1 모르는 티켓 *$/);
  });

  it("런이 없으면 런 구역을 두지 않는다", async () => {
    const page = await loaded();
    const panel = panelText(render(page, { selectedId: ticketOf(page, "ACME-6").id }));
    expect(panel).not.toContain("런 보기");
    expect(panel).not.toMatch(/ 런 \d/);
  });

  it("런이 하나면 한 행만 보이고 모두 보기를 두지 않는다", async () => {
    const page = await loaded();
    const panel = panelText(render(page, { selectedId: ticketOf(page, "ACME-3").id }));
    expect(panel).toContain("런 1");
    expect(panel).toContain("Running · runner-a");
    expect(panel).not.toContain("Runs에서 모두 보기");
  });

  it("런이 여섯이면 최근 다섯만 보이고 Runs에서 모두 보기를 둔다", async () => {
    const page = await loaded();
    const base = ticketOf(page, "ACME-3").runs[0];
    if (base === undefined) throw new Error("no run");
    const runs: TicketRun[] = Array.from({ length: 6 }, (_, i) => ({
      ...base,
      id: `run-${i}`,
      runnerName: `runner-${i}`,
    }));
    const panel = withTicket(page, "ACME-3", { runs });
    expect(panel).toContain("런 6");
    expect(panel).toContain("Running · runner-4");
    expect(panel).not.toContain("Running · runner-5");
    expect(panel).toContain("Runs에서 모두 보기");
  });

  it("라벨이 없으면 없음을 쓰고, 자동 할당 라벨은 맨 앞 칩이다", async () => {
    const page = await loaded();
    expect(withTicket(page, "ACME-6", { labels: [] })).toContain("라벨 없음");
    const panel = withTicket(page, "ACME-6", {
      labels: [
        { name: "bug", autoAssign: false },
        { name: "factory", autoAssign: true },
      ],
    });
    expect(panel.indexOf("factory · 자동 할당")).toBeLessThan(panel.indexOf("bug"));
  });

  it("Mapping이 없으면 지금 문장을 쓴다", async () => {
    const page = await loaded();
    expect(
      withTicket(page, "ACME-6", { mapping: null, assignability: { kind: "no-mapping" } }),
    ).toContain("Mapping Mapping이 없어요");
  });
});

describe("상위 이슈로 묶기(0171)", () => {
  const ref = (key: string, title = `${key} 제목`) => ({
    key,
    title,
    url: `https://linear.example.com/acme/issue/${key}`,
    state: { name: "In Progress", category: "started" },
  });
  async function grouped(): Promise<TicketsPage> {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    return {
      ...page,
      tickets: page.tickets.map((ticket) => {
        if (ticket.key === "ACME-5" || ticket.key === "ACME-3")
          return { ...ticket, ancestors: [ref("ACME-6")] };
        if (ticket.key === "ACME-2")
          return { ...ticket, ancestors: [ref("EPIC-1", "범위 밖 상위")] };
        if (ticket.key === "ACME-6") return { ...ticket, assignability: { kind: "parent-issue" } };
        return ticket;
      }),
    };
  }
  const listOf = (html: string) => html.split("<aside")[0] ?? "";

  it("묶기 보기는 상위 줄과 하위 줄, 상위 이슈 없음 머리를 보인다", async () => {
    const html = listOf(render(await grouped()));
    const shown = text(html);
    expect(shown).toContain("상위 이슈 없음");
    expect(html).toContain('aria-label="ACME-6 하위 티켓 접기"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-progress="0/2"');
    expect(shown).toContain("0/2");
    expect(shown.indexOf("EPIC-1")).toBeLessThan(shown.indexOf("상위 이슈 없음"));
  });

  it("상위 줄에는 할당 버튼이 없고 하위 런 요약을 보인다", async () => {
    const rows = rowTexts(listOf(render(await grouped())));
    expect(rows.get("ACME-6")).toContain("Running 1");
    expect(rows.get("ACME-6")).not.toContain("할당");
  });

  it("할 일 칸은 테두리 버튼이고 노란 주 버튼을 쓰지 않는다", async () => {
    const list = listOf(render(await grouped(), { view: "flat" }));
    expect(text(list)).toContain("답하기");
    expect(variants(list)).not.toContain("primary");
  });

  it("모든 티켓 보기는 묶지 않고 제목 아래에 상위 이슈를 보인다", async () => {
    const html = listOf(render(await grouped(), { view: "flat" }));
    expect(text(html)).not.toContain("상위 이슈 없음");
    expect(text(html)).toContain("↳ ACME-6 ACME-6 제목");
    expect(html).not.toContain("aria-expanded");
  });

  it("보기 단추는 글자 없는 아이콘이고 고른 보기를 눌림으로 보인다", async () => {
    const html = render(await grouped(), { view: "flat" });
    expect(html).toMatch(/aria-label="티켓 하나씩 보기"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/aria-label="상위 이슈로 묶어 보기"[^>]*aria-pressed="false"/);
  });

  it("좁은 화면용 런 줄이 제목 칸 안에 있고 런 칸과 같은 내용이다", async () => {
    const html = listOf(render(await grouped()));
    const row =
      html.split('role="listitem"').find((chunk) => chunk.includes("ACME-3 ACME-3")) ?? "";
    const below = /data-run-below=""[^>]*>([\s\S]*?)<\/span><\/span><\/span>/.exec(row)?.[1] ?? "";
    expect(text(below)).toContain("Running");
    expect(row).toContain("data-run-cell");
  });

  it("상위 이슈 패널은 진행, 하위 목록을 보이고 할당하지 않는다", async () => {
    const page = await grouped();
    const id = page.tickets.find((ticket) => ticket.key === "ACME-6")?.id ?? "";
    const panel = panelText(render(page, { selectedId: id }));
    expect(panel).toContain("ACME-6 · Web · 상위 이슈");
    expect(panel).toContain("2개 중 0개 Done · 0개 진행 중 · 2개 남았어요");
    expect(panel).toContain("ACME-5 ACME-5 제목");
    expect(panel).toContain("티켓 정보");
    expect(panel).not.toContain("할당하기");
  });

  it("읽은 범위 밖 상위 이슈 패널은 안내와 Linear 링크만 둔다", async () => {
    const page = await grouped();
    const child = page.tickets.find((ticket) => ticket.key === "ACME-2");
    const html = render(page, { selectedId: ticketId(child?.connection ?? "", "EPIC-1") });
    const panel = panelText(html);
    expect(panel).toContain("읽은 범위 밖의 이슈예요");
    expect(panel).not.toContain("티켓 정보");
    expect(panel).not.toContain("하위 티켓");
    expect(html.split("<aside")[1]).toContain("issue/EPIC-1");
  });

  it("하위 티켓 패널은 상위 이슈 링크 줄을 더한다", async () => {
    const page = await grouped();
    const id = page.tickets.find((ticket) => ticket.key === "ACME-5")?.id ?? "";
    expect(panelText(render(page, { selectedId: id }))).toContain("상위 이슈 ACME-6 ACME-6 제목");
  });
});

describe("수동 할당 폼", () => {
  const choice = (id: string, overrides: Partial<RunnerChoice> = {}): RunnerChoice => ({
    id,
    name: id,
    online: true,
    assignmentBlocked: false,
    projects: ["p"],
    blockedProjects: [],
    usageLimits: [],
    ...overrides,
  });
  const runners: RunnerChoice[] = [
    choice("runner-a"),
    choice("runner-b", { online: false }),
    choice("runner-c", { assignmentBlocked: true }),
    choice("runner-d", { projects: ["q"] }),
    choice("runner-e", { projects: ["p", "q"], blockedProjects: ["p"] }),
  ];
  const labels = {
    auto: "auto",
    offline: (n: string) => `${n} offline`,
    blocked: (n: string) => `${n} blocked`,
    repoBlocked: (n: string) => `${n} repo blocked`,
    limited: (n: string, limit: { provider: string; resetsInMs: number }) =>
      `${n} ${limit.provider} ${limit.resetsInMs}`,
  };

  it("저장소를 라디오로 고르고 저장소마다 러너 수를, push가 막힌 저장소는 꺼서 보인다(0115)", () => {
    const html = renderWithMessages(
      <AssignForm
        defaults={{
          runnerProject: "q",
          agent: "claude",
          repos: [
            { id: "p", name: "acme/p", isDefault: true, label: null },
            { id: "q", name: "acme/q", isDefault: false, label: "api" },
            { id: "r", name: "acme/r", isDefault: false, label: "infra" },
          ],
        }}
        runners={[...runners, choice("runner-f", { projects: ["r"], blockedProjects: ["r"] })]}
        agents={["codex", "claude"]}
        repo="q"
        runner={AUTO_RUNNER}
        agent="claude"
        onRepoChange={noop}
        onRunnerChange={noop}
        onAgentChange={noop}
      />,
      ticketsMessages,
    );
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(3);
    expect(radios[1]).toContain('value="q"');
    expect(radios[1]).toContain("checked");
    expect(radios[2]).toContain("disabled");
    const all = text(html);
    expect(all).toContain("기본");
    expect(all).toContain("러너 4대에 있어요");
    expect(all).toContain("러너 2대에 있어요");
    expect(all).toContain("라벨 api");
    expect(all).toContain("acme/q");
    expect(all).toContain("push가 막혀 맡길 수 있는 러너가 없어요");
    expect(all).toContain("할당 때 자동으로 고르기");
    expect(all).toContain("Claude Code");
  });

  it("러너 목록: 자동 고르기가 맨 앞, 그 프로젝트가 있는 러너만, 인증이 깨진 러너는 비활성+이유", () => {
    expect(runnerOptionsFor(runners, "p", "claude", labels)).toEqual([
      { value: AUTO_RUNNER, label: "auto" },
      { value: "runner-a", label: "runner-a" },
      { value: "runner-b", label: "runner-b offline" },
      { value: "runner-c", label: "runner-c blocked", disabled: true },
      { value: "runner-e", label: "runner-e repo blocked", disabled: true },
    ]);
    expect(runnerOptionsFor(runners, "q", "claude", labels)).toContainEqual({
      value: "runner-e",
      label: "runner-e",
    });
  });

  it("고른 에이전트의 공급자 한도에 닿은 러너는 막지 않고 경고만 붙인다", () => {
    const limited = [
      choice("runner-a", { usageLimits: [{ provider: "claude", resetsInMs: 60_000 }] }),
    ];

    expect(runnerOptionsFor(limited, "p", "claude", labels)).toEqual([
      { value: AUTO_RUNNER, label: "auto" },
      { value: "runner-a", label: "runner-a claude 60000" },
    ]);
    expect(runnerOptionsFor(limited, "p", "codex", labels)).toEqual([
      { value: AUTO_RUNNER, label: "auto" },
      { value: "runner-a", label: "runner-a" },
    ]);
  });

  it("한도 경고 문구에 공급자 이름과 풀리는 시간을 보인다", () => {
    const html = renderWithMessages(
      <AssignForm
        defaults={{
          runnerProject: "p",
          agent: "claude",
          repos: [{ id: "p", name: "acme/p", isDefault: true, label: null }],
        }}
        runners={[
          choice("runner-a", { usageLimits: [{ provider: "claude", resetsInMs: 68 * 60_000 }] }),
        ]}
        agents={["claude"]}
        repo="p"
        runner="runner-a"
        agent="claude"
        onRepoChange={noop}
        onRunnerChange={noop}
        onAgentChange={noop}
      />,
      ticketsMessages,
    );
    expect(text(html)).toContain("runner-a · Claude 한도에 닿았어요. 1 hr 8 min 뒤 풀려요");
  });
});
