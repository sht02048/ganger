import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_WRITE_TOOLS } from "@ganger/app/mcp/actions";
import { powerSettingsPath } from "@ganger/app/power-settings";
import { loadRunDetail } from "@ganger/app/run-detail/load";
import { loadSettingsPage } from "@ganger/app/settings/load";
import {
  SecretBox,
  answerRunQuestion,
  changeRunState,
  completeRunControlRequest,
  getMapping,
  getRunCancelRequest,
  getRunControlRequest,
  recordAgentCheck,
  markRunRelationsUnread,
  latestChangeSeq,
  listChangesAfter,
  listRecentMcpActions,
  listRunMcpActions,
  listRunQuestions,
  listRunners,
  markAnswerSent,
  recordRunQuestions,
  saveMcpWriteAllowed,
  getRun,
} from "@ganger/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { toQuestionId, toRunId, toTrackerConnectionId, toTrackerProjectId } from "@ganger/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createMcpServer } from "./server.js";
import type { McpContext, ServerStatus } from "./server.js";
import { SERVER_OFF_NOTE, WRITES_OFF_ERROR } from "./write-tools.js";
import { KEY, at, fakeRegistry, queueRun, runnerId, seedMcpDatabase } from "./test-seed.js";

let home: string;
let client: Client;
let seeded: ReturnType<typeof seedMcpDatabase>;
let status: ServerStatus;
let problem: string | null;
let listChanges: number;

async function connect(
  clientName = "hermes",
  syncBeforeMessages = true,
  registry = fakeRegistry(),
): Promise<void> {
  const context: McpContext = {
    db: seeded.db,
    secretBox: new SecretBox(KEY),
    registry,
    home,
    mcpLaunch: { located: true, command: "/opt/node", args: ["/opt/cli.js", "mcp"], env: {} },
    version: "0.0.0-test",
    timeZone: "UTC",
    now: () => at(60),
    serverStatus: () => status,
    schemaProblem: () => problem,
  };
  const mcp = createMcpServer(context);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: clientName, version: "0.0.0" });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChanges += 1;
  });
  const serving = syncBeforeMessages ? mcp.connect(serverSide) : mcp.server.connect(serverSide);
  await Promise.all([serving, client.connect(clientSide)]);
}

const textContent = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});

const jsonObject = z.record(z.string(), z.unknown());

async function call(name: string, args: Record<string, unknown> = {}) {
  const raw = await client.callTool({ name, arguments: args });
  const text = textContent
    .parse(raw)
    .content.map((c) => c.text)
    .join("");
  const parsed = jsonObject.safeParse(text.startsWith("{") ? JSON.parse(text) : null);
  return { isError: raw.isError === true, text, json: parsed.success ? parsed.data : {} };
}

async function toolNames(): Promise<string[]> {
  return (await client.listTools()).tools.map((t) => t.name);
}

function allowWrites(allowed = true): void {
  saveMcpWriteAllowed(seeded.db, allowed, at(59));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ganger-mcp-write-"));
  status = { running: true, url: "http://127.0.0.1:3000" };
  problem = null;
  listChanges = 0;
  seeded = seedMcpDatabase(":memory:");
});

afterEach(async () => {
  await client.close();
  seeded.db.$client.close();
  rmSync(home, { recursive: true, force: true });
});

describe("MCP 쓰기 허용 스위치", () => {
  it("꺼져 있으면 쓰기 도구가 목록에 없고, 불러도 거절하고 기록하지 않는다", async () => {
    await connect();
    const names = await toolNames();
    for (const tool of MCP_WRITE_TOOLS) expect(names).not.toContain(tool);

    const answered = await call("answer_question", { runId: seeded.waiting, answer: "yes" });
    expect(answered.isError).toBe(true);
    expect(answered.text).toContain("answer_question disabled");
    expect(listRunQuestions(seeded.db, seeded.waiting)[0]?.answer).toBeNull();
    expect(listRunMcpActions(seeded.db, seeded.waiting)).toEqual([]);
  });

  it("켜면 다시 시작하지 않아도 쓰기 도구가 보이고, 끄면 다시 사라진다", async () => {
    await connect();
    allowWrites();
    expect((await toolNames()).toSorted()).toEqual(
      expect.arrayContaining([...MCP_WRITE_TOOLS].toSorted()),
    );
    expect(listChanges).toBeGreaterThan(0);

    allowWrites(false);
    const names = await toolNames();
    for (const tool of MCP_WRITE_TOOLS) expect(names).not.toContain(tool);
  });

  it("목록을 다시 읽기 전에 꺼도 쓰기 호출은 거절한다", async () => {
    allowWrites();
    await connect();
    expect(await toolNames()).toContain("cancel_run");
    allowWrites(false);
    const canceled = await call("cancel_run", { runId: seeded.waiting });
    expect(canceled.isError).toBe(true);
    expect(canceled.text).toContain("cancel_run disabled");
    expect(getRunCancelRequest(seeded.db, seeded.waiting)).toBeNull();
  });

  it("목록이 아직 켜진 채여도 도구를 부를 때 스위치를 다시 확인한다", async () => {
    allowWrites();
    await connect("hermes", false);
    allowWrites(false);
    const off = await call("cancel_run", { runId: seeded.waiting });
    expect(off.isError).toBe(true);
    expect(off.json["error"]).toBe(WRITES_OFF_ERROR);
    expect(listRunMcpActions(seeded.db, seeded.waiting)).toEqual([]);
  });

  it("목록이 아직 켜진 채여도 도구를 부를 때 스키마 판을 다시 확인한다", async () => {
    allowWrites();
    await connect("hermes", false);
    problem = "The database is newer than this version of Ganger.";
    const behind = await call("cancel_run", { runId: seeded.waiting });
    expect(behind.json["error"]).toBe(problem);
    expect(getRunCancelRequest(seeded.db, seeded.waiting)).toBeNull();
    expect(listRunMcpActions(seeded.db, seeded.waiting)).toEqual([]);
  });

  it("그사이 서버가 DB를 다른 판으로 올렸으면 쓰지 않고 판이 다르다고 알린다", async () => {
    allowWrites();
    await connect();
    problem = "The database is newer than this version of Ganger.";
    const canceled = await call("cancel_run", { runId: seeded.waiting });
    expect(canceled.isError).toBe(true);
    expect(getRunCancelRequest(seeded.db, seeded.waiting)).toBeNull();
    for (const tool of MCP_WRITE_TOOLS) expect(await toolNames()).not.toContain(tool);
  });
});

describe("MCP 쓰기 도구", () => {
  beforeEach(() => allowWrites());

  it("화면의 쓰기 기능과 1:1이고, 막는 넷(비밀 값, 러너 추가·ssh 대상·Orca 경로, 주소, 허용 스위치)의 도구가 없다", async () => {
    await connect();
    const { tools } = await client.listTools();
    const writes = tools.filter((t) => t.annotations?.readOnlyHint !== true);
    expect(writes.map((t) => t.name).toSorted()).toEqual([...MCP_WRITE_TOOLS].toSorted());
    const blocked =
      /secret|token_save|save_token|api_key|apikey|add_runner|save_runner|ssh|orca|address|webhook|allow|switch|mcp/i;
    for (const tool of tools) expect(tool.name).not.toMatch(blocked);
    const blockedArgs = [
      "apiKey",
      "webhookSecret",
      "token",
      "sshTarget",
      "orcaPath",
      "webAddress",
      "webhookAddress",
      "allowed",
      "mcpWriteAllowed",
    ];
    for (const tool of tools) {
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      for (const arg of blockedArgs) expect(properties).not.toContain(arg);
    }
  });

  it("Capacity 도구는 러너와 Capacity만 받고, ssh 대상·Orca 경로를 보내도 바꾸지 않는다", async () => {
    await connect();
    const { tools } = await client.listTools();
    const capacityTool = tools.find((t) => t.name === "set_runner_capacity");
    expect(Object.keys(capacityTool?.inputSchema.properties ?? {}).toSorted()).toEqual([
      "capacity",
      "runner",
    ]);
    const before = listRunners(seeded.db).find((r) => r.id === runnerId);

    const saved = await call("set_runner_capacity", {
      runner: "runner-a",
      capacity: 5,
      sshTarget: "attacker@evil.example.com",
      orcaPath: "/tmp/evil",
    });
    expect(saved.isError).toBe(false);
    const after = listRunners(seeded.db).find((r) => r.id === runnerId);
    expect(after).toEqual({ ...before, capacity: 5 });
  });

  it("화면이 거절하는 값(옵션처럼 보이는 model 등)은 MCP로도 저장하지 않고 거절로 남긴다", async () => {
    await connect();
    for (const model of ["-x", "a b", "bad\u0007"]) {
      const saved = await call("set_mapping", {
        connection: "Acme",
        project: "Web",
        runnerProject: "github:acme/web",
        agent: "claude",
        model,
      });
      expect(saved.isError).toBe(true);
    }
    const blank = await call("set_in_progress_state", {
      connection: "Acme",
      project: "Web",
      state: "   ",
    });
    expect(blank.isError).toBe(true);
    expect(
      getMapping(seeded.db, toTrackerConnectionId("conn-acme"), toTrackerProjectId("tp-web"))
        ?.model,
    ).toBeNull();
    expect(listRecentMcpActions(seeded.db, 10).map((a) => [a.tool, a.outcome, a.reason])).toEqual([
      ["set_in_progress_state", "rejected", "invalid"],
      ["set_mapping", "rejected", "invalid"],
      ["set_mapping", "rejected", "invalid"],
      ["set_mapping", "rejected", "invalid"],
    ]);
  });

  it("되돌릴 수 없는 도구에만 파괴적 표시를 단다", async () => {
    await connect();
    const { tools } = await client.listTools();
    const destructive = tools
      .filter((t) => t.annotations?.destructiveHint === true)
      .map((t) => t.name)
      .toSorted();
    expect(destructive).toEqual(["cancel_run", "remove_tracker_project"]);
    for (const tool of tools.filter((t) => MCP_WRITE_TOOLS.some((name) => name === t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(false);
    }
  });

  it("질문에 답하면 답을 저장하고, Run 상세 상태 기록 사이에 MCP · 클라이언트 이름으로 남긴다", async () => {
    await connect("Operator");
    const answered = await call("answer_question", { runId: seeded.waiting, answer: "no" });
    expect(answered.isError).toBe(false);
    expect(answered.json["outcome"]).toBe("done");
    expect(listRunQuestions(seeded.db, seeded.waiting)[0]?.answer?.text).toBe("no");

    const detail = loadRunDetail(seeded.db, seeded.waiting, at(61));
    if (detail.kind !== "found") throw new Error("run not found");
    const event = detail.run.timeline.find((e) => e.kind === "mcp");
    expect(event).toEqual({
      kind: "mcp",
      client: "Operator",
      tool: "answer_question",
      outcome: "done",
      reason: null,
      at: at(60).toISOString(),
    });
    expect(listRecentMcpActions(seeded.db, 10)).toEqual([]);
  });

  it("같은 requestId 로 다시 답하면 한 번만 처리하고 같은 결과를 돌려준다(0156)", async () => {
    await connect();
    const args = { runId: seeded.waiting, answer: "no", requestId: "mcp-request-id-0156" };

    const first = await call("answer_question", args);
    const second = await call("answer_question", args);

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(second.json).toEqual(first.json);
    expect(listRunQuestions(seeded.db, seeded.waiting).map((q) => q.answer?.text)).toEqual(["no"]);
    expect(listRunMcpActions(seeded.db, seeded.waiting)).toHaveLength(1);
  });

  it("questionId 없이 답한 뒤 다음 질문이 와도 같은 requestId 는 처음 결과를 돌려주고 새 질문에 답하지 않는다(0156)", async () => {
    await connect();
    const args = { runId: seeded.waiting, answer: "no", requestId: "mcp-request-id-next" };
    expect((await call("answer_question", args)).isError).toBe(false);
    recordRunQuestions(seeded.db, seeded.waiting, [
      { id: toQuestionId("q-next"), body: "next?", options: [], askedAt: at(61) },
    ]);

    const again = await call("answer_question", args);
    const changed = await call("answer_question", { ...args, answer: "yes" });

    expect(again.isError).toBe(false);
    expect(changed.json["reason"]).toBe("request-reused");
    expect(
      listRunQuestions(seeded.db, seeded.waiting).find((q) => q.id === toQuestionId("q-next"))
        ?.answer,
    ).toBeNull();
  });

  it("같은 requestId 로 다시 취소하면 같은 결과이고, requestId 는 없어도 된다(0156)", async () => {
    await connect();
    const args = { runId: seeded.waiting, requestId: "mcp-request-id-0156" };

    const first = await call("cancel_run", args);
    const second = await call("cancel_run", args);
    expect(listRunMcpActions(seeded.db, seeded.waiting)).toHaveLength(1);
    const withoutId = await call("cancel_run", { runId: seeded.waiting });

    expect(first.isError).toBe(false);
    expect(second.json).toEqual(first.json);
    expect(withoutId.isError).toBe(false);
  });

  it("Human Check 는 종류와 external 칸의 요청 내용으로 읽고, answer_question 으로는 답하지 못한다", async () => {
    await connect("Operator");
    const runId = seeded.waiting;
    const first = toQuestionId("q-1");
    answerRunQuestion(seeded.db, { runId, questionId: first, answer: "yes" }, at(20));
    markAnswerSent(seeded.db, { runId, questionId: first }, at(21));
    const checkId = toQuestionId("msg-check");
    recordRunQuestions(seeded.db, runId, [
      { id: checkId, kind: "human-check", body: "EXTERNAL-check", options: [], askedAt: at(22) },
    ]);

    const shown = await call("get_run", { runId });
    expect(JSON.stringify(shown.json)).toContain(
      '"kind":"human-check","questionId":"msg-check","answered":false,"external":{"body":"EXTERNAL-check"}',
    );

    const pending = await call("answer_question", { runId, answer: "확인했어요" });
    expect(pending.json["reason"]).toBe("no-question");
    const named = await call("answer_question", {
      runId,
      questionId: checkId,
      answer: "확인했어요",
    });
    expect(named.json["reason"]).toBe("not-found");
    expect(listRunQuestions(seeded.db, runId).find((q) => q.id === checkId)?.answer).toBeNull();
  });

  it("런과 상관없는 쓰기는 Settings MCP 구역의 최근 작업에 대상과 함께 남는다", async () => {
    await connect("hermes\u0007‮ bot");
    await call("request_runner_check", { runner: "runner-a" });
    await call("update_workspace", { maxRunMinutes: 90 });

    const page = await loadSettingsPage(
      { db: seeded.db, secretBox: new SecretBox(KEY), registry: fakeRegistry() },
      undefined,
      at(61),
    );
    expect(page.install.mcp.writeAllowed).toBe(true);
    expect(page.install.mcp.recent.map((a) => [a.client, a.tool, a.target, a.outcome])).toEqual([
      ["hermes bot", "update_workspace", "Acme Commerce", "done"],
      ["hermes bot", "request_runner_check", "runner-a", "done"],
    ]);
    expect(page.workspace?.general.maxRunMinutes).toBe(90);
  });

  it("거절된 쓰기도 결과와 함께 남긴다", async () => {
    await connect();
    const missing = await call("request_runner_check", { runner: "nope" });
    expect(missing.isError).toBe(true);
    expect(listRecentMcpActions(seeded.db, 10).map((a) => [a.tool, a.outcome, a.reason])).toEqual([
      ["request_runner_check", "rejected", "not-found"],
    ]);
  });

  it("start_run_without_waiting은 같은 요청 ID를 다시 보내도 같은 결과이고 기록을 남긴다", async () => {
    await connect();
    const queued = queueRun(seeded.db, "ACME-6", 40);
    markRunRelationsUnread(seeded.db, queued, at(41));
    const args = { runId: queued, requestId: "request-0159-0001" };

    expect((await call("start_run_without_waiting", args)).json["outcome"]).toBe("done");
    expect((await call("start_run_without_waiting", args)).json["outcome"]).toBe("done");
    expect(listRunMcpActions(seeded.db, queued).map((a) => a.outcome)).toEqual(["done"]);

    const short = await call("start_run_without_waiting", { runId: queued, requestId: "short" });
    expect(short.isError).toBe(true);
  });

  it("서버가 꺼져 있으면 worker가 처리하는 쓰기의 결과에 서버가 켜지면 처리한다고 알린다", async () => {
    status = { running: false, url: null };
    await connect();
    const queued = queueRun(seeded.db, "ACME-5", 40);
    const canceled = await call("cancel_run", { runId: queued });
    expect(canceled.json["pending"]).toBe(SERVER_OFF_NOTE);
    expect(listRunMcpActions(seeded.db, queued).map((a) => a.tool)).toEqual(["cancel_run"]);

    const capacity = await call("set_runner_capacity", { runner: "runner-a", capacity: 3 });
    expect(capacity.json["pending"]).toBeUndefined();
  });

  it("서버가 켜져 있으면 처리 대기 알림을 붙이지 않는다", async () => {
    await connect();
    const requested = await call("request_run_log", { runId: seeded.waiting });
    expect(requested.isError).toBe(false);
    expect(requested.json["pending"]).toBeUndefined();
  });

  it("티켓을 할당하면 새 런의 기록에 남는다", async () => {
    await connect();
    const assigned = await call("assign_ticket", { ticket: "ACME-9" });
    expect(assigned.isError).toBe(false);
    const runId = z.string().parse(assigned.json["runId"]);
    expect(listRunMcpActions(seeded.db, toRunId(runId))).toHaveLength(1);
  });

  it("상위 이슈도 MCP로는 지금처럼 할당한다(0171)", async () => {
    await connect("hermes", true, fakeRegistry({ parentLoaded: true }));
    const assigned = await call("assign_ticket", { ticket: "ACME-8" });
    expect(assigned.isError).toBe(false);
  });

  it("러너를 넘겨 할당한 런은 그 러너에 고정된다", async () => {
    await connect();
    const chosen = await call("assign_ticket", { ticket: "ACME-9", runner: "runner-a" });
    expect(chosen.isError).toBe(false);
    const chosenId = toRunId(z.string().parse(chosen.json["runId"]));
    expect(getRun(seeded.db, chosenId)).toMatchObject({ runnerChosen: true });
  });

  it("쓰기 도구로 바꾼 것도 화면이 알 수 있게 변경 기록 줄을 남긴다(0124)", async () => {
    await connect();
    const kindsAfter = async (name: string, args: Record<string, unknown>) => {
      const before = latestChangeSeq(seeded.db);
      const result = await call(name, args);
      expect(result.isError).toBe(false);
      return listChangesAfter(seeded.db, before).map((change) => [change.kind, change.targetId]);
    };

    expect(await kindsAfter("answer_question", { runId: seeded.waiting, answer: "no" })).toEqual([
      ["run", seeded.waiting],
      ["run", seeded.waiting],
      ["settings", null],
    ]);
    expect(await kindsAfter("set_runner_capacity", { runner: "runner-a", capacity: 3 })).toEqual([
      ["runner", "runner-a"],
      ["settings", null],
    ]);
    expect((await kindsAfter("assign_ticket", { ticket: "ACME-9" })).map(([kind]) => kind)).toEqual(
      expect.arrayContaining(["assignment", "settings"]),
    );
  });

  it("잠자기 설정은 설치 폴더의 파일에 쓴다", async () => {
    await connect();
    const saved = await call("set_prevent_sleep", { preventSleep: false });
    expect(saved.isError).toBe(false);
    expect(JSON.parse(readFileSync(powerSettingsPath(home), "utf8"))).toEqual({
      preventSleep: false,
    });
  });
});

function askHumanCheck(): ReturnType<typeof toQuestionId> {
  const runId = seeded.waiting;
  const first = toQuestionId("q-1");
  answerRunQuestion(seeded.db, { runId, questionId: first, answer: "yes" }, at(20));
  markAnswerSent(seeded.db, { runId, questionId: first }, at(21));
  const checkId = toQuestionId("msg-check");
  recordRunQuestions(seeded.db, runId, [
    { id: checkId, kind: "human-check", body: "EXTERNAL-check", options: [], askedAt: at(22) },
  ]);
  return checkId;
}

function humanCheckAnswer(checkId: ReturnType<typeof toQuestionId>) {
  return listRunQuestions(seeded.db, seeded.waiting).find((q) => q.id === checkId)?.answer?.text;
}

function moveWaitingRunTo(state: "running" | "paused"): void {
  if (!changeRunState(seeded.db, seeded.waiting, { to: "running" }, at(30)).ok) {
    throw new Error("move to running");
  }
  if (state === "running") return;
  const paused = changeRunState(
    seeded.db,
    seeded.waiting,
    { to: "paused", source: "operator" },
    at(31),
  );
  if (!paused.ok) throw new Error("move to paused");
}

function failPendingControl(): void {
  const request = getRunControlRequest(seeded.db, seeded.waiting);
  if (request === null) throw new Error("no control request");
  completeRunControlRequest(seeded.db, {
    runId: seeded.waiting,
    requestedAt: request.requestedAt,
    completedAt: at(60),
    error: "runner-error",
  });
}

const mcpLog = (runId: Parameters<typeof listRunMcpActions>[1]) =>
  listRunMcpActions(seeded.db, runId).map((a) => [a.tool, a.outcome, a.reason]);

describe("MCP Human Check 답하기(0190)", () => {
  beforeEach(() => allowWrites());

  it("허용이 꺼져 있으면 보이지 않고 답하지 않는다", async () => {
    allowWrites(false);
    const checkId = askHumanCheck();
    await connect();
    expect(await toolNames()).not.toContain("answer_human_check");
    const off = await call("answer_human_check", {
      runId: seeded.waiting,
      decision: "confirmed",
    });
    expect(off.isError).toBe(true);
    expect(humanCheckAnswer(checkId)).toBeUndefined();
  });

  it("도구 설명이 운영자에게 먼저 확인받으라고 알린다", async () => {
    await connect();
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === "answer_human_check")?.description;
    expect(description).toContain("approving a merge");
    expect(description).toContain("confirm with the operator first");
  });

  it("확인했어요로 답하면 화면과 같은 답을 저장하고 Run 상세에 MCP로 남긴다", async () => {
    const checkId = askHumanCheck();
    await connect("hermes");
    const answered = await call("answer_human_check", {
      runId: seeded.waiting,
      decision: "confirmed",
    });
    expect(answered.isError).toBe(false);
    expect(humanCheckAnswer(checkId)).toBe("확인했어요");

    const detail = loadRunDetail(seeded.db, seeded.waiting, at(61));
    if (detail.kind !== "found") throw new Error("run not found");
    expect(detail.run.timeline.find((e) => e.kind === "mcp")).toMatchObject({
      client: "hermes",
      tool: "answer_human_check",
      outcome: "done",
    });
  });

  it("고쳐 주세요에 덧붙일 말을 함께 저장한다", async () => {
    const checkId = askHumanCheck();
    await connect();
    await call("answer_human_check", {
      runId: seeded.waiting,
      decision: "changes-requested",
      note: "  문구를 고쳐 주세요  ",
    });
    expect(humanCheckAnswer(checkId)).toBe("고쳐 주세요\n\n문구를 고쳐 주세요");
  });

  it("답할 Human Check 가 없으면 이유와 함께 거절하고 기록한다", async () => {
    await connect();
    const refused = await call("answer_human_check", {
      runId: seeded.waiting,
      decision: "confirmed",
    });
    expect(refused.json["reason"]).toBe("no-human-check");
    expect(mcpLog(seeded.waiting)).toEqual([["answer_human_check", "rejected", "no-human-check"]]);
  });

  it("Question 의 id 로는 Human Check 답을 저장하지 않는다", async () => {
    await connect();
    const refused = await call("answer_human_check", {
      runId: seeded.waiting,
      questionId: "q-1",
      decision: "confirmed",
    });
    expect(refused.json["reason"]).toBe("not-found");
    expect(listRunQuestions(seeded.db, seeded.waiting)[0]?.answer).toBeNull();
  });

  it("화면 길이를 넘는 말은 거절한다", async () => {
    const checkId = askHumanCheck();
    await connect();
    const refused = await call("answer_human_check", {
      runId: seeded.waiting,
      decision: "confirmed",
      note: "가".repeat(10_001),
    });
    expect(refused.json["reason"]).toBe("invalid");
    expect(humanCheckAnswer(checkId)).toBeUndefined();
  });

  it("같은 requestId 는 한 번만 처리하고, 다른 내용이면 request-reused 로 거절한다", async () => {
    const checkId = askHumanCheck();
    await connect();
    const args = {
      runId: seeded.waiting,
      decision: "confirmed",
      requestId: "mcp-human-check-0190",
    };
    const first = await call("answer_human_check", args);
    const second = await call("answer_human_check", args);
    const changed = await call("answer_human_check", { ...args, decision: "changes-requested" });

    expect(second.json).toEqual(first.json);
    expect(changed.json["reason"]).toBe("request-reused");
    expect(humanCheckAnswer(checkId)).toBe("확인했어요");
    expect(mcpLog(seeded.waiting)).toEqual([
      ["answer_human_check", "done", null],
      ["answer_human_check", "rejected", "request-reused"],
    ]);
  });
});

describe("MCP 멈추기·재개(0190)", () => {
  beforeEach(() => allowWrites());

  it("허용이 꺼져 있으면 보이지 않고 요청하지 않는다", async () => {
    allowWrites(false);
    moveWaitingRunTo("running");
    await connect();
    const names = await toolNames();
    expect(names).not.toContain("pause_run");
    expect(names).not.toContain("resume_run");
    expect((await call("pause_run", { runId: seeded.waiting })).isError).toBe(true);
    expect(getRunControlRequest(seeded.db, seeded.waiting)).toBeNull();
  });

  it("Running 런을 멈추도록 요청한다", async () => {
    moveWaitingRunTo("running");
    await connect();
    expect((await call("pause_run", { runId: seeded.waiting })).isError).toBe(false);
    expect(getRunControlRequest(seeded.db, seeded.waiting)).toMatchObject({
      control: "pause",
      status: "pending",
    });
    expect(mcpLog(seeded.waiting)).toEqual([["pause_run", "done", null]]);
  });

  it("Paused 런을 재개하도록 요청한다", async () => {
    moveWaitingRunTo("paused");
    await connect();
    expect((await call("resume_run", { runId: seeded.waiting })).isError).toBe(false);
    expect(getRunControlRequest(seeded.db, seeded.waiting)).toMatchObject({
      control: "resume",
      status: "pending",
    });
    expect(mcpLog(seeded.waiting)).toEqual([["resume_run", "done", null]]);
  });

  it("상태가 맞지 않으면 이유와 함께 거절한다", async () => {
    await connect();
    const pause = await call("pause_run", { runId: seeded.waiting });
    const resume = await call("resume_run", { runId: seeded.waiting });
    const ended = await call("pause_run", { runId: seeded.ended });
    expect(pause.json["reason"]).toBe("not-running");
    expect(resume.json["reason"]).toBe("not-paused");
    expect(ended.json["reason"]).toBe("already-ended");
    expect(getRunControlRequest(seeded.db, seeded.waiting)).toBeNull();
  });

  it("같은 requestId 는 한 번만 처리하고, 다른 동작이면 거절한다", async () => {
    moveWaitingRunTo("running");
    await connect();
    const args = { runId: seeded.waiting, requestId: "mcp-control-0190-a" };
    const first = await call("pause_run", args);
    const second = await call("pause_run", args);
    const other = await call("resume_run", args);

    expect(second.json).toEqual(first.json);
    expect(other.json["reason"]).toBe("request-reused");
    expect(mcpLog(seeded.waiting)).toEqual([
      ["pause_run", "done", null],
      ["resume_run", "rejected", "request-reused"],
    ]);
  });

  it("러너에서 실패한 재개는 같은 requestId 로 다시 요청한다", async () => {
    moveWaitingRunTo("paused");
    await connect();
    const args = { runId: seeded.waiting, requestId: "mcp-control-0190-b" };
    expect((await call("resume_run", args)).isError).toBe(false);
    failPendingControl();
    expect(getRunControlRequest(seeded.db, seeded.waiting)?.status).toBe("failed");

    expect((await call("resume_run", args)).isError).toBe(false);
    expect(getRunControlRequest(seeded.db, seeded.waiting)).toMatchObject({
      control: "resume",
      status: "pending",
    });
    expect(mcpLog(seeded.waiting)).toHaveLength(2);
  });
});

describe("MCP 이어서 맡기기(0190)", () => {
  beforeEach(() => allowWrites());

  const agentGone = () => recordAgentCheck(seeded.db, seeded.ended, "gone", { stopHandled: true });

  it("허용이 꺼져 있으면 보이지 않고 새 런을 만들지 않는다", async () => {
    allowWrites(false);
    agentGone();
    await connect();
    expect(await toolNames()).not.toContain("continue_run");
    const off = await call("continue_run", { runId: seeded.ended, message: "이어서 해 주세요" });
    expect(off.isError).toBe(true);
    expect(mcpLog(seeded.ended)).toEqual([]);
  });

  it("끝난 런을 이어서 새 런을 만들고 새 런 기록에 MCP 출처를 남긴다", async () => {
    agentGone();
    await connect("hermes");
    const continued = await call("continue_run", {
      runId: seeded.ended,
      message: "테스트를 고쳐 주세요",
    });
    expect(continued.isError).toBe(false);
    expect(continued.json["continuedFrom"]).toBe(seeded.ended);
    const next = toRunId(z.string().parse(continued.json["runId"]));
    expect(getRun(seeded.db, next)).toMatchObject({ state: "queued" });

    const detail = loadRunDetail(seeded.db, next, at(61));
    if (detail.kind !== "found") throw new Error("run not found");
    expect(detail.run.timeline.find((e) => e.kind === "mcp")).toMatchObject({
      client: "hermes",
      tool: "continue_run",
      outcome: "done",
    });
  });

  it("말이 없거나 공백이면 런을 만들지 않는다", async () => {
    agentGone();
    await connect();
    expect((await call("continue_run", { runId: seeded.ended })).isError).toBe(true);
    expect((await call("continue_run", { runId: seeded.ended, message: "  " })).isError).toBe(true);
    expect(listRunMcpActions(seeded.db, seeded.ended)).toEqual([]);
  });

  it("서버가 막으면 이유와 함께 거절하고 원래 런에 기록한다", async () => {
    await connect();
    const running = await call("continue_run", { runId: seeded.waiting, message: "이어서" });
    const agentAlive = await call("continue_run", { runId: seeded.ended, message: "이어서" });
    expect(running.json["reason"]).toBe("not-ended");
    expect(agentAlive.json["reason"]).toBe("previous-agent");
    expect(mcpLog(seeded.ended)).toEqual([["continue_run", "rejected", "previous-agent"]]);
  });

  it("같은 requestId 는 같은 새 런을 돌려주고, 다른 말이면 거절한다", async () => {
    agentGone();
    await connect();
    const args = {
      runId: seeded.ended,
      message: "이어서 해 주세요",
      requestId: "mcp-continue-0190",
    };
    const first = await call("continue_run", args);
    const second = await call("continue_run", args);
    const changed = await call("continue_run", { ...args, message: "다른 말" });

    expect(second.json).toEqual(first.json);
    expect(changed.json["reason"]).toBe("request-reused");
    const next = toRunId(z.string().parse(first.json["runId"]));
    expect(mcpLog(next)).toEqual([["continue_run", "done", null]]);
  });
});
