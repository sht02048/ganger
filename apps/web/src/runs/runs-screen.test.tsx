import {
  toAgentId,
  toPullRequestId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
} from "@ganger/core";
import { assignRun, changeRunState, requestRunCancel, updateRunRecords } from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runsJson from "../../messages/ko/runs.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import {
  addTitledRun,
  connection,
  endedCases,
  labs,
  minutes,
  now,
  offlineQueuedKey,
  seedDatabase,
} from "../testing/seed";
import { loadHomePage } from "@ganger/app/home/load";
import { loadRunsPage } from "@ganger/app/runs/load";
import { runsMessages } from "./messages";
import type { RunFilter, RunsPage, RunView } from "@ganger/app/runs/model";
import { RunsScreen } from "./runs-screen";

const noop = () => {};

function render(
  page: RunsPage,
  options: { filter?: RunFilter; selectedId?: string | undefined } = {},
) {
  return renderWithMessages(
    <RunsScreen
      page={page}
      workspaces={[
        { id: "ws-commerce", name: "Acme Commerce" },
        { id: "ws-labs", name: "Acme Labs" },
      ]}
      filter={options.filter ?? "all"}
      selectedId={options.selectedId}
      onFilterChange={noop}
      onSelect={noop}
      onOpen={noop}
      onPickWorkspace={noop}
      onShowMoreEnded={noop}
      runHref={(id) => `/runs/${id}`}
    />,
    runsMessages,
  );
}

interface RowCells {
  key: string;
  title: string;
  runner: string;
  result: string;
  pill: string;
  time: string;
}

function spanEnd(html: string, start: number): number {
  let depth = 0;
  let at = start;
  do {
    const open = html.indexOf("<span", at + 1);
    const close = html.indexOf("</span>", at + 1);
    if (close === -1) throw new Error("unclosed span");
    if (open !== -1 && open < close) {
      depth += 1;
      at = open;
    } else {
      depth -= 1;
      at = close;
    }
  } while (depth >= 0);
  return at + "</span>".length;
}

function withoutFoldedOnly(html: string): string {
  let out = html;
  for (let start = out.indexOf("<span data-folded-only="); start !== -1;) {
    out = out.slice(0, start) + out.slice(spanEnd(out, start));
    start = out.indexOf("<span data-folded-only=");
  }
  return out;
}

function foldedLine(html: string, key: string): string {
  const row = html.split('role="option"').find((chunk) => chunk.includes(`>${key}<`)) ?? "";
  const start = row.indexOf('<span data-folded-only="first"');
  if (start === -1) return "";
  return row.slice(start, spanEnd(row, start)).replace(/<[^>]+>/g, "");
}

function rowTexts(html: string): Map<string, RowCells> {
  const rows = new Map<string, RowCells>();
  for (const chunk of withoutFoldedOnly(html).split('role="option"').slice(1)) {
    const cells = chunk
      .split(/<[^>]+>/)
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.includes("="));
    const [key, ...rest] = cells;
    if (key === undefined) continue;
    const untitled = /data-hide-when="stacked"[^>]*><\/span>/.test(chunk);
    const [title, runner, result, pill, time] = untitled ? [key, ...rest] : rest;
    rows.set(key, {
      key,
      title: title ?? "",
      runner: runner ?? "",
      result: result ?? "",
      pill: pill ?? "",
      time: time ?? "",
    });
  }
  return rows;
}

function panelText(html: string): string {
  const panel = html.split("<aside")[1] ?? "";
  return panel.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function addProjectMissingRun(db: Database, key: string): string {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject: toTrackerProjectId("tp-web"),
    runnerProject: toRunnerProjectId("github:acme/gone"),
    agent: toAgentId("claude"),
    now: minutes(100),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.run.id;
}

describe("Runs 화면", () => {
  it("Ended 런은 알약에 요약 결과, 흐린 줄에 러너와 에이전트 결과를 보인다", () => {
    const { db } = seedDatabase();
    const rows = rowTexts(render(loadRunsPage(db, undefined, now)));
    for (const c of endedCases) {
      const cells = rows.get(c.key);
      expect({ key: c.key, pill: cells?.pill }).toEqual({
        key: c.key,
        pill: domain.summary[c.summary],
      });
      expect(cells?.result).toContain(domain.agentResult[c.agentResult]);
    }
  });

  it("Ended 가 아닌 런은 알약에 런 상태, 흐린 줄에 러너와 에이전트를 보인다", () => {
    const { db } = seedDatabase();
    const rows = rowTexts(render(loadRunsPage(db, undefined, now)));
    const running = rows.get("ACME-10");
    expect([running?.runner, running?.result, running?.pill]).toEqual([
      "runner-a",
      domain.agent.claude,
      domain.runState.running,
    ]);
    expect(rows.get("ACME-11")?.pill).toBe(domain.runState["waiting-for-input"]);
    expect(rows.get("ACME-12")?.pill).toBe(domain.runState.disconnected);
    expect(rows.get("ACME-13")?.pill).toBe(domain.runState.queued);
    expect(rows.get(offlineQueuedKey)?.runner).toBe(runsJson.noRunner);
  });

  it("행은 키·제목·러너·결과·상태·시간 열이고 열 머리를 둔다(0101)", () => {
    const { db } = seedDatabase();
    const id = addTitledRun(db, "ACME-30", "결제 실패 재시도");
    const html = render(loadRunsPage(db, undefined, now), { selectedId: id });
    const head = html
      .split('aria-hidden="true"')
      .find((chunk) => chunk.includes(runsJson.columns.key));
    const headers = (head ?? "")
      .split("</div>")[0]
      ?.split(/<[^>]+>/)
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.includes("="));
    expect(headers).toEqual([
      runsJson.columns.key,
      runsJson.columns.title,
      runsJson.columns.runner,
      runsJson.columns.result,
      runsJson.columns.status,
      runsJson.columns.time,
    ]);
    const row = rowTexts(html).get("ACME-30");
    expect(row?.title).toBe("결제 실패 재시도");
    expect(row?.runner).not.toBe("");
    expect(html).toContain('title="결제 실패 재시도"');
  });

  it("좁아져 접히면 러너와 결과가 제목 아래 둘째 줄로 돌아간다(0101)", () => {
    const { db } = seedDatabase();
    addTitledRun(db, "ACME-30", "결제 실패 재시도");
    const html = render(loadRunsPage(db, undefined, now));
    const rows = rowTexts(html);
    const running = rows.get("ACME-10");
    expect(foldedLine(html, "ACME-10")).toBe(
      [running?.runner, running?.result].join(runsJson.metaSeparator),
    );
    const titled = rows.get("ACME-30");
    expect(titled?.title).toBe("결제 실패 재시도");
    expect(foldedLine(html, "ACME-30")).toBe(
      [titled?.key, titled?.runner, titled?.result].join(runsJson.metaSeparator),
    );
    const ended = endedCases[0];
    if (ended === undefined) throw new Error("no ended case");
    expect(foldedLine(html, ended.key)).toContain(domain.agentResult[ended.agentResult]);
  });

  it("시간 칸은 끝난 런이면 상대 시간, 진행 중이면 경과다(ADR 0010 7번)", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const rows = rowTexts(render(page));
    const times = page.runs.map((run) => ({
      ended: run.state === "ended",
      time: rows.get(run.ticketKey)?.time ?? "",
    }));
    const relative = /^(Just now|\d+ (min|hr) ago|\d+월 \d+일)$/;
    expect(times.filter((r) => r.ended).every((r) => relative.test(r.time))).toBe(true);
    expect(
      times
        .filter((r) => !r.ended)
        .every((r) => /^(<1 min|\d+ min|\d+ hr( \d+ min)?|\d+ days?)$/.test(r.time)),
    ).toBe(true);
    expect(times.some((r) => r.ended) && times.some((r) => !r.ended)).toBe(true);
  });

  it("패널에 상태, 요약 결과, 두 축, 러너, 에이전트, 경과 시간, PR 을 보인다", () => {
    const { db, ids } = seedDatabase();
    const text = panelText(
      render(loadRunsPage(db, undefined, now), { selectedId: ids.get("ACME-2") }),
    );
    expect(text).toContain(domain.summary.failed);
    expect(text).toContain(domain.agentResult["reported-failure"]);
    expect(text).toContain(runsJson.panel.prSection.state.open);
    expect(text).toContain(runsJson.panel.reason.failed);
    expect(text).toContain("runner-a");
    expect(text).toContain(domain.agent.claude);
    expect(text).toContain("29 min");
    expect(text).toContain("#2");
  });

  it("행과 패널이 회색 키 옆에 할당 때 저장한 티켓 제목을 보인다(ADR 0010 9번, 0064)", () => {
    const { db } = seedDatabase();
    const id = addTitledRun(db, "ACME-30", "결제 실패 재시도");
    const html = render(loadRunsPage(db, undefined, now), { selectedId: id });
    const titled = rowTexts(html).get("ACME-30");
    expect([titled?.key, titled?.title]).toEqual(["ACME-30", "결제 실패 재시도"]);
    expect(html).toMatch(/<h2[^>]*>결제 실패 재시도<\/h2>/);
    expect(panelText(html)).toContain("ACME-30 · Web");
  });

  it("패널에 Run 상세로 가는 링크를 둔다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    const html = render(loadRunsPage(db, undefined, now), { selectedId: id });
    expect(html).toContain(`href="/runs/${id ?? ""}"`);
    expect(panelText(html)).toContain(runsJson.panel.openDetail);
  });

  it("진행 중인 런의 경과 시간은 패널에 한 번만 보인다", () => {
    const { db, ids } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const text = panelText(render(page, { selectedId: ids.get("ACME-10") }));
    expect(text.match(/(<1 min|\d+ days?|\d+ hr( \d+ min)?|\d+ min)(?! ago)\b/g)).toHaveLength(1);
  });

  it("러너가 Offline 이면 패널에 Offline 알약을 보인다", () => {
    const { db, ids } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const id = ids.get("ACME-10");
    const offline: RunsPage = {
      ...page,
      runs: page.runs.map((run) =>
        run.id === id ? { ...run, runner: { name: "runner-a", online: false } } : run,
      ),
    };
    const html = render(offline, { selectedId: id }).split("<aside")[1] ?? "";
    expect(html).toContain(`>${domain.runnerState.offline}<`);
  });

  it("필터에 맞는 런이 없으면 패널에 빈 상태 한 줄을 둔다", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, labs, now);
    expect(panelText(render(page, { filter: "succeeded" }))).toContain(runsJson.panel.empty);
    const empty: RunsPage = { ...page, runs: [] };
    expect(panelText(render(empty))).toContain(runsJson.panel.noRuns);
  });

  it("걸린 조건을 지울 수 있는 버튼 줄로 보이고, 맞는 런이 없으면 조건 때문이라고 알린다(0075)", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now, 50, {
      runner: "runner-a",
      agent: "codex",
      days: 7,
    });
    const html = render(page);
    expect(html).toContain(`role="group" aria-label="${runsJson.conditions.label}"`);
    expect(html).toContain(">러너: runner-a<");
    expect(html).toContain(`aria-label="러너: runner-a 조건 지우기"`);
    expect(html).toContain(">기간: 최근 7일<");
    expect(html).toContain(`>${runsJson.conditions.clearAll}<`);
    expect(html).toContain(runsJson.noRunsWithConditions);
    expect(panelText(html)).toContain(runsJson.panel.noRunsWithConditions);

    const one = render(loadRunsPage(db, undefined, now, 50, { runner: "" }));
    expect(one).toContain(`>${runsJson.conditions.noRunner}<`);
    expect(one).not.toContain(runsJson.conditions.clearAll);
    expect(render(loadRunsPage(db, undefined, now))).not.toContain(runsJson.conditions.label);
  });

  it("끝난 런이 더 있으면 몇 개까지 보이는지 알리고 '더 보기'를 둔다", () => {
    const { db } = seedDatabase();
    const page: RunsPage = { ...loadRunsPage(db, undefined, now), moreEnded: true };
    const ended = page.runs.filter((run) => run.state === "ended").length;
    const html = render(page);
    expect(html).toContain(runsJson.ended.partial.replace("{count}", String(ended)));
    expect(html).toContain(`>${runsJson.ended.showMore}<`);
    expect(render({ ...page, moreEnded: false })).not.toContain(runsJson.ended.showMore);
  });

  it("Queued 런의 패널에 기다리는 이유를 보인다(Q65·Q68)", () => {
    const { db, ids } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    expect(panelText(render(page, { selectedId: ids.get(offlineQueuedKey) }))).toContain(
      domain.queuedReason["runner-offline"],
    );
    expect(panelText(render(page, { selectedId: ids.get("ACME-13") }))).toContain(
      domain.queuedReason.starting,
    );
  });

  it("상태 필터는 고른 상태나 요약 결과의 런만 보이고 개수를 센다", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const failed = rowTexts(render(page, { filter: "failed" }));
    expect([...failed.keys()].sort()).toEqual(
      endedCases
        .filter((c) => c.summary === "failed")
        .map((c) => c.key)
        .sort(),
    );
    const waiting = rowTexts(render(page, { filter: "waiting-for-input" }));
    expect([...waiting.keys()]).toEqual(["ACME-11"]);
    const queued = rowTexts(render(page, { filter: "queued" }));
    expect([...queued.keys()].sort()).toEqual(["ACME-13", offlineQueuedKey].sort());
  });

  it("필터는 두 줄이다: 위는 모두·처리할 일·진행 중·끝남 묶음, 아래는 상태별 칩(티켓 0091)", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const tablist = (html: string, label: string): string => {
      const start = html.indexOf(`aria-label="${label}"`);
      expect(html.slice(start, html.indexOf(">", start))).toContain('role="tablist"');
      return html.slice(start, html.indexOf("</div>", start));
    };
    const tabs = (list: string) =>
      [
        ...list.matchAll(
          /<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/g,
        ),
      ].map((m) => ({
        selected: m[1] === "true",
        text: (m[2] ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      }));

    const all = render(page);
    const groups = tabs(tablist(all, runsJson.filter.groupLabel));
    const count = (filter: RunFilter) => rowTexts(render(page, { filter })).size;
    expect(groups.map((tab) => tab.text)).toEqual([
      `${runsJson.filter.all} ${page.runs.length}`,
      `${runsJson.filter.attention} ${count("attention")}`,
      `${runsJson.filter["in-progress"]} ${count("in-progress")}`,
      `${runsJson.filter.done} ${count("done")}`,
    ]);
    expect(groups.map((tab) => tab.selected)).toEqual([true, false, false, false]);
    expect(count("attention") + count("in-progress") + count("done")).toBe(page.runs.length);

    const statuses = tabs(tablist(all, runsJson.filter.statusLabel));
    expect(statuses.map((tab) => tab.text.replace(/ \d+$/, ""))).toEqual([
      "Running",
      "Paused",
      "Waiting for Input",
      "Disconnected",
      "Queued",
      "Succeeded",
      "Failed",
      "Canceled",
    ]);
    expect(statuses.some((tab) => tab.selected)).toBe(false);

    const queued = render(page, { filter: "queued" });
    expect(tabs(tablist(queued, runsJson.filter.groupLabel)).some((tab) => tab.selected)).toBe(
      false,
    );
    expect(
      tabs(tablist(queued, runsJson.filter.statusLabel))
        .filter((tab) => tab.selected)
        .map((tab) => tab.text),
    ).toEqual([`Queued ${count("queued")}`]);
  });

  it("진행 중은 Queued·Running 런, 끝남은 처리할 일이 아닌 끝난 런이다(티켓 0091)", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const keysOf = (filter: RunFilter) => [...rowTexts(render(page, { filter })).keys()].sort();
    expect(keysOf("in-progress")).toEqual(
      page.runs
        .filter((run) => run.state === "queued" || run.state === "running")
        .map((run) => run.ticketKey)
        .sort(),
    );
    expect(keysOf("done")).toEqual(
      page.runs
        .filter((run) => run.state === "ended" && !run.attention)
        .map((run) => run.ticketKey)
        .sort(),
    );
    expect(keysOf("in-progress").length).toBeGreaterThan(0);
    expect(keysOf("done").length).toBeGreaterThan(0);
  });

  it("처리할 일 칩과 머리글 수는 Dashboard 의 To do 런과 같다(티켓마다 마지막 런)", () => {
    const { db, ids } = seedDatabase();
    const homeRunIds = (): string[] =>
      loadHomePage(db, "ws-commerce", now, "UTC")
        .attention.flatMap((item) => (item.kind === "run" ? [item.run.id] : []))
        .sort();
    const attentionIds = (page: RunsPage): string[] => {
      const keys = new Set(rowTexts(render(page, { filter: "attention" })).keys());
      return page.runs
        .filter((run) => keys.has(run.ticketKey) && run.attention)
        .map((run) => run.id)
        .sort();
    };

    let page = loadRunsPage(db, undefined, now);
    expect(attentionIds(page)).toEqual(homeRunIds());
    expect(homeRunIds().length).toBeGreaterThan(0);
    expect(render(page)).toContain(
      `${page.runs.length}개 중 ${homeRunIds().length}개가 처리할 일이에요.`,
    );

    const failedKey = endedCases.find((c) => c.summary === "failed")?.key;
    if (failedKey === undefined) throw new Error("seed");
    const result = assignRun(db, {
      ticket: { connection, key: toTicketKey(failedKey) },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(110),
    });
    expect(result.ok).toBe(true);
    page = loadRunsPage(db, undefined, now);
    const oldFailed = ids.get(failedKey);
    expect(page.runs.find((run) => run.id === oldFailed)?.attention).toBe(false);
    expect(attentionIds(page)).toEqual(homeRunIds());
  });

  it("PR 정보를 읽지 못한 런은 행에 PR 못 읽음을, 패널에 이유를 보인다 (0144)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    const ended = changeRunState(
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
    expect(ended.ok).toBe(true);
    const page = loadRunsPage(db, undefined, now);
    expect(page.runs.find((run) => run.id === id)).toMatchObject({
      prState: "unknown",
      prReadError: "no-access",
    });
    const row = rowTexts(render(page)).get("ACME-10");
    expect(row?.result).toBe(
      [domain.agentResult["reported-success"], runsJson.prUnread].join(runsJson.metaSeparator),
    );
    expect(row?.pill).toBe(domain.summary.succeeded);
    const text = panelText(render(page, { selectedId: id }));
    expect(text).toContain(runsJson.panel.reason.succeeded);
    expect(text).toContain(runsJson.panel.prUnread["no-access"]);
    expect(text).toContain(runsJson.panel.prSection.state.unknown);
  });

  it("열린 PR 의 CI 실패·충돌·뒤처짐을 행에 보이고 요약 결과는 그대로다 (0150)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    expect(
      changeRunState(
        db,
        id,
        { to: "ended", agentResult: "reported-success", prState: "open" },
        minutes(110),
      ).ok,
    ).toBe(true);
    const pullRequest = {
      id: toPullRequestId("12"),
      displayId: "#12",
      url: "https://code.example.com/acme/web/pull/12",
      ci: "failure",
      checkedAt: minutes(111),
    };
    updateRunRecords(db, id, {
      pullRequest: {
        ...pullRequest,
        signals: {
          open: true,
          headCommit: "abc",
          ciFailed: true,
          checkTotal: 4,
          failedCount: 1,
          failedChecks: ["lint"],
          checksTruncated: false,
          conflict: true,
          behindBy: 3,
        },
      },
    });
    const html = render(loadRunsPage(db, undefined, now));
    const row = html.split('role="option"').find((chunk) => chunk.includes(">ACME-10<"));
    const marks = row?.slice(row.indexOf("data-pr-marks")).replace(/<[^>]+>/g, " ");
    expect(marks).toContain(runsJson.prMarks.ciFailed);
    expect(marks).toContain(runsJson.prMarks.conflict);
    expect(marks).toContain(runsJson.prMarks.behind.replace("{count}", "3"));
    expect(row).toContain(domain.summary.succeeded);

    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(112) } });
    expect(render(loadRunsPage(db, undefined, now))).not.toContain("data-pr-marks");
  });

  it("PR 정보를 읽지 못한 Failed 런도 제 이유 곁에 못 읽은 이유를 보인다 (0145)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    const ended = changeRunState(
      db,
      id,
      { to: "ended", agentResult: "timed-out", prState: "unknown", prReadError: "other" },
      minutes(110),
    );
    expect(ended.ok).toBe(true);
    const text = panelText(render(loadRunsPage(db, undefined, now), { selectedId: id }));
    expect(text).toContain(runsJson.panel.reason.failed);
    expect(text).toContain(runsJson.panel.prUnread.other);
  });

  it("Succeeded 필터는 성공을 보고한 런만 보이고, 처리할 일에는 Succeeded 런이 없다 (0145)", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const succeeded = rowTexts(render(page, { filter: "succeeded" }));
    expect([...succeeded.keys()].toSorted()).toEqual(["ACME-1", "ACME-7"]);
    for (const row of succeeded.values()) expect(row.pill).toBe(domain.summary.succeeded);
    const attention = rowTexts(render(page, { filter: "attention" }));
    expect([...attention.values()].some((row) => row.pill === domain.summary.succeeded)).toBe(
      false,
    );
    expect(attention.has("ACME-2")).toBe(true);
  });

  it("행의 PR 정보는 이후 PR 상태가 있으면 그것을 보인다 (0145)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("seed");
    const before = rowTexts(render(loadRunsPage(db, undefined, now))).get("ACME-2");
    expect(before?.result).toContain(`#2 ${domain.prState.open}`);
    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(110) } });
    const after = rowTexts(render(loadRunsPage(db, undefined, now))).get("ACME-2");
    expect(after?.result).toContain(`#2 ${domain.prState.merged}`);
    expect(after?.pill).toBe(domain.summary.failed);
  });

  it('Canceled 필터는 운영자가 취소한 런만 "취소"로 보인다(Q82.18)', () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-13");
    if (id === undefined) throw new Error("seed");
    const ended = changeRunState(
      db,
      id,
      { to: "ended", agentResult: "canceled", prState: "none" },
      minutes(110),
    );
    expect(ended.ok).toBe(true);
    const page = loadRunsPage(db, undefined, now);
    const canceled = rowTexts(render(page, { filter: "canceled" }));
    expect([...canceled.keys()]).toEqual(["ACME-13"]);
    expect(canceled.get("ACME-13")?.pill).toBe(domain.summary.canceled);
    expect(canceled.get("ACME-13")?.result).toContain(domain.agentResult.canceled);
    expect(rowTexts(render(page, { filter: "failed" })).has("ACME-13")).toBe(false);
  });

  it("Offline 과 러너에서 프로젝트가 빠짐의 Queued 이유를 다른 문구로 보인다(Q68·Q82.13)", () => {
    const { db, ids } = seedDatabase();
    const missing = addProjectMissingRun(db, "ACME-15");
    const page = loadRunsPage(db, undefined, now);
    const offlineText = panelText(render(page, { selectedId: ids.get(offlineQueuedKey) }));
    const missingText = panelText(render(page, { selectedId: missing }));
    expect(offlineText).toContain(domain.queuedReason["runner-offline"]);
    expect(offlineText).not.toContain(domain.queuedReason["project-missing"]);
    expect(missingText).toContain(domain.queuedReason["project-missing"]);
    expect(missingText).not.toContain(domain.queuedReason["runner-offline"]);
    expect(domain.queuedReason["project-missing"]).not.toBe(domain.queuedReason["runner-offline"]);
  });

  it("처리되지 않은 취소 요청이 있는 런에 취소 중을 보인다(Q82.21)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    expect(requestRunCancel(db, id, minutes(110)).ok).toBe(true);
    const page = loadRunsPage(db, undefined, now);
    const rows = rowTexts(render(page));
    expect(rows.get("ACME-10")?.result).toContain(runsJson.cancelling);
    expect(rows.get("ACME-10")?.pill).toBe(domain.runState.running);
    expect(rows.get("ACME-11")?.result).not.toContain(runsJson.cancelling);
    const text = panelText(render(page, { selectedId: id }));
    expect(text).toContain(runsJson.panel.cancelling);
    expect(text).toContain(runsJson.panel.cancellingReason);
  });

  describe("상세 패널(0166)", () => {
    const section = runsJson.panel.prSection;
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
    const pullRequest = {
      id: toPullRequestId("12"),
      displayId: "#12",
      url: "https://code.example.com/acme/web/pull/12",
      ci: "failure",
      checkedAt: minutes(111),
    };

    function endWithPr(prState: "open" | "merged", ci = "failure") {
      const { db, ids } = seedDatabase();
      const id = ids.get("ACME-10");
      if (id === undefined) throw new Error("seed");
      expect(
        changeRunState(
          db,
          id,
          { to: "ended", agentResult: "reported-success", prState },
          minutes(110),
        ).ok,
      ).toBe(true);
      updateRunRecords(db, id, {
        pullRequest: {
          ...pullRequest,
          ci,
          signals: { ...signals, open: prState === "open" },
        },
      });
      return { db, id, html: render(loadRunsPage(db, undefined, now), { selectedId: id }) };
    }

    const panelHtml = (html: string) => html.split("<aside")[1] ?? "";
    const tones = (html: string) =>
      [...panelHtml(html).matchAll(/data-signal-tone="(\w+)"/g)].map((m) => m[1]);

    it.each([
      ["ACME-13", domain.runState.queued, "기다리는 중"],
      ["ACME-10", domain.runState.running, " min"],
      ["ACME-11", domain.runState["waiting-for-input"], " min"],
      ["ACME-12", domain.runState.disconnected, " min"],
    ])("%s 는 머리에 상태와 시간을 두고 에이전트 결과 줄이 없다", (key, pill, time) => {
      const { db, ids } = seedDatabase();
      const text = panelText(
        render(loadRunsPage(db, undefined, now), { selectedId: ids.get(key) }),
      );
      expect(text).toContain(pill);
      expect(text).toContain(time);
      expect(text).toContain(section.none);
      expect(text).not.toContain(runsJson.panel.agentResult);
    });

    it("Paused 런은 멈춘 시간과 이유를 보인다", () => {
      const { db, ids } = seedDatabase();
      const page = loadRunsPage(db, undefined, now);
      const id = ids.get("ACME-10");
      const paused: RunsPage = {
        ...page,
        runs: page.runs.map((run) =>
          run.id === id && run.state === "running"
            ? { ...run, state: "paused", pausedMs: 120_000 }
            : run,
        ),
      };
      const text = panelText(render(paused, { selectedId: id }));
      expect(text).toContain(domain.runState.paused);
      expect(text).toContain("2 min 멈춰 있어요");
      expect(text).toContain(runsJson.panel.reason.paused);
    });

    it.each([
      ["reported-success", "succeeded"],
      ["reported-failure", "failed"],
      ["canceled", "canceled"],
    ] as const)(
      "끝난 런(%s)은 끝난 때·걸린 시간과 에이전트 결과를 보인다",
      (agentResult, summary) => {
        const { db, ids } = seedDatabase();
        const id = ids.get("ACME-10");
        if (id === undefined) throw new Error("seed");
        expect(
          changeRunState(db, id, { to: "ended", agentResult, prState: "none" }, minutes(110)).ok,
        ).toBe(true);
        const text = panelText(render(loadRunsPage(db, undefined, now), { selectedId: id }));
        expect(text).toContain(domain.summary[summary]);
        expect(text).toMatch(/끝남 · .+ 걸림/);
        expect(text).toContain(runsJson.panel.reason[summary]);
        expect(text).toContain(domain.agentResult[agentResult]);
        expect(text).toContain(section.none);
      },
    );

    it("머리 첫 줄은 번호·프로젝트·브랜치이고 없앤 줄은 보이지 않는다", () => {
      const { html } = endWithPr("open");
      const panel = panelHtml(html);
      expect(panelText(html)).toMatch(/ACME-10 · Web · \S+/);
      expect(panel.indexOf("ACME-10")).toBeLessThan(panel.indexOf("<h2"));
      const terms = [...panel.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1]);
      expect(terms).toEqual([
        section.ci,
        section.conflict,
        section.base,
        runsJson.panel.runner,
        runsJson.panel.agent,
        runsJson.panel.agentResult,
      ]);
    });

    it("Open·CI 실패·충돌·뒤처짐을 줄마다 보이고 이유 끝에 확인 문장을 붙이며 결과는 그대로다", () => {
      const { html } = endWithPr("open");
      const text = panelText(html);
      expect(text).toContain("PR #12");
      expect(text).toContain(section.state.open);
      expect(text).toContain("7개 중 2개 실패");
      expect(text).toContain(section.conflictValue.some);
      expect(text).toContain("3커밋 뒤");
      expect(text).toContain("읽음");
      expect(text).toContain(
        `${runsJson.panel.reason.succeeded} PR의 CI가 실패해서 확인이 필요해요.`,
      );
      expect(text).toContain(domain.summary.succeeded);
      expect(tones(html)).toEqual(["problem", "problem", "warning"]);
      expect(panelHtml(html)).toContain(`href="${pullRequest.url}/checks"`);
    });

    it("Merged PR 은 CI 줄만 두고 확인 문장을 붙이지 않는다", () => {
      const { html } = endWithPr("merged", "success");
      const text = panelText(html);
      expect(text).toContain(section.state.merged);
      expect(text).toContain(section.ciValue.success);
      expect(tones(html)).toEqual(["pass"]);
      expect(text).not.toContain(section.conflict);
      expect(text).not.toContain("확인이 필요해요");
    });

    function withPullRequest(change: Partial<NonNullable<RunView["pullRequest"]>>) {
      const { db, id } = endWithPr("open");
      const page = loadRunsPage(db, undefined, now);
      const changed: RunsPage = {
        ...page,
        runs: page.runs.map((run) =>
          run.id === id && run.pullRequest !== null
            ? { ...run, pullRequest: { ...run.pullRequest, ...change } }
            : run,
        ),
      };
      return render(changed, { selectedId: id });
    }

    it("더 읽지 않는 Open PR 의 지난 CI 실패로는 확인 문장을 붙이지 않고 충돌·base 는 모름으로 둔다", () => {
      const html = withPullRequest({ signals: null, ci: "failure" });
      const text = panelText(html);
      expect(text).not.toContain("확인이 필요해요");
      expect(text).toContain(section.conflictValue.unknown);
      expect(tones(html)).toEqual(["problem", "neutral", "neutral"]);
    });

    it("진행 중 런의 PR 신호를 못 읽었으면 충돌·base 를 모름으로 둔다", () => {
      const { db, ids } = seedDatabase();
      const id = ids.get("ACME-10");
      if (id === undefined) throw new Error("seed");
      updateRunRecords(db, id, { pullRequest: { ...pullRequest, ci: "pending" } });
      const html = render(loadRunsPage(db, undefined, now), { selectedId: id });
      expect(panelText(html)).toContain(section.ciValue.pending);
      expect(tones(html)).toEqual(["neutral", "neutral", "neutral"]);
    });

    it("진행 중 런의 PR 이 코드 호스트에서 닫혔으면 CI 줄만 두고 읽은 때를 보인다", () => {
      const { db, ids } = seedDatabase();
      const id = ids.get("ACME-10");
      if (id === undefined) throw new Error("seed");
      updateRunRecords(db, id, {
        pullRequest: {
          ...pullRequest,
          ci: "success",
          signals: { ...signals, open: false, ciFailed: false, conflict: null, behindBy: null },
        },
      });
      const html = render(loadRunsPage(db, undefined, now), { selectedId: id });
      expect(tones(html)).toEqual(["pass"]);
      expect(panelText(html)).toContain("읽음");
    });

    it("검사 목록이 잘렸으면 실패 수를 '이상'으로 말한다", () => {
      const html = withPullRequest({
        signals: {
          ciFailed: true,
          checkTotal: 150,
          failedCount: 2,
          failedChecks: ["lint"],
          checksTruncated: true,
          conflict: false,
          behindBy: 0,
          checkedAt: minutes(111).toISOString(),
        },
      });
      expect(panelText(html)).toContain("150개 중 2개 이상 실패");
    });

    it("자세히 보기는 주 버튼, PR 은 새 탭으로 여는 보조 버튼이다", () => {
      const { html, id } = endWithPr("open");
      const panel = panelHtml(html);
      const anchor = (href: string) =>
        [...panel.matchAll(/<a [^>]*>/g)]
          .map((m) => m[0])
          .find((tag) => tag.includes(`href="${href}"`));
      expect(anchor(`/runs/${id}`)).toContain('data-variant="primary"');
      const prLink = anchor(pullRequest.url);
      expect(prLink).toContain('data-variant="secondary"');
      expect(prLink).toContain('target="_blank"');
      expect(prLink).toContain('rel="noreferrer"');
      expect(panel.match(/data-variant="primary"/g)).toHaveLength(1);
    });
  });

  it("Workspace 를 바꾸면 그 Workspace 의 런만 보인다", () => {
    const { db } = seedDatabase();
    const labsRows = rowTexts(render(loadRunsPage(db, labs, now)));
    expect([...labsRows.keys()]).toEqual(["LAB-1"]);
    const commerceRows = rowTexts(render(loadRunsPage(db, "ws-commerce", now)));
    expect(commerceRows.has("LAB-1")).toBe(false);
    expect(commerceRows.has("ACME-1")).toBe(true);
  });

  it("전체에서는 Workspace 를 고르라고 보인다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsPage(db, "all", now));
    expect(html).toContain(runsJson.allWorkspaces.body);
    expect(html).toContain("Acme Labs");
    expect(html).not.toContain('role="option"');
  });

  it("문구는 메시지 파일에서 온다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsPage(db, undefined, now));
    expect(html).toContain(runsJson.title);
    expect(html).toContain(runsJson.filter.attention);
    expect(html).not.toMatch(/\b(runs|domain)\.[a-zA-Z]/);
  });
});
