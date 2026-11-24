import { toRunId, toTicketKey } from "@ganger/core";
import { describe, expect, it } from "vitest";
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import type { HomePullRequest, HomeRun } from "@ganger/app/home/model";
import type { PrSignalsView } from "@ganger/app/pr-signals-view";
import { renderWithMessages } from "../testing/render";
import { homeMessages } from "./messages";
import { PrTabContent } from "./sheet-pr-tab";
import { initialSheetTab, prTabDot, showsPrTab } from "./sheet-tabs";

const unusedMerge = () => Promise.reject(new Error("unused"));

const base = {
  id: toRunId("run-1"),
  ticketId: "ticket-ACME-1",
  ticketKey: toTicketKey("ACME-1"),
  ticketTitle: "결제 재시도",
  trackerProject: "Web",
  workspace: { id: "ws-commerce", name: "Commerce" },
  runner: { name: "runner-1", online: true },
  agent: "claude",
  waitMs: 0,
  executionMs: 60_000,
  pullRequest: null,
  cancelling: false,
  control: null,
};

const clean: PrSignalsView = {
  ciFailed: false,
  checkTotal: 4,
  failedCount: 0,
  failedChecks: [],
  checksTruncated: false,
  conflict: false,
  behindBy: 0,
  checkedAt: "2026-11-23T00:00:00.000Z",
};

function pr(over: Partial<HomePullRequest> = {}): HomePullRequest {
  return {
    displayId: "#42",
    url: "https://code.example.com/acme/web/pull/42",
    signals: clean,
    ci: "success",
    state: "open",
    settledAt: null,
    settledAgoMs: null,
    branch: "acme-1-retry",
    title: null,
    baseBranch: null,
    commitSummary: null,
    merge: null,
    ...over,
  };
}

const failing = pr({
  ci: "failure",
  signals: { ...clean, ciFailed: true, failedCount: 2, failedChecks: ["lint", "e2e (2)"] },
});

function ended(pullRequest: HomePullRequest | null, prState: "none" | "open" = "open"): HomeRun {
  return {
    ...base,
    pullRequest,
    state: "ended",
    agentResult: "reported-success",
    prState: pullRequest === null ? prState : "open",
    prReadError: null,
    summary: "succeeded",
    endedAt: "2026-11-23T00:00:00.000Z",
    endedAgoMs: 60_000,
  };
}

const running: HomeRun = { ...base, state: "running" };
const queued: HomeRun = { ...base, state: "queued", queuedReason: { kind: "behind" } };
const humanCheck: HomeRun = {
  ...base,
  pullRequest: failing,
  state: "waiting-for-input",
  input: { kind: "human-check", questionId: "q-1", body: "확인해 주세요", answered: false },
  waitingMs: 60_000,
};
const paused: HomeRun = {
  ...base,
  pullRequest: failing,
  state: "paused",
  pausedMs: 60_000,
  pauseSource: "operator",
};

describe("처음 열리는 탭(티켓 0199)", () => {
  it("할 일이 있거나 answer 모드면 「런」이다", () => {
    expect(initialSheetTab(humanCheck, "summary")).toBe("run");
    expect(initialSheetTab(paused, "summary")).toBe("run");
    expect(initialSheetTab(ended(failing), "answer")).toBe("run");
  });

  it("끝난 런의 PR 에 CI 실패나 충돌이 있으면 「PR」이다", () => {
    expect(initialSheetTab(ended(failing), "summary")).toBe("pr");
    expect(initialSheetTab(ended(pr({ signals: { ...clean, conflict: true } })), "summary")).toBe(
      "pr",
    );
  });

  it("그 밖에는 「런」이다", () => {
    expect(initialSheetTab(ended(pr()), "summary")).toBe("run");
    expect(initialSheetTab(ended(pr({ signals: { ...clean, behindBy: 3 } })), "summary")).toBe(
      "run",
    );
    expect(initialSheetTab(ended(null), "summary")).toBe("run");
    expect(initialSheetTab({ ...running, pullRequest: failing }, "summary")).toBe("run");
    expect(initialSheetTab(ended(pr({ ...failing, state: "merged" })), "summary")).toBe("run");
  });
});

describe("「PR」 탭 보이기와 점(티켓 0199)", () => {
  it("Queued 런은 「PR」 탭을 숨긴다", () => {
    expect(showsPrTab(queued)).toBe(false);
    expect(showsPrTab(running)).toBe(true);
    expect(showsPrTab(ended(null))).toBe(true);
  });

  it("CI 실패·충돌은 problem, 문제 없으면 clear, 도는 중·뒤처짐은 waiting, 머지는 merged, 닫힘은 closed 점이다", () => {
    expect(prTabDot(failing)).toEqual({ state: "problem", reason: "problem" });
    expect(prTabDot(pr({ signals: { ...clean, conflict: true, behindBy: 2 } }))).toEqual({
      state: "problem",
      reason: "problem",
    });
    expect(prTabDot(pr())).toEqual({ state: "clear", reason: "ok" });
    expect(prTabDot(pr({ ci: "pending" }))).toEqual({ state: "waiting", reason: "pending" });
    expect(prTabDot(pr({ signals: { ...clean, behindBy: 3 } }))).toEqual({
      state: "waiting",
      reason: "behind",
    });
    expect(prTabDot(pr({ state: "merged", signals: null }))).toEqual({
      state: "merged",
      reason: "merged",
    });
    expect(prTabDot(pr({ state: "closed", signals: null }))).toEqual({
      state: "closed",
      reason: "closed",
    });
  });

  it("다시 읽지 않아 신호가 없는 PR 은 저장된 CI 실패로 빨간 점을 달거나 「PR」 탭으로 열지 않는다", () => {
    const hidden = pr({ ci: "failure", signals: null });
    expect(prTabDot(hidden)).toBeNull();
    expect(initialSheetTab(ended(hidden), "summary")).toBe("run");
    expect(prTab(ended(hidden))).not.toContain('data-signal-tone="problem"');
  });

  it("신호를 읽지 못해 판단할 수 없으면 점을 두지 않는다", () => {
    expect(prTabDot(pr({ signals: null }))).toBeNull();
    expect(prTabDot(pr({ ci: "unknown", signals: { ...clean, conflict: null } }))).toBeNull();
  });
});

function prTab(run: HomeRun): string {
  return renderWithMessages(
    <PrTabContent run={run} onMerge={unusedMerge} onLoadCommits={unusedMerge} />,
    homeMessages,
  );
}

const p = homeJson.sheet.pr;

describe("「PR」 탭 줄 목록(티켓 0199)", () => {
  it("통과한 PR 은 CI·충돌·base 를 ✓ 로 보이고 PR 링크와 브랜치를 둔다", () => {
    const html = prTab(ended(pr()));
    expect(html).toContain(p.ciValue.passed.replace("{count}", "4"));
    expect(html).toContain(p.conflictValue.none);
    expect(html).toContain(p.baseValue.upToDate);
    expect(html.match(/data-signal-tone="pass"/g)).toHaveLength(3);
    expect(html).toContain('href="https://code.example.com/acme/web/pull/42"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("acme-1-retry");
    expect(html).not.toContain(p.state);
  });

  it("CI 가 실패하면 실패 수와 실패한 체크 이름을 빨간 줄로 보인다", () => {
    const html = prTab(ended(failing));
    expect(html).toContain(p.ciValue.failedOf.replace("{total}", "4").replace("{failed}", "2"));
    expect(html).toContain(
      new Intl.ListFormat("ko", { type: "conjunction" }).format(["lint", "e2e (2)"]),
    );
    expect(html).toContain('data-signal-tone="problem"');
  });

  it("CI 가 도는 중이고 뒤처졌으면 그대로 보인다", () => {
    const html = prTab({
      ...running,
      pullRequest: pr({ ci: "pending", signals: { ...clean, behindBy: 3 } }),
    });
    expect(html).toContain(p.ciValue.pending);
    expect(html).toContain(p.baseValue.behind.replace("{count}", "3"));
    expect(html).toContain('data-signal-tone="warning"');
  });

  it("저장된 CI 가 실패여도 새로 읽은 체크가 모두 통과면 통과로 보인다", () => {
    const html = prTab({ ...running, pullRequest: pr({ ci: "failure" }) });
    expect(html).toContain(p.ciValue.passed.replace("{count}", "4"));
    expect(html).not.toContain('data-signal-tone="problem"');
  });

  it("충돌이 있으면 빨간 줄이다", () => {
    const html = prTab({ ...running, pullRequest: pr({ signals: { ...clean, conflict: true } }) });
    expect(html).toContain(p.conflictValue.some);
    expect(html).toContain('data-signal-tone="problem"');
  });

  it("신호를 읽지 못한 값은 알 수 없어요로 둔다", () => {
    const html = prTab({ ...running, pullRequest: pr({ ci: "unknown", signals: null }) });
    expect(html.match(new RegExp(p.conflictValue.unknown, "g"))?.length).toBeGreaterThanOrEqual(3);
  });

  it("머지된 PR 은 상태와 머지 시각만 보이고 CI 줄을 두지 않는다", () => {
    const html = prTab(
      ended(
        pr({
          state: "merged",
          signals: null,
          settledAt: "2026-11-23T00:00:00.000Z",
          settledAgoMs: 3 * 60 * 60 * 1000,
        }),
      ),
    );
    expect(html).toContain("Merged · ");
    expect(html).toContain("3");
    expect(html).not.toContain(`>${p.ci}<`);
    expect(prTab(ended(pr({ state: "merged", signals: null })))).toContain(`>${p.merged}<`);
  });

  it("닫힌 PR 은 닫힘으로 보인다", () => {
    const html = prTab(ended(pr({ state: "closed", signals: null })));
    expect(html).toContain(p.closed);
    expect(html).not.toContain(`>${p.ci}<`);
  });

  it("PR 이 없으면 진행 중에는 아직 없다고, 끝난 런에는 만들지 않고 끝났다고 알린다", () => {
    const live = prTab(running);
    expect(live).toContain(p.none);
    expect(live).toContain(p.noneYet);
    const done = prTab(ended(null, "none"));
    expect(done).toContain(p.noneEnded);
    expect(done).not.toContain(p.none);
  });
});
