import { loadHomePage } from "@ganger/app/home/load";
import { HUMAN_CHECK_MERGED_NOTE, mergeRunPullRequest } from "@ganger/app/home/merge-pr";
import type { MergePrInput } from "@ganger/app/home/merge-pr";
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
  clearMergeDenials,
  getRunWithRecords,
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
const CHECK_ID = "msg-check";

const openSignals: PullRequestSignals = {
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
};

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
    signals: openSignals,
    ...over,
  };
}

interface World {
  db: Database;
  runId: RunId;
  codeHost: FakeCodeHost;
  merge: (input: Partial<MergePrInput>) => ReturnType<typeof mergeRunPullRequest>;
}

function seedMergeWorld(options: { humanCheck?: boolean } = {}): World {
  const { db } = seedDatabase();
  const box = new SecretBox(new Uint8Array(32).fill(7));
  saveCodeHostConnection(db, box, {
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
        id: toQuestionId(CHECK_ID),
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
    merge: (input) =>
      mergeRunPullRequest(
        { db, secretBox: box, registry },
        { runId: run.id, method: null, requestId: "request-0000000001", ...input },
        () => now,
      ),
  };
}

function homePr(world: World) {
  const page = loadHomePage(world.db, "ws-commerce", now, "UTC");
  const run = [...page.running, ...page.attention.map((item) => item.run)].find(
    (r) => r.id === world.runId,
  );
  return run?.pullRequest ?? null;
}

describe("런 패널에서 PR 머지하기 (0201)", () => {
  it.each(["squash", "merge"] as const)(
    "고른 방식 %s 과 본 head 로 코드 호스트 머지를 부른다",
    async (method) => {
      const world = seedMergeWorld();
      expect(await world.merge({ method })).toEqual({ ok: true, method, replayed: false });
      expect(world.codeHost.merges).toEqual([
        { repo: REPO, id: PR_ID, method, expectedHead: HEAD },
      ]);
    },
  );

  it("방식을 고르지 않으면 레포 기본 방식으로 머지한다", async () => {
    const world = seedMergeWorld();
    expect(await world.merge({ method: null })).toEqual({
      ok: true,
      method: "squash",
      replayed: false,
    });
    expect(world.codeHost.merges[0]?.method).toBe("squash");
  });

  it("레포가 허용하지 않은 방식은 코드 호스트를 부르지 않고 거절한다", async () => {
    const world = seedMergeWorld();
    expect(await world.merge({ method: "rebase" })).toEqual({
      ok: false,
      reason: "method-not-allowed",
      message: null,
    });
    expect(world.codeHost.merges).toEqual([]);
  });

  it("보호 규칙이 막으면 GitHub 이 준 이유와 함께 blocked 로 거절한다", async () => {
    const world = seedMergeWorld();
    const message = "At least 1 approving review is required by reviewers with write access.";
    world.codeHost.mergeOutcome = { ok: false, reason: "blocked", message };
    expect(await world.merge({})).toEqual({ ok: false, reason: "blocked", message });
    expect(homePr(world)?.state).toBe("open");
  });

  it("권한 오류면 no-write-access 로 거절하고 버튼을 끄도록 기록한다", async () => {
    const world = seedMergeWorld();
    world.codeHost.mergeOutcome = {
      ok: false,
      reason: "no-write-access",
      message: "Resource not accessible by personal access token",
    };
    expect(await world.merge({})).toMatchObject({ ok: false, reason: "no-write-access" });
    expect(homePr(world)?.merge).toMatchObject({ noPermission: true });

    updateRunRecords(world.db, world.runId, {
      pullRequest: pullRequestRecord(snapshot(), minutes(119)),
    });
    expect(homePr(world)?.merge).toMatchObject({ noPermission: true });

    clearMergeDenials(world.db);
    expect(homePr(world)?.merge).toMatchObject({ noPermission: false });
  });

  it("같은 요청 ID 는 동시에 와도, 다시 와도 한 번만 머지하고 같은 결과를 준다", async () => {
    const world = seedMergeWorld();
    const [first, second] = await Promise.all([
      world.merge({ method: "squash" }),
      world.merge({ method: "squash" }),
    ]);
    const third = await world.merge({ method: "squash" });
    expect([first, second, third]).toEqual([
      { ok: true, method: "squash", replayed: false },
      { ok: true, method: "squash", replayed: false },
      { ok: true, method: "squash", replayed: true },
    ]);
    expect(world.codeHost.merges).toHaveLength(1);
  });

  it("같은 요청 ID 를 다른 방식으로 보내면 거절한다", async () => {
    const world = seedMergeWorld();
    await world.merge({ method: "squash" });
    expect(await world.merge({ method: "merge" })).toMatchObject({
      ok: false,
      reason: "request-reused",
    });
    expect(world.codeHost.merges).toHaveLength(1);
  });

  it("거절된 요청은 같은 요청 ID 로 다시 보내면 다시 판단한다", async () => {
    const world = seedMergeWorld();
    world.codeHost.mergeOutcome = { ok: false, reason: "blocked", message: null };
    await world.merge({});
    world.codeHost.mergeOutcome = { ok: true };
    expect(await world.merge({})).toEqual({ ok: true, method: "squash", replayed: false });
    expect(world.codeHost.merges).toHaveLength(2);
  });

  it("런이 Human Check 를 기다리면 확인했어요 · 운영자가 PR을 머지했어요로 답한다", async () => {
    const world = seedMergeWorld({ humanCheck: true });
    await world.merge({});
    expect(listRunQuestions(world.db, world.runId).at(-1)?.answer?.text).toBe(
      `확인했어요\n\n${HUMAN_CHECK_MERGED_NOTE}`,
    );
  });

  it("머지에 실패하면 Human Check 에 답하지 않는다", async () => {
    const world = seedMergeWorld({ humanCheck: true });
    world.codeHost.mergeOutcome = { ok: false, reason: "blocked", message: null };
    await world.merge({});
    expect(listRunQuestions(world.db, world.runId).at(-1)?.answer).toBeNull();
  });

  it("머지한 뒤 PR 을 바로 다시 읽어 「PR」 탭을 머지됨으로 바꾸고 버튼을 없앤다", async () => {
    const world = seedMergeWorld();
    expect(homePr(world)).toMatchObject({ state: "open", merge: { defaultMethod: "squash" } });
    await world.merge({});
    expect(homePr(world)).toMatchObject({ state: "merged", merge: null });
    const signals = getRunWithRecords(world.db, world.runId)?.records.pullRequest?.signals;
    expect(signals).toMatchObject({
      open: false,
      settled: { state: "merged" },
      operatorMergedAt: now.toISOString(),
    });
  });

  it("다시 읽기에 실패해도 머지됨으로 적는다", async () => {
    const world = seedMergeWorld();
    world.codeHost.getPullRequest = () => Promise.reject(new Error("offline"));
    await world.merge({});
    expect(homePr(world)).toMatchObject({ state: "merged", merge: null, title: "Add login" });
  });

  it("PR 이 없거나 이미 닫힌 런은 머지하지 않는다", async () => {
    const world = seedMergeWorld();
    updateRunRecords(world.db, world.runId, {
      pullRequest: pullRequestRecord(snapshot({ state: "closed", signals: null }), minutes(119)),
    });
    expect(await world.merge({})).toMatchObject({ ok: false, reason: "not-open" });
    expect(await world.merge({ runId: "missing" })).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(world.codeHost.merges).toEqual([]);
  });
});
