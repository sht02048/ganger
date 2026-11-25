import {
  AdapterRegistry,
  toAgentId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  SecretBoxError,
  assignRun,
  migrate,
  openDatabase,
  saveMapping,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
} from "@ganger/db";
import { describe, expect, it } from "vitest";
import type { RunDetail } from "../run-detail/model.js";
import { loadRunTicketPageLink } from "../run-ticket-link.js";
import { loadV1TicketLink, parseV1RunAction, toV1RunDetail } from "./run-actions.js";

const detail: RunDetail = {
  id: "run-1",
  now: "2026-11-23T00:00:00.000Z",
  ticketKey: "ACME-1",
  ticketTitle: "제목",
  trackerProject: "Web",
  workspace: { id: "ws", name: "Acme" },
  branch: "acme/secret-branch",
  worktree: "fake::/private/worktree",
  runner: null,
  agent: "claude",
  model: null,
  assignedAt: "2026-11-23T00:00:00.000Z",
  startedAt: null,
  endedAt: null,
  waitMs: 0,
  executionMs: null,
  status: {
    state: "waiting-for-input",
    inputSince: null,
    input: {
      kind: "question",
      questionId: "q",
      body: "어느 쪽으로 할까요?\n\nA) 왼쪽\nB) 오른쪽",
      choices: [],
      answered: false,
    },
  },
  pullRequest: null,
  report: "보고",
  brief: "지시서 비밀",
  startError: null,
  cancelPending: false,
  control: null,
  agentMessage: { accepting: true, latest: null },
  timeline: [{ kind: "assigned", at: "2026-11-23T00:00:00.000Z" }],
  log: { kind: "stored", lines: ["터미널 내용"] },
  otherRuns: [],
  continuedFrom: null,
  continuedBy: null,
  prHandedOver: false,
  continuePlace: null,
  continueOffer: null,
};

describe("toV1RunDetail", () => {
  it("본문에서 읽은 선택지와 그대로 보낼 답을 싣는다", () => {
    const { input, nextStep } = toV1RunDetail(detail);
    expect(nextStep).toBe("question");
    expect(input).toMatchObject({
      kind: "question",
      lead: ["어느 쪽으로 할까요?"],
      choices: [
        { text: "왼쪽", answer: "(A) 왼쪽" },
        { text: "오른쪽", answer: "(B) 오른쪽" },
      ],
    });
  });

  it("타임라인, 터미널, 지시서, 워크트리를 싣지 않는다", () => {
    const text = JSON.stringify(toV1RunDetail(detail));
    for (const hidden of ["터미널 내용", "지시서 비밀", "secret-branch", "/private/worktree"]) {
      expect(text).not.toContain(hidden);
    }
    expect(text).not.toContain("timeline");
  });
});

describe("toV1RunDetail의 PR 상태와 읽기 실패", () => {
  const pullRequest = {
    displayId: "#7",
    url: "https://example.com/acme/pay/pull/7",
    ci: "success" as const,
    signals: null,
  };
  const ended = (
    status: Partial<Extract<RunDetail["status"], { state: "ended" }>>,
    pr: RunDetail["pullRequest"] = pullRequest,
  ): RunDetail => ({
    ...detail,
    pullRequest: pr,
    status: {
      state: "ended",
      agentResult: "reported-success",
      prState: "open",
      prReadError: null,
      prReadDiagnosis: null,
      summary: "succeeded",
      keptWorktree: null,
      laterPrState: null,
      ...status,
    },
  });

  it("끝날 때 본 PR 상태를 싣고 시각은 비운다", () => {
    expect(toV1RunDetail(ended({ prState: "merged" })).pullRequest).toMatchObject({
      state: "merged",
      stateSince: null,
    });
    expect(toV1RunDetail(ended({ prState: "closed" })).pullRequest?.state).toBe("closed");
  });

  it("런이 끝난 뒤 병합·닫힘을 본 때와 지난 시간을 싣는다", () => {
    const pr = toV1RunDetail(
      ended({ prState: "open", laterPrState: { state: "merged", at: "2026-11-22T21:00:00.000Z" } }),
    ).pullRequest;
    expect(pr).toMatchObject({
      state: "merged",
      stateSince: { at: "2026-11-22T21:00:00.000Z", agoMs: 3 * 60 * 60 * 1000 },
    });
  });

  it("끝나지 않은 런의 PR은 열림이다", () => {
    expect(toV1RunDetail({ ...detail, pullRequest }).pullRequest).toMatchObject({
      state: "open",
      stateSince: null,
    });
    expect(toV1RunDetail({ ...detail, pullRequest })).toMatchObject({
      prReadError: null,
      prReadDiagnosis: null,
    });
  });

  it("PR 기록이 없어도 읽기 실패 이유와 진단을 싣는다", () => {
    const diagnosis = {
      kind: "different" as const,
      runner: "acme-runner",
      runnerLogin: "acme-dev",
      server: { kind: "gh" as const, logins: ["acme-bot"] },
    };
    const v1 = toV1RunDetail(
      ended({ prState: "unknown", prReadError: "no-access", prReadDiagnosis: diagnosis }, null),
    );
    expect(v1).toMatchObject({
      pullRequest: null,
      prReadError: "no-access",
      prReadDiagnosis: diagnosis,
    });
    expect(toV1RunDetail(ended({ prState: "unknown", prReadError: "other" }))).toMatchObject({
      prReadError: "other",
      prReadDiagnosis: null,
    });
  });
});

describe("parseV1RunAction", () => {
  it("v1이 여는 다섯 동작만 받고 pause는 받지 않는다", () => {
    for (const action of ["answer", "human-check", "deny", "resume", "cancel"]) {
      expect(parseV1RunAction(action)).toBe(action);
    }
    expect(parseV1RunAction("pause")).toBeNull();
    expect(parseV1RunAction("ticket-link")).toBeNull();
  });
});

function linkWorld(ticketUrl: string | null, broken = false) {
  const db = openDatabase(":memory:");
  migrate(db);
  const secretBox = new SecretBox(new Uint8Array(32).fill(7));
  const kind = toTrackerKind("fake");
  const connection = toTrackerConnectionId("conn");
  const trackerProject = toTrackerProjectId("tp");
  const runnerProject = toRunnerProjectId("fake:acme/web");
  const agent = toAgentId("claude");
  const key = toTicketKey("ACME-1");
  saveTrackerConnection(db, secretBox, {
    id: connection,
    kind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveWorkspace(db, { id: toWorkspaceId("ws"), name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId: toWorkspaceId("ws"),
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: null,
  });
  saveMapping(db, { connection, trackerProject, runnerProject, agent });
  const assigned = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject,
    agent,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  const tracker = new FakeTracker(kind);
  if (ticketUrl !== null) {
    tracker.addTicket({
      key,
      title: "제목",
      body: "",
      url: ticketUrl,
      labels: [],
      project: null,
      state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
      updatedAt: new Date(),
    });
  }
  if (broken) tracker.getTicket = () => Promise.reject(new Error("tracker down"));
  const registry = new AdapterRegistry().registerTracker({ kind, create: () => tracker });
  return { context: { db, secretBox, registry }, runId: assigned.run.id };
}

describe("loadV1TicketLink", () => {
  it("트래커의 티켓 주소를 돌려준다", async () => {
    const { context, runId } = linkWorld("https://tracker.example.com/ACME-1");
    expect(await loadV1TicketLink(context, runId)).toEqual({
      status: 200,
      url: "https://tracker.example.com/ACME-1",
    });
  });

  it("웹 주소가 아니거나 티켓이 없으면 not-found다", async () => {
    const unsafe = linkWorld("javascript:alert(1)");
    expect(await loadV1TicketLink(unsafe.context, unsafe.runId)).toEqual({
      status: 404,
      reason: "not-found",
    });
    const gone = linkWorld(null);
    expect(await loadV1TicketLink(gone.context, gone.runId)).toEqual({
      status: 404,
      reason: "not-found",
    });
    expect(await loadV1TicketLink(gone.context, "no-run")).toEqual({
      status: 404,
      reason: "not-found",
    });
  });

  it("비밀값을 열지 못하면 웹 경로는 503 안내이고 v1 은 예외를 그대로 둔다", async () => {
    const { context, runId } = linkWorld("https://tracker.example.com/ACME-1");
    const otherKey = { ...context, secretBox: new SecretBox(new Uint8Array(32).fill(9)) };
    expect(await loadRunTicketPageLink(otherKey, runId)).toEqual({
      status: 503,
      reason: "tracker-unavailable",
    });
    await expect(loadV1TicketLink(otherKey, runId)).rejects.toBeInstanceOf(SecretBoxError);
  });

  it("트래커를 읽지 못하면 tracker-unavailable이다", async () => {
    const { context, runId } = linkWorld("https://tracker.example.com/ACME-1", true);
    expect(await loadV1TicketLink(context, runId)).toEqual({
      status: 503,
      reason: "tracker-unavailable",
    });
  });
});
