import { toRunnerId, toRunnerKind } from "@ganger/core";
import {
  addDevice,
  migrate,
  openDatabase,
  recordGhAccounts,
  recordRunnerCheck,
  saveRunner,
  saveWorkspace,
  toWorkspaceId,
} from "@ganger/db";
import { describe, expect, it } from "vitest";
import { loadThisDevice, loadV1Runners, loadV1Workspaces } from "./runners.js";

const at = new Date("2026-11-23T00:00:00.000Z");

function world() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

function addRunner(db: ReturnType<typeof world>, id: string, online: boolean, blocked = false) {
  const runnerId = toRunnerId(id);
  saveRunner(db, { id: runnerId, kind: toRunnerKind("fake"), name: id, config: {}, capacity: 2 });
  recordRunnerCheck(db, {
    runnerId,
    online,
    checkedAt: at,
    error: null,
    projects: [],
    assignmentBlocked: blocked,
  });
}

describe("v1 Runners", () => {
  it("Workspace가 없어도 러너를 보이고 문제 러너를 앞에 둔다", () => {
    const db = world();
    addRunner(db, "healthy", true);
    addRunner(db, "down", false);
    addRunner(db, "no-auth", true, true);
    const { runners } = loadV1Runners(db, at);
    expect(runners.map((runner) => runner.cause).slice(-1)).toEqual([null]);
    expect(runners.find((runner) => runner.name === "down")?.cause).toBe("offline");
    expect(runners.find((runner) => runner.name === "no-auth")?.cause).toBe("auth");
  });

  it("ssh 대상 같은 러너 설정을 응답에 싣지 않는다", () => {
    const db = world();
    const runnerId = toRunnerId("secretive");
    saveRunner(db, {
      id: runnerId,
      kind: toRunnerKind("fake"),
      name: "secretive",
      config: { sshTarget: "user@host.example.com", orcaPath: "/opt/orca" },
      capacity: 1,
    });
    const text = JSON.stringify(loadV1Runners(db, at));
    expect(text).not.toContain("host.example.com");
    expect(text).not.toContain("/opt/orca");
  });
});

describe("v1 Runners의 gh 계정", () => {
  it("러너 gh 계정과 만료 표시를 싣고 읽지 않은 러너는 비운다", () => {
    const db = world();
    addRunner(db, "acme-runner", true);
    addRunner(db, "fresh", true);
    recordGhAccounts(db, {
      runnerId: toRunnerId("acme-runner"),
      readAt: new Date(at.getTime() - 3 * 60_000),
      reading: {
        kind: "logged-in",
        accounts: [
          { host: "github.com", login: "old-dev", active: false, expired: true },
          { host: "github.com", login: "acme-dev", active: true, expired: false },
        ],
      },
    });
    const { runners } = loadV1Runners(db, at);
    expect(runners.find((runner) => runner.name === "acme-runner")?.ghAccounts).toEqual({
      kind: "logged-in",
      readAt: "2026-11-22T23:57:00.000Z",
      agoMs: 3 * 60_000,
      accounts: [
        { host: "github.com", login: "acme-dev", active: true, expired: false },
        { host: "github.com", login: "old-dev", active: false, expired: true },
      ],
    });
    expect(runners.find((runner) => runner.name === "fresh")?.ghAccounts).toBeNull();
  });

  it("gh 없음·로그인 안 됨을 그대로 싣는다", () => {
    const db = world();
    addRunner(db, "no-gh", true);
    recordGhAccounts(db, {
      runnerId: toRunnerId("no-gh"),
      readAt: at,
      reading: { kind: "not-installed" },
    });
    expect(loadV1Runners(db, at).runners[0]?.ghAccounts).toEqual({
      kind: "not-installed",
      readAt: at.toISOString(),
      agoMs: 0,
    });
  });
});

describe("v1 Workspace와 이 기기", () => {
  it("Workspace 목록은 id와 이름만 싣는다", () => {
    const db = world();
    saveWorkspace(db, { id: toWorkspaceId("ws-1"), name: "Acme" });
    expect(loadV1Workspaces(db)).toEqual({ workspaces: [{ id: "ws-1", name: "Acme" }] });
  });

  it("이 기기 정보에 토큰 해시를 싣지 않고, 지운 기기는 없다", () => {
    const db = world();
    const device = addDevice(db, { name: "iPhone", kind: "phone", tokenHash: "hash-value" }, at);
    expect(loadThisDevice(db, device.id)).toEqual({
      id: device.id,
      name: "iPhone",
      createdAt: at.toISOString(),
    });
    expect(loadThisDevice(db, "missing")).toBeNull();
  });
});
