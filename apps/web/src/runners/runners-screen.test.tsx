import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runnersJson from "../../messages/ko/runners.json" with { type: "json" };
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { recordGhAccounts, recordProviderUsage, recordRunnerCheck } from "@ganger/db";
import { toRunnerId } from "@ganger/core";
import {
  addUnreachedCanceledRun,
  breakGitHubAuth,
  failSomePushes,
  now,
  seedDatabase,
} from "../testing/seed";
import { loadRunnersPage } from "@ganger/app/runners/load";
import { runnersMessages } from "./messages";
import { failedChecksFirst, problemRunnersFirst } from "@ganger/app/runners/model";
import type {
  OccupyingRun,
  RunnerGhAccountsView,
  RunnerView,
  RunnersPage,
} from "@ganger/app/runners/model";
import { runnerRunsHref } from "../runs/hrefs";
import { addRunnerHref, RunnersScreen } from "./runners-screen";
import type { RunnerActions } from "./runners-screen";

const panel = runnersJson.panel;

const noActions: RunnerActions = {
  recheck: () => Promise.resolve({ ok: true }),
  pollChecks: () => Promise.resolve(false),
};

function render(page: RunnersPage, selectedId?: string, ws?: string) {
  return renderWithMessages(
    <RunnersScreen
      page={page}
      selectedId={selectedId}
      ws={ws}
      onSelect={() => undefined}
      actions={noActions}
    />,
    runnersMessages,
  );
}

function rowsOf(html: string): { name: string; html: string; selected: boolean }[] {
  return html
    .split('role="option"')
    .slice(1)
    .map((chunk) => {
      const end = chunk.indexOf("<aside");
      const row = end === -1 ? chunk : chunk.slice(0, end);
      return {
        name: /id="runner-([^"]+)"/.exec(row)?.[1] ?? "",
        html: row,
        selected: /^[^>]*aria-selected="true"/.test(row),
      };
    });
}

function panelHtml(html: string): string {
  const start = html.indexOf(`<section aria-label="${panel.label}"`);
  if (start === -1) throw new Error("no panel");
  return html.slice(start);
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

function variantsOf(html: string): string[] {
  return [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1] ?? "");
}

function runner(overrides: Partial<RunnerView> & { id: string }): RunnerView {
  return {
    name: overrides.id,
    online: true,
    offlineMs: null,
    assignmentBlocked: false,
    pushBlockedProjects: [],
    checks: null,
    checked: null,
    capacity: 2,
    occupying: [],
    queued: [],
    leftWorktrees: [],
    sshTarget: null,
    orcaPath: null,
    usage: null,
    load: null,
    ghAccounts: null,
    ...overrides,
  };
}

const readLoad = {
  kind: "read" as const,
  readAt: "2026-11-23T00:00:00.000Z",
  agoMs: 2 * 60_000,
  cpu: { percent: 92, loadAverage: 9.2, cores: 10, high: true },
  memory: {
    percent: 81,
    usedBytes: 26 * 1024 ** 3,
    totalBytes: 32 * 1024 ** 3,
    pressure: "normal" as const,
    high: false,
  },
  gpu: { percent: 12, name: "Apple GPU" },
};

describe("Runners 부하(0191)", () => {
  it("목록에 막대 세 개와 %를 보이고 높은 값만 problem 으로 칠한다", () => {
    const html = render({ runners: [runner({ id: "r-a", load: readLoad })] });
    const row = rowsOf(html)[0]?.html ?? "";
    expect(row.match(/role="meter"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(row).toMatch(/data-load="cpu" data-tone="problem"/);
    expect(row).toMatch(/data-load="memory" data-tone="neutral"/);
    expect(row).toContain('aria-label="r-a CPU 부하"');
  });

  it("GPU 를 못 읽으면 없음이라고 쓴다", () => {
    const html = render({
      runners: [runner({ id: "r-a", load: { ...readLoad, gpu: null } })],
    });
    expect(textOf(rowsOf(html)[0]?.html ?? "")).toContain("GPU 없음");
  });

  it("Offline 이면 지난 값 대신 읽지 못했다고 쓴다", () => {
    const html = render({ runners: [runner({ id: "r-a", online: false, load: readLoad })] });
    const row = textOf(rowsOf(html)[0]?.html ?? "");
    expect(row).toContain("Offline이라 읽지 못했어요");
    expect(row).not.toContain("92%");
  });

  it("상세의 부하 구역은 자리와 사용량 사이에 읽은 때와 값을 보인다", () => {
    const text = textOf(panelHtml(render({ runners: [runner({ id: "r-a", load: readLoad })] })));
    expect(text).toContain("코어 10개에 부하 9.2 · 5분 넘게 높아요");
    expect(text).toContain("26 / 32 GB · 메모리 압박 보통");
    expect(text).toContain("Apple GPU");
    expect(text).toContain("2 min ago 읽음");
    const load = text.indexOf("코어 10개");
    expect(text.indexOf(panel.capacity)).toBeLessThan(load);
    expect(load).toBeLessThan(text.indexOf(panel.usage.title, load));
  });

  it("머리 문장에 부하가 높은 러너를 더한다", () => {
    const html = render({
      runners: [runner({ id: "r-a", load: readLoad }), runner({ id: "r-b" })],
    });
    expect(textOf(html)).toContain("부하가 높아요: r-a(CPU).");
  });
});

const callout = /<section aria-labelledby="[^"]*"[^>]*><div[^>]*><span aria-hidden="true"/;
const recheckButtons = new RegExp(`<button(?:(?!</button>)[^])*>${panel.recheck}<`, "g");

function occupyingRun(overrides: Partial<OccupyingRun> & { id: string }): OccupyingRun {
  return {
    ticketKey: "ACME-1",
    ticketTitle: null,
    workspace: { id: "ws", name: "Acme" },
    state: "running",
    waitingFor: null,
    executionMs: 4 * 60_000,
    ...overrides,
  };
}

describe("Runners 목록", () => {
  it("문제 있는 러너(Offline·Runner Issue)를 Online 러너보다 위에 두고 그 안의 순서는 지킨다", () => {
    const page: RunnersPage = {
      runners: [
        runner({ id: "ok-1" }),
        runner({ id: "down", online: false }),
        runner({ id: "ok-2" }),
        runner({ id: "auth", assignmentBlocked: true }),
      ],
    };
    expect(rowsOf(render(page)).map((r) => r.name)).toEqual(["down", "auth", "ok-1", "ok-2"]);
    expect(problemRunnersFirst(page.runners).map((r) => r.id)).toEqual([
      "down",
      "auth",
      "ok-1",
      "ok-2",
    ]);
  });

  it("행마다 상태 알약은 하나다: Offline 이면 Offline, 인증이 깨지면 Runner Issue, 아니면 Online", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const page = loadRunnersPage(db, now);
    page.runners.push(runner({ id: "runner-c" }));
    const rows = rowsOf(render(page));
    expect(rows.map((r) => [r.name, pillsOf(r.html)])).toEqual([
      ["runner-a", [{ status: "runner-issue", label: domain.attention["runner-issue"] }]],
      ["runner-b", [{ status: "offline", label: domain.runnerState.offline }]],
      ["runner-c", [{ status: "online", label: domain.runnerState.online }]],
    ]);
  });

  it('행에 알약·이름·주소, 그 아래 무엇이 문제인지 한 문장, 자리 칸과 "n/m"을 보인다(0092)', () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const rows = rowsOf(render(loadRunnersPage(db, now)));
    const a = rows.find((r) => r.name === "runner-a")?.html ?? "";
    expect(a).not.toMatch(/role="meter"[^>]*aria-valuetext="4\/10"/);
    expect(a).toMatch(/role="img" aria-label="10자리 중 4자리 사용" data-tone="problem"/);
    expect(textOf(a)).toContain("4/10");
    expect(textOf(a)).toContain(`Runner Issue runner-a ${runnersJson.row.assignmentBlocked}`);
    const b = rows.find((r) => r.name === "runner-b")?.html ?? "";
    expect(textOf(b)).toContain("오케스트레이터가 이 러너에 2 hr 닿지 않아요.");
  });

  it("Offline 이 된 시각을 모르는 러너는 경과 없이 닿지 않는다고만 보인다(티켓 0064)", () => {
    const page: RunnersPage = { runners: [runner({ id: "down", online: false })] };
    const down = rowsOf(render(page)).find((r) => r.name === "down")?.html ?? "";
    expect(textOf(down)).toContain(runnersJson.row.offline);
    expect(textOf(down)).not.toMatch(/<1 min|\d+ (min|hr|days?)/);
  });

  it("꽉 찬 러너는 자리를 기다리는 런 수를, 빈자리가 있으면 빈자리 수를 한 문장으로 보인다", () => {
    const occupying = [
      {
        id: "r1",
        ticketKey: "ACME-1",
        ticketTitle: null,
        workspace: { id: "ws", name: "Acme" },
        state: "running" as const,
        waitingFor: null,
        executionMs: 1000,
      },
    ];
    const queued = [
      { id: "q1", ticketKey: "ACME-2", workspace: { id: "ws", name: "Acme" }, waitMs: 1000 },
      { id: "q2", ticketKey: "ACME-3", workspace: { id: "ws", name: "Acme" }, waitMs: 1000 },
    ];
    const rows = rowsOf(
      render({
        runners: [
          runner({
            id: "full",
            capacity: 1,
            occupying,
            queued,
            sshTarget: "dev@runner.example.com",
          }),
          runner({ id: "free", capacity: 3, occupying }),
        ],
      }),
    );
    expect(textOf(rows[0]?.html ?? "")).toContain("꽉 찼어요. 런 2개가 자리를 기다려요.");
    expect(rows[0]?.html).toContain("dev@runner.example.com");
    expect(rows[0]?.html).toContain('data-tone="progress"');
    expect(textOf(rows[1]?.html ?? "")).toContain("2자리가 비어 있어요.");
  });

  it("제목 아래 한 줄 요약에 문제 있는 러너 수와 새 런을 받을 수 있는 러너 수를 보인다", () => {
    const { db } = seedDatabase();
    expect(textOf(render(loadRunnersPage(db, now)))).toContain(
      "2대 중 1대에 문제가 있어요. 1대가 지금 새 런을 받을 수 있어요.",
    );
    breakGitHubAuth(db);
    expect(textOf(render(loadRunnersPage(db, now)))).toContain(
      "2대 중 2대에 문제가 있어요. 지금 새 런을 받을 수 있는 러너가 없어요.",
    );
    expect(textOf(render({ runners: [runner({ id: "ok" })] }))).toContain(
      "러너 1대 모두 문제가 없어요. 1대가 지금 새 런을 받을 수 있어요.",
    );
  });

  it("노란 주 버튼은 머리의 러너 추가와 패널 고칠 일 카드의 다시 확인뿐이다(ADR 0010 6번, 0095, 0165)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const html = render(loadRunnersPage(db, now));
    expect(variantsOf(html).filter((v) => v === "primary")).toHaveLength(2);
    expect(variantsOf(panelHtml(html)).filter((v) => v === "primary")).toHaveLength(1);
    expect(html).toContain(`<a href="/runners?sel=new" data-variant="primary"`);
  });

  it("러너 추가를 고르면 패널에 온보딩과 같은 등록 흐름을 그리고 목록은 아무 행도 고르지 않는다(0095)", () => {
    const { db } = seedDatabase();
    const html = renderWithMessages(
      <RunnersScreen
        page={loadRunnersPage(db, now)}
        selectedId="new"
        ws={undefined}
        onSelect={() => undefined}
        actions={noActions}
        setup={<p>setup-flow</p>}
      />,
      runnersMessages,
    );
    const panel = html.slice(html.indexOf("<aside"));
    expect(panel).toContain("러너 추가");
    expect(panel).toContain("<p>setup-flow</p>");
    expect(html).toContain('<section aria-label="러너 추가">');
    expect(rowsOf(html).filter((row) => row.selected)).toEqual([]);
  });

  it("러너 추가 링크는 보던 Workspace(ws)를 이어 간다", () => {
    expect(addRunnerHref("ws-labs")).toBe("/runners?ws=ws-labs&sel=new");
    const { db } = seedDatabase();
    expect(render(loadRunnersPage(db, now), undefined, "ws-labs")).toContain(
      'href="/runners?ws=ws-labs&amp;sel=new"',
    );
  });

  it("러너가 없으면 빈 상태로 안내하고 목록과 패널 내용은 그리지 않는다", () => {
    const html = render({ runners: [] });
    const text = textOf(html);
    expect(text).toContain(runnersJson.empty.title);
    expect(text).toContain(runnersJson.empty.body);
    expect(/<header[^]*?<\/header>/.exec(html)?.[0]).not.toContain("<p");
    expect(html).not.toContain('role="listbox"');
    expect(variantsOf(html)).toEqual(["primary"]);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-mascot="resting"/);
  });

  it("러너가 있으면 마스코트를 두지 않는다(0077)", () => {
    expect(render(loadRunnersPage(seedDatabase().db, now))).not.toContain("data-mascot");
  });
});

describe("Runners 고른 러너 패널", () => {
  it("sel 로 고른 러너를 고르고, sel 이 없으면 맨 위 러너를 고른다", () => {
    const { db } = seedDatabase();
    const page = loadRunnersPage(db, now);
    const chosen = rowsOf(render(page, "runner-a")).filter((r) => r.selected);
    expect(chosen.map((r) => r.name)).toEqual(["runner-a"]);
    expect(render(page, "runner-a")).toMatch(/<h2[^>]*>runner-a<\/h2>/);
    expect(
      rowsOf(render(page))
        .filter((r) => r.selected)
        .map((r) => r.name),
    ).toEqual(["runner-b"]);
    expect(
      rowsOf(render(page, "missing"))
        .filter((r) => r.selected)
        .map((r) => r.name),
    ).toEqual(["runner-b"]);
  });

  it("해결 상자는 문제 있는 러너에만 보이고 제목·번호 단계·다시 확인 버튼을 담는다", () => {
    const { db } = seedDatabase();
    const page = loadRunnersPage(db, now);
    const offline = panelHtml(render(page, "runner-b"));
    expect(offline).toMatch(callout);
    expect(textOf(offline)).toContain(panel.fix.offline.title);
    expect(offline).toMatch(/<ol[^>]*><li[^]*?1<\/span>[^]*?2<\/span>[^]*?3<\/span>/);
    expect(textOf(offline)).toContain(panel.fix.offline.steps["1"]);
    expect(variantsOf(offline).filter((v) => v === "primary")).toHaveLength(1);
    expect(offline.match(recheckButtons)).toHaveLength(1);

    const online = panelHtml(render(page, "runner-a"));
    expect(online).not.toMatch(callout);
    expect(online.match(recheckButtons)).toHaveLength(1);
    expect(variantsOf(online)).not.toContain("primary");
  });

  it("확인 항목이 깨져 할당에서 빠진 러너의 고칠 일 카드는 깨진 항목·영향·고치는 법과 다시 확인 하나를 둔다(0165)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(a).toMatch(callout);
    const text = textOf(a);
    expect(text).toContain("GitHub push 항목이 깨졌어요");
    expect(text).toContain(panel.fix.assignmentBlocked.body);
    expect(text).toContain(domain.pushCheck.fix.other);
    expect(a.match(recheckButtons)).toHaveLength(1);
    expect(variantsOf(a).filter((v) => v === "primary")).toHaveLength(1);
  });

  it("상태가 Online 이어도 push 가 깨진 저장소가 있으면 알약은 Online 이고 고칠 일 카드에 그 저장소를 보인다(0165)", () => {
    const { db } = seedDatabase();
    failSomePushes(db, [
      { name: "web", satisfied: false, failure: { kind: "auth", reason: null } },
    ]);
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(pillsOf(a)[0]).toEqual({ status: "online", label: domain.runnerState.online });
    expect(a).toMatch(callout);
    expect(textOf(a)).toContain("acme/web 티켓은 이 러너에 맡기지 않아요.");
    expect(a.match(recheckButtons)).toHaveLength(1);
  });

  it("할당을 막은 원인이 push 가 아니면 카드는 그 항목의 안내와 push 영향을 보이고 push 해결법은 그 줄로 옮긴다(0165)", () => {
    const html = panelHtml(
      render({
        runners: [
          runner({
            id: "r",
            assignmentBlocked: true,
            pushBlockedProjects: ["acme/web"],
            checks: [
              {
                id: "orca-service",
                name: "Orca service",
                project: null,
                satisfied: false,
                blocksAssignment: true,
                hint: "orca serve service install",
                failure: null,
              },
              {
                id: "github-push:github:acme/web",
                name: "GitHub push access: acme/web",
                project: "acme/web",
                satisfied: false,
                blocksAssignment: false,
                hint: null,
                failure: { kind: "auth", reason: null },
              },
            ],
          }),
        ],
      }),
    );
    const card = html.slice(html.search(callout), html.indexOf(`>${panel.checksTitle}</h3>`));
    expect(textOf(card)).toContain("Orca 상시 서비스 항목이 깨졌어요");
    expect(textOf(card)).toContain("orca serve service install");
    expect(textOf(card)).toContain("이 항목을 고쳐도 acme/web 티켓은 push를 고칠 때까지");
    expect(card).not.toContain("gh auth setup-git");
    expect(html.match(/>gh auth setup-git</g)).toHaveLength(1);
  });

  it("push 와 상관없는 항목만 깨진 Online 러너는 카드 없이 그 줄에 안내를 두고 머리에 다시 확인을 둔다(0165)", () => {
    const html = panelHtml(
      render({
        runners: [
          runner({
            id: "r",
            checks: [
              {
                id: "orca-service",
                name: "Orca service",
                project: null,
                satisfied: false,
                blocksAssignment: false,
                hint: "orca serve service install",
                failure: null,
              },
            ],
          }),
        ],
      }),
    );
    expect(html).not.toMatch(callout);
    expect(textOf(html)).toContain("orca serve service install");
    expect(html.match(recheckButtons)).toHaveLength(1);
  });

  it("고치기는 러너 이름이 든 아이콘 버튼이고 머리 줄 순서는 이름, 알약·시각·다시 확인이다(0165)", () => {
    const { db } = seedDatabase();
    const html = panelHtml(
      renderWithMessages(
        <RunnersScreen
          page={loadRunnersPage(db, now)}
          selectedId="runner-a"
          ws={undefined}
          onSelect={() => undefined}
          actions={noActions}
          renderEdit={() => <p>edit-form</p>}
        />,
        runnersMessages,
      ),
    );
    expect(html).toMatch(
      /<button(?=[^>]*aria-label="runner-a 러너 고치기")(?=[^>]*aria-expanded="false")/,
    );
    expect(html).toMatch(/aria-label="runner-a 러너 고치기"[^]*?<svg/);
    expect(html.indexOf("<h2")).toBeLessThan(html.indexOf('data-status="online"'));
  });

  it("상태 알약·확인 시각, 제목 이름과 주소를 패널 머리에 둔다", () => {
    const html = panelHtml(
      render({
        runners: [
          runner({
            id: "r",
            name: "build-1",
            sshTarget: "dev@runner.example.com",
            checked: { at: now.toISOString(), agoMs: 2 * 60 * 60 * 1000 },
          }),
        ],
      }),
    );
    expect(pillsOf(html)[0]).toEqual({ status: "online", label: domain.runnerState.online });
    expect(textOf(html)).toContain("2 hr ago 확인");
    expect(html).toMatch(/<h2[^>]*>build-1<\/h2>/);
    expect(html).toMatch(/<p[^>]*>dev@runner.example.com<\/p>/);
  });

  it("자리는 n/capacity 와 칸 막대, 한 줄 런 행(상태 점·번호·제목·시간)을 Run 상세 링크로 보인다(0165)", () => {
    const { db, ids } = seedDatabase();
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(textOf(a)).toContain(`${panel.capacity} 4/10`);
    expect(a).toMatch(/role="img" aria-label="10자리 중 4자리 사용"/);
    expect(a.match(/data-cell="used"/g)).toHaveLength(4);
    expect(a.match(/data-cell="free"/g)).toHaveLength(6);
    expect(textOf(a)).toContain("이 러너를 기다리는 Queued 런");
    expect(ids.has("LAB-1")).toBe(true);
    expect(a).not.toContain("LAB-1 ");
    expect(textOf(a)).toContain(panel.viewRuns);
  });

  it("패널은 러너별 런 목록 대신 그 러너 조건의 Runs 링크를 둔다(0173)", () => {
    expect(runnerRunsHref("ws-labs", "runner a")).toBe("/runs?ws=ws-labs&runner=runner+a");
    expect(runnerRunsHref(undefined, "r")).toBe("/runs?runner=r");
    const html = panelHtml(
      render({
        runners: [runner({ id: "r", capacity: 2, occupying: [occupyingRun({ id: "a" })] })],
      }),
    );
    expect(html).toMatch(new RegExp(`<a [^>]*href="/runs\\?[^"]*runner=r"[^>]*>${panel.viewRuns}`));
    expect(html).not.toContain('href="/runs/a');
  });

  it.each([
    { capacity: 2, used: 0, cells: 2 },
    { capacity: 3, used: 2, cells: 3 },
    { capacity: 0, used: 1, cells: 0 },
  ])(
    "자리 $used/$capacity 는 칸 $cells 개를 그린다(0 이면 막대 없이 숫자만)",
    ({ capacity, used, cells }) => {
      const occupying = Array.from({ length: used }, (_, index) =>
        occupyingRun({ id: `o${index}` }),
      );
      const html = panelHtml(render({ runners: [runner({ id: "r", capacity, occupying })] }));
      expect(html.match(/data-cell="(used|free)"/g) ?? []).toHaveLength(cells);
      expect(textOf(html)).toContain(`${panel.capacity} ${used}/${capacity}`);
    },
  );

  it("이 러너를 기다리는 Queued 런은 개수와 번호 한 줄로 보인다(0165)", () => {
    const queued = ["ACME-14", "ACME-15"].map((ticketKey) => ({
      id: ticketKey,
      ticketKey,
      workspace: { id: "ws", name: "Acme" },
      waitMs: 1000,
    }));
    const text = textOf(panelHtml(render({ runners: [runner({ id: "r", queued })] })));
    expect(text).toContain("이 러너를 기다리는 Queued 런 2 · ACME-14, ACME-15");
  });

  it("확인 항목은 통과 수/전체를 제목 옆에 두고 깨진 항목을 맨 위에, 줄마다 모양이 다른 아이콘을 둔다(0165)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(textOf(a)).toContain(`${panel.checksTitle} 2/3`);
    const states = [...a.matchAll(/data-check="([^"]+)"/g)].map((m) => m[1]);
    expect(states).toEqual(["broken", "ok", "ok"]);
    expect(a).toContain('data-check-icon="broken"');
    expect(a).toContain('data-check-icon="ok"');
    expect(textOf(a)).toContain(`${panel.check.ok} Orca service`);
    expect(textOf(a)).not.toContain("GitHub push access");
  });

  it("GitHub push는 저장소마다 한 줄이고 깨진 줄 오른쪽에 이유, 같은 해결 안내는 카드에 한 번만 보인다(0165)", () => {
    const { db } = seedDatabase();
    failSomePushes(db, [
      {
        name: "web",
        satisfied: false,
        failure: { kind: "auth", reason: "Permission to acme/web.git denied to someone." },
      },
      { name: "api", satisfied: false, failure: { kind: "auth", reason: null } },
      { name: "lab", satisfied: null, failure: { kind: "timeout", reason: null } },
    ]);
    const html = render(loadRunnersPage(db, now), "runner-a");
    const a = panelHtml(html);
    const pushCheck = domain.pushCheck;
    const text = textOf(a);
    expect(text).toContain(`GitHub push · acme/web ${pushCheck.failure.auth}`);
    expect(text).toContain("Permission to acme/web.git denied to someone.");
    expect(text).toContain(`GitHub push · acme/api ${pushCheck.failure.auth}`);
    expect(text).toContain(`GitHub push · acme/lab ${pushCheck.failure.timeout}`);
    expect(a.match(/>gh auth setup-git</g)).toHaveLength(1);
    expect([...a.matchAll(/data-check="([^"]+)"/g)].map((m) => m[1]).slice(0, 3)).toEqual([
      "broken",
      "broken",
      "unknown",
    ]);

    const row = rowsOf(html).find((r) => r.name === "runner-a");
    expect(pillsOf(row?.html ?? "")).toEqual([
      { status: "online", label: domain.runnerState.online },
    ]);
    expect(textOf(row?.html ?? "")).toContain(
      "저장소 2개는 push가 안 돼 맡기지 않아요. 6자리가 비어 있어요.",
    );
  });

  it("모두 통과하면 N개 모두 통과 한 줄로 접고 펼침 버튼을 둔다(0165)", () => {
    const { db } = seedDatabase();
    failSomePushes(db, []);
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(a).toMatch(/<button[^>]*aria-expanded="false"[^>]*>(?:(?!<\/button>)[^])*모두 통과/);
    expect(textOf(a)).toMatch(/\d+개 모두 통과/);
    expect(a).not.toContain("data-check=");
    expect(a).not.toMatch(callout);
  });

  it("확인하지 못한 항목은 그렇다고 글로 보인다", () => {
    const html = panelHtml(
      render({
        runners: [
          runner({
            id: "r",
            checks: [
              {
                id: "x",
                name: "Orca service",
                project: null,
                satisfied: null,
                blocksAssignment: false,
                hint: null,
                failure: null,
              },
            ],
          }),
        ],
      }),
    );
    expect(textOf(html)).toContain(`${panel.checksTitle} 0/1`);
    expect(html).toContain('data-check-icon="unknown"');
    expect(html).toMatch(new RegExp(`data-check="unknown"[^]*?${panel.check.unknown}`));
  });

  it("깨진 항목 아래에 어댑터의 해결 안내를 보인다", () => {
    const { db } = seedDatabase();
    recordRunnerCheck(db, {
      runnerId: toRunnerId("runner-a"),
      online: true,
      checkedAt: now,
      error: null,
      projects: null,
      assignmentBlocked: false,
      prerequisites: [
        {
          id: "orca-service",
          name: "Orca service",
          satisfied: false,
          hint: "orca serve service install",
          blocksAssignment: false,
        },
      ],
    });
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(textOf(a)).toContain(`${panel.checksTitle} 0/1`);
    expect(textOf(a)).toContain("Orca 상시 서비스 orca serve service install");
    expect(a).not.toMatch(callout);
  });

  it("Offline 러너는 확인 항목 대신 ssh로 닿지 않는다고 보인다", () => {
    const { db } = seedDatabase();
    const b = panelHtml(render(loadRunnersPage(db, now), "runner-b"));
    expect(textOf(b)).toContain(`${panel.checksTitle} ${panel.check.broken} ${panel.unreachable}`);
    expect(b).toMatch(callout);
    expect(textOf(b)).toContain(panel.fix.offline.title);
    expect(b.match(recheckButtons)).toHaveLength(1);
  });

  it("확인 항목을 아직 읽지 않은 러너는 그렇다고 보인다", () => {
    const { db } = seedDatabase();
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(textOf(a)).toContain(`${panel.checksTitle} ${panel.noChecks}`);
    expect(textOf(a)).not.toContain(panel.checksAllPassed.replace("{count}", ""));
    expect(a.match(recheckButtons)).toHaveLength(1);
  });

  it("남은 워크트리와 그 까닭을 보인다", () => {
    const { db } = seedDatabase();
    const text = textOf(panelHtml(render(loadRunnersPage(db, now), "runner-a")));
    expect(text).toContain("남은 워크트리 2");
    expect(text).toContain(panel.worktree["operator-decides"]);
    expect(text).toContain(panel.worktree["keep-until-pr-settles"]);
  });

  it("러너에 닿지 못한 채 끝난 취소 런을 남은 워크트리에 넣는다(Q82.21)", () => {
    const { db } = seedDatabase();
    addUnreachedCanceledRun(db, "ACME-22");
    const text = textOf(panelHtml(render(loadRunnersPage(db, now), "runner-b")));
    expect(text).toContain("남은 워크트리 1");
    expect(text).toContain(`ACME-22 ${panel.worktree["operator-decides"]}`);
  });

  it("확인 항목 정렬은 깨짐, 모름, 통과 순이다", () => {
    expect(
      failedChecksFirst([
        { id: "a", satisfied: true },
        { id: "b", satisfied: null },
        { id: "c", satisfied: false },
      ]).map((c) => c.id),
    ).toEqual(["c", "b", "a"]);
  });
});

describe("공급자 사용량(0086)", () => {
  const usage = runnersJson.usage;
  const readAt = new Date(now.getTime() - 3 * 60_000);
  const resetsAt = new Date(now.getTime() + 72 * 60_000);

  function seededWithUsage() {
    const { db } = seedDatabase();
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-a"),
      readAt,
      reading: {
        kind: "read",
        providers: [
          {
            provider: "claude",
            status: "ok",
            windows: [
              { kind: "session", usedPercent: 100, resetsAt },
              { kind: "weekly", usedPercent: 72, resetsAt: null },
              { kind: "fableWeekly", usedPercent: 9, resetsAt: null },
            ],
          },
          {
            provider: "codex",
            status: "ok",
            windows: [{ kind: "weekly", usedPercent: 40, resetsAt: null }],
          },
          { provider: "kimi", status: "signed-out", windows: [] },
          { provider: "cursor", status: "signed-out", windows: [] },
          { provider: "gemini", status: "unavailable", windows: [] },
          { provider: "newbie", status: "error", windows: [] },
        ],
      },
    });
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-b"),
      readAt,
      reading: { kind: "unreadable" },
    });
    return loadRunnersPage(db, now);
  }

  it("목록 행에 가장 높은 사용량의 공급자·창 이름과 막대·%를 보인다", () => {
    const rows = rowsOf(render(seededWithUsage()));
    const a = rows.find((r) => r.name === "runner-a")?.html ?? "";
    expect(textOf(a)).toContain("Claude 5시간");
    expect(a).toContain('aria-valuetext="100%"');
    expect(a).toContain('aria-label="runner-a 가장 높은 사용량: Claude 5시간"');
    expect(textOf(a)).toContain(`${usage.highest} Claude 5시간 100%`);
    expect(a).toMatch(/data-tone="problem"[^>]*role="meter"[^>]*aria-valuetext="100%"/);
    const b = rows.find((r) => r.name === "runner-b")?.html ?? "";
    expect(textOf(b)).toContain(usage.unreadable);
    expect(b).not.toMatch(/aria-valuetext="\d+%"/);
  });

  it("90% 미만이면 중립, 90% 이상이면 problem 막대다", () => {
    const html = panelHtml(render(seededWithUsage(), "runner-a"));
    const tones = [
      ...html.matchAll(/data-tone="([a-z]+)"[^>]*role="meter"[^>]*aria-valuetext="(\d+)%"/g),
    ].map((m) => [m[2], m[1]]);
    expect(tones).toEqual([
      ["100", "problem"],
      ["72", "neutral"],
      ["9", "neutral"],
      ["40", "neutral"],
    ]);
  });

  it("패널에 쓰는 공급자의 있는 창만, 로그인 안 한 공급자와 쓰지 않는 공급자는 한 줄로 접고 읽은 시각과 안내를 보인다", () => {
    const html = panelHtml(render(seededWithUsage(), "runner-a"));
    const text = textOf(html);
    expect(text).toContain(panel.usage.title);
    expect(text).toContain("3 min ago 읽음");
    expect(text).toMatch(/5시간 100% \S+에 초기화돼요 · 한도에 닿았어요/);
    expect(text).toContain("주간 72% Fable 주간 9%");
    expect(text).toContain("Fable 주간");
    expect(text).not.toContain("월간");
    expect(text).toContain("로그인하지 않았어요: Kimi 및 Cursor. 쓰지 않아요: Gemini");
    expect(html).not.toContain("<details");
    expect(text).toContain("newbie");
    expect(text).toContain(panel.usage.error);
    expect(html).toContain(`aria-label="${panel.usage.privacyLabel}"`);
    expect(text).not.toContain(usage.highest);
  });

  it("읽지 못했거나 아직 읽지 않았으면 그렇게 말한다", () => {
    const page = seededWithUsage();
    expect(textOf(panelHtml(render(page, "runner-b")))).toContain(panel.usage.unreadable);
    const fresh = render({ runners: [runner({ id: "new" })] }, "new");
    expect(textOf(panelHtml(fresh))).toContain(panel.usage.notRead);
    expect(textOf(rowsOf(fresh)[0]?.html ?? "")).toContain(usage.notRead);
  });
});

describe("Runners 다시 그리기(0092)", () => {
  const usage = runnersJson.usage;
  const readAt = new Date(now.getTime() - 3 * 60_000);

  function withUsage(
    windows: { kind: "session" | "weekly"; usedPercent: number; resetsAt: Date | null }[],
  ) {
    const { db } = seedDatabase();
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-a"),
      readAt,
      reading: { kind: "read", providers: [{ provider: "claude", status: "ok", windows }] },
    });
    return loadRunnersPage(db, now);
  }

  it("목록 위에 러너 / 자리 / 사용량(가장 높은 값) 열 머리를 둔다", () => {
    const html = render(withUsage([]));
    const head = html.slice(0, html.indexOf('role="listbox"'));
    expect(textOf(head)).toContain(
      `${runnersJson.columns.runner} ${runnersJson.columns.capacity} ${runnersJson.columns.usage}`,
    );
    expect(head).toMatch(/aria-hidden="true"/);
  });

  it("행의 사용량은 이름과 %를 한 줄에, 막대를 그 아래에 둔다", () => {
    const page = withUsage([{ kind: "session", usedPercent: 93, resetsAt: null }]);
    const a = rowsOf(render(page)).find((r) => r.name === "runner-a")?.html ?? "";
    expect(a).toMatch(
      /role="meter"[^>]*aria-valuetext="93%"[^>]*><span aria-hidden="true"[^>]*><span[^>]*>Claude 5시간<\/span><span[^>]*>93%<\/span><\/span><div/,
    );
    expect(a).toContain('data-tone="problem"');
  });

  it("사용량을 읽지 못한 러너의 사용량 칸은 한 줄 글이다", () => {
    const { db } = seedDatabase();
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-a"),
      readAt,
      reading: { kind: "unreadable" },
    });
    const a =
      rowsOf(render(loadRunnersPage(db, now))).find((r) => r.name === "runner-a")?.html ?? "";
    expect(textOf(a)).toContain(usage.unreadable);
    expect(a).not.toContain('role="meter"');
  });

  it("문제 러너의 이유 한 줄은 problem 색, Online 러너는 아니다", () => {
    const page: RunnersPage = {
      runners: [runner({ id: "down", online: false }), runner({ id: "ok" })],
    };
    const html = render(page);
    const [down, ok] = rowsOf(html);
    const reasonClass = (row: string, text: string) =>
      new RegExp(`class="([^"]*)"[^>]*>${text}<`).exec(row)?.[1] ?? "";
    const problemClass = reasonClass(down?.html ?? "", runnersJson.row.offline);
    const okClass = reasonClass(ok?.html ?? "", runnersJson.row.free.replace("{free}", "2"));
    expect(problemClass).not.toBe("");
    expect(okClass).not.toBe("");
    expect(problemClass).not.toBe(okClass);
  });

  it("Online 러너의 패널은 머리 → 자리 → 사용량 → 확인 항목 순서다(0165)", () => {
    const { db } = seedDatabase();
    failSomePushes(db, []);
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    const order = [
      `>${panel.capacity}</h3>`,
      `>${panel.usage.title}</h3>`,
      `>${panel.checksTitle}</h3>`,
    ].map((needle) => a.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it("고칠 일이 있는 패널은 머리 → 고칠 일 카드 → 확인 항목 → 자리 → 사용량 순서다(0165)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    const at = (needle: string) => a.indexOf(needle);
    const order = [
      at("<h2"),
      at("GitHub push 항목이 깨졌어요"),
      at(`>${panel.checksTitle}</h3>`),
      at(`>${panel.capacity}</h3>`),
      at(`>${panel.usage.title}</h3>`),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it("사용량 머리 오른쪽에 읽은 시각, 제목 옆에 도움말을 둔다(0165)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-a"),
      readAt,
      reading: { kind: "read", providers: [] },
    });
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(a).toMatch(
      new RegExp(`>${panel.usage.title}</h3><button[^>]*aria-label="${panel.usage.privacyLabel}"`),
    );
    expect(a).toMatch(/<span[^>]*>3 min ago 읽음<\/span>/);
  });

  it("로그인하지 않은 공급자만, 쓰지 않는 공급자만 있으면 그 문장 하나로 이름을 보인다", () => {
    const only = (status: "signed-out" | "unavailable") => {
      const { db } = seedDatabase();
      recordProviderUsage(db, {
        runnerId: toRunnerId("runner-a"),
        readAt,
        reading: {
          kind: "read",
          providers: [
            { provider: "codex", status, windows: [] },
            { provider: "gemini", status, windows: [] },
          ],
        },
      });
      return textOf(panelHtml(render(loadRunnersPage(db, now), "runner-a")));
    };
    expect(only("signed-out")).toContain("로그인하지 않았어요: Codex 및 Gemini");
    expect(only("unavailable")).toContain("쓰지 않아요: Codex 및 Gemini");
    expect(only("unavailable")).not.toContain("로그인하지 않았어요");
  });

  it("초기화 시각이 지난 100% 창은 한도라고 하지 않는다", () => {
    const past = new Date(now.getTime() - 60_000);
    const a = panelHtml(
      render(withUsage([{ kind: "session", usedPercent: 100, resetsAt: past }]), "runner-a"),
    );
    expect(textOf(a)).not.toContain(panel.usage.atLimit);
    const future = new Date(now.getTime() + 60_000);
    const b = panelHtml(
      render(withUsage([{ kind: "session", usedPercent: 100, resetsAt: future }]), "runner-a"),
    );
    expect(textOf(b)).toContain(panel.usage.atLimit);
  });
});

describe("러너의 gh 계정(0205)", () => {
  const readGh = { readAt: "2026-11-23T00:00:00.000Z", agoMs: 3 * 60_000 };
  const ghText = (ghAccounts: RunnerGhAccountsView | null, online = true) =>
    textOf(panelHtml(render({ runners: [runner({ id: "r-a", online, ghAccounts })] })));

  it("상세에 GitHub (gh) 구역을 사용량 뒤에 두고 계정마다 한 줄, 사용 중 계정과 읽은 때를 보인다", () => {
    const text = ghText({
      ...readGh,
      kind: "logged-in",
      accounts: [
        { host: "github.com", login: "acme-bot", active: true },
        { host: "ghe.acme.example", login: "acme-ci", active: false },
      ],
    });
    expect(text).toContain("GitHub (gh)");
    expect(text).toContain("acme-bot · github.com · 사용 중");
    expect(text).toContain("acme-ci · ghe.acme.example");
    expect(text).not.toContain("acme-ci · ghe.acme.example · 사용 중");
    expect(text).toContain("3 min ago 읽음");
    expect(text.indexOf(panel.usage.title)).toBeLessThan(text.indexOf("GitHub (gh)"));
  });

  it("gh 가 없거나 로그인하지 않았거나 읽지 못했으면 그대로 말한다", () => {
    expect(ghText({ ...readGh, kind: "not-installed" })).toContain("gh 없음");
    expect(ghText({ ...readGh, kind: "logged-out" })).toContain("로그인 안 됨");
    expect(ghText({ ...readGh, kind: "unreadable" })).toContain(panel.ghAccounts.unreadable);
    expect(ghText(null)).toContain(panel.ghAccounts.notRead);
  });

  it("정보만 보이고 문제 색이나 고칠 일 카드를 더하지 않는다", () => {
    const html = panelHtml(
      render({ runners: [runner({ id: "r-a", ghAccounts: { ...readGh, kind: "logged-out" } })] }),
    );
    expect(html).not.toMatch(callout);
    expect(html).not.toContain('role="alert"');
  });

  it("Offline 러너에도 마지막으로 읽은 계정을 읽은 때와 함께 보인다", () => {
    const text = ghText(
      {
        ...readGh,
        kind: "logged-in",
        accounts: [{ host: "github.com", login: "acme-bot", active: true }],
      },
      false,
    );
    expect(text).toContain("acme-bot · github.com · 사용 중");
    expect(text).toContain("3 min ago 읽음");
  });

  it("저장한 값에서 사용 중 계정을 먼저 두고 토큰 같은 다른 값은 화면까지 오지 않는다", () => {
    const { db } = seedDatabase();
    recordGhAccounts(db, {
      runnerId: toRunnerId("runner-a"),
      readAt: now,
      reading: Object.assign(
        { token: "gho_FAKE" },
        {
          kind: "logged-in" as const,
          accounts: [
            Object.assign({ token: "gho_FAKE" }, { host: "github.com", login: "b", active: false }),
            { host: "github.com", login: "a", active: true },
          ],
        },
      ),
    });
    const page = loadRunnersPage(db, now, { includeGhAccounts: true });
    const gh = page.runners.find((r) => r.id === "runner-a")?.ghAccounts;
    expect(gh).toMatchObject({ kind: "logged-in", accounts: [{ login: "a" }, { login: "b" }] });
    expect(JSON.stringify(page)).not.toContain("gho_");
    expect(render(page, "runner-a")).not.toContain("gho_");
    expect(loadRunnersPage(db, now).runners[0]).not.toHaveProperty("ghAccounts");
  });
});
