import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { addRunDecisionCases, now, seedStatsDatabase } from "../testing/stats-seed";
import { loadStatsPage } from "@ganger/app/stats/load";
import { statsMessages } from "./messages";
import type { StatsDimension, StatsPage, StatsPeriodDays } from "@ganger/app/stats/model";
import { StatsScreen } from "./stats-screen";

const noop = () => {};

function render(
  page: StatsPage,
  options: {
    dimension?: StatsDimension;
    runsHref?: (dimension: StatsDimension, key: string, days: StatsPeriodDays) => string;
    failedRunsHref?: (days: StatsPeriodDays) => string;
  } = {},
) {
  return renderWithMessages(
    <StatsScreen
      page={page}
      workspaces={[
        { id: "ws-commerce", name: "Acme Commerce" },
        { id: "ws-labs", name: "Acme Labs" },
      ]}
      dimension={options.dimension ?? "runner"}
      onDimensionChange={noop}
      onPeriodChange={noop}
      onPickWorkspace={noop}
      {...(options.runsHref === undefined ? {} : { runsHref: options.runsHref })}
      {...(options.failedRunsHref === undefined ? {} : { failedRunsHref: options.failedRunsHref })}
    />,
    statsMessages,
  );
}

function seeded(days: StatsPeriodDays = 14): StatsPage {
  return loadStatsPage(seedStatsDatabase(), undefined, now, "UTC", days);
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from);
  return html.slice(start, html.indexOf(to, start));
}

function tiles(html: string): string[] {
  return html
    .split('role="group"')
    .slice(1)
    .map((chunk) => text(`<${chunk.slice(0, chunk.indexOf("</div>"))}`).trim());
}

function breakdownRows(html: string): string[][] {
  const body = between(html.slice(html.lastIndexOf("<table")), "<tbody", "</tbody>");
  return body
    .split(/<tr[\s>]/)
    .slice(1)
    .map((row) => {
      const label = /aria-label="([^"]+)"/.exec(row)?.[1] ?? "";
      return [
        ...row
          .split(/<[^>]+>/)
          .map((s) => s.trim())
          .filter((s) => s !== "" && !s.includes("=")),
        label,
      ];
    });
}

describe("Stats 화면(0072)", () => {
  it("한 줄 머리에 화면 이름 제목과 결론 요약을 두고, 그 아래에 Workspace·기간을 둔다(0113)", () => {
    const html = render(seeded());
    const header = between(html, "<header", "</header>");
    expect(header).toMatch(/<h1[^>]*>Stats<\/h1>/);
    expect(text(header)).toContain("끝난 런 9개 중 56%가 Succeeded예요.");
    expect(text(html)).toContain("Acme Commerce · 11월 4일–11월 17일");
    expect(text(html)).not.toContain("Stats · Acme Commerce");
  });

  it("기간 7일 · 14일 · 30일을 한 줄 탭으로 고르고 지금 기간이 골라져 있다", () => {
    const html = render(seeded(7));
    const periods = between(html, 'aria-label="기간"', "</div>");
    expect(text(periods)).toContain("7일 14일 30일");
    expect(periods).toMatch(/aria-selected="true"[^>]*>7일/);
  });

  it("숫자 넷은 같은 모양 카드로 성공률·PR 병합·리드 타임·끝난 런이다 (R5)", () => {
    expect(tiles(render(seeded()))).toEqual([
      "성공률 56% 앞 14일보다 44%p 내렸어요",
      "PR 병합 3 이 기간에 끝난 런 중 PR이 병합된 런 수예요",
      "리드 타임 중앙값 22 min 느린 10%는 2 hr 1 min 넘게 걸렸어요",
      "끝난 런 9",
    ]);
  });

  it("성공률은 같은 길이의 바로 앞 기간과 비교하고 좋아지면 better, 나빠지면 worse 다", () => {
    const fourteen = render(seeded(14));
    expect(fourteen).toMatch(/data-trend="worse"[^>]*>앞 14일보다 44%p 내렸어요/);
    const seven = render(seeded(7));
    expect(seven).toMatch(/data-trend="better"[^>]*>앞 7일보다 7%p 올랐어요/);
    expect(text(seven)).toContain("끝난 런 7개 중 57%가 Succeeded예요");
  });

  it("앞 기간에 비율을 낼 런이 없으면 비교할 런이 없다고 말한다", () => {
    const html = render(seeded(30));
    expect(text(html)).toContain("앞 30일에는 비교할 런이 없어요");
    expect(html).not.toContain('data-trend="better"');
    expect(html).not.toContain('data-trend="worse"');
  });

  it("기간을 바꾸면 숫자와 차트 막대 수가 바뀐다", () => {
    const fourteen = render(seeded(14));
    const seven = render(seeded(7));
    expect(tiles(fourteen)[3]).toBe("끝난 런 9");
    expect(tiles(seven)[3]).toBe("끝난 런 7");
    expect(fourteen.match(/title="[^"]*: Succeeded/g)).toHaveLength(14);
    expect(seven.match(/title="[^"]*: Succeeded/g)).toHaveLength(7);
    expect(between(seven, "<tbody", "</tbody>").match(/<th scope="row"/g)).toHaveLength(7);
  });

  it("차트의 마지막 날 이름은 오늘이고 범례는 제목 옆에 있다", () => {
    const html = render(seeded());
    const head = text(between(html, "날짜별로 끝난 런</h2>", 'role="img"'));
    expect(head).toContain("Succeeded Failed Canceled");
    expect(head).not.toContain("Human Check");
    const days = text(between(html, 'role="img"', "표로 보기")).trim();
    expect(days.endsWith("오늘")).toBe(true);
  });

  it("날짜별 막대에 마우스로 볼 날마다 요약 결과 수를 단다", () => {
    const html = render(seeded());
    expect(html).toContain('title="11월 16일: Succeeded 1 · Failed 1 · Canceled 0"');
  });

  it("날짜별 값을 차트와 이은 표로 접근성 트리에 둔다(0053)", () => {
    const html = render(seeded());
    const tableId = /<table id="([^"]+)"/.exec(html)?.[1];
    expect(tableId).toBeDefined();
    expect(html).toMatch(new RegExp(`role="img"[^>]*aria-details="${tableId ?? ""}"`));
    const table = html.slice(html.indexOf(`<table id="${tableId ?? ""}"`));
    const throughput = table.slice(0, table.indexOf("</table>"));
    expect(throughput).toContain("<caption");
    expect(text(throughput)).toContain("날짜별로 끝난 런 수 날짜 Succeeded Failed Canceled");
    expect(throughput.match(/<th scope="row"/g)).toHaveLength(14);
    expect(text(throughput)).toContain("11월 16일 1 1 0");
    expect(throughput).not.toMatch(/\shidden|display:\s*none|aria-hidden/);
    expect(html).toContain("표로 보기");
  });

  it("왜 실패했나요는 실패 이유를 말로 쓰고 PR 상태를 한 줄로, 막대와 개수를 함께 보인다", () => {
    const html = render(seeded());
    const failures = between(html, "왜 실패했나요</h2>", "나눠 보기");
    expect(text(failures)).toContain("왜 실패했나요 4");
    expect(text(failures)).toContain("에이전트가 실패를 보고했어요 PR 없음 2개 · 열림 1개 3개");
    expect(text(failures)).toContain("최대 실행 시간을 넘겼어요 PR 열림 1개 1개");
    expect(text(failures)).not.toContain("PR이 병합되지 않고 닫혔어요");
    expect(failures.match(/<li/g)).toHaveLength(2);
    expect(failures).not.toContain("완료 보고");
  });

  it("실패 이유에 에이전트가 중간에 멈춤과 런을 시작하지 못함이 말로 보인다", () => {
    const db = seedStatsDatabase();
    addRunDecisionCases(db);
    const failures = text(
      between(
        render(loadStatsPage(db, undefined, now, "UTC", 14)),
        "왜 실패했나요</h2>",
        "나눠 보기",
      ),
    );
    expect(failures).toContain("에이전트가 중간에 멈췄어요 PR 없음 1개 1개");
    expect(failures).toContain("런을 시작하지 못했어요 PR 없음 1개 1개");
    expect(failures).not.toContain("Canceled");
  });

  it("나눠 보기는 러너 · 트래커 프로젝트 · 에이전트 탭과 이름 · 끝난 런 · 성공률 · 리드 타임 숫자 열이다", () => {
    const html = render(seeded());
    expect(text(between(html, 'aria-label="나눠 볼 기준"', "</div>"))).toContain(
      "러너 트래커 프로젝트 에이전트",
    );
    expect(breakdownRows(html)).toEqual([
      ["runner-a", "5", "80%", "22 min", ""],
      ["runner-b", "4", "25%", "18 min", ""],
    ]);
    expect(breakdownRows(render(seeded(), { dimension: "agent" })).map((r) => r[0])).toEqual([
      "Claude Code",
      "Codex",
    ]);
  });

  it("나눠 보기 행 이름은 그 행의 조건과 Stats 기간으로 Runs 를 여는 링크다(0075)", () => {
    const runsHref = (dimension: StatsDimension, key: string, days: StatsPeriodDays) =>
      `/runs?${dimension}=${key}&days=${days}`;
    const html = render(seeded(7), { runsHref });
    const body = between(html.slice(html.lastIndexOf("<table")), "<tbody", "</tbody>");
    expect(body).toContain(
      '<a href="/runs?runner=runner-a&amp;days=7" aria-label="runner-a의 런 보기"',
    );
    const agents = render(seeded(), { runsHref, dimension: "agent" });
    expect(agents).toContain('aria-label="Claude Code의 런 보기"');
    expect(agents).toContain('href="/runs?agent=claude&amp;days=14"');
    expect(render(seeded())).not.toContain("의 런 보기");
  });

  it("나눠 보기 표의 열 머리는 이름 · 끝난 런 · 성공률 · 리드 타임이다", () => {
    const html = render(seeded());
    const breakdown = html.slice(html.lastIndexOf("<table"));
    expect(text(between(breakdown, "<thead", "</thead>")).trim()).toBe(
      "이름 끝난 런 성공률 리드 타임",
    );
  });

  it("나눠 보기 표 아래에 이름을 누르면 Runs 가 열린다고 알려 준다. 링크가 없으면 알리지 않는다", () => {
    const runsHref = () => "/runs";
    expect(text(render(seeded(), { runsHref }))).toContain(
      "이름을 누르면 그 조건과 기간으로 Runs가 열려요.",
    );
    expect(text(render(seeded()))).not.toContain("이름을 누르면");
  });

  it("왜 실패했나요 아래 'Failed 런 보기'는 Stats 기간의 Failed 런을 여는 링크다", () => {
    const failedRunsHref = (days: StatsPeriodDays) => `/runs?f=failed&days=${days}`;
    const html = render(seeded(7), { failedRunsHref });
    const failures = between(html, "왜 실패했나요</h2>", "나눠 보기");
    expect(failures).toMatch(/<a href="\/runs\?f=failed&amp;days=7"[^>]*>Failed 런 보기<\/a>/);
    expect(render(seeded())).not.toContain("Failed 런 보기");
  });

  it("기간에 Failed 런이 없으면 'Failed 런 보기'를 두지 않는다", () => {
    const failedRunsHref = () => "/runs?f=failed";
    const html = render(
      loadStatsPage(seedStatsDatabase(), undefined, new Date("2027-01-01T00:00:00Z"), "UTC", 14),
      { failedRunsHref },
    );
    expect(html).not.toContain("Failed 런 보기");
  });

  it("오른쪽 상세 패널이 없고 나눠 보기 행은 고르는 목록이 아니다", () => {
    const html = render(seeded());
    expect(html).not.toContain("<aside");
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
  });

  it("기간에 끝난 런이 없으면 제목과 구역이 그렇다고 말한다", () => {
    const html = render(
      loadStatsPage(seedStatsDatabase(), undefined, new Date("2027-01-01T00:00:00Z"), "UTC", 14),
    );
    expect(text(between(html, "<header", "</header>"))).toContain(
      "최근 14일 동안 끝난 런이 없어요.",
    );
    expect(text(html)).toContain("이 기간에 Failed 런이 없어요.");
    expect(text(html)).toContain("최근 14일 동안 끝난 런이 없어요. 런이 끝나면 여기에 보여요.");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<table");
  });

  it("노란 주 버튼이 없다. 보기만 하는 화면이다(ADR 0010 6번)", () => {
    expect(render(seeded())).not.toContain('data-variant="primary"');
  });

  it("전체 보기에서는 Workspace 를 고르라고 안내한다", () => {
    const html = text(render(loadStatsPage(seedStatsDatabase(), "all", now, "UTC", 14)));
    expect(html).toContain("통계는 Workspace마다 봐요.");
    expect(html).toContain("Acme Labs 보기");
  });

  describe("Canceled(Q82.9·Q82.18)", () => {
    const page = () => {
      const db = seedStatsDatabase();
      addRunDecisionCases(db);
      return loadStatsPage(db, undefined, now, "UTC", 14);
    };

    it("제목은 Canceled 를 뺀 수로 말하고 뺐다는 설명은 끝난 런 카드가 맡는다", () => {
      const html = render(page());
      expect(text(between(html, "<header", "</header>"))).toContain(
        "끝난 런 11개 중 45%가 Succeeded예요.",
      );
      expect(html).not.toContain("Canceled를 뺀");
      expect(tiles(html)[3]).toBe("끝난 런 13 Canceled 2개를 빼고 11개로 비율을 내요");
      expect(html).toContain('title="11월 17일: Succeeded 1 · Failed 2 · Canceled 2"');
    });

    it("나눠 보기 끝난 런은 Canceled 를 세고 성공률은 Canceled 를 빼고 낸다", () => {
      const rows = breakdownRows(render(page(), { dimension: "agent" }));
      expect(rows.find((r) => r[0] === "gemini")).toEqual(["gemini", "2", "0%", "11 min", ""]);
    });
  });
});
