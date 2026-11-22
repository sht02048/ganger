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

  it("트래커를 읽지 못하면 tracker-unavailable이다", async () => {
    const { context, runId } = linkWorld("https://tracker.example.com/ACME-1", true);
    expect(await loadV1TicketLink(context, runId)).toEqual({
      status: 503,
      reason: "tracker-unavailable",
    });
  });
});
