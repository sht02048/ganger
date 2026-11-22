import { toPullRequestId } from "@ganger/core";
import { changeRunState, requestRunCancel, updateRunRecords } from "@ganger/db";
import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runsJson from "../../messages/ko/runs.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { addTitledRun, labs, minutes, now, offlineQueuedKey, seedDatabase } from "../testing/seed";
import { loadRunsBoard } from "@ganger/app/runs/board-load";
import type { BoardRun, RunsBoardPage } from "@ganger/app/runs/board";
import { runsMessages } from "./messages";
import { RunPanelBody } from "./run-panel";
import { RunsScreen } from "./runs-screen";

const noop = () => {};

function render(page: RunsBoardPage, options: { runnerId?: string } = {}) {
  return renderWithMessages(
    <RunsScreen
      page={page}
      workspaces={[
        { id: "ws-commerce", name: "Acme Commerce" },
        { id: "ws-labs", name: "Acme Labs" },
      ]}
      selectedId={undefined}
      runnerId={options.runnerId}
      onSelect={noop}
      onOpen={noop}
      onPickWorkspace={noop}
      onOpenRunnerRuns={noop}
      onShowMoreEnded={noop}
      runHref={(id) => `/runs/${id}`}
    />,
    runsMessages,
  );
}

function panelHtml(run: BoardRun) {
  return renderWithMessages(
    <RunPanelBody run={run} detailHref={`/runs/${run.id}`} onOpenDetail={noop} />,
    runsMessages,
  );
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function find(page: RunsBoardPage, id: string | undefined): BoardRun {
  const run = [...page.active, ...page.ended].find((r) => r.id === id);
  if (run === undefined) throw new Error("run not on page");
  return run;
}

const pullRequest = {
  id: toPullRequestId("12"),
  displayId: "#12",
  url: "https://code.example.com/acme/web/pull/12",
  ci: "failure",
  checkedAt: minutes(111),
};
const signals = {
  open: true,
  headCommit: "abc",
  ciFailed: true,
  checkTotal: 7,
  failedCount: 2,
  failedChecks: ["lint", "static"],
  checksTruncated: false,
  conflict: true,
  behindBy: 3,
};

function endWithPr(prState: "open" | "merged" | "closed", ci = "failure") {
  const { db, ids } = seedDatabase();
  const id = ids.get("ACME-10");
  if (id === undefined) throw new Error("seed");
  expect(
    changeRunState(db, id, { to: "ended", agentResult: "reported-success", prState }, minutes(110))
      .ok,
  ).toBe(true);
  updateRunRecords(db, id, {
    pullRequest: { ...pullRequest, ci, signals: { ...signals, open: prState === "open" } },
  });
  return { db, id, page: loadRunsBoard(db, undefined, now, { view: "all" }) };
}

describe("끝난 런 표의 PR 번호 링크(0184)", () => {
  const statusCell = (html: string) => textOf(html.split('role="option"')[1] ?? "");

  it.each(["merged", "closed"] as const)("PR 이 %s 이면 상태 낱말 없이 번호만 붙인다", (state) => {
    const { page } = endWithPr(state, "success");
    const html = render(page);
    expect(html).toContain(`href="${pullRequest.url}"`);
    expect(html).toContain('target="_blank"');
    expect(textOf(html)).toContain(`PR ${pullRequest.displayId}`);
    expect(textOf(html)).not.toContain("PR 병합됨");
  });

  it("CI 가 실패한 열린 PR 은 이유 뒤에 번호를 붙인다", () => {
    const { page } = endWithPr("open");
    expect(textOf(render(page))).toMatch(
      new RegExp(`${runsJson.reason["ci-failed"]}\\s*·\\s*PR ${pullRequest.displayId}`),
    );
  });

  it("PR 이 없으면 아무것도 붙이지 않는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    changeRunState(
      db,
      id,
      { to: "ended", agentResult: "reported-success", prState: "none" },
      minutes(110),
    );
    const html = render(loadRunsBoard(db, undefined, now, { view: "all" }));
    expect(statusCell(html)).not.toContain("PR #");
  });
});

describe("Runs 두 구역(0173)", () => {
  it("상황 문장과 지금·끝난 런 구역을 보이고 묶음 탭·상태 칩은 없다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsBoard(db, undefined, now));
    const text = textOf(html);
    expect(text).toContain("러너와 끊긴 런이 1개 있어요.");
    expect(text).toContain("지금 1개가 돌고, 1개가 답을 기다려요.");
    expect(text).toContain("2개는 시작을 기다려요.");
    expect(text).toContain(runsJson.now.title);
    expect(text).toContain(runsJson.endedRuns.title);
    expect(html).not.toContain("묶음으로 거르기");
    expect(html).not.toContain("상태로 거르기");
  });

  it("목록에는 영어 상태 이름과 알약이 없고 한국어 한 마디를 쓴다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsBoard(db, undefined, now, { view: "all" }));
    expect(html).not.toContain("data-status-pill");
    const text = textOf(html);
    for (const name of [domain.runState.running, domain.summary.failed, domain.summary.canceled])
      expect(text).not.toContain(name);
    expect(text).toContain(runsJson.word.failed);
  });

  it("러너마다 카드 하나이고 자리 표시를 두며 꺼진 러너는 꺼져 있다고 쓴다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsBoard(db, undefined, now));
    expect(html).toContain('data-runner-card="runner-a"');
    expect(html).toContain('data-runner-card="runner-b"');
    expect(html).toContain('data-cells="meter"');
    expect(html).toContain(runsJson.now.offline);
  });

  it("꺼진 러너의 끊긴 런은 그 카드에 빨간 뜻으로 보이고 카드를 흐리게 하지 않는다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now);
    const cut = page.active.find((run) => run.state === "disconnected");
    if (cut === undefined || cut.runnerId === null) throw new Error("seed");
    const offline: RunsBoardPage = {
      ...page,
      runners: page.runners.map((r) => (r.id === cut.runnerId ? { ...r, online: false } : r)),
    };
    const html = render(offline);
    const card = html.split(`data-runner-card="${cut.runnerId}"`)[1]?.split("data-runner-card")[0];
    expect(card?.startsWith(" data-dimmed")).toBe(false);
    expect(card).toContain(runsJson.word.disconnected);
    expect(card).toContain('data-status="disconnected"');
    expect(card).toContain(runsJson.now.offline);
  });

  it("도는 런이 없는 Online 러너는 한 줄로 알리고 빈 자리 칸을 두지 않는다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, labs, now);
    const html = render({
      ...page,
      active: [],
      runners: [
        {
          id: "idle",
          name: "idle",
          online: true,
          capacity: 3,
          used: 0,
          otherWorkspaces: { count: 0, onlyWorkspaceId: null },
        },
      ],
    });
    expect(textOf(html)).toContain(runsJson.now.noRuns);
    expect(textOf(html)).toContain(runsJson.situation.none);
    expect(html).not.toContain("빈 자리");
  });

  it("좁은 화면 탭 순서를 위해 DOM 은 기다리는 런 카드를 러너 카드 앞에 둔다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsBoard(db, undefined, now));
    expect(html.indexOf("data-waiting-card")).toBeLessThan(html.indexOf("data-runner-cards"));
  });

  it("조건으로 카드가 비면 러너가 없다고 하지 않고, 다른 Workspace 의 자리는 그렇게 말한다", () => {
    const { db } = seedDatabase();
    const empty = render(loadRunsBoard(db, undefined, now, { conditions: { agent: "codex" } }));
    expect(textOf(empty)).toContain(runsJson.now.noMatch);
    expect(textOf(empty)).not.toContain(runsJson.now.noRunners);
    const page = loadRunsBoard(db, labs, now);
    const other = render({
      ...page,
      active: [],
      runners: [
        {
          id: "busy",
          name: "busy",
          online: true,
          capacity: 3,
          used: 1,
          otherWorkspaces: { count: 1, onlyWorkspaceId: "ws-other" },
        },
      ],
    });
    expect(textOf(other)).toContain("다른 Workspace에서 1개가 돌아요");
  });

  it("끝난 런 토글은 확인 필요와 모두의 수를 보인다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now);
    const text = textOf(render(page));
    expect(text).toContain(`${runsJson.endedRuns.review} ${page.endedCounts.review}`);
    expect(text).toContain(`${runsJson.endedRuns.all} ${page.endedCounts.all}`);
  });

  it("끝난 런 칸은 키·제목·러너·상태·시간이고 PR 문제를 짧은 이유로 보인다", () => {
    const { page, id } = endWithPr("open");
    const run = find(page, id);
    const html = render(page);
    const row = html.split('role="option"').find((chunk) => chunk.includes(`>${run.ticketKey}<`));
    expect(textOf(row ?? "")).toContain(
      `${runsJson.word["needs-review"]} · ${runsJson.reason["ci-failed"]}`,
    );
    const head = textOf(html.split('aria-hidden="true"').find((c) => c.includes("columns")) ?? "");
    expect(head).toBeDefined();
    for (const column of Object.values(runsJson.endedRuns.columns))
      expect(html).toContain(`>${column}<`);
  });

  it("걸린 조건은 지울 수 있는 칩이고 Stats 의 Failed 조건도 칩이다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now, {
      conditions: { runner: "runner-a", agent: "codex", days: 7 },
      failedOnly: true,
    });
    const html = render(page);
    expect(html).toContain(`role="group" aria-label="${runsJson.conditions.label}"`);
    expect(html).toContain(">러너: runner-a<");
    expect(html).toContain('aria-label="러너: runner-a 조건 지우기"');
    expect(html).toContain(">기간: 최근 7일<");
    expect(html).toContain(`>${runsJson.conditions.failed}<`);
    expect(html).toContain(`>${runsJson.conditions.clearAll}<`);
    expect(html).toContain(runsJson.endedRuns.emptyWithConditions);
    expect(render(loadRunsBoard(db, undefined, now))).not.toContain(runsJson.conditions.label);
  });

  it("끝난 런이 더 있으면 더 불러오는 버튼을 둔다", () => {
    const { db } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now, { view: "all", endedLimit: 2 });
    expect(render(page)).toContain(`>${runsJson.endedRuns.loadMore}<`);
    expect(render({ ...page, moreEnded: false })).not.toContain(runsJson.endedRuns.loadMore);
  });

  it("전체에서는 Workspace 를 고르라고 보인다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsBoard(db, "all", now));
    expect(html).toContain(runsJson.allWorkspaces.body);
    expect(html).toContain("Acme Labs");
    expect(html).not.toContain('role="option"');
  });
});

describe("Runs 패널(0173)", () => {
  it("PR CI 실패면 처리할 일 상자에 실패한 검사 보기와 이어서 맡기기를 둔다", () => {
    const { page, id } = endWithPr("open");
    const html = panelHtml({ ...find(page, id), canContinue: true });
    const text = textOf(html);
    expect(text).toContain(runsJson.panel.todoTitle);
    expect(text).toContain(runsJson.panel.prSection.failedChecks);
    expect(text).toContain(runsJson.panel.continue);
    expect(html).toContain(`href="${pullRequest.url}/checks"`);
    expect(text).toContain("7개 중 2개 실패");
    expect(text).toContain("3커밋 뒤");
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1);
  });

  it("이어서 맡길 수 없는 런에는 이어서 맡기기를 두지 않는다", () => {
    const { page, id } = endWithPr("open");
    const html = panelHtml({ ...find(page, id), canContinue: false });
    expect(textOf(html)).not.toContain(runsJson.panel.continue);
  });

  it("런 상세로 가는 버튼은 이동임을 문구로 드러낸다", () => {
    const { db, ids } = seedDatabase();
    const run = find(loadRunsBoard(db, undefined, now), ids.get("ACME-10"));
    const text = textOf(panelHtml({ ...run, nextStep: "paused" }));
    expect(text).toContain(runsJson.panel.inDetail.paused);
  });

  it("Merged PR 은 처리할 일 없이 CI 줄만 둔다", () => {
    const { page, id } = endWithPr("merged", "success");
    const html = panelHtml(find(page, id));
    const text = textOf(html);
    expect(text).not.toContain(runsJson.panel.todoTitle);
    expect(text).toContain(runsJson.panel.prSection.state.merged);
    expect(text).not.toContain(runsJson.panel.prSection.conflict);
  });

  it("런 정보는 에이전트와 결과이고 런 상세 열기 링크를 둔다", () => {
    const { page, id } = endWithPr("open");
    const html = panelHtml(find(page, id));
    expect(textOf(html)).toContain(domain.agent.claude);
    expect(textOf(html)).toContain(domain.agentResult["reported-success"]);
    expect(html).toMatch(new RegExp(`href="/runs/${id}"[^>]*data-variant="primary"`));
    expect(textOf(html)).toContain(runsJson.panel.openDetail);
  });

  it("Queued 런은 기다리는 이유를 보인다", () => {
    const { db, ids } = seedDatabase();
    const page = loadRunsBoard(db, undefined, now);
    expect(textOf(panelHtml(find(page, ids.get(offlineQueuedKey))))).toContain(
      domain.queuedReason["runner-offline"],
    );
    expect(textOf(panelHtml(find(page, ids.get("ACME-13"))))).toContain(
      domain.queuedReason.starting,
    );
  });

  it("처리되지 않은 취소 요청이 있으면 취소 중을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    expect(requestRunCancel(db, id, minutes(110)).ok).toBe(true);
    const text = textOf(panelHtml(find(loadRunsBoard(db, undefined, now), id)));
    expect(text).toContain(runsJson.panel.cancelling);
    expect(text).toContain(runsJson.panel.cancellingReason);
  });

  it("못 읽은 PR 은 이유를 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    changeRunState(
      db,
      id,
      {
        to: "ended",
        agentResult: "reported-success",
        prState: "unknown",
        prReadError: "no-access",
      },
      minutes(110),
    );
    const page = loadRunsBoard(db, undefined, now, { view: "all" });
    expect(textOf(panelHtml(find(page, id)))).toContain(runsJson.panel.prUnread["no-access"]);
  });

  it("제목 있는 런도 패널을 그린다", () => {
    const { db } = seedDatabase();
    const id = addTitledRun(db, "ACME-30", "결제 실패 재시도");
    const page = loadRunsBoard(db, undefined, now);
    expect(textOf(panelHtml(find(page, id)))).toContain(runsJson.panel.openDetail);
  });
});
