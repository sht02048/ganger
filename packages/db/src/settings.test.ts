import {
  toLabelId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import { describe, expect, it } from "vitest";
import { toWorkspaceId } from "./ids.js";
import { assignRun, changeRunState, getRun, listRuns } from "./runs.js";
import { latestChangeSeq } from "./change-events.js";
import {
  getInstallSettings,
  getWorkspaceBrief,
  listWorkspaces,
  getMapping,
  getWorkspaceTrackerProject,
  listRunnerSnapshots,
  listRunners,
  listWorkspaceTrackerProjects,
  recordProviderUsage,
  recordRunnerCheck,
  removeWorkspaceTrackerProject,
  replaceMapping,
  saveCheckedWebhookAddress,
  saveInstallAddresses,
  saveMapping,
  saveWorkspace,
  saveWorkspaceBrief,
  saveWorkspaceTrackerProject,
} from "./settings.js";
import {
  addRunner,
  agent,
  connection,
  repoA,
  seededDatabase,
  trackerProject,
  workspaceId,
} from "./test-fixtures.js";

const otherWorkspace = toWorkspaceId("ws-2");
const otherProject = toTrackerProjectId("tp-2");

function seedTwoWorkspaces() {
  const db = seededDatabase();
  saveWorkspace(db, { id: otherWorkspace, name: "Labs" });
  saveWorkspaceTrackerProject(db, {
    workspaceId: otherWorkspace,
    connection,
    projectId: otherProject,
    name: "Lab",
    inProgressStateId: null,
  });
  return db;
}

describe("listWorkspaceTrackerProjects", () => {
  it("Workspace를 주지 않으면 모든 Workspace의 트래커 프로젝트를 돌려준다", () => {
    const db = seedTwoWorkspaces();
    expect(listWorkspaceTrackerProjects(db)).toEqual([
      {
        workspaceId: otherWorkspace,
        connection,
        projectId: otherProject,
        name: "Lab",
        inProgressStateId: null,
        mergedStateId: null,
      },
      {
        workspaceId,
        connection,
        projectId: trackerProject,
        name: "Web",
        inProgressStateId: null,
        mergedStateId: null,
      },
    ]);
  });

  it("머지 때 상태는 고른 값과 null을 저장하고, 값을 주지 않은 저장은 그대로 둔다", () => {
    const db = seedTwoWorkspaces();
    const project = {
      workspaceId,
      connection,
      projectId: trackerProject,
      name: "Web",
      inProgressStateId: null,
    };
    const mergedStateOf = () =>
      getWorkspaceTrackerProject(db, connection, trackerProject)?.mergedStateId;
    const done = toTrackerStateId("st-done");

    saveWorkspaceTrackerProject(db, { ...project, mergedStateId: done });
    expect(mergedStateOf()).toBe(done);
    saveWorkspaceTrackerProject(db, { ...project, name: "Web 2" });
    expect(mergedStateOf()).toBe(done);
    saveWorkspaceTrackerProject(db, { ...project, mergedStateId: null });
    expect(mergedStateOf()).toBeNull();
  });

  it("Workspace를 주면 그 Workspace 것만 돌려준다", () => {
    const db = seedTwoWorkspaces();
    expect(listWorkspaceTrackerProjects(db, otherWorkspace).map((p) => p.projectId)).toEqual([
      otherProject,
    ]);
  });
});

describe("removeWorkspaceTrackerProject", () => {
  it("빼면 Mapping은 함께 지워지지만 런 기록은 남는다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "runner-1", capacity: 2, online: true, projects: [repoA] });
    const ticket = (key: string) => ({ connection, key: toTicketKey(key) });
    const assign = (key: string) => {
      const result = assignRun(db, {
        ticket: ticket(key),
        trackerProject,
        runnerProject: repoA,
        agent,
      });
      if (!result.ok) throw new Error(result.reason);
      return result.run.id;
    };
    const ended = assign("ENG-1");
    const ok = changeRunState(db, ended, {
      to: "ended",
      agentResult: "canceled",
      prState: "none",
    });
    expect(ok.ok).toBe(true);
    const queued = assign("ENG-2");

    expect(
      removeWorkspaceTrackerProject(db, { workspaceId, connection, projectId: trackerProject }),
    ).toBe(true);

    expect(listWorkspaceTrackerProjects(db, workspaceId)).toEqual([]);
    expect(getMapping(db, connection, trackerProject)).toBeNull();
    expect(listRuns(db).map((run) => run.id)).toEqual([ended, queued]);
    expect(getRun(db, ended)).toMatchObject({ state: "ended", trackerProject, workspaceId });
    expect(getRun(db, queued)).toMatchObject({ state: "queued", trackerProject, workspaceId });
  });

  it("다른 Workspace에 묶인 트래커 프로젝트는 빼지 않는다", () => {
    const db = seedTwoWorkspaces();
    expect(
      removeWorkspaceTrackerProject(db, { workspaceId, connection, projectId: otherProject }),
    ).toBe(false);
    expect(listWorkspaceTrackerProjects(db, otherWorkspace)).toHaveLength(1);
  });
});

describe("recordRunnerCheck 필수 조건", () => {
  const prerequisites = [
    { id: "service", name: "Orca service", satisfied: true, hint: null, blocksAssignment: false },
    {
      id: "push:github:acme/web",
      name: "acme/web",
      satisfied: false,
      hint: "gh auth setup-git",
      blocksAssignment: true,
    },
  ];

  it("러너 필수 조건 하나하나(프로젝트별 GitHub 인증, Q82.15)를 저장하고 읽는다", () => {
    const db = seededDatabase();
    const id = addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    expect(listRunners(db)[0]?.prerequisites).toBeNull();
    recordRunnerCheck(db, {
      runnerId: id,
      online: true,
      checkedAt: new Date(1),
      error: null,
      projects: null,
      assignmentBlocked: true,
      prerequisites,
    });
    expect(listRunners(db)[0]).toMatchObject({ assignmentBlocked: true, prerequisites });
  });

  it("필수 조건을 읽지 못한 확인(null 이나 생략)은 이전 값을 남긴다", () => {
    const db = seededDatabase();
    const id = addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    const check = { runnerId: id, checkedAt: new Date(1), error: null, projects: null };
    recordRunnerCheck(db, { ...check, online: true, assignmentBlocked: true, prerequisites });
    recordRunnerCheck(db, {
      ...check,
      online: false,
      assignmentBlocked: null,
      prerequisites: null,
    });
    recordRunnerCheck(db, { ...check, online: false, assignmentBlocked: null });
    expect(listRunners(db)[0]).toMatchObject({ online: false, prerequisites });
  });

  it("프로젝트에 걸린 push 실패를 이유와 함께 저장하고, 그 프로젝트만 막힌 프로젝트로 읽는다 (0096)", () => {
    const db = seededDatabase();
    const id = addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    const pushFailed = {
      id: `github-push:${repoA}`,
      name: "push",
      satisfied: false,
      hint: null,
      blocksAssignment: false,
      project: repoA,
      failure: { kind: "auth" as const, reason: "Permission to acme/web.git denied to someone." },
    };
    const check = { runnerId: id, checkedAt: new Date(1), error: null, projects: null };
    recordRunnerCheck(db, {
      ...check,
      online: true,
      assignmentBlocked: false,
      prerequisites: [prerequisites[0], pushFailed].flatMap((p) => (p === undefined ? [] : [p])),
    });

    expect(listRunners(db)[0]?.prerequisites?.[1]).toEqual(pushFailed);
    expect(listRunnerSnapshots(db)[0]).toMatchObject({
      assignmentBlocked: false,
      blockedProjects: [repoA],
    });

    recordRunnerCheck(db, { ...check, online: false, assignmentBlocked: null });
    expect(listRunnerSnapshots(db)[0]?.blockedProjects).toEqual([]);
  });
});

describe("recordRunnerCheck Offline 시각(0064)", () => {
  const check = (id: ReturnType<typeof addRunner>, online: boolean, at: number) => ({
    runnerId: id,
    online,
    checkedAt: new Date(at),
    error: null,
    projects: null,
    assignmentBlocked: null,
  });

  it("Online 에서 Offline 이 된 첫 확인 시각을 남기고, Offline 이 이어지는 동안 바꾸지 않는다", () => {
    const db = seededDatabase();
    const id = addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    expect(listRunners(db)[0]?.offlineSince).toBeNull();

    recordRunnerCheck(db, check(id, false, 5_000));
    expect(listRunners(db)[0]?.offlineSince).toEqual(new Date(5_000));

    recordRunnerCheck(db, check(id, false, 65_000));
    expect(listRunners(db)[0]).toMatchObject({
      online: false,
      checkedAt: new Date(65_000),
      offlineSince: new Date(5_000),
    });
  });

  it("다시 Online 이 되면 지우고, 그 뒤 Offline 이 되면 새 시각을 남긴다", () => {
    const db = seededDatabase();
    const id = addRunner(db, { id: "runner-1", capacity: 1, online: false, projects: [repoA] });
    expect(listRunners(db)[0]?.offlineSince).toEqual(new Date(0));

    recordRunnerCheck(db, check(id, true, 10_000));
    expect(listRunners(db)[0]?.offlineSince).toBeNull();

    recordRunnerCheck(db, check(id, false, 20_000));
    expect(listRunners(db)[0]?.offlineSince).toEqual(new Date(20_000));
  });
});

describe("recordProviderUsage(0086)", () => {
  it("읽기 전에는 사용량이 없다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    expect(listRunners(db)[0]?.providerUsage).toBeNull();
  });

  it("공급자별 상태와 창 사용량, 읽은 시각을 저장하고 읽는다", () => {
    const db = seededDatabase();
    const id = addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    const reading = {
      kind: "read" as const,
      providers: [
        {
          provider: "claude",
          status: "ok" as const,
          windows: [
            { kind: "session" as const, usedPercent: 100, resetsAt: new Date(9_000) },
            { kind: "weekly" as const, usedPercent: 72, resetsAt: null },
          ],
        },
        { provider: "codex", status: "signed-out" as const, windows: [] },
      ],
    };
    recordProviderUsage(db, { runnerId: id, readAt: new Date(5_000), reading });
    expect(listRunners(db)[0]?.providerUsage).toEqual({ readAt: new Date(5_000), reading });
  });

  it("읽지 못한 결과도 시각과 함께 남기고, 러너 상태는 바꾸지 않는다", () => {
    const db = seededDatabase();
    const id = addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    const before = listRunners(db)[0];
    recordProviderUsage(db, {
      runnerId: id,
      readAt: new Date(7_000),
      reading: { kind: "unreadable" },
    });
    const after = listRunners(db)[0];
    expect(after?.providerUsage).toEqual({
      readAt: new Date(7_000),
      reading: { kind: "unreadable" },
    });
    expect({ ...after, providerUsage: null }).toEqual({ ...before, providerUsage: null });
  });

  it("저장된 값이 깨졌으면 읽지 못한 것으로 본다", () => {
    const db = seededDatabase();
    addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    db.$client
      .prepare("UPDATE runners SET provider_usage = ?, provider_usage_read_at = 3000")
      .run(JSON.stringify({ kind: "read", providers: [{ provider: 1 }] }));
    expect(listRunners(db)[0]?.providerUsage).toEqual({
      readAt: new Date(3_000),
      reading: { kind: "unreadable" },
    });
  });
});

describe("설치 설정(0048)", () => {
  it("처음 읽을 때 설치 ID를 만들고, 다시 읽어도 같은 ID다", () => {
    const db = seededDatabase();
    const first = getInstallSettings(db);
    expect(first.instanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.webAddress).toBeNull();
    expect(getInstallSettings(db).instanceId).toBe(first.instanceId);
  });

  it("주소를 저장해도 설치 ID는 그대로다", () => {
    const db = seededDatabase();
    const { instanceId } = getInstallSettings(db);
    saveInstallAddresses(
      db,
      { webAddress: "https://server.example.ts.net", webhookAddress: null },
      new Date("2026-11-18T00:00:00Z"),
    );
    expect(getInstallSettings(db)).toEqual({
      instanceId,
      webAddress: "https://server.example.ts.net",
      webhookAddress: null,
      webhookAddressCheckedAt: null,
    });
  });
});

describe("Mapping 저장소 목록(0115)", () => {
  const repoB = toRunnerProjectId("fake:acme/b");
  const repoC = toRunnerProjectId("fake:acme/c");
  const api = toLabelId("label-api");

  it("기본 하나와 라벨 붙은 저장소를 순서대로 저장하고 읽는다", () => {
    const db = seededDatabase();
    expect(
      replaceMapping(db, {
        connection,
        trackerProject,
        agent,
        model: "opus",
        repos: [
          { project: repoA, isDefault: true, labelId: null },
          { project: repoC, isDefault: false, labelId: api },
          { project: repoB, isDefault: false, labelId: null },
        ],
      }),
    ).toEqual({ ok: true });

    expect(getMapping(db, connection, trackerProject)).toEqual({
      connection,
      trackerProject,
      agent,
      model: "opus",
      defaultRepo: repoA,
      repos: [
        { project: repoA, isDefault: true, labelId: null },
        { project: repoC, isDefault: false, labelId: api },
        { project: repoB, isDefault: false, labelId: null },
      ],
    });
  });

  it("같은 트래커 프로젝트에서 한 라벨을 두 저장소에 붙이면 거절하고 저장된 값을 바꾸지 않는다", () => {
    const db = seededDatabase();
    const before = getMapping(db, connection, trackerProject);

    expect(
      replaceMapping(db, {
        connection,
        trackerProject,
        agent,
        repos: [
          { project: repoA, isDefault: true, labelId: null },
          { project: repoB, isDefault: false, labelId: api },
          { project: repoC, isDefault: false, labelId: api },
        ],
      }),
    ).toEqual({ ok: false, reason: "label-in-use" });
    expect(getMapping(db, connection, trackerProject)).toEqual(before);
  });

  it("DB도 기본 둘·라벨 중복·기본의 라벨을 막는다", () => {
    const db = seededDatabase();
    const insert = (runner: string, isDefault: number, label: string | null) =>
      db.$client
        .prepare(
          "INSERT INTO mapping_repos (tracker_connection_id, tracker_project_id, runner_project_id, is_default, label_id, position) VALUES (?, ?, ?, ?, ?, 9)",
        )
        .run(connection, trackerProject, runner, isDefault, label);
    expect(() => insert("x", 1, null)).toThrow(/UNIQUE/);
    expect(() => insert("y", 1, "l")).toThrow(/CHECK/);
    insert("z", 0, "l");
    expect(() => insert("w", 0, "l")).toThrow(/UNIQUE/);
  });

  it("saveMapping은 기본 저장소를 바꾸고 나머지 저장소는 그대로 둔다(MCP set_mapping)", () => {
    const db = seededDatabase();
    replaceMapping(db, {
      connection,
      trackerProject,
      agent,
      repos: [
        { project: repoA, isDefault: true, labelId: null },
        { project: repoB, isDefault: false, labelId: api },
        { project: repoC, isDefault: false, labelId: null },
      ],
    });

    saveMapping(db, { connection, trackerProject, runnerProject: repoB, agent });

    expect(getMapping(db, connection, trackerProject)?.repos).toEqual([
      { project: repoB, isDefault: true, labelId: null },
      { project: repoA, isDefault: false, labelId: null },
      { project: repoC, isDefault: false, labelId: null },
    ]);
  });
});

describe("Linear가 이 서버에 닿을 주소의 확인 시각(0130)", () => {
  const at = new Date("2026-11-20T09:00:00Z");
  const later = new Date("2026-11-20T10:00:00Z");

  it("확인한 주소로 저장하면 확인 시각을 남기고, 다른 주소만 바꾸는 저장은 그대로 둔다", () => {
    const db = seededDatabase();
    saveCheckedWebhookAddress(db, "https://hooks.example.com", at);
    expect(getInstallSettings(db)).toMatchObject({
      webhookAddress: "https://hooks.example.com",
      webhookAddressCheckedAt: at,
    });
    saveInstallAddresses(
      db,
      { webAddress: "https://server.example.ts.net", webhookAddress: "https://hooks.example.com" },
      later,
    );
    expect(getInstallSettings(db)).toMatchObject({
      webAddress: "https://server.example.ts.net",
      webhookAddressCheckedAt: at,
    });
  });

  it("확인 없이 닿을 주소를 바꾸면 확인 시각을 지운다", () => {
    const db = seededDatabase();
    saveCheckedWebhookAddress(db, "https://hooks.example.com", at);
    saveInstallAddresses(
      db,
      { webAddress: null, webhookAddress: "http://192.168.0.10:3000" },
      later,
    );
    expect(getInstallSettings(db).webhookAddressCheckedAt).toBeNull();
  });
});

describe("Workspace 앞뒤 지시", () => {
  it("새 Workspace는 앞뒤 지시가 비어 있다", () => {
    const db = seededDatabase();
    expect(getWorkspaceBrief(db, workspaceId)).toEqual({ before: "", after: "" });
    expect(listWorkspaces(db)[0]?.brief).toEqual({ before: "", after: "" });
  });

  it("저장한 앞뒤 지시를 줄바꿈 그대로 읽는다", () => {
    const db = seededDatabase();
    const brief = { before: "- Read AGENTS.md\n- Use pnpm", after: "Open a PR to develop." };
    expect(saveWorkspaceBrief(db, { id: workspaceId, brief })).toBe(true);
    expect(getWorkspaceBrief(db, workspaceId)).toEqual(brief);
    expect(listWorkspaces(db).find((w) => w.id === workspaceId)?.brief).toEqual(brief);
  });

  it("이름이나 최대 실행 시간을 저장해도 앞뒤 지시는 그대로 둔다", () => {
    const db = seededDatabase();
    const brief = { before: "Before.", after: "After." };
    saveWorkspaceBrief(db, { id: workspaceId, brief });
    saveWorkspace(db, { id: workspaceId, name: "Renamed", maxRunMs: 60_000 });
    expect(getWorkspaceBrief(db, workspaceId)).toEqual(brief);
  });

  it("없는 Workspace에는 저장하지 않는다", () => {
    const db = seededDatabase();
    expect(
      saveWorkspaceBrief(db, {
        id: toWorkspaceId("ws-missing"),
        brief: { before: "x", after: "" },
      }),
    ).toBe(false);
    expect(getWorkspaceBrief(db, toWorkspaceId("ws-missing"))).toBeNull();
  });

  it("같은 값을 다시 저장하면 변경 기록을 남기지 않는다", () => {
    const db = seededDatabase();
    const brief = { before: "Before.", after: "" };
    saveWorkspaceBrief(db, { id: workspaceId, brief });
    const before = latestChangeSeq(db);
    saveWorkspaceBrief(db, { id: workspaceId, brief });
    expect(latestChangeSeq(db)).toBe(before);
  });
});
