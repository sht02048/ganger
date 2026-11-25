import { HUMAN_CHECK_MERGED_NOTE } from "@ganger/app/home/merge-pr";
import { handleV1Merge, loadV1RunDetail } from "@ganger/app/devices/run-actions";
import {
  AdapterRegistry,
  pullRequestRecord,
  toCodeHostKind,
  toPullRequestId,
  toQuestionId,
  toRepoRef,
  toTicketKey,
} from "@ganger/core";
import type { PullRequestSignals, PullRequestSnapshot, RunId } from "@ganger/core";
import { FakeCodeHost } from "@ganger/core/testing";
import {
  SecretBox,
  changeRunState,
  listRunQuestions,
  listRuns,
  recordRunQuestions,
  saveCodeHostConnection,
  toCodeHostConnectionId,
  updateRunRecords,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { minutes, now, seedDatabase } from "../testing/seed";

const KIND = toCodeHostKind("fake");
const REPO = toRepoRef("acme/web");
const PR_ID = toPullRequestId("42");
const HEAD = "head-sha";

function signals(over: Partial<PullRequestSignals> = {}): PullRequestSignals {
  return {
    open: true,
    headCommit: HEAD,
    ciFailed: false,
    checkTotal: 3,
    failedCount: 0,
    failedChecks: [],
    checksTruncated: false,
    conflict: false,
    behindBy: 0,
    title: "Add login",
    baseBranch: "develop",
    merge: { methods: ["squash", "merge"], defaultMethod: "squash", blocked: null, canWrite: true },
    ...over,
  };
}

function snapshot(over: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    id: PR_ID,
    displayId: "#42",
    url: "https://example.com/acme/web/pull/42",
    title: "Add login",
    body: "ACME-10",
    state: "open",
    createdAt: minutes(5),
    mergedAt: null,
    headBranch: "acme/wt-ACME-10",
    sourceRepo: REPO,
    headCommit: HEAD,
    baseBranch: "develop",
    ci: "success",
    signals: signals(),
    ...over,
  };
}

interface World {
  db: Database;
  runId: RunId;
  codeHost: FakeCodeHost;
  merge: (body: unknown) => ReturnType<typeof handleV1Merge>;
  pullRequest: () => NonNullable<ReturnType<typeof loadV1RunDetail>>["pullRequest"];
}

function seedWorld(options: { humanCheck?: boolean } = {}): World {
  const { db } = seedDatabase();
  const secretBox = new SecretBox(new Uint8Array(32).fill(7));
  saveCodeHostConnection(db, secretBox, {
    id: toCodeHostConnectionId("fake"),
    kind: KIND,
    name: "fake",
    config: {},
    secrets: {},
  });
  const codeHost = new FakeCodeHost(KIND, "github:");
  codeHost.putPullRequest(REPO, snapshot());
  const registry = new AdapterRegistry().registerCodeHost({ kind: KIND, create: () => codeHost });
  const run = listRuns(db, { states: ["running"] }).find(
    (r) => r.ticket.key === toTicketKey("ACME-10"),
  );
  if (run === undefined) throw new Error("no running run");
  updateRunRecords(db, run.id, { pullRequest: pullRequestRecord(snapshot(), minutes(100)) });
  if (options.humanCheck === true) {
    const changed = changeRunState(db, run.id, { to: "waiting-for-input" }, minutes(110));
    if (!changed.ok) throw new Error("state change failed");
    recordRunQuestions(db, run.id, [
      {
        id: toQuestionId("msg-check"),
        kind: "human-check",
        body: "PR #42 머지를 확인해 주세요",
        options: [],
        askedAt: minutes(110),
      },
    ]);
  }
  return {
    db,
    runId: run.id,
    codeHost,
    merge: (body) => handleV1Merge({ db, secretBox, registry }, run.id, body, () => now),
    pullRequest: () => loadV1RunDetail(db, run.id, now)?.pullRequest ?? null,
  };
}

const body = {
  requestId: "request-0000000001",
  method: "squash",
  expectedHead: HEAD,
};

describe("v1 런 상세의 머지 정보 (0220)", () => {
  it("열린 PR 에 허용 방식, 레포 기본, 막힘, 권한, 본 head 를 싣는다", () => {
    expect(seedWorld().pullRequest()?.merge).toEqual({
      methods: ["squash", "merge"],
      defaultMethod: "squash",
      blocked: null,
      noPermission: false,
      headCommit: HEAD,
    });
  });

  it("레포 규칙이 막으면 막는 이유를, 쓰기 권한이 없으면 권한 거절을 싣는다", () => {
    const world = seedWorld();
    updateRunRecords(world.db, world.runId, {
      pullRequest: pullRequestRecord(
        snapshot({
          signals: signals({
            conflict: true,
            merge: {
              methods: ["squash"],
              defaultMethod: "squash",
              blocked: "conflict",
              canWrite: false,
            },
          }),
        }),
        minutes(119),
      ),
    });
    expect(world.pullRequest()?.merge).toMatchObject({
      methods: ["squash"],
      blocked: "conflict",
      noPermission: true,
    });
  });

  it("머지한 PR 에는 머지 정보가 없다", async () => {
    const world = seedWorld();
    await world.merge(body);
    expect(world.pullRequest()).toMatchObject({ merge: null });
  });
});

describe("v1 머지 쓰기 (0220)", () => {
  it("고른 방식과 화면이 본 head 로 머지하고 200 을 준다", async () => {
    const world = seedWorld();
    expect(await world.merge({ ...body, method: "merge", expectedHead: "seen-head" })).toEqual({
      status: 200,
    });
    expect(world.codeHost.merges).toEqual([
      { repo: REPO, id: PR_ID, method: "merge", expectedHead: "seen-head" },
    ]);
  });

  it("런이 Human Check 를 기다리면 머지하면서 확인했어요로 답한다", async () => {
    const world = seedWorld({ humanCheck: true });
    await world.merge(body);
    expect(listRunQuestions(world.db, world.runId).at(-1)?.answer?.text).toBe(
      `확인했어요\n\n${HUMAN_CHECK_MERGED_NOTE}`,
    );
  });

  it("레포 규칙이 막으면 GitHub 이 준 이유와 함께 blocked 로 거절한다", async () => {
    const world = seedWorld();
    const message = "At least 1 approving review is required.";
    world.codeHost.mergeOutcome = { ok: false, reason: "blocked", message };
    expect(await world.merge(body)).toEqual({ status: 409, reason: "blocked", message });
  });

  it("그사이 head 가 바뀌면 head-changed 로 거절한다", async () => {
    const world = seedWorld();
    world.codeHost.mergeOutcome = { ok: false, reason: "head-changed", message: null };
    expect(await world.merge(body)).toEqual({ status: 409, reason: "head-changed" });
  });

  it("GitHub 에 닿지 못하면 502 network 로 거절한다", async () => {
    const world = seedWorld();
    world.codeHost.mergePullRequest = () => Promise.reject(new Error("offline"));
    expect(await world.merge(body)).toEqual({ status: 502, reason: "network" });
  });

  it("같은 요청 번호를 다시 보내면 다시 머지하지 않고 200 을 준다", async () => {
    const world = seedWorld();
    expect(await world.merge(body)).toEqual({ status: 200 });
    expect(await world.merge(body)).toEqual({ status: 200 });
    expect(world.codeHost.merges).toHaveLength(1);
  });

  it("같은 요청 번호를 다른 방식으로 보내면 request-reused 로 거절한다", async () => {
    const world = seedWorld();
    await world.merge(body);
    expect(await world.merge({ ...body, method: "merge" })).toEqual({
      status: 409,
      reason: "request-reused",
    });
    expect(world.codeHost.merges).toHaveLength(1);
  });

  it("레포가 허용하지 않은 방식은 머지하지 않고 거절한다", async () => {
    const world = seedWorld();
    expect(await world.merge({ ...body, method: "rebase" })).toEqual({
      status: 409,
      reason: "method-not-allowed",
    });
    expect(world.codeHost.merges).toEqual([]);
  });

  it("런은 있는데 GitHub 에 PR 이 없으면 404 가 아니라 pr-not-found 로 거절한다", async () => {
    const world = seedWorld();
    world.codeHost.mergeOutcome = { ok: false, reason: "not-found", message: null };
    expect(await world.merge(body)).toEqual({ status: 409, reason: "pr-not-found" });
  });

  it("없는 런은 404 다", async () => {
    const world = seedWorld();
    expect(
      await handleV1Merge(
        {
          db: world.db,
          secretBox: new SecretBox(new Uint8Array(32).fill(7)),
          registry: new AdapterRegistry(),
        },
        "missing",
        body,
        () => now,
      ),
    ).toEqual({ status: 404, reason: "not-found" });
  });

  it.each([
    ["방식이 없다", { requestId: body.requestId, expectedHead: HEAD }],
    ["head 가 없다", { requestId: body.requestId, method: "squash" }],
    ["모르는 방식이다", { ...body, method: "fast-forward" }],
    ["모르는 필드가 있다", { ...body, extra: true }],
  ])("요청이 잘못되면 invalid-request 다: %s", async (_name, wrong) => {
    const world = seedWorld();
    expect(await world.merge(wrong)).toEqual({ status: 400, reason: "invalid-request" });
    expect(world.codeHost.merges).toEqual([]);
  });
});
