import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import type { Database } from "./database.js";
import { MigrationError, checkSchema, loadMigrations, migrate } from "./migrate.js";
import { seededDatabase, tempDatabasePath } from "./test-fixtures.js";

function schemaDump(db: Database): unknown[] {
  return db.$client.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all();
}

describe("migrate", () => {
  let cleanup: () => void = () => {};
  afterEach(() => cleanup());

  it("빈 파일에서 스키마를 만들고, 다시 돌려도 스키마가 바뀌지 않는다", () => {
    const temp = tempDatabasePath();
    cleanup = temp.cleanup;

    const db = openDatabase(temp.path);
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrate(db)).toEqual(migrations.map((m) => m.name));
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row["name"]);
    expect(tables).toEqual(
      expect.arrayContaining([
        "auto_assign_labels",
        "code_host_connections",
        "log_tail_requests",
        "mapping_repos",
        "mappings",
        "mcp_actions",
        "run_cancel_requests",
        "run_permission_waits",
        "run_questions",
        "run_state_changes",
        "runner_check_requests",
        "runner_projects",
        "runners",
        "runs",
        "schema_migrations",
        "tracker_connections",
        "tracker_events",
        "workspace_tracker_projects",
        "workspaces",
      ]),
    );
    const first = schemaDump(db);

    expect(migrate(db)).toEqual([]);
    expect(schemaDump(db)).toEqual(first);
    db.$client.close();

    const again = openDatabase(temp.path);
    expect(migrate(again)).toEqual([]);
    expect(schemaDump(again)).toEqual(first);
    again.$client.close();
  });

  it("WAL과 외래 키를 켠다", () => {
    const temp = tempDatabasePath();
    cleanup = temp.cleanup;
    const db = openDatabase(temp.path);
    expect(db.$client.prepare("PRAGMA journal_mode").get()?.["journal_mode"]).toBe("wal");
    expect(db.$client.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"]).toBe(1);
    db.$client.close();
  });

  it("이 코드가 모르는 마이그레이션이 DB에 있으면(다운그레이드) 거부한다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.$client
      .prepare(
        "INSERT INTO schema_migrations (name, hash, applied_at) VALUES ('99990101000000_future', 'x', 0)",
      )
      .run();
    expect(() => migrate(db)).toThrow(MigrationError);
  });

  it("이미 적용한 마이그레이션의 SQL이 바뀌었으면 거부한다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const edited = loadMigrations().map((m) => ({ ...m, hash: `${m.hash}-edited` }));
    expect(() => migrate(db, edited)).toThrow(/edited/);
  });

  it("마이그레이션이 실패하면 아무것도 남기지 않는다", () => {
    const db = openDatabase(":memory:");
    const broken = [
      ...loadMigrations(),
      {
        name: "99990101000000_broken",
        hash: "broken",
        sql: ["CREATE TABLE extra (id TEXT)", "SELECT * FROM missing"],
      },
    ];
    expect(() => migrate(db, broken)).toThrow(/no such table: missing/);
    expect(
      db.$client.prepare("SELECT name FROM sqlite_schema WHERE name IN ('runs', 'extra')").get(),
    ).toBeUndefined();
    expect(migrate(db)).toEqual(loadMigrations().map((m) => m.name));
  });

  it("테이블을 다시 만드는 마이그레이션(drizzle-kit 방식)이 자식 행을 지우지 않는다", () => {
    const db = seededDatabase();
    const children = () =>
      db.$client.prepare("SELECT count(*) AS n FROM workspace_tracker_projects").get()?.["n"];
    expect(children()).toBe(1);

    const recreate = {
      name: "99990101000000_recreate_workspaces",
      hash: "recreate",
      sql: [
        "PRAGMA foreign_keys=OFF",
        `CREATE TABLE __new_workspaces (
          id text PRIMARY KEY, name text NOT NULL,
          max_run_ms integer DEFAULT 7200000 NOT NULL, created_at integer NOT NULL)`,
        "INSERT INTO __new_workspaces SELECT id, name, max_run_ms, created_at FROM workspaces",
        "DROP TABLE workspaces",
        "ALTER TABLE __new_workspaces RENAME TO workspaces",
        "PRAGMA foreign_keys=ON",
      ],
    };
    expect(migrate(db, [...loadMigrations(), recreate])).toEqual([recreate.name]);
    expect(children()).toBe(1);
    expect(db.$client.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"]).toBe(1);
  });

  it("외래 키를 어기는 마이그레이션은 되돌린다", () => {
    const db = seededDatabase();
    const orphan = {
      name: "99990101000000_orphan",
      hash: "orphan",
      sql: ["DELETE FROM workspaces"],
    };
    expect(() => migrate(db, [...loadMigrations(), orphan])).toThrow(/foreign key/);
    expect(db.$client.prepare("SELECT count(*) AS n FROM workspaces").get()?.["n"]).toBe(1);
    expect(db.$client.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"]).toBe(1);
  });

  it("0064 마이그레이션이 기존 런·러너를 남긴 채 제목과 Offline 시각 칸을 비워 더한다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_run_title_offline_since"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runners (id, kind, name, capacity, online, checked_at, created_at)
        VALUES ('r', 'fake', 'r', 1, 0, 5, 0);
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, worktree_name, state, runner_id, assigned_at)
        VALUES ('queued', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'ganger-ENG-1-1', 'queued', 'r', 1);
    `);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client.prepare("SELECT id, ticket_key, ticket_title, state FROM runs").all(),
    ).toEqual([{ id: "queued", ticket_key: "ENG-1", ticket_title: null, state: "queued" }]);
    expect(
      db.$client.prepare("SELECT id, online, checked_at, offline_since FROM runners").all(),
    ).toEqual([{ id: "r", online: 0, checked_at: 5, offline_since: null }]);
  });

  it("0086 마이그레이션이 기존 러너를 남긴 채 공급자 사용량 칸을 비워 더한다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_runner_provider_usage"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runners (id, kind, name, capacity, online, prerequisites, checked_at, offline_since, created_at)
        VALUES ('r', 'fake', 'r', 2, 1, '[]', 5, NULL, 0);
      INSERT INTO runner_projects (runner_id, project_id, display_name, setup_state)
        VALUES ('r', 'rp', 'rp', 'ready');
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, worktree_name, state, runner_id, assigned_at)
        VALUES ('queued', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'ganger-ENG-1-1', 'queued', 'r', 1);
    `);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client
        .prepare(
          "SELECT id, capacity, online, prerequisites, checked_at, provider_usage, provider_usage_read_at FROM runners",
        )
        .all(),
    ).toEqual([
      {
        id: "r",
        capacity: 2,
        online: 1,
        prerequisites: "[]",
        checked_at: 5,
        provider_usage: null,
        provider_usage_read_at: null,
      },
    ]);
    expect(db.$client.prepare("SELECT count(*) AS n FROM runner_projects").get()?.["n"]).toBe(1);
    expect(db.$client.prepare("SELECT runner_id FROM runs").all()).toEqual([{ runner_id: "r" }]);
  });

  it("0230 마이그레이션이 기존 기기를 남긴 채 종류 칸을 더하고 데스크톱 앱이 등록한 기기만 desktop 으로 채운다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_device_kind"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO devices (id, name, token_hash, created_at) VALUES
        ('phone', 'Acme iPhone', 'h1', 0),
        ('desktop', 'Ganger 데스크톱 (acme-mac)', 'h2', 1),
        ('lookalike', 'Ganger 데스크톱', 'h3', 2);
    `);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client
        .prepare("SELECT id, name, token_hash, kind FROM devices ORDER BY created_at")
        .all(),
    ).toEqual([
      { id: "phone", name: "Acme iPhone", token_hash: "h1", kind: "phone" },
      { id: "desktop", name: "Ganger 데스크톱 (acme-mac)", token_hash: "h2", kind: "desktop" },
      { id: "lookalike", name: "Ganger 데스크톱", token_hash: "h3", kind: "phone" },
    ]);
  });

  it("0230 마이그레이션 뒤 빈 DB 에 넣은 기기는 종류를 주지 않으면 phone 이다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.$client.exec(
      "INSERT INTO devices (id, name, token_hash, created_at) VALUES ('d', 'Acme iPhone', 'h', 0)",
    );
    expect(db.$client.prepare("SELECT kind FROM devices").get()).toEqual({ kind: "phone" });
  });

  it("0144 마이그레이션이 기존 런을 그대로 옮기고 PR 못 읽음과 이유 칸을 더한다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_pr_read_unknown"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runners (id, kind, name, capacity, online, checked_at, created_at)
        VALUES ('r', 'fake', 'r', 1, 1, 5, 0);
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, worktree_name, branch, state, runner_id, assigned_at, started_at,
        ended_at, worktree_ref, agent_ref, agent_result, pr_state, pr_id, pr_display_id, pr_url,
        pr_ci_state, pr_checked_at)
        VALUES ('ended', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'ganger-ENG-1-1', 'b', 'ended', 'r', 1, 2,
          3, 'wt', 'ag', 'reported-success', 'open', 'pr-1', '#1', 'https://code.example.com/acme/pull/1',
          'success', 3);
    `);
    expect(() =>
      db.$client.exec("UPDATE runs SET pr_state = 'unknown' WHERE id = 'ended'"),
    ).toThrow(/CHECK constraint/);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client
        .prepare("SELECT id, state, agent_result, pr_state, pr_display_id, pr_read_error FROM runs")
        .all(),
    ).toEqual([
      {
        id: "ended",
        state: "ended",
        agent_result: "reported-success",
        pr_state: "open",
        pr_display_id: "#1",
        pr_read_error: null,
      },
    ]);
    expect(() =>
      db.$client.exec("UPDATE runs SET pr_state = 'unknown' WHERE id = 'ended'"),
    ).toThrow(/runs_pr_read_error_iff_unknown/);
    db.$client.exec(
      "UPDATE runs SET pr_state = 'unknown', pr_read_error = 'no-access' WHERE id = 'ended'",
    );
    expect(() =>
      db.$client.exec("UPDATE runs SET pr_read_error = 'forbidden' WHERE id = 'ended'"),
    ).toThrow(/runs_pr_read_error/);
  });

  it("0148 마이그레이션은 지운 알림 사건의 번호를 다시 쓰지 않고, 기존 질문은 Question 종류로 둔다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_human_check"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO runners (id, kind, name, capacity, online, checked_at, created_at)
        VALUES ('r', 'fake', 'r', 1, 1, 5, 0);
      INSERT INTO notification_events (id, seq, kind, cause, runner_id, subject, created_at)
        VALUES (5, 5, 'runner-offline', 'kept', 'r', 'r', 1),
          (100, 100, 'runner-offline', 'purged', 'r', 'r', 2);
      DELETE FROM notification_events WHERE id = 100;
    `);

    migrate(db);

    db.$client.exec(`
      INSERT INTO notification_events (seq, kind, cause, runner_id, subject, created_at)
        VALUES (101, 'runner-offline', 'next', 'r', 'r', 3);
    `);
    expect(db.$client.prepare("SELECT id FROM notification_events ORDER BY id").all()).toEqual([
      { id: 5 },
      { id: 101 },
    ]);
    expect(
      db.$client
        .prepare("SELECT name FROM sqlite_sequence WHERE name LIKE '%notification_events'")
        .all(),
    ).toEqual([{ name: "notification_events" }]);
  });

  it("0145 마이그레이션이 기존 런을 그대로 옮기고 워크트리를 남긴 이유와 지우기 요청 칸을 비워 더하며, Human Check 알림 사건을 지운다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_run_outcome_names"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runners (id, kind, name, capacity, online, checked_at, created_at)
        VALUES ('r', 'fake', 'r', 1, 1, 5, 0);
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, worktree_name, branch, state, runner_id, assigned_at, started_at,
        ended_at, worktree_ref, agent_ref, agent_result, pr_state, worktree_removed_at)
        VALUES ('ended', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'ganger-ENG-1-1', 'b', 'ended', 'r', 1, 2,
          3, 'wt', 'ag', 'reported-success', 'none', 4);
      INSERT INTO notification_events (id, seq, kind, cause, run_id, workspace_id, ticket_key, subject, created_at)
        VALUES (1, 1, 'human-check', 'human-check:ended', 'ended', 'w', 'ENG-1', 'ENG-1', 5),
          (2, 2, 'failed', 'failed:ended', 'ended', 'w', 'ENG-1', 'ENG-1', 6);
    `);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client
        .prepare(
          "SELECT id, agent_result, pr_state, worktree_removed_at, worktree_kept, worktree_remove_requested_at FROM runs",
        )
        .all(),
    ).toEqual([
      {
        id: "ended",
        agent_result: "reported-success",
        pr_state: "none",
        worktree_removed_at: 4,
        worktree_kept: null,
        worktree_remove_requested_at: null,
      },
    ]);
    expect(db.$client.prepare("SELECT id, kind FROM notification_events").all()).toEqual([
      { id: 2, kind: "failed" },
    ]);
    db.$client.exec("UPDATE runs SET worktree_kept = 'uncommitted-changes' WHERE id = 'ended'");
    expect(() =>
      db.$client.exec("UPDATE runs SET worktree_kept = 'dirty' WHERE id = 'ended'"),
    ).toThrow(/runs_worktree_kept/);
  });

  it("0089 마이그레이션이 기존 설치 설정·런을 남긴 채 MCP 쓰기 허용을 끈 채로 더하고 작업 기록 테이블을 만든다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_mcp_actions"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO install_settings (id, instance_id, web_address, webhook_address, updated_at)
        VALUES (1, 'instance', 'https://ganger.example.com', NULL, 5);
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, worktree_name, state, assigned_at)
        VALUES ('queued', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'ganger-ENG-1-1', 'queued', 1);
    `);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client
        .prepare(
          "SELECT instance_id, web_address, webhook_address, mcp_write_allowed, updated_at FROM install_settings",
        )
        .all(),
    ).toEqual([
      {
        instance_id: "instance",
        web_address: "https://ganger.example.com",
        webhook_address: null,
        mcp_write_allowed: 0,
        updated_at: 5,
      },
    ]);
    expect(db.$client.prepare("SELECT id FROM runs").all()).toEqual([{ id: "queued" }]);
    db.$client
      .prepare(
        "INSERT INTO mcp_actions (at, client, tool, run_id, outcome) VALUES (6, 'hermes', 'cancel_run', 'queued', 'done')",
      )
      .run();
    expect(() =>
      db.$client
        .prepare(
          "INSERT INTO mcp_actions (at, client, tool, outcome) VALUES (7, 'x', 'y', 'maybe')",
        )
        .run(),
    ).toThrow("CHECK constraint failed");
  });

  it("0115 마이그레이션이 기존 Mapping 한 줄을 그 저장소를 기본으로 하는 목록으로 옮긴다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_mapping_repos"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO workspace_tracker_projects (tracker_connection_id, tracker_project_id, workspace_id, name)
        VALUES ('c', 'tp1', 'w', 'Web'), ('c', 'tp2', 'w', 'Api'), ('c', 'tp3', 'w', 'Docs');
      INSERT INTO mappings (tracker_connection_id, tracker_project_id, runner_project_id, agent_id, model)
        VALUES ('c', 'tp1', 'rp-web', 'claude', 'opus'), ('c', 'tp2', 'rp-api', 'codex', NULL);
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, worktree_name, state, assigned_at)
        VALUES ('queued', 'c', 'ENG-1', 'w', 'tp1', 'rp-web', 'claude', 'ganger-ENG-1-1', 'queued', 1);
    `);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client
        .prepare(
          "SELECT tracker_project_id, agent_id, model FROM mappings ORDER BY tracker_project_id",
        )
        .all(),
    ).toEqual([
      { tracker_project_id: "tp1", agent_id: "claude", model: "opus" },
      { tracker_project_id: "tp2", agent_id: "codex", model: null },
    ]);
    expect(
      db.$client
        .prepare(
          "SELECT tracker_project_id, runner_project_id, is_default, label_id FROM mapping_repos ORDER BY tracker_project_id",
        )
        .all(),
    ).toEqual([
      { tracker_project_id: "tp1", runner_project_id: "rp-web", is_default: 1, label_id: null },
      { tracker_project_id: "tp2", runner_project_id: "rp-api", is_default: 1, label_id: null },
    ]);
    expect(db.$client.prepare("SELECT id, runner_project_id FROM runs").all()).toEqual([
      { id: "queued", runner_project_id: "rp-web" },
    ]);
  });

  it("0037 마이그레이션이 옛 런을 결정적 워크트리 이름·실제 브랜치·완료 보고 결과로 옮긴다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const before = all.findIndex((m) => m.name.endsWith("_core_contracts"));
    expect(before).toBeGreaterThan(0);
    migrate(db, all.slice(0, before));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runners (id, kind, name, capacity, created_at) VALUES ('r', 'fake', 'r', 1, 0);
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, branch, state, runner_id, assigned_at)
        VALUES ('queued', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'factory/ENG-1-1', 'queued', NULL, 1);
      UPDATE runs SET retry_token = 'op-1' WHERE id = 'queued';
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, branch, state, runner_id, assigned_at, started_at, ended_at,
        worktree_ref, agent_result, pr_state)
        VALUES ('ended', 'c', 'ENG-2', 'w', 'tp', 'rp', 'a', 'factory/ENG-2-1', 'ended', 'r', 1, 2, 3,
          'repo::/wt', 'exited-with-error', 'open');
    `);

    migrate(db);
    const rows = db.$client
      .prepare(
        "SELECT id, worktree_name, branch, agent_ref, agent_result, runner_unreached, start_requested_at FROM runs ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      {
        id: "ended",
        worktree_name: "factory-ENG-2-1",
        branch: "factory/ENG-2-1",
        agent_ref: "repo::/wt",
        agent_result: "reported-failure",
        runner_unreached: 0,
        start_requested_at: null,
      },
      {
        id: "queued",
        worktree_name: "factory-ENG-1-1",
        branch: null,
        agent_ref: null,
        agent_result: null,
        runner_unreached: 0,
        start_requested_at: 1,
      },
    ]);
  });
});

describe("checkSchema", () => {
  it("마이그레이션을 돌리지 않은 DB는 뒤처졌다고 알리고 아무것도 만들지 않는다", () => {
    const db = openDatabase(":memory:");
    expect(checkSchema(db)).toEqual({
      kind: "behind",
      missing: loadMigrations().map((m) => m.name),
    });
    expect(schemaDump(db)).toEqual([]);
  });

  it("모든 마이그레이션을 적용한 DB는 지금 판이다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(checkSchema(db)).toEqual({ kind: "current" });
  });

  it("마지막 마이그레이션이 빠졌으면 뒤처졌다고 알린다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    migrate(db, all.slice(0, -1));
    expect(checkSchema(db, all)).toEqual({ kind: "behind", missing: [all.at(-1)?.name] });
  });

  it("모르는 마이그레이션이 있으면 앞섰다고 알린다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.$client
      .prepare(
        "INSERT INTO schema_migrations (name, hash, applied_at) VALUES ('99990101000000_future', 'x', 0)",
      )
      .run();
    expect(checkSchema(db)).toEqual({ kind: "ahead", unknown: ["99990101000000_future"] });
  });

  it("적용한 마이그레이션의 SQL이 바뀌었으면 고쳐졌다고 알린다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const edited = loadMigrations().map((m) => ({ ...m, hash: `${m.hash}-edited` }));
    expect(checkSchema(db, edited)).toEqual({
      kind: "edited",
      changed: edited.map((m) => m.name),
    });
  });
});
