import { describe, expect, it, vi } from "vitest";

import type { V1Failure, V1RunResult, V1RunsClient } from "../connection/client";
import type { DashboardRun } from "../dashboard/model";
import { REQUEST_ID_RETRY_WINDOW_MS, RunRequestIds } from "./request-ids";
import { createLiveRunPort } from "./run-port";

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

function world(replies: ActionReply[]) {
  const runAction = vi.fn<V1RunsClient["runAction"]>(() =>
    Promise.resolve(replies.shift() ?? sent),
  );
  const client: V1RunsClient = {
    runDetail: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
    ticketLink: () => Promise.resolve({ ok: false, failure: { kind: "unreachable" } }),
    runAction,
  };
  const session = {
    refresh: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    noteFailure: vi.fn<(failure: V1Failure) => void>(),
  };
  const idOf = (call: number) => runAction.mock.calls[call]?.[1].body.requestId;
  return { port: createLiveRunPort(client, session), runAction, session, idOf };
}

const answer = { action: "answer", questionId: "q", answer: "A" } as const;

describe("앱의 쓰기 요청", () => {
  it("모든 쓰기에 16~64자 requestId를 싣는다", async () => {
    const w = world([]);
    await w.port.write(run, answer);
    expect(w.idOf(0)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("닿지 않았던 요청을 다시 보내면 같은 ID를 쓴다", async () => {
    const w = world([{ ok: false, failure: { kind: "unreachable" } }, sent]);
    expect(await w.port.write(run, answer)).toEqual({ kind: "failed", cause: "unreachable" });
    expect(await w.port.write(run, answer)).toEqual({ kind: "sent" });
    expect(w.idOf(1)).toBe(w.idOf(0));
  });

  it("내용을 바꿔 보내면 새 ID를 쓴다", async () => {
    const w = world([{ ok: false, failure: { kind: "unreachable" } }, sent]);
    await w.port.write(run, answer);
    await w.port.write(run, { ...answer, answer: "B" });
    expect(w.idOf(1)).not.toBe(w.idOf(0));
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
