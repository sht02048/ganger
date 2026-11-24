import {
  toAgentMessageRequestId,
  toFollowUpRef,
  toPermissionRequestId,
  toPullRequestId,
  toQuestionId,
  toRunId,
  toRunnerId,
} from "@ganger/core";
import {
  changeRunState,
  completeAgentMessage,
  getRun,
  recordGhAccounts,
  recordAgentMessageFollowUp,
  completeRunControlRequest,
  requestAgentMessage,
  requestRunCancel,
  requestRunControl,
  recordMcpAction,
  completeLogTailRequest,
  recordProviderUsage,
  recordPermissionWaits,
  recordRunQuestions,
  recordAgentCheck,
  recordContinuePlace,
  requestPreviousAgentStop,
  recordStartFailure,
  recordStartRequested,
  saveWorkspaceBrief,
  toWorkspaceId,
  updateRunRecords,
} from "@ganger/db";
import type { RunId } from "@ganger/core";
import type { Database } from "@ganger/db";
import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runJson from "../../messages/ko/run.json" with { type: "json" };
import { buttonsOf } from "../testing/buttons";
import { labeledTimesOf } from "../testing/labeled-times";
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { addTitledRun, endedCases, minutes, now, seedDatabase } from "../testing/seed";
import { loadRunDetail, requestRunLogTail } from "@ganger/app/run-detail/load";
import questionJson from "../../messages/ko/question.json" with { type: "json" };
import { LOG_POLL_LIMIT, runDetailPollMs } from "./actions";
import { runMessages } from "./messages";
import type { RunDetail, RunDetailPage } from "@ganger/app/run-detail/model";
import { RunDetailScreen, timelineRows } from "./run-detail-screen";
import type { RunDetailBack } from "./run-detail-screen";
import { addExtraEnded, assign, extraEndedCases, startedOn, walk } from "./testing";
import { nextStepInputOfDetail, runNextStep } from "@ganger/app/run-next-step";
import { answerInput, submitAnswer } from "@ganger/app/home/actions";
import {
  cancelRunRequest,
  continueRunRequest,
  removeWorktreeRequest,
} from "@ganger/app/run-detail/actions";

const resolved = () => Promise.resolve();

const labels = (html: string): string[] => buttonsOf(html).map((button) => button.label);

function render(page: RunDetailPage, timeZone?: string, back?: RunDetailBack): string {
  return renderWithMessages(
    <RunDetailScreen
      page={page}
      runsHref="/runs"
      runHref={(id) => `/runs/${id}`}
      runnerHref={(id) => `/runs?runner=${id}`}
      {...(back === undefined ? {} : { back })}
      onAnswer={resolved}
      onHumanCheck={resolved}
      onDeny={resolved}
      onCancel={resolved}
      onRemoveWorktree={resolved}
      onContinue={resolved}
      onStopPreviousAgent={resolved}
      onControl={() => Promise.resolve("requested" as const)}
      onStartWithoutWaiting={resolved}
      onSendAgentMessage={() => Promise.resolve("requested" as const)}
      onRefreshLog={resolved}
    />,
    runMessages,
    timeZone,
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");
}

function problemCalloutBlocks(html: string, title: string): string[] {
  const titleAt = html.indexOf(`>${title}</h3>`);
  if (titleAt === -1) throw new Error(`no problem callout titled ${title}`);
  const section = html.slice(html.lastIndexOf("<section", titleAt));
  const blocks: string[] = [];
  let depth = 0;
  let blockStart = 0;
  for (const tag of section.matchAll(/<(\/?)[a-zA-Z][\w-]*(?:"[^"]*"|[^>"])*?(\/?)>/g)) {
    if (tag[2] === "/") continue;
    if (tag[1] === "/") {
      depth -= 1;
      if (depth === 0) return blocks;
      if (depth === 1) blocks.push(section.slice(blockStart, tag.index + tag[0].length));
    } else {
      if (depth === 1) blockStart = tag.index;
      depth += 1;
    }
  }
  throw new Error("unclosed problem callout");
}

function valueOf(html: string, label: string): string | undefined {
  const after = html.split(`>${label}</dt>`)[1];
  return after === undefined ? undefined : text(after.split("</dd>")[0] ?? "").trim();
}

function page(db: Database, id: string | undefined): RunDetailPage {
  if (id === undefined) throw new Error("no run id");
  return loadRunDetail(db, id, now);
}

function found(db: Database, id: string | undefined): RunDetail {
  const p = page(db, id);
  if (p.kind !== "found") throw new Error("not found");
  return p.run;
}

describe("Run 상세의 돌아가기 (0181)", () => {
  const backName = (back?: RunDetailBack) => {
    const { db, ids } = seedDatabase();
    const html = render({ kind: "found", run: found(db, ids.get("ACME-10")) }, undefined, back);
    return /<a href="\/runs"[^>]*aria-label="([^"]+)"/.exec(html)?.[1];
  };

  it("앱 안 기록이 없으면 Runs로 돌아간다", () => {
    expect(backName()).toBe(runJson.backTo.runs);
  });

  it.each(["dashboard", "tickets", "runs", "run", "runners", "stats", "settings"] as const)(
    "%s 에서 왔으면 그 화면 이름으로 돌아간다",
    (origin) => {
      expect(backName({ origin, go: () => {} })).toBe(runJson.backTo[origin]);
    },
  );
});

describe("Run 상세의 티켓 링크 (0197)", () => {
  it("머리에 런의 트래커 경로를 새 탭으로 여는 이름 있는 링크가 있다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    const html = render({ kind: "found", run: found(db, id) });
    const anchor = html
      .match(/<a [^>]*>/g)
      ?.find((tag) => tag.includes(`href="/runs/${encodeURIComponent(id ?? "")}/ticket"`));
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain(`aria-label="${runJson.openInTracker} (${runJson.newTab})"`);
  });
});

describe("Run 상세의 먼저 끝나야 하는 티켓 (0160)", () => {
  const blocker = (key: string, stateName: string, stateCategory: string) => ({
    key,
    title: `${key} 제목`,
    stateName,
    stateCategory,
  });
  const queuedWith = (queuedReason: RunDetail["status"] & { state: "queued" }) => {
    const { db, ids } = seedDatabase();
    return render({
      kind: "found",
      run: { ...found(db, ids.get("ACME-10")), status: queuedReason },
    });
  };

  it("기다림은 선행 목록과 끝난 티켓, 기다리지 않고 시작을 보이고 자리 안내는 뺀다", () => {
    const html = queuedWith({
      state: "queued",
      queuedReason: {
        kind: "blockers-waiting",
        blockers: [blocker("ACME-11", "In Progress", "started")],
        finished: [blocker("ACME-9", "Done", "completed")],
      },
    });
    const body = text(html);

    expect(body).toContain(runJson.blockerWait.waiting);
    expect(body).toContain("ACME-11");
    expect(body).toContain("ACME-9");
    expect(labels(html)).toContain(runJson.blockerWait.trigger);
    expect(body).not.toContain("러너가 비면");
  });

  it("멈춘 기다림은 까닭에 맞는 안내를 보인다", () => {
    const canceled = blocker("ACME-10", "Canceled", "canceled");
    const body = text(
      queuedWith({
        state: "queued",
        queuedReason: {
          kind: "blockers-stuck",
          cause: "canceled",
          blocker: canceled,
          blockers: [canceled],
        },
      }),
    );

    expect(body).toContain(runJson.blockerWait.stuck.canceled);
    expect(body).not.toContain(runJson.blockerWait.waiting);
  });

  it("선행 티켓을 기다리지 않는 Queued 런에는 시작 버튼이 없다", () => {
    const html = queuedWith({ state: "queued", queuedReason: { kind: "behind" } });

    expect(labels(html)).not.toContain(runJson.blockerWait.trigger);
    expect(text(html)).not.toContain(runJson.blockerWait.title);
  });
});

describe("Run 상세의 에이전트에게 보내기 (0147)", () => {
  const started = (db: Database, key: string, at: number) => {
    const id = assign(db, key, at);
    walk(db, id, at, [startedOn(key)]);
    return id;
  };
  const sent = (db: Database, id: Parameters<typeof requestAgentMessage>[1], body: string) => {
    const result = requestAgentMessage(
      db,
      id,
      { requestId: toAgentMessageRequestId(`request-${body}`), body },
      minutes(910),
    );
    if (!result.ok) throw new Error("not requested");
    return result.id;
  };

  it("Running·Waiting for Input·Paused 런에만 입력칸을 보인다", () => {
    const { db } = seedDatabase();
    const id = started(db, "ACME-91", 900);
    expect(text(render(page(db, id)))).toContain(runJson.agentMessage.title);

    changeRunState(db, id, { to: "waiting-for-input" }, minutes(901));
    expect(text(render(page(db, id)))).not.toContain(runJson.agentMessage.hint.waiting);
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-91"), body: "어느 쪽?", options: [], askedAt: minutes(901) },
    ]);
    const waiting = text(render(page(db, id)));
    expect(waiting).toContain(runJson.agentMessage.title);
    expect(waiting).toContain(runJson.agentMessage.hint.waiting);

    changeRunState(db, id, { to: "running" }, minutes(902));
    changeRunState(db, id, { to: "paused", source: "operator" }, minutes(903));
    const paused = text(render(page(db, id)));
    expect(paused).toContain(runJson.agentMessage.title);
    expect(paused).toContain(runJson.agentMessage.hint.paused);

    changeRunState(db, id, { to: "disconnected" }, minutes(904));
    expect(text(render(page(db, id)))).not.toContain(runJson.agentMessage.title);

    changeRunState(db, id, { to: "ended", agentResult: "canceled", prState: "none" }, minutes(905));
    expect(text(render(page(db, id)))).not.toContain(runJson.agentMessage.title);
  });

  it("Queued 런과 취소 중인 런에는 입력칸이 없다", () => {
    const { db } = seedDatabase();
    const queued = assign(db, "ACME-92", 900);
    expect(text(render(page(db, queued)))).not.toContain(runJson.agentMessage.title);
    const id = started(db, "ACME-93", 900);
    requestRunCancel(db, id, minutes(901));
    expect(text(render(page(db, id)))).not.toContain(runJson.agentMessage.title);
  });

  it("타임라인에 운영자가 보냄과 보낸 말을 남기고, Paused 런은 재개하면 전한다고 보인다", () => {
    const { db } = seedDatabase();
    const id = started(db, "ACME-94", 900);
    changeRunState(db, id, { to: "paused", source: "operator" }, minutes(901));
    sent(db, id, "끝내기 전에 PR 까지 열어 줘요");
    const html = text(render(page(db, id)));
    expect(html).toContain(runJson.timeline["operator-message"]);
    expect(html).toContain("끝내기 전에 PR 까지 열어 줘요");
    expect(html).toContain(runJson.agentMessage.delivery["after-resume"]);
  });

  it("후속 워커를 멈추는 동안에는 보내는 중이라고 하지 않고 다시 읽기를 돌리지 않는다", () => {
    const { db } = seedDatabase();
    const id = started(db, "ACME-97", 900);
    const messageId = sent(db, id, "다시 시작된 말");
    recordAgentMessageFollowUp(db, messageId, toFollowUpRef("ctx_follow_up"));
    const detail = page(db, id);
    const html = text(render(detail));
    expect(html).toContain(runJson.agentMessage.delivery["stopping-follow-up"]);
    expect(html).not.toContain(runJson.agentMessage.delivery.sending);
    expect(runDetailPollMs(detail, LOG_POLL_LIMIT)).toBe(false);
  });

  it("후속 워커를 멈추지 못하면 러너에서 직접 멈추라고 보인다", () => {
    const { db } = seedDatabase();
    const id = started(db, "ACME-96", 900);
    const messageId = sent(db, id, "다시 시작된 말");
    completeAgentMessage(db, {
      id: messageId,
      runId: id,
      completedAt: minutes(911),
      error: "follow-up-not-stopped",
    });
    expect(text(render(page(db, id)))).toContain(
      runJson.agentMessage.failure["follow-up-not-stopped"],
    );
  });

  it("보내지 못하면 입력칸과 타임라인에 이유를 보인다", () => {
    const { db } = seedDatabase();
    const id = started(db, "ACME-95", 900);
    const messageId = sent(db, id, "안 닿는 말");
    completeAgentMessage(db, {
      id: messageId,
      runId: id,
      completedAt: minutes(911),
      error: "runner-unreachable",
    });
    const html = render(page(db, id));
    const reason = runJson.agentMessage.failure["runner-unreachable"];
    expect(text(html).split(reason).length - 1).toBe(2);
    expect(html).toMatch(/role="status"[^>]*>[^<]*보내지 못했어요/);
  });
});

describe("Run 상세의 받은 지시서 (0146)", () => {
  it("시작한 런은 받은 지시서 전체를 접은 채로 보이고, 줄바꿈을 그대로 둔다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-90", 900);
    const brief = "Read AGENTS.md first.\n\nACME-90 Fix totals\n\n## 운영자에게 물을 때\n";
    recordStartRequested(db, id, minutes(900), brief);
    walk(db, id, 900, [startedOn("ACME-90")]);
    const html = render(page(db, id));
    const details = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(details).not.toContain(" open");
    expect(text(details)).toContain(runJson.brief.title);
    expect(details).toContain(`aria-label="${runJson.brief.label}"`);
    expect(details).toContain("Read AGENTS.md first.\n\nACME-90 Fix totals");
  });

  it("Workspace 지시를 바꿔도 이미 시작한 런의 받은 지시서는 그대로다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-91", 910);
    recordStartRequested(db, id, minutes(910), "Old rule.\n\nACME-91\n");
    walk(db, id, 910, [startedOn("ACME-91")]);
    saveWorkspaceBrief(db, {
      id: toWorkspaceId(found(db, id).workspace.id),
      brief: { before: "New rule.", after: "" },
    });
    expect(found(db, id).brief).toBe("Old rule.\n\nACME-91\n");
  });

  it("지시서를 보내기 전이거나 시작하지 못한 런에는 받은 지시서 구역이 없다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-92", 920);
    recordStartRequested(db, id, minutes(920), "never received");
    expect(found(db, id).brief).toBeNull();
    walk(db, id, 920, [{ to: "ended", agentResult: "could-not-start", prState: "none" }]);
    expect(found(db, id).brief).toBeNull();
    expect(render(page(db, id))).not.toContain(runJson.brief.title);
  });
});

describe("Run 상세의 처리할 일 띠와 배치 (0174)", () => {
  const prUrl = "https://code.example.com/acme/web/pull/70";
  const endedWithPr = (
    ciFailed: boolean,
    conflict: boolean,
    {
      checkTotal = 4,
      keptWorktree = false,
    }: { checkTotal?: number | null; keptWorktree?: boolean } = {},
  ) => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-70", 400);
    walk(db, id, 400, [
      startedOn("ACME-70"),
      { to: "ended", agentResult: "reported-success", prState: "open" },
    ]);
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("70"),
        displayId: "#70",
        url: prUrl,
        ci: ciFailed ? "failure" : "success",
        checkedAt: minutes(403),
        signals: {
          open: true,
          headCommit: "abc",
          ciFailed,
          checkTotal,
          failedCount: ciFailed ? 1 : 0,
          failedChecks: ciFailed ? ["lint"] : [],
          checksTruncated: false,
          conflict,
          behindBy: 0,
        },
      },
    });
    const run = found(db, id);
    if (run.status.state !== "ended") throw new Error("run has not ended");
    return render({
      kind: "found",
      run: {
        ...run,
        report: "시계 adapter를 합쳤어요.",
        status: keptWorktree
          ? {
              ...run.status,
              keptWorktree: { reason: "unpushed-commits", removing: false },
            }
          : run.status,
      },
    });
  };
  const primaryLinks = (html: string): string[] =>
    [...html.matchAll(/<a [^>]*data-variant="primary"[^>]*>/g)].map(
      (match) => /href="([^"]+)"/.exec(match[0])?.[1] ?? "",
    );

  it("PR CI 가 실패한 끝난 런은 띠의 노란 버튼이 실패한 검사로 가고 할 일이 없다고 하지 않는다", () => {
    const html = endedWithPr(true, false);
    expect(text(html)).toContain(domain.runNextStep.body["pr-ci-failed"]);
    expect(text(html)).toContain(domain.runNextStep.action["pr-ci-failed"]);
    expect(primaryLinks(html)).toEqual([`${prUrl}/checks`]);
    expect(buttonsOf(html).filter((b) => b.variant === "primary")).toEqual([]);
    expect(text(html)).not.toContain("할 일이 없어요");
  });

  it("충돌한 PR 은 띠의 노란 버튼이 PR 로 간다", () => {
    const html = endedWithPr(false, true);
    expect(text(html)).toContain(domain.runNextStep.body["pr-conflict"]);
    expect(primaryLinks(html)).toEqual([prUrl]);
  });

  it.each([
    { step: "pr-conflict", ciFailed: false, conflict: true },
    { step: "pr-ci-failed", ciFailed: true, conflict: false },
  ] as const)(
    "$step 띠는 덧붙일 말과 보존 워크트리가 없으면 빈 본문을 두지 않는다(0177)",
    ({ step, ciFailed, conflict }) => {
      const html = endedWithPr(ciFailed, conflict, { checkTotal: null });
      const blocks = problemCalloutBlocks(html, domain.runNextStep.body[step]);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toContain("<h3");
      expect(blocks[1]).toContain("<a ");
    },
  );

  it.each([
    { step: "pr-conflict", ciFailed: false, conflict: true },
    { step: "pr-ci-failed", ciFailed: true, conflict: false },
  ] as const)(
    "$step 띠는 보존 워크트리가 있으면 본문에 그 안내를 보인다(0177)",
    ({ step, ciFailed, conflict }) => {
      const html = endedWithPr(ciFailed, conflict, { checkTotal: null, keptWorktree: true });
      const blocks = problemCalloutBlocks(html, domain.runNextStep.body[step]);
      expect(blocks).toHaveLength(3);
      expect(text(blocks[1] ?? "")).toContain(runJson.keptWorktree["unpushed-commits"]);
      expect(text(blocks[1] ?? "")).toContain(runJson.keptWorktreeNext["unpushed-commits"]);
    },
  );

  it("Question 은 띠의 답하기가 보조 버튼이고 노란 버튼은 보내기 하나다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-1"), body: "계속할까요?", options: ["네"], askedAt: minutes(50) },
    ]);
    const buttons = buttonsOf(render(page(db, id)));
    expect(buttons.find((b) => b.label === domain.runNextStep.action.question)?.variant).toBe(
      "secondary",
    );
    expect(buttons.filter((b) => b.variant === "primary").map((b) => b.label)).toEqual([
      questionJson.send,
    ]);
  });

  it("Permission 은 띠에 허용 안내만 두고 노란 버튼이 없다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordPermissionWaits(db, id, [
      { id: toPermissionRequestId("perm-1"), detail: "Bash: ls", requestedAt: minutes(50) },
    ]);
    const html = render(page(db, id));
    expect(text(html)).toContain(domain.runNextStep.body.permission);
    expect(buttonsOf(html).filter((b) => b.variant === "primary")).toEqual([]);
  });

  it("Paused 런의 재개하기는 띠에 하나만 있다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    changeRunState(db, id, { to: "paused" }, minutes(90));
    const resumes = buttonsOf(render(page(db, id))).filter(
      (b) => b.label === runJson.control.resume,
    );
    expect(resumes).toEqual([{ variant: "primary", label: runJson.control.resume }]);
  });

  it("Disconnected 와 Failed 는 띠에 문장을 보이고 노란 버튼이 없다", () => {
    const { db, ids } = seedDatabase();
    const disconnected = render(page(db, ids.get("ACME-12")));
    expect(text(disconnected)).toContain(domain.runNextStep.body.disconnected);
    expect(buttonsOf(disconnected).filter((b) => b.variant === "primary")).toEqual([]);
    const extra = addExtraEnded(db);
    const failed = render(page(db, extra.get("ACME-24")));
    expect(text(failed)).toContain(domain.runNextStep.body.failed);
    expect(buttonsOf(failed).filter((b) => b.variant === "primary")).toEqual([]);
  });

  it("처리할 일이 없는 Running 런은 띠 없이 조용한 한 줄만 둔다", () => {
    const { db, ids } = seedDatabase();
    const html = render(page(db, ids.get("ACME-10")));
    expect(text(html)).toContain(runJson.reason.running);
    for (const body of Object.values(domain.runNextStep.body)) {
      expect(text(html)).not.toContain(body);
    }
    expect(primaryLinks(html)).toEqual([]);
  });

  it("CI 가 도는 중이면 PR 구역에 그 상태와 검사 수를 함께 보인다", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-2"));
    if (run.pullRequest === null) throw new Error("no PR");
    const html = render({
      kind: "found",
      run: {
        ...run,
        pullRequest: {
          ...run.pullRequest,
          ci: "pending",
          signals: {
            ciFailed: false,
            checkTotal: 4,
            failedCount: 0,
            failedChecks: [],
            checksTruncated: false,
            conflict: false,
            behindBy: 0,
            checkedAt: minutes(100).toISOString(),
          },
        },
      },
    });
    expect(valueOf(html, runJson.pr.ci)).toBe(
      `${runJson.ci.pending} · ${runJson.pr.checks.replace("{total}", "4")}`,
    );
  });

  it("CI 를 못 읽어도 마지막으로 아는 실패는 PR 구역에 실패로 보인다", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-2"));
    if (run.pullRequest === null) throw new Error("no PR");
    const html = render({
      kind: "found",
      run: {
        ...run,
        pullRequest: {
          ...run.pullRequest,
          ci: "unavailable",
          signals: {
            ciFailed: true,
            checkTotal: null,
            failedCount: 0,
            failedChecks: [],
            checksTruncated: false,
            conflict: null,
            behindBy: null,
            checkedAt: minutes(100).toISOString(),
          },
        },
      },
    });
    expect(valueOf(html, runJson.pr.ci)).toContain(runJson.ci.failure);
    expect(valueOf(html, runJson.pr.ci)).not.toContain(runJson.ci.unavailable);
  });

  it("지우는 중인 워크트리에는 지워 달라는 안내를 보이지 않는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-3");
    if (id === undefined) throw new Error("no ACME-3");
    updateRunRecords(db, id, { worktreeKept: "unpushed-commits" });
    removeWorktreeRequest(db, id, minutes(110));
    expect(text(render(page(db, id)))).not.toContain(runJson.keptWorktreeNext["unpushed-commits"]);
  });

  it("새 런이 생긴 옛 런도 워크트리를 남긴 이유와 다음 행동을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-3");
    if (id === undefined) throw new Error("no ACME-3");
    updateRunRecords(db, id, { worktreeKept: "uncommitted-changes" });
    const run = found(db, id);
    const newer = new Date(Date.parse(run.assignedAt) + 60_000).toISOString();
    const html = render({
      kind: "found",
      run: {
        ...run,
        otherRuns: [{ id: "run-new", assignedAt: newer, state: "running" }],
      },
    });
    expect(text(html)).toContain(
      `${runJson.keptWorktree["uncommitted-changes"]} ${runJson.keptWorktreeNext["uncommitted-changes"]}`,
    );
    expect(labels(html)).toContain(runJson.removeWorktree.trigger);
  });

  it("다음 런으로 넘긴 PR 은 지난 CI 실패를 문제로 보이지 않는다", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-2"));
    if (run.pullRequest === null) throw new Error("no PR");
    const html = render({
      kind: "found",
      run: {
        ...run,
        prHandedOver: true,
        pullRequest: { ...run.pullRequest, ci: "failure", signals: null },
      },
    });
    expect(text(html)).not.toContain(runJson.pr.checksLink);
    expect(html).not.toContain('data-signal-tone="problem"');
  });

  it("끝난 런의 이어서 맡기기는 보조 버튼이다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-71", 400);
    walk(db, id, 400, [
      startedOn("ACME-71"),
      { to: "ended", agentResult: "reported-success", prState: "none" },
    ]);
    const run = found(db, id);
    const html = render({
      kind: "found",
      run: {
        ...run,
        continueOffer: {
          sourceNumber: 1,
          nextNumber: 2,
          runnerName: "runner-a",
          place: "same-worktree",
          hasReport: false,
          hasWorkspaceBrief: false,
          agent: "gone",
          agentStopRequested: false,
        },
      },
    });
    expect(buttonsOf(html).find((b) => b.label === runJson.continue.trigger)?.variant).toBe(
      "secondary",
    );
  });

  it("PR 정보는 PR 구역 한 곳에만 있고 머리에 PR 버튼이 없다", () => {
    const html = endedWithPr(true, false);
    expect(html.match(/aria-label="PR #70"/g)).toHaveLength(1);
    expect(text(html).split("PR #70")).toHaveLength(2);
    expect(html.split(`href="${prUrl}"`)).toHaveLength(2);
  });

  it("완료 보고는 지나온 일의 종료 항목 안에 있고 따로 있던 카드는 없다", () => {
    const html = endedWithPr(false, false);
    const body = text(html);
    const timelineAt = body.indexOf(runJson.timeline.title);
    const endedAt = body.indexOf(runJson.timeline.ended, timelineAt);
    const reportAt = body.indexOf("시계 adapter를 합쳤어요.");
    expect(timelineAt).toBeGreaterThan(-1);
    expect(reportAt).toBeGreaterThan(endedAt);
    expect(html).not.toMatch(/<h2[^>]*>완료 보고<\/h2>/);
  });

  it("런 정보는 네 줄이고 러너는 Runs 의 러너 조건으로 가며 받은 지시서는 그 안에 접혀 있다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    const run = { ...found(db, id), brief: "지시서 본문" };
    const html = render({ kind: "found", run });
    const card = html.split(`aria-label="${runJson.props.label}"`)[1]?.split("</section>")[0] ?? "";
    expect(card.match(/<dt/g)).toHaveLength(4);
    expect(card).toContain(`href="/runs?runner=${run.runner?.id ?? ""}"`);
    expect(card).toContain("<details");
    expect(card).not.toMatch(/<details[^>]* open/);
    expect(card).toContain("지시서 본문");
  });
});

describe("Run 상세 화면", () => {
  it("에이전트 결과 아홉과 PR 상태 넷이 각각의 칸에, 요약 결과(Canceled 포함)가 계산 표대로 보인다", () => {
    const { db, ids } = seedDatabase();
    const extra = addExtraEnded(db);
    const cases = [
      ...endedCases.map((c) => ({ ...c, id: ids.get(c.key) })),
      ...extraEndedCases.map((c) => ({ ...c, id: extra.get(c.key) })),
    ];
    for (const c of cases) {
      const html = render(page(db, c.id));
      const body = text(html);
      const quiet = runNextStep(nextStepInputOfDetail(found(db, c.id))) === "none";
      expect({
        key: c.key,
        agent: body.includes(domain.agentResult[c.agentResult]),
        pr: c.prState === "none" || body.includes(domain.prState[c.prState]),
        summary: body.includes(domain.summary[c.summary]),
        reason: !quiet || body.includes(runJson.reason[c.summary]),
      }).toEqual({ key: c.key, agent: true, pr: true, summary: true, reason: true });
    }
  });

  it.each(["no-access", "other"] as const)(
    "PR 정보를 읽지 못한 런(%s)은 못 읽음과 이유, 할 일을 보인다 (0144)",
    (reason) => {
      const { db } = seedDatabase();
      const id = assign(db, "ACME-40", 400);
      walk(db, id, 400, [
        startedOn("ACME-40"),
        {
          to: "ended",
          agentResult: "reported-success",
          prState: "unknown",
          prReadError: reason,
        },
      ]);
      expect(found(db, id).status).toMatchObject({ prState: "unknown", prReadError: reason });
      const html = render(page(db, id));
      const body = text(html);
      expect(body).toContain(`${runJson.prUnread.title} ${runJson.prUnread[reason]}`);
      expect(body).toContain(`PR ${domain.prState.unknown}`);
      expect(pillsOf(html).map((pill) => pill.label)).toEqual([domain.summary.succeeded]);
    },
  );

  it("저장소를 볼 수 없어 PR 을 못 읽은 런은 러너와 서버의 gh 계정 진단을 함께 보인다 (0207)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-40", 400);
    walk(db, id, 400, [
      startedOn("ACME-40"),
      {
        to: "ended",
        agentResult: "reported-success",
        prState: "unknown",
        prReadError: "no-access",
      },
    ]);
    const runnerId = getRun(db, toRunId(id))?.runnerId;
    if (runnerId === null || runnerId === undefined) throw new Error("runner");
    recordGhAccounts(db, {
      runnerId,
      readAt: now,
      reading: {
        kind: "logged-in",
        accounts: [{ host: "github.com", login: "acme-dev", active: true, expired: false }],
      },
    });
    const server = { ghLogins: ["my-personal"], tokenSaved: true, tokenOnly: false };
    const body = text(render(loadRunDetail(db, id, now, server)));
    expect(body).toContain(`${runJson.prUnread.title} ${runJson.prUnread["no-access"]}`);
    expect(body).toContain(
      "는 acme-dev, 서버는 my-personal 계정으로 읽어요. 서버 계정이 이 저장소를 볼 수 없어요.",
    );
    expect(text(render(loadRunDetail(db, id, now)))).not.toContain("서버는");
  });

  it("열린 PR 의 검사·충돌·뒤처짐을 PR 구역에 줄로 보이고 요약 결과는 그대로다 (0150)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-42", 400);
    walk(db, id, 400, [
      startedOn("ACME-42"),
      { to: "ended", agentResult: "reported-success", prState: "open" },
    ]);
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("12"),
        displayId: "#12",
        url: "https://code.example.com/acme/web/pull/12",
        ci: "failure",
        checkedAt: minutes(403),
        signals: {
          open: true,
          headCommit: "abc",
          ciFailed: true,
          checkTotal: 4,
          failedCount: 2,
          failedChecks: ["lint", "e2e"],
          checksTruncated: false,
          conflict: true,
          behindBy: 3,
        },
      },
    });
    const html = render(page(db, id));
    expect(valueOf(html, runJson.pr.ci)).toContain(
      runJson.pr.failedChecks
        .replace("{total}", "4")
        .replace("{failed}", "2")
        .replace("{names}", "lint, e2e"),
    );
    expect(valueOf(html, runJson.pr.conflict)).toBe(runJson.pr.hasConflict);
    expect(valueOf(html, runJson.pr.base)).toBe(runJson.pr.behindBy.replace("{count}", "3"));
    const readTime = labeledTimesOf(html).find((time) => time.title === runJson.pr.readLabel);
    expect(readTime?.hidden).toBe(runJson.pr.readLabel);
    expect(readTime?.visible).toMatch(/^\d{2}:\d{2}$/);
    expect(text(html)).not.toMatch(/\d{2}:\d{2} 읽음/);
    const endedTime = labeledTimesOf(html).find((time) => time.title === runJson.when.endedLabel);
    expect(endedTime).toMatchObject({ hidden: runJson.when.endedLabel });
    expect(text(html)).toContain(`${runJson.when.endedLabel} ${endedTime?.visible ?? "?"} · `);
    expect(text(html)).not.toContain(`${endedTime?.visible ?? "?"} 끝남`);
    expect(pillsOf(html).map((pill) => pill.label)).toEqual([domain.summary.succeeded]);
    expect(text(html)).not.toContain("CI 다시");
  });

  it("도는 런의 열린 PR 은 보이고, 다시 읽지 않게 된 끝난 런은 지난 값을 보이지 않는다 (0150)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-44", 400);
    walk(db, id, 400, [startedOn("ACME-44")]);
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("14"),
        displayId: "#14",
        url: "https://code.example.com/acme/web/pull/14",
        ci: "failure",
        checkedAt: minutes(403),
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
    expect(valueOf(render(page(db, id)), runJson.pr.conflict)).toBe(runJson.pr.hasConflict);

    walk(db, id, 410, [{ to: "ended", agentResult: "reported-success", prState: "open" }]);
    expect(valueOf(render(page(db, id)), runJson.pr.conflict)).toBe(runJson.pr.hasConflict);

    updateRunRecords(db, id, { worktreeRemovedAt: minutes(420) });
    expect(valueOf(render(page(db, id)), runJson.pr.conflict)).toBeUndefined();
  });

  it("같은 커밋에서 PR 정보만 못 읽으면 지난 검사 결과 대신 새 CI 값을 따른다 (0150)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-46", 400);
    walk(db, id, 400, [startedOn("ACME-46")]);
    const pullRequest = {
      id: toPullRequestId("16"),
      displayId: "#16",
      url: "https://code.example.com/acme/web/pull/16",
      headCommit: "abc",
    };
    updateRunRecords(db, id, {
      pullRequest: {
        ...pullRequest,
        ci: "failure",
        checkedAt: minutes(403),
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
    updateRunRecords(db, id, {
      pullRequest: { ...pullRequest, ci: "success", checkedAt: minutes(404), signals: null },
    });
    expect(found(db, id).pullRequest?.signals).toMatchObject({
      ciFailed: false,
      checkTotal: null,
      failedCount: 0,
      failedChecks: [],
      conflict: true,
      behindBy: 3,
    });
  });

  it("같은 커밋에서 CI 를 아예 못 읽으면 지난 CI 실패 표시를 둔다 (0150)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-47", 400);
    walk(db, id, 400, [startedOn("ACME-47")]);
    const pullRequest = {
      id: toPullRequestId("17"),
      displayId: "#17",
      url: "https://code.example.com/acme/web/pull/17",
      headCommit: "abc",
    };
    updateRunRecords(db, id, {
      pullRequest: {
        ...pullRequest,
        ci: "failure",
        checkedAt: minutes(403),
        signals: {
          open: true,
          headCommit: "abc",
          ciFailed: true,
          checkTotal: 4,
          failedCount: 1,
          failedChecks: ["lint"],
          checksTruncated: false,
          conflict: false,
          behindBy: 0,
        },
      },
    });
    updateRunRecords(db, id, {
      pullRequest: { ...pullRequest, ci: "unavailable", checkedAt: minutes(404), signals: null },
    });
    expect(found(db, id).pullRequest?.signals).toMatchObject({ ciFailed: true, checkTotal: null });
  });

  it("PR 정보를 못 읽은 도는 런도 Actions 로 읽은 CI 실패는 표시한다 (0150)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-45", 400);
    walk(db, id, 400, [startedOn("ACME-45")]);
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("15"),
        displayId: "#15",
        url: "https://code.example.com/acme/web/pull/15",
        ci: "failure",
        checkedAt: minutes(403),
        signals: null,
      },
    });
    expect(found(db, id).pullRequest?.signals).toMatchObject({ ciFailed: true, conflict: null });
  });

  it("병합된 PR 에는 충돌과 뒤처짐 줄을 보이지 않는다 (0150)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-43", 400);
    walk(db, id, 400, [
      startedOn("ACME-43"),
      { to: "ended", agentResult: "reported-success", prState: "merged" },
    ]);
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("13"),
        displayId: "#13",
        url: "https://code.example.com/acme/web/pull/13",
        ci: "success",
        checkedAt: minutes(403),
        signals: {
          open: false,
          headCommit: "abc",
          ciFailed: false,
          checkTotal: 4,
          failedCount: 0,
          failedChecks: [],
          checksTruncated: false,
          conflict: null,
          behindBy: null,
        },
      },
    });
    const html = render(page(db, id));
    expect(valueOf(html, runJson.pr.conflict)).toBeUndefined();
    expect(valueOf(html, runJson.pr.base)).toBeUndefined();
  });

  it("제목은 할당 때 저장한 티켓 제목이고, 회색 줄에 키를 함께 보인다(ADR 0010 9번, 0064)", () => {
    const { db } = seedDatabase();
    const html = render(page(db, addTitledRun(db, "ACME-30", "결제 실패 재시도")));
    expect(html).toMatch(/<h1[^>]*>결제 실패 재시도<\/h1>/);
    expect(text(html)).toContain("ACME-30 · Web");
  });

  it("제목을 모르는 런은 키를 제목으로 보인다", () => {
    const { db, ids } = seedDatabase();
    expect(render(page(db, ids.get("ACME-2")))).toMatch(/<h1[^>]*>ACME-2<\/h1>/);
  });

  it("에이전트는 ID 대신 공용 에이전트 이름으로 보인다", () => {
    const { db, ids } = seedDatabase();
    expect(valueOf(render(page(db, ids.get("ACME-2"))), runJson.props.agentModel)).toContain(
      "Claude Code",
    );
  });

  it("런에 적은 모델을 보이고, 정하지 않았으면 러너 기본값을 쓴다고 보인다(0043)", () => {
    const { db, ids } = seedDatabase();
    expect(valueOf(render(page(db, ids.get("ACME-2"))), runJson.props.agentModel)).toContain(
      runJson.props.defaultModel,
    );
    const id = assign(db, "ACME-90", 500, "sonnet");
    expect(valueOf(render(page(db, id)), runJson.props.agentModel)).toContain("sonnet");
  });

  it("러너에 닿지 못한 채 끝난 취소 런은 워크트리를 남긴 이유와 지우기 버튼을 보인다", () => {
    const { db } = seedDatabase();
    const extra = addExtraEnded(db);
    const kept = render(page(db, extra.get("ACME-22")));
    expect(text(kept)).toContain(runJson.keptWorktree["runner-unreached"]);
    expect(labels(kept)).toContain(runJson.removeWorktree.trigger);
    const removed = render(page(db, extra.get("ACME-21")));
    expect(text(removed)).not.toContain(runJson.keptWorktree["runner-unreached"]);
    expect(labels(removed)).not.toContain(runJson.removeWorktree.trigger);
  });

  it("PR 구역에 PR 번호와 지금 PR 상태를 보이고, 이후 PR 상태가 있으면 그것을 보인다 (0145, 0174)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("no ACME-2");
    const body = (): string => text(render(page(db, id)));
    expect(body()).toContain(`PR #2 ${domain.prState.open}`);
    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(110) } });
    expect(body()).toContain(`PR #2 ${domain.prState.merged}`);
    const noPr = text(render(page(db, ids.get("ACME-4"))));
    expect(noPr).not.toContain(runJson.pr.open);
  });

  it("Succeeded 인데 PR 이 없으면 워크트리를 남겼다고 보이고 워크트리 지우기를 둔다 (0145 R7-2·R7-3)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-41", 400);
    walk(db, id, 400, [
      startedOn("ACME-41"),
      { to: "ended", agentResult: "reported-success", prState: "none" },
    ]);
    const html = render(page(db, id));
    const body = text(html);
    expect(body).toContain(`${runJson.keptWorktree["no-pr"]} ${runJson.keptWorktreeNext["no-pr"]}`);
    expect(body).not.toContain("할 일이 없어요");
    expect(labels(html)).toContain(runJson.removeWorktree.trigger);
    expect(html).toMatch(/data-variant="danger"[^>]*>워크트리 지우기|워크트리 지우기/);
  });

  it.each(["uncommitted-changes", "unpushed-commits", "check-failed"] as const)(
    "worker 가 일이 남아 남긴 워크트리(%s)는 그 이유를 보인다 (0145 R7-1)",
    (reason) => {
      const { db, ids } = seedDatabase();
      const id = ids.get("ACME-3");
      if (id === undefined) throw new Error("no ACME-3");
      updateRunRecords(db, id, { worktreeKept: reason });
      const html = render(page(db, id));
      expect(text(html)).toContain(
        `${runJson.keptWorktree[reason]} ${runJson.keptWorktreeNext[reason]}`,
      );
      expect(labels(html)).toContain(runJson.removeWorktree.trigger);
    },
  );

  it("워크트리 지우기를 요청하면 버튼 대신 지우는 중을 상태 문장으로 보인다 (0145 R7-3)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-3");
    if (id === undefined) throw new Error("no ACME-3");
    updateRunRecords(db, id, { worktreeKept: "unpushed-commits" });
    removeWorktreeRequest(db, id, minutes(110));
    const html = render(page(db, id));
    expect(labels(html)).not.toContain(runJson.removeWorktree.trigger);
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${runJson.removeWorktree.pending}<`));
  });

  it("시작하지 않고 끝난 런은 0초 만에 끝났다고 하지 않는다", () => {
    const { db } = seedDatabase();
    const extra = addExtraEnded(db);
    const body = text(render(page(db, extra.get("ACME-23"))));
    expect(body).toContain("시작하지 않고 1 min 기다린 뒤 끝났어요");
    expect(body).not.toContain("만에 끝났어요");
  });

  it("시작할 수 없음 런은 시작 오류를 보인다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-30", 60);
    recordStartFailure(db, id, { failures: 3, error: "worker-start: project not found" });
    walk(db, id, 60, [{ to: "ended", agentResult: "could-not-start", prState: "none" }]);
    const body = text(render(page(db, id)));
    expect(body).toContain(runJson.startError.title);
    expect(body).toContain("worker-start: project not found");
  });

  it("Disconnected 런은 연결 끊김과 ssh 가 실패하기 시작한 시각을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-12");
    if (id === undefined) throw new Error("no ACME-12");
    updateRunRecords(db, id, { unreachableSince: minutes(40) });
    const body = text(render(page(db, id)));
    expect(body).toContain(domain.runState.disconnected);
    expect(body).toContain("09:40부터 러너에 닿지 않아요");
    expect(body).toContain(runJson.timeline.unreachable);
  });

  it("같은 런의 타임라인 시각을 운영자 시간대로 보인다(0044)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-12");
    if (id === undefined) throw new Error("no ACME-12");
    updateRunRecords(db, id, { unreachableSince: minutes(40) });
    const detail = page(db, id);
    expect(text(render(detail))).toContain("09:40부터 러너에 닿지 않아요");
    expect(text(render(detail, "Asia/Seoul"))).toContain("18:40부터 러너에 닿지 않아요");
    expect(text(render(detail, "America/Los_Angeles"))).toContain("01:40부터 러너에 닿지 않아요");
  });

  it("워크트리를 지우지 않은 러너 연결 끊김 런은 워크트리를 남긴 이유와 지우기 버튼을 보인다", () => {
    const { db, ids } = seedDatabase();
    const html = render(page(db, ids.get("ACME-5")));
    expect(text(html)).toContain(
      `${runJson.keptWorktree["runner-disconnected"]} ${runJson.keptWorktreeNext["runner-disconnected"]}`,
    );
    expect(labels(html)).toContain(runJson.removeWorktree.trigger);
    const removed = render(page(db, ids.get("ACME-3")));
    expect(text(removed)).not.toContain(runJson.keptWorktree["runner-disconnected"]);
    expect(labels(removed)).not.toContain(runJson.removeWorktree.trigger);
  });

  it("Ended 가 아닌 런에서만 취소 행동이 보이고, 취소 요청이 있으면 취소 중을 보인다", () => {
    const { db, ids } = seedDatabase();
    for (const key of ["ACME-10", "ACME-11", "ACME-12", "ACME-13"]) {
      expect({
        key,
        cancel: render(page(db, ids.get(key))).includes(runJson.cancel.trigger),
      }).toEqual({ key, cancel: true });
    }
    for (const c of endedCases) {
      expect(render(page(db, ids.get(c.key)))).not.toContain(runJson.cancel.trigger);
    }
    const running = ids.get("ACME-10");
    if (running === undefined) throw new Error("no ACME-10");
    expect(cancelRunRequest(db, running, minutes(100))).toEqual({ ok: true });
    const pending = render(page(db, running));
    expect(pending).toContain(runJson.cancelPending);
    expect(pending).not.toContain(runJson.cancel.trigger);
  });

  it("Running 런은 멈추기, 요청 중이면 멈추는 중, 실패하면 이유를 알림 역할 없이 보인다(0118)", () => {
    const { db, ids } = seedDatabase();
    const running = ids.get("ACME-10");
    if (running === undefined) throw new Error("no ACME-10");
    expect(labels(render(page(db, running)))).toContain(runJson.control.pause);

    expect(requestRunControl(db, running, "pause", minutes(100))).toMatchObject({ ok: true });
    const pending = render(page(db, running));
    expect(text(pending)).toContain(runJson.control.pausePending);
    expect(labels(pending)).not.toContain(runJson.control.pause);

    completeRunControlRequest(db, {
      runId: running,
      requestedAt: minutes(100),
      completedAt: minutes(115),
      error: "runner-unreachable",
    });
    const failed = render(page(db, running));
    const reason = runJson.control.pauseFailed.replace(
      "{reason}",
      domain.runControlFailure["runner-unreachable"],
    );
    expect(text(failed)).toContain(reason);
    expect(failed).not.toMatch(/role="alert"[^>]*>[^<]*멈추지 못했어요/);
    expect(labels(failed)).toContain(runJson.control.pause);

    const later = loadRunDetail(db, running, minutes(126));
    expect(later.kind === "found" ? later.run.control : "missing").toBeNull();
  });

  it("러너에서 멈춘 런과 보고 없이 멈춘 런은 이유를 다르게 보이고, 보고 없이 멈추면 마지막 출력을 접지 않고 보인다(0120)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    expect(changeRunState(db, id, { to: "paused", source: "runner" }, minutes(90))).toMatchObject({
      ok: true,
    });
    const onRunner = text(render(page(db, id)));
    expect(onRunner).toContain(
      runJson.reason.paused.replace("{source}", domain.pauseSource.runner),
    );
    expect(onRunner).not.toContain(runJson.lastOutput.title);

    expect(changeRunState(db, id, { to: "running" }, minutes(95))).toMatchObject({ ok: true });
    expect(
      changeRunState(db, id, { to: "paused", source: "unreported" }, minutes(100)),
    ).toMatchObject({ ok: true });
    updateRunRecords(db, id, { lastLog: ["로그인 버튼을 고쳤어요", "❯"] });
    const detail = found(db, id);
    expect(detail.status).toMatchObject({
      state: "paused",
      pauseSource: "unreported",
      lastOutput: ["로그인 버튼을 고쳤어요", "❯"],
    });
    const html = render(page(db, id));
    expect(text(html)).toContain(
      runJson.reason.paused.replace("{source}", domain.pauseSource.unreported),
    );
    expect(text(html)).toContain(runJson.lastOutput.title);
    expect(text(html)).toContain("로그인 버튼을 고쳤어요");
    expect(html).not.toContain("<details");

    updateRunRecords(db, id, { lastLog: null });
    expect(text(render(page(db, id)))).toContain(runJson.lastOutput.none);
  });

  it("Paused 런은 Paused 알약, 멈춘 시간, 재개하기를 보이고 실행 시간에서 멈춘 시간을 뺀다(0118)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    const before = found(db, id).executionMs ?? 0;
    expect(changeRunState(db, id, { to: "paused" }, minutes(90))).toMatchObject({ ok: true });
    const detail = found(db, id);
    expect(detail.status.state).toBe("paused");
    const html = render(page(db, id));
    expect(pillsOf(html)).toContainEqual({ status: "paused", label: domain.runState.paused });
    expect(buttonsOf(html)).toContainEqual({ variant: "primary", label: runJson.control.resume });
    expect(labels(html)).not.toContain(runJson.control.pause);
    expect(text(html)).toContain(domain.runNextStep.body.paused);
    expect(text(html)).toContain(
      runJson.reason.paused.replace("{source}", domain.pauseSource.operator),
    );
    expect(text(html)).toContain(runJson.timeline.paused);
    expect(detail.executionMs).toBe(before - 30 * 60_000);

    expect(changeRunState(db, id, { to: "disconnected" }, minutes(110))).toMatchObject({
      ok: true,
    });
    const offline = text(render(page(db, id)));
    expect(offline).toContain(runJson.reason.disconnectedPaused);
    expect(offline).not.toContain(runJson.reason.disconnected);
  });

  it("질문으로 기다리는 런은 질문 내용, 선택지, 답하기 칸을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      {
        id: toQuestionId("q-1"),
        body: "마이그레이션을 지금 돌릴까요?",
        options: ["돌려 주세요", "멈춰 주세요"],
        askedAt: minutes(50),
      },
    ]);
    const html = render(page(db, id));
    const body = text(html);
    expect(body).toContain("마이그레이션을 지금 돌릴까요?");
    expect(body).toContain("돌려 주세요");
    expect(body).toContain(questionJson.send);
    expect(html).toMatch(/<input type="radio"[^>]*value="0"/);
    expect(body).toContain(domain.runNextStep.body.question);
    expect(body).not.toContain(runJson.permission.deny);
  });

  it("권한 대기 런은 러너 화면에서 허용하라고 안내하고 거절만 둔다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordPermissionWaits(db, id, [
      {
        id: toPermissionRequestId("perm-1"),
        detail: "Bash: rm -rf node_modules",
        requestedAt: minutes(50),
      },
    ]);
    const html = render(page(db, id));
    const body = text(html);
    expect(body).toContain("Bash: rm -rf node_modules");
    expect(body).toContain(runJson.permission.body);
    expect(body).toContain(runJson.permission.deny);
    expect(body).not.toContain("허용하기");
    expect(html).not.toMatch(/<button[^>]*>[^<]*허용/);
    expect(body.split(runJson.agentMessage.title)[0]).not.toContain(questionJson.send);
  });

  it("답이나 거절을 남긴 뒤에는 입력 칸을 닫고 worker 가 보낸다고 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-1"), body: "계속할까요?", options: [], askedAt: minutes(50) },
    ]);
    submitAnswer(
      db,
      answerInput.parse({ runId: id, questionId: "q-1", answer: "네" }),
      minutes(51),
    );
    const html = render(page(db, id));
    expect(html).not.toContain('name="answer"');
    expect(text(html)).toContain(runJson.reason.answered);
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${runJson.question.sent}<`));
  });

  it("CI 상태를 볼 수 없으면 그렇게 보이고 요약 결과는 그대로다(Q79)", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-2"));
    if (run.pullRequest === null) throw new Error("no PR");
    const body = text(
      render({
        kind: "found",
        run: { ...run, pullRequest: { ...run.pullRequest, ci: "unavailable" } },
      }),
    );
    expect(body).toContain(runJson.ci.unavailable);
    expect(body).toContain(domain.summary.failed);
  });

  it("로그 꼬리: 폴링이 끝나도 로그가 오지 않았으면 가져오는 중 대신 다시 요청하는 길을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    requestRunLogTail(db, id, minutes(100));
    const html = renderWithMessages(
      <RunDetailScreen
        page={page(db, id)}
        runsHref="/runs"
        runHref={(other) => `/runs/${other}`}
        runnerHref={(runner) => `/runs?runner=${runner}`}
        logStalled
        onAnswer={resolved}
        onHumanCheck={resolved}
        onDeny={resolved}
        onCancel={resolved}
        onRemoveWorktree={resolved}
        onContinue={resolved}
        onStopPreviousAgent={resolved}
        onControl={() => Promise.resolve("requested" as const)}
        onStartWithoutWaiting={resolved}
        onSendAgentMessage={() => Promise.resolve("requested" as const)}
        onRefreshLog={resolved}
      />,
      runMessages,
    );
    const body = text(html);

    expect(html).toMatch(new RegExp(`role="status"[^>]*>${runJson.log.stalled}<`));
    expect(body).toContain(runJson.log.stalled);
    expect(body).not.toContain(runJson.log.pending);
    expect(body).toContain(runJson.log.refresh);
  });

  it("로그 꼬리: 요청 중이면 가져오는 중을, 결과가 들어오면 그 줄을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    requestRunLogTail(db, id, minutes(100));
    expect(text(render(page(db, id)))).toContain(runJson.log.pending);
    completeLogTailRequest(db, {
      runId: id,
      requestedAt: minutes(100),
      completedAt: minutes(101),
      lines: ["$ pnpm test", "Tests 42 passed"],
    });
    const html = render(page(db, id));
    const body = text(html);
    expect(body).toContain("Tests 42 passed");
    expect(body).not.toContain(runJson.log.pending);
    const fetched = labeledTimesOf(html).find((time) => time.title === runJson.log.fetchedLabel);
    expect(fetched?.hidden).toBe(runJson.log.fetchedLabel);
    expect(body).toContain(`가져온 2줄 · ${runJson.log.fetchedLabel} ${fetched?.visible ?? "?"}`);
    expect(html.replace(/<[^>]+>/g, "")).not.toMatch(/(ago|Just now) [가-힣]/);
  });

  it("완료 보고 본문과 같은 티켓의 다른 런을 보인다", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-1"));
    const body = text(
      render({
        kind: "found",
        run: {
          ...run,
          report: "PR을 열고 CI 통과를 확인했어요.",
          otherRuns: [
            {
              id: "run-old",
              assignedAt: minutes(0).toISOString(),
              state: "ended",
              summary: "failed",
            },
          ],
        },
      }),
    );
    expect(body).toContain("PR을 열고 CI 통과를 확인했어요.");
    expect(body).toContain(runJson.otherRuns.title);
    expect(body).toContain(domain.summary.failed);
  });

  it("노란 주 버튼은 하나 이하이고, 질문 선택지는 버튼이 아닌 라디오, 런 취소는 위험 버튼이다(ADR 0010 6번)", () => {
    const { db, ids } = seedDatabase();
    const question = ids.get("ACME-11");
    if (question === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, question, [
      {
        id: toQuestionId("q-1"),
        body: "재시도 간격을 바꿀까요?",
        options: ["지수 백오프", "30초 고정"],
        askedAt: minutes(50),
      },
    ]);
    const html = render(page(db, question));
    const buttons = buttonsOf(html);
    expect(buttons.filter((b) => b.variant === "primary").map((b) => b.label)).toEqual([
      questionJson.send,
    ]);
    for (const choice of ["지수 백오프", "30초 고정"]) {
      expect(buttons.some((b) => b.label === choice)).toBe(false);
      expect(html).toMatch(new RegExp(`<input type="radio"[^>]*>\\s*<span[^>]*>${choice}</span>`));
    }
    expect(buttons.find((b) => b.label === runJson.cancel.trigger)?.variant).toBe("danger");
    expect(buttons.some((b) => b.variant === "other")).toBe(false);

    const extra = addExtraEnded(db);
    for (const id of [...ids.values(), ...extra.values()]) {
      const primaries = buttonsOf(render(page(db, id))).filter((b) => b.variant === "primary");
      expect(primaries.length).toBeLessThanOrEqual(1);
    }
  });

  it("권한 대기의 거절은 위험 버튼이다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordPermissionWaits(db, id, [
      { id: toPermissionRequestId("perm-1"), detail: "Bash: ls", requestedAt: minutes(50) },
    ]);
    const buttons = buttonsOf(render(page(db, id)));
    expect(buttons.find((b) => b.label === runJson.permission.deny)?.variant).toBe("danger");
    expect(buttons.filter((b) => b.variant === "primary")).toEqual([]);
  });

  it("맞는 러너가 모두 런의 공급자 한도에 닿으면 대기 사유에 공급자와 풀리는 시간을 보인다", () => {
    const { db } = seedDatabase();
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-a"),
      readAt: minutes(110),
      reading: {
        kind: "read",
        providers: [
          {
            provider: "claude",
            status: "ok",
            windows: [{ kind: "session", usedPercent: 100, resetsAt: minutes(188) }],
          },
        ],
      },
    });
    const id = assign(db, "ACME-90", 115);

    expect(found(db, id).status).toEqual({
      state: "queued",
      queuedReason: { kind: "usage-limit", provider: "claude", resetsInMs: 68 * 60_000 },
    });
    expect(text(render(page(db, id)))).toContain(
      "모든 러너가 Claude 한도에 닿아 1 hr 8 min 뒤 풀려요",
    );
  });

  it("상태 알약 글은 GLOSSARY 영어 용어다(ADR 0010 1번)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-1"), body: "계속할까요?", options: [], askedAt: minutes(50) },
    ]);
    const terms = new Map<string, string>([
      ["queued", "Queued"],
      ["running", "Running"],
      ["waiting-for-input", "Waiting for Input"],
      ["disconnected", "Disconnected"],
      ["succeeded", "Succeeded"],
      ["failed", "Failed"],
      ["canceled", "Canceled"],
      ["question", "Question"],
      ["permission", "Permission"],
    ]);
    const extra = addExtraEnded(db);
    const pills = [...ids.values(), ...extra.values()].flatMap((runId) =>
      pillsOf(render(page(db, runId))),
    );
    expect(pills.length).toBeGreaterThan(ids.size);
    expect(pills.some((p) => p.status === "question")).toBe(true);
    for (const pill of pills) expect(pill.label).toBe(terms.get(pill.status));
  });

  it("질문 카드에 Question 알약과 답을 기다린 시간을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-1"), body: "계속할까요?", options: [], askedAt: minutes(50) },
    ]);
    expect(text(render(page(db, id)))).toContain("Question 1 hr 10 min 답을 기다려요");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-2"), body: "나중 질문", options: [], askedAt: minutes(100) },
    ]);
    const body = text(render(page(db, id)));
    expect(body).toContain("Question 1 hr 10 min 답을 기다려요 계속할까요?");
    expect(body).not.toContain("20 min 답을 기다려요");
  });

  it("타임라인은 같은 날이면 시각만, 다른 날이면 날짜를 붙인다", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-10"));
    const body = text(
      render({
        kind: "found",
        run: {
          ...run,
          now: "2026-11-18T03:00:00.000Z",
          timeline: [
            { kind: "assigned", at: "2026-11-17T23:10:00.000Z" },
            { kind: "started", at: "2026-11-18T01:45:00.000Z" },
          ],
        },
      }),
    );
    expect(body).toContain("11월 17일 23:10");
    expect(body).toMatch(/ 01:45 /);
  });

  it("MCP로 한 런 요청은 상태 기록 사이에 MCP · 이름과 도구로 보이고, Operator라고 보내도 MCP가 붙는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    const runId = toRunId(id);
    const assignedAt = found(db, id).assignedAt;
    recordMcpAction(db, {
      at: new Date(Date.parse(assignedAt) + 1),
      client: "Operator",
      tool: "request_run_log",
      target: "ACME-10",
      runId,
      outcome: "done",
      reason: null,
    });
    recordMcpAction(db, {
      at: new Date(Date.parse(assignedAt) + 2),
      client: "hermes",
      tool: "cancel_run",
      target: "ACME-10",
      runId,
      outcome: "rejected",
      reason: "already-ended",
    });
    const run = found(db, id);
    expect(run.timeline.map((e) => e.kind)).toContain("mcp");
    const body = text(render({ kind: "found", run }));
    expect(body).toContain("MCP · Operator 로그 요청");
    expect(body).toContain("MCP · hermes 런 취소 · 하지 못했어요: 이미 끝난 런이에요");
    expect(body.indexOf("할당")).toBeLessThan(body.indexOf("MCP · Operator"));
  });

  it("없는 런이면 찾을 수 없다고 보인다", () => {
    expect(text(render({ kind: "not-found" }))).toContain(runJson.notFound.title);
  });

  it("문구는 메시지 파일에서 온다", () => {
    const { db, ids } = seedDatabase();
    for (const key of ["ACME-2", "ACME-10", "ACME-12", "ACME-13"]) {
      expect(render(page(db, ids.get(key)))).not.toMatch(/\b(run|domain)\.[a-zA-Z]/);
    }
  });
});

describe("이어서 맡기기(0149)", () => {
  function keptRun(db: Database, key = "ACME-40") {
    const id = assign(db, key, 500);
    walk(db, id, 500, [
      startedOn(key),
      { to: "ended", agentResult: "reported-success", prState: "none", reportBody: "push 남음" },
    ]);
    updateRunRecords(db, id, { worktreeKept: "unpushed-commits" });
    recordAgentCheck(db, id, "gone", { stopHandled: true });
    return id;
  }

  function found(db: Database, id: string): RunDetail {
    const loaded = loadRunDetail(db, id, minutes(600));
    if (loaded.kind !== "found") throw new Error("run not found");
    return loaded.run;
  }

  it("워크트리가 남은 끝난 런에만 이어서 맡기기를 보이고 새 런 번호를 함께 둔다", () => {
    const { db, ids } = seedDatabase();
    const id = keptRun(db);
    expect(labels(render({ kind: "found", run: found(db, id) }))).toContain(
      runJson.continue.trigger,
    );
    expect(found(db, id).continueOffer).toEqual({
      sourceNumber: 1,
      nextNumber: 2,
      runnerName: "runner-a",
      place: "same-worktree",
      hasReport: true,
      hasWorkspaceBrief: false,
      agent: "gone",
      agentStopRequested: false,
    });
    saveWorkspaceBrief(db, {
      id: toWorkspaceId(found(db, id).workspace.id),
      brief: { before: "먼저 규칙을 읽어요.", after: "" },
    });
    expect(found(db, id).continueOffer?.hasWorkspaceBrief).toBe(true);
    const running = ids.get("ACME-10");
    if (running === undefined) throw new Error("no ACME-10");
    expect(found(db, running).continueOffer).toBeNull();
  });

  it("지운 워크트리는 같은 브랜치로 새 워크트리를 만든다고 알린다", () => {
    const { db } = seedDatabase();
    const id = keptRun(db);
    updateRunRecords(db, id, { worktreeRemovedAt: minutes(550) });
    expect(found(db, id).continueOffer?.place).toBe("recreated");
  });

  it("워크트리가 없어서 끝난 런은 같은 브랜치로 새 워크트리를 만든다고 알린다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-41", 500);
    walk(db, id, 500, [
      startedOn("ACME-41"),
      { to: "ended", agentResult: "worktree-missing", prState: "none" },
    ]);
    expect(found(db, id).continueOffer?.place).toBe("recreated");
  });

  it.each(["alive", "unknown"] as const)(
    "이전 에이전트가 %s이면 이어서 맡기기를 쓸 수 없게 하고 이유를 보인다",
    (check) => {
      const { db } = seedDatabase();
      const id = keptRun(db);
      recordAgentCheck(db, id, check, { stopHandled: true });

      const html = render({ kind: "found", run: found(db, id) });
      expect(html).toContain('aria-disabled="true"');
      expect(text(html)).toContain(runJson.continue.blocked[check]);
      expect(labels(html).includes(runJson.continue.stop)).toBe(check === "alive");
    },
  );

  it("멈추기를 요청하면 멈추는 중을 보이고 버튼을 뺀다", () => {
    const { db } = seedDatabase();
    const id = keptRun(db);
    recordAgentCheck(db, id, "alive", { stopHandled: true });
    expect(requestPreviousAgentStop(db, id, minutes(570))).toEqual({ ok: true });

    const html = render({ kind: "found", run: found(db, id) });
    expect(text(html)).toContain(runJson.continue.stopPending);
    expect(labels(html)).not.toContain(runJson.continue.stop);
  });

  it("열린 PR은 다음 런으로 넘겼다고 보이고, 머지된 PR은 이전 런에 남긴다", () => {
    const { db } = seedDatabase();
    const withPr = (key: string, prState: "open" | "merged"): RunId => {
      const id = assign(db, key, 500);
      walk(db, id, 500, [
        startedOn(key),
        { to: "ended", agentResult: "reported-failure", prState },
      ]);
      updateRunRecords(db, id, {
        worktreeKept: "unpushed-commits",
        pullRequest: {
          id: toPullRequestId("7"),
          displayId: "#7",
          url: "https://code.example.com/acme/pull/7",
          ci: "success",
          checkedAt: minutes(520),
        },
      });
      recordAgentCheck(db, id, "gone", { stopHandled: true });
      const result = continueRunRequest(db, id, "이어 주세요", minutes(560));
      if (!result.ok) throw new Error(result.reason);
      queuedNext = { source: id, next: result.runId };
      return id;
    };
    let queuedNext: { source: RunId; next: RunId } | null = null;
    const handedOver = runJson.prHandedOver.replace("{pr}", "#7");

    const open = withPr("ACME-42", "open");
    expect(text(render({ kind: "found", run: found(db, open) }))).not.toContain(handedOver);
    if (queuedNext === null) throw new Error("no continued run");
    const { next } = queuedNext as { source: RunId; next: RunId };
    walk(db, next, 560, [startedOn("ACME-42-2")]);
    expect(text(render({ kind: "found", run: found(db, open) }))).toContain(handedOver);

    expect(
      text(render({ kind: "found", run: found(db, withPr("ACME-43", "merged")) })),
    ).not.toContain(handedOver);
  });

  it("Queued 동안에는 기록한 곳이 있어도 아직 확인 중이라고 보인다", () => {
    const { db } = seedDatabase();
    const id = keptRun(db);
    const result = continueRunRequest(db, id, "이어 주세요", minutes(560));
    if (!result.ok) throw new Error(result.reason);
    recordContinuePlace(db, result.runId, "recreated");

    const body = text(render({ kind: "found", run: found(db, result.runId) }));
    expect(body).toContain(runJson.continuation.place.pending);
    expect(body).not.toContain(runJson.continuation.place.recreated);
  });

  it("이어 받은 런이 시작하기 전에 끝나면 이어 받은 곳 대신 그 사실을 보인다", () => {
    const { db } = seedDatabase();
    const id = keptRun(db);
    const result = continueRunRequest(db, id, "이어 주세요", minutes(560));
    if (!result.ok) throw new Error(result.reason);
    recordContinuePlace(db, result.runId, "same-worktree");
    walk(db, result.runId, 560, [{ to: "ended", agentResult: "canceled", prState: "none" }]);

    const body = text(render({ kind: "found", run: found(db, result.runId) }));
    expect(body).toContain(runJson.continuation.place.notStarted);
    expect(body).not.toContain(runJson.continuation.place["same-worktree"]);
  });

  it("두 런을 잇고 양쪽 Run 상세와 지나온 일에 런 번호를 보인다", () => {
    const { db } = seedDatabase();
    const id = keptRun(db);
    const result = continueRunRequest(db, id, "push 해 주세요", minutes(560));
    if (!result.ok) throw new Error(result.reason);

    const next = found(db, result.runId);
    expect(next.continuedFrom).toEqual({ id, number: 1 });
    const nextBody = text(render({ kind: "found", run: next }));
    expect(nextBody).toContain("런 #1을 이어서");
    expect(nextBody).toContain(runJson.continuation.place.pending);
    expect(nextBody).toContain("런 #1을 이어서 시작");

    const source = found(db, id);
    expect(source.continuedBy).toEqual({ id: result.runId, number: 2 });
    expect(source.continueOffer).toBeNull();
    const html = render({ kind: "found", run: source });
    expect(labels(html)).not.toContain(runJson.removeWorktree.trigger);
    expect(text(html)).toContain("런 #2에 이어서 맡겼어요");
    expect(text(html)).not.toContain(runJson.keptWorktree["unpushed-commits"]);
  });

  it.each([
    [1, "을"],
    [2, "를"],
    [3, "을"],
    [4, "를"],
    [5, "를"],
    [6, "을"],
    [7, "을"],
    [8, "을"],
    [9, "를"],
    [10, "을"],
    [12, "를"],
  ] as const)("런 #%i 뒤에 맞는 조사(%s)를 붙인다", (number, particle) => {
    const t = createTranslator({
      locale: "ko",
      messages: runMessages,
      namespace: "run.continuation",
    });
    expect(t("from", { number, digit: number % 10 })).toBe(`런 #${number}${particle} 이어서`);
  });

  it.each(["same-worktree", "recreated", "from-scratch"] as const)(
    "어디서 이어 받았는지(%s) Run 상세에 보인다",
    (place) => {
      const { db } = seedDatabase();
      const id = keptRun(db);
      const result = continueRunRequest(db, id, "이어 주세요", minutes(560));
      if (!result.ok) throw new Error(result.reason);
      recordContinuePlace(db, toRunId(result.runId), place);
      walk(db, result.runId, 560, [startedOn("ACME-40-2")]);

      const body = text(render({ kind: "found", run: found(db, result.runId) }));
      expect(body).toContain(runJson.continuation.place[place]);
    },
  );
});

describe("타임라인 줄 열쇠(0153)", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const later = "2026-01-01T00:01:00.000Z";

  it("앞에 줄이 끼어들어도 이미 있던 줄의 열쇠는 그대로다", () => {
    const before = timelineRows([{ kind: "paused", at: later }]);
    const after = timelineRows([
      { kind: "unpaused", at },
      { kind: "paused", at: later },
    ]);
    expect(after[1]?.key).toBe(before[0]?.key);
  });

  it("종류와 시각이 같은 줄도 열쇠가 겹치지 않는다", () => {
    const rows = timelineRows([
      { kind: "paused", at },
      { kind: "paused", at },
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });
});
