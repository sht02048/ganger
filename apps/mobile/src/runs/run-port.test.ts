import { describe, expect, it, vi } from "vitest";

import type { V1Failure, V1RunResult, V1RunsClient } from "../connection/client";
import type { DashboardRun } from "../dashboard/model";
import { REQUEST_ID_RETRY_WINDOW_MS, RunRequestIds } from "./request-ids";
import { createLiveRunPort, demoRunDetail } from "./run-port";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const run: DashboardRun = {
  id: "run-1",
  ticketId: "ticket-1",
  ticketKey: "ACME-1",
  ticketTitle: "제목",
  trackerProject: "ACME",
  workspace: { id: "ws", name: "Payments" },
  runner: null,
  agent: "claude",
  waitMs: 0,
  executionMs: null,
  pullRequest: null,
  cancelling: false,
  control: null,
  todoTag: null,
  state: "running",
};

type ActionReply = V1RunResult<{ accepted: true }>;
const sent: ActionReply = { ok: true, data: { accepted: true }, serverVersion: "0.4.0" };
const lost: ActionReply = { ok: false, failure: { kind: "unreachable" } };

function world(replies: ActionReply[], pause: { since: string | null } = { since: null }) {
  const runAction = vi.fn<V1RunsClient["runAction"]>(() =>
    Promise.resolve(replies.shift() ?? sent),
  );
  let detailReachable = true;
  const client: V1RunsClient = {
    runDetail: () =>
      Promise.resolve(
        detailReachable
          ? {
              ok: true,
              data: { ...demoRunDetail(run), pausedSince: pause.since },
              serverVersion: "0.4.0",
            }
          : { ok: false, failure: { kind: "unreachable" } },
      ),
    ticketLink: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
    runAction,
  };
  const session = {
    refresh: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    noteFailure: vi.fn<(failure: V1Failure) => void>(),
  };
  const idOf = (call: number) => runAction.mock.calls[call]?.[1].body.requestId;
  const wait = vi.fn<() => Promise<void>>(() => Promise.resolve());
  return {
    port: createLiveRunPort(client, session, wait),
    runAction,
    session,
    idOf,
    wait,
    failDetail: () => {
      detailReachable = false;
    },
  };
}

const answer = { action: "answer", questionId: "q", answer: "A" } as const;

describe("앱의 쓰기 요청", () => {
  it("모든 쓰기에 UUID requestId를 싣는다", async () => {
    const w = world([]);
    await w.port.write(run, answer);
    expect(w.idOf(0)).toMatch(UUID);
  });

  it("응답을 잃으면 확인 중을 알리고 기다린 뒤 같은 ID로 한 번 더 보낸다", async () => {
    const w = world([lost, sent]);
    const onConfirming = vi.fn<() => void>();
    expect(await w.port.write(run, answer, onConfirming)).toEqual({ kind: "sent" });
    expect(onConfirming).toHaveBeenCalledOnce();
    expect(w.wait).toHaveBeenCalledOnce();
    expect(w.runAction).toHaveBeenCalledTimes(2);
    expect(w.idOf(1)).toBe(w.idOf(0));
    expect(w.session.noteFailure).not.toHaveBeenCalled();
    expect(w.session.refresh).toHaveBeenCalledOnce();
  });

  it("다시 보내도 응답이 없으면 확인하지 못함으로 끝내고 세션이 다시 읽게 한다", async () => {
    const w = world([lost, lost]);
    expect(await w.port.write(run, answer)).toEqual({ kind: "unconfirmed" });
    expect(w.runAction).toHaveBeenCalledTimes(2);
    expect(w.session.noteFailure).toHaveBeenCalledWith({ kind: "unreachable" });
  });

  it("다시 보낸 요청이 서버 오류면 보냈는지 모르므로 확인하지 못함으로 끝낸다", async () => {
    const w = world([lost, { ok: false, failure: { kind: "server-error" } }]);
    expect(await w.port.write(run, answer)).toEqual({ kind: "unconfirmed" });
  });

  it("맞지 않는 서버의 쓰기 응답은 처리됐을 수 있어 실패라고 단정하지 않는다", async () => {
    const failure = { kind: "incompatible", update: "app", serverVersion: "0.5.0" } as const;
    const w = world([{ ok: false, failure }]);
    expect(await w.port.write(run, answer)).toEqual({ kind: "unconfirmed" });
    expect(w.runAction).toHaveBeenCalledOnce();
    expect(w.session.noteFailure).toHaveBeenCalledWith(failure);
  });

  it("다시 보낸 요청을 서버가 거절하면 이유를 돌려준다", async () => {
    const w = world([lost, { ok: false, failure: { kind: "refused", reason: "already-ended" } }]);
    expect(await w.port.write(run, { action: "cancel" })).toEqual({
      kind: "refused",
      reason: "already-ended",
    });
  });

  it.each([
    ["refused", { kind: "refused", reason: "already-answered" }],
    ["invalid-request", { kind: "invalid-request" }],
    ["server-error", { kind: "server-error" }],
  ] as const)("응답이 온 실패(%s)는 다시 보내지 않는다", async (_name, failure) => {
    const w = world([{ ok: false, failure }]);
    const onConfirming = vi.fn<() => void>();
    await w.port.write(run, answer, onConfirming);
    expect(w.runAction).toHaveBeenCalledOnce();
    expect(w.wait).not.toHaveBeenCalled();
    expect(onConfirming).not.toHaveBeenCalled();
  });

  it.each([
    { action: "answer", questionId: "q", answer: "A" },
    { action: "human-check", questionId: "q", decision: "confirmed", note: "" },
    { action: "deny", promptId: "p", reason: "" },
    { action: "resume" },
    { action: "cancel" },
    { action: "retry" },
    { action: "clear-todo" },
    { action: "continue", message: "이어서" },
  ] as const)("$action 쓰기도 응답을 잃으면 같은 ID로 다시 보낸다", async (write) => {
    const w = world([lost, sent]);
    expect(await w.port.write(run, write)).toEqual({ kind: "sent" });
    expect(w.idOf(1)).toBe(w.idOf(0));
  });

  it("재개 전 상태를 읽지 못하면 보내지 않았으니 다시 보내지 않는다", async () => {
    const w = world([]);
    w.failDetail();
    expect(await w.port.write(run, { action: "resume" })).toEqual({
      kind: "failed",
      cause: "unreachable",
    });
    expect(w.runAction).not.toHaveBeenCalled();
  });

  it("확인하지 못한 요청을 시간 안에 다시 보내면 같은 ID를 쓴다", async () => {
    const w = world([lost, lost, sent]);
    await w.port.write(run, answer);
    expect(await w.port.write(run, answer)).toEqual({ kind: "sent" });
    expect(w.idOf(2)).toBe(w.idOf(0));
  });

  it("내용을 바꿔 보내면 새 ID를 쓴다", async () => {
    const w = world([lost, lost, sent]);
    await w.port.write(run, answer);
    await w.port.write(run, { ...answer, answer: "B" });
    expect(w.idOf(2)).not.toBe(w.idOf(0));
  });

  it("성공한 뒤의 다음 요청은 새 ID를 쓰고 화면을 다시 읽는다", async () => {
    const w = world([sent, sent]);
    await w.port.write(run, { action: "resume" });
    await w.port.write(run, { action: "resume" });
    expect(w.idOf(1)).not.toBe(w.idOf(0));
    expect(w.session.refresh).toHaveBeenCalledTimes(2);
  });

  it("거절은 이유로 돌려주고 연결 문제로 다루지 않는다", async () => {
    const w = world([{ ok: false, failure: { kind: "refused", reason: "already-ended" } }]);
    expect(await w.port.write(run, { action: "cancel" })).toEqual({
      kind: "refused",
      reason: "already-ended",
    });
    expect(w.session.noteFailure).not.toHaveBeenCalled();
    expect(w.session.refresh).toHaveBeenCalledOnce();
  });

  it("트래커 주소를 읽지 못해도 연결 문제로 다루지 않는다", async () => {
    const w = world([]);
    expect(await w.port.ticketLink(run)).toEqual({ kind: "unavailable" });
    expect(w.session.noteFailure).not.toHaveBeenCalled();
  });

  it("재개는 같은 멈춤 안에서만 ID를 다시 쓰고, 다시 멈춘 런에는 새 ID를 쓴다", async () => {
    const pause = { since: "2026-11-23T00:00:00.000Z" };
    const w = world([lost, lost, lost, lost, sent], pause);
    await w.port.write(run, { action: "resume" });
    await w.port.write(run, { action: "resume" });
    expect(w.idOf(2)).toBe(w.idOf(0));
    pause.since = "2026-11-23T00:00:30.000Z";
    await w.port.write(run, { action: "resume" });
    expect(w.idOf(4)).not.toBe(w.idOf(0));
  });

  it("머지는 고른 방식과 본 head 를 싣고, 같은 머지를 다시 누르면 같은 ID 를 쓴다", async () => {
    const merge = { action: "merge", method: "squash", expectedHead: "abc" } as const;
    const w = world([lost, lost, sent]);
    expect(await w.port.write(run, merge)).toEqual({ kind: "unconfirmed" });
    expect(await w.port.write(run, merge)).toEqual({ kind: "sent" });
    expect(w.runAction.mock.calls[0]?.[1]).toEqual({
      action: "merge",
      body: { requestId: w.idOf(0), method: "squash", expectedHead: "abc" },
    });
    expect(w.idOf(2)).toBe(w.idOf(0));
  });

  it("머지 방식이나 본 head 가 바뀌면 새 ID 를 쓴다", async () => {
    const merge = { action: "merge", method: "squash", expectedHead: "abc" } as const;
    const w = world([lost, lost, lost, lost, sent]);
    await w.port.write(run, merge);
    await w.port.write(run, { ...merge, method: "merge" });
    await w.port.write(run, { ...merge, expectedHead: "def" });
    expect(new Set([w.idOf(0), w.idOf(2), w.idOf(4)]).size).toBe(3);
  });

  it("머지 거절은 GitHub 이 준 문장과 함께 돌려준다", async () => {
    const w = world([
      { ok: false, failure: { kind: "refused", reason: "blocked", message: "Review required" } },
    ]);
    expect(
      await w.port.write(run, { action: "merge", method: "squash", expectedHead: "abc" }),
    ).toEqual({ kind: "refused", reason: "blocked", message: "Review required" });
  });

  it("토큰이 거절되면 세션에 알린다", async () => {
    const w = world([{ ok: false, failure: { kind: "token-rejected" } }]);
    await w.port.write(run, { action: "cancel" });
    expect(w.session.noteFailure).toHaveBeenCalledWith({ kind: "token-rejected" });
  });
});

describe("RunRequestIds", () => {
  it("다시 시도할 시간이 지나면 새 ID를 쓴다", () => {
    let now = 0;
    const ids = new RunRequestIds(() => now);
    const first = ids.idFor("slot", "content");
    now = REQUEST_ID_RETRY_WINDOW_MS - 1;
    expect(ids.idFor("slot", "content")).toBe(first);
    now += REQUEST_ID_RETRY_WINDOW_MS;
    expect(ids.idFor("slot", "content")).not.toBe(first);
  });
});
