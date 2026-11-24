import { AdapterRegistry, toCodeHostKind, toRunnerId } from "@ganger/core";
import { FakeCodeHost } from "@ganger/core/testing";
import {
  SecretBox,
  listCodeHostConnections,
  listRuns,
  migrate,
  openDatabase,
  recordGhAccounts,
} from "@ganger/db";
import { GitHubAuth } from "@ganger/codehost-github";
import { describe, expect, it } from "vitest";
import { saveGitHubToken } from "@ganger/app/settings/actions";
import { checkGitHubConnection, loadGitHubAuthView } from "@ganger/app/settings/github-auth";
import type { SettingsContext } from "@ganger/app/settings/load";
import type { GitHubAuthView } from "@ganger/app/settings/model";
import { buttonsOf } from "../testing/buttons";
import { renderWithMessages } from "../testing/render";
import { seedDatabase } from "../testing/seed";
import { GitHubAuthPanel } from "./github-auth";
import { settingsMessages } from "./messages";
import type { SettingsActions } from "./settings-screen";

const now = new Date("2026-11-23T09:00:00Z");
const actions: SettingsActions = {
  saveGeneral: () => Promise.resolve({ ok: true }),
  saveBrief: () => Promise.resolve({ ok: true }),
  addProject: () => Promise.resolve({ ok: true }),
  removeProject: () => Promise.resolve({ ok: true }),
  saveMapping: () => Promise.resolve({ ok: true }),
  saveInProgress: () => Promise.resolve({ ok: true }),
  saveLabel: () => Promise.resolve({ ok: true }),
  saveConnection: () => Promise.resolve({ ok: true }),
  checkConnection: () => Promise.resolve({ ok: true }),
  saveGitHubToken: () => Promise.resolve({ ok: true }),
  checkGitHub: () => Promise.resolve({ ok: true }),
  saveRunner: () => Promise.resolve({ ok: true }),
  recheckRunner: () => Promise.resolve({ ok: true }),
  saveAddresses: () => Promise.resolve({ ok: true }),
  savePower: () => Promise.resolve({ ok: true }),
  saveMcpWrite: () => Promise.resolve({ ok: true }),
  createLabel: () => Promise.resolve({ ok: false, reason: "not-found" }),
  reloadFromTracker: () => Promise.resolve(),
  pollRunnerChecks: () => Promise.resolve(false),
  checkWebhookAddress: () => Promise.resolve({ ok: true }),
  turnOffWebhook: () => Promise.resolve({ ok: true }),
};

function panel(view: GitHubAuthView, connected = true): string {
  return renderWithMessages(
    <GitHubAuthPanel view={view} connected={connected} actions={actions} onClose={() => {}} />,
    settingsMessages,
  );
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const MISSING: GitHubAuthView = { cli: { kind: "missing" }, tokenSaved: false, source: "none" };

describe("Settings GitHub 구역 (0204)", () => {
  it("A: gh로 연결하면 계정마다 활성 표시와 볼 수 있는 곳을 보이고 토큰 칸은 접어 둔다", () => {
    const html = panel({
      cli: {
        kind: "logged-in",
        multiAccount: true,
        accounts: [
          { login: "acme-bot", active: true, owners: ["acme-bot", "acme"] },
          { login: "jane-doe", active: false, owners: ["jane-doe", "jane-labs"] },
        ],
      },
      tokenSaved: true,
      source: "gh",
    });
    const shown = text(html);
    expect(shown).toContain("gh로 연결했어요");
    expect(shown).toContain("acme-bot 활성 볼 수 있는 곳 · acme-bot, acme");
    expect(shown).toContain("jane-doe 볼 수 있는 곳 · jane-doe, jane-labs");
    expect(shown).not.toContain("jane-doe 활성");
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+"/);
    expect(html).not.toMatch(/<details[^>]*\sopen=""/);
    expect(shown).toContain("붙여 넣은 토큰도 저장해 뒀어요");
    expect(buttonsOf(html).map((b) => [b.label, b.variant])).toEqual(
      expect.arrayContaining([
        ["다시 확인", "secondary"],
        ["닫기", "ghost"],
        ["확인하고 저장", "secondary"],
      ]),
    );
  });

  it("B: gh 로그인이 없으면 gh auth login 명령과 복사·다시 확인을 보인다", () => {
    const html = panel(
      { cli: { kind: "logged-out", multiAccount: true }, tokenSaved: false, source: "none" },
      false,
    );
    const shown = text(html);
    expect(shown).toContain("gh에 로그인돼 있지 않아요");
    expect(shown).toContain("서버를 돌리는 사용자로");
    expect(html).toContain(">gh auth login</pre>");
    expect(buttonsOf(html).map((b) => b.label)).toEqual(
      expect.arrayContaining(["복사", "다시 확인"]),
    );
    expect(html).not.toMatch(/<details[^>]*\sopen=""/);
  });

  it("C: gh가 없으면 설치 안내와 함께 토큰 칸을 펼쳐 두고 권한 안내를 보인다", () => {
    const html = panel(MISSING, false);
    const shown = text(html);
    expect(shown).toContain("이 서버 기계에 gh가 없어요");
    expect(html).toContain('href="https://cli.github.com/"');
    expect(html).toMatch(/<details[^>]*\sopen=""/);
    expect(html).toContain('name="token"');
    expect(shown).toContain("PR을 읽기만 하려면 Pull requests 읽기 권한을 줘요");
    expect(shown).toContain("Pull requests와 Contents 쓰기 권한을 줘요");
    expect(buttonsOf(html).find((b) => b.label === "확인하고 저장")?.variant).toBe("primary");
  });

  it("gh 상태를 읽는 동안에는 읽는 중이라고 알린다", () => {
    const html = renderWithMessages(
      <GitHubAuthPanel view={undefined} connected={false} actions={actions} />,
      settingsMessages,
    );
    expect(html).toMatch(/role="status"[^>]*>이 서버 기계의 gh 로그인을 확인하는 중…/);
  });
});

function context(scene: { loggedIn: boolean; expired?: boolean }) {
  const db = openDatabase(":memory:");
  migrate(db);
  const codeHost = new FakeCodeHost(toCodeHostKind("fake-host"));
  const configs: unknown[] = [];
  const registry = new AdapterRegistry().registerCodeHost({
    kind: codeHost.kind,
    create: (config) => {
      configs.push(config);
      return codeHost;
    },
  });
  const githubAuth = new GitHubAuth({
    gh: {
      run: (args) => {
        if (args[0] === "--version") {
          return Promise.resolve({ code: 0, stdout: "gh version 2.60.0", stderr: "" });
        }
        const accounts = [
          ...(scene.loggedIn ? [{ state: "success", active: true, login: "acme-bot" }] : []),
          ...(scene.expired === true ? [{ state: "error", active: false, login: "acme-old" }] : []),
        ];
        if (args[1] === "status") {
          return Promise.resolve({
            code: 0,
            stdout: JSON.stringify({ hosts: { "github.com": accounts } }),
            stderr: "",
          });
        }
        return Promise.resolve({ code: 0, stdout: "gho_SECRETcheck1\n", stderr: "" });
      },
    },
    fetch: () => Promise.resolve(new Response("{}", { status: 500 })),
  });
  const ctx: SettingsContext = {
    db,
    secretBox: new SecretBox(new Uint8Array(32).fill(3)),
    registry,
    githubAuth,
  };
  return { ctx, codeHost, configs };
}

describe("GitHub 연결 확인과 토큰 저장 (0204)", () => {
  it("토큰을 저장할 때는 gh가 아닌 붙여 넣은 토큰만으로 확인하고, 그 표시는 저장하지 않는다", async () => {
    const { ctx, configs } = context({ loggedIn: true });
    expect(await saveGitHubToken(ctx, { token: "github_pat_example" }, now)).toEqual({ ok: true });
    expect(configs).toEqual([
      { config: { credentials: "token" }, secrets: { token: "github_pat_example" } },
    ]);
    expect(listCodeHostConnections(ctx.db, ctx.secretBox).map((c) => c.config)).toEqual([{}]);
  });

  it("다시 확인은 gh 로그인이 있으면 토큰 없는 연결을 저장하고, 화면 상태에는 토큰을 담지 않는다", async () => {
    const { ctx } = context({ loggedIn: true });
    expect(await checkGitHubConnection(ctx, now)).toEqual({ ok: true });
    expect(
      listCodeHostConnections(ctx.db, ctx.secretBox).map((c) => [c.config, c.secrets]),
    ).toEqual([[{}, {}]]);
    const view = await loadGitHubAuthView(ctx);
    expect(view.source).toBe("gh");
    expect(view.tokenSaved).toBe(false);
    expect(JSON.stringify(view)).not.toContain("gho_SECRETcheck1");
  });

  it("다시 확인은 GitHub가 거절하면 저장하지 않고 이유를 돌려준다", async () => {
    const { ctx, codeHost } = context({ loggedIn: true });
    codeHost.connection = { ok: false, error: { kind: "unauthorized" } };
    expect(await checkGitHubConnection(ctx, now)).toEqual({ ok: false, reason: "unauthorized" });
    expect(listCodeHostConnections(ctx.db, ctx.secretBox)).toEqual([]);
  });

  it("gh 로그인도 토큰도 없으면 no-credentials, 토큰만 있으면 토큰으로 확인한다", async () => {
    const { ctx } = context({ loggedIn: false });
    expect(await checkGitHubConnection(ctx, now)).toEqual({
      ok: false,
      reason: "no-credentials",
    });
    await saveGitHubToken(ctx, { token: "github_pat_example" }, now);
    expect(await checkGitHubConnection(ctx, now)).toEqual({ ok: true });
    expect((await loadGitHubAuthView(ctx)).source).toBe("token");
  });
});

describe("만료된 gh 계정과 PR 읽기 진단 (0207)", () => {
  const withExpired: GitHubAuthView = {
    cli: {
      kind: "logged-in",
      multiAccount: true,
      accounts: [
        { login: "jane-doe", active: false, expired: false, owners: ["jane-doe"] },
        { login: "acme-old", active: true, expired: true, owners: null },
      ],
    },
    tokenSaved: false,
    source: "gh",
  };

  it("만료된 계정은 흐리게 로그인이 만료됐다고 보이고 볼 수 있는 곳을 말하지 않는다", () => {
    const html = panel(withExpired);
    const shown = text(html);
    expect(shown).toContain("gh로 연결했어요");
    expect(shown).toContain("jane-doe 볼 수 있는 곳 · jane-doe");
    expect(shown).toContain("acme-old 활성 로그인이 만료됐어요");
    expect(shown).not.toContain("acme-old 활성 볼 수 있는 곳");
  });

  it("모든 계정이 만료됐으면 다시 로그인하라고 gh auth login 명령을 보인다", () => {
    const html = panel(
      {
        cli: {
          kind: "logged-in",
          multiAccount: true,
          accounts: [{ login: "acme-old", active: true, expired: true, owners: null }],
        },
        tokenSaved: false,
        source: "none",
      },
      false,
    );
    const shown = text(html);
    expect(shown).toContain("gh 계정의 로그인이 모두 만료됐어요");
    expect(shown).not.toContain("gh로 연결했어요");
    expect(html).toContain(">gh auth login</pre>");
    expect(shown).toContain("acme-old 활성 로그인이 만료됐어요");
    expect(buttonsOf(html).find((b) => b.label === "확인하고 저장")?.variant).toBe("primary");
  });

  it("PR을 읽지 못한 러너마다 런 수와 러너·서버 계정 진단을 보인다", () => {
    const shown = text(
      panel({
        ...withExpired,
        prReadDiagnoses: [
          {
            runs: 2,
            diagnosis: {
              kind: "different",
              runner: "runner-a",
              runnerLogin: "acme-dev",
              server: { kind: "gh", logins: ["jane-doe"] },
            },
          },
          {
            runs: 1,
            diagnosis: {
              kind: "runner-unknown",
              runner: "runner-b",
              server: { kind: "gh", logins: ["jane-doe"] },
            },
          },
        ],
      }),
    );
    expect(shown).toContain("PR을 읽지 못한 러너");
    expect(shown).toContain(
      "런 2개 · 러너(runner-a)는 acme-dev, 서버는 jane-doe 계정으로 읽어요. 서버 계정이 그 저장소를 볼 수 없어요.",
    );
    expect(shown).toContain("런 1개 · 서버는 jane-doe 계정으로 읽어요. 러너(runner-b)의 gh 계정을");
    expect(text(panel(withExpired))).not.toContain("PR을 읽지 못한 러너");
  });

  it("서버 상태는 만료된 계정만 있으면 gh로 연결했다고 하지 않고 다시 확인도 gh 를 쓰지 않는다", async () => {
    const { ctx } = context({ loggedIn: false, expired: true });
    const view = await loadGitHubAuthView(ctx);
    expect(view.source).toBe("none");
    expect(view.cli).toMatchObject({ kind: "logged-in", accounts: [{ login: "acme-old" }] });
    expect(await checkGitHubConnection(ctx, now)).toEqual({ ok: false, reason: "no-credentials" });
    expect(JSON.stringify(view)).not.toContain("gho_");
  });

  it("저장소를 볼 수 없어 PR을 읽지 못한 런의 러너를 서버 계정과 견줘 진단을 싣는다", async () => {
    const { db } = seedDatabase();
    const ctx = { ...context({ loggedIn: true }).ctx, db };
    const runnerId = toRunnerId("runner-a");
    recordGhAccounts(db, {
      runnerId,
      readAt: now,
      reading: {
        kind: "logged-in",
        accounts: [{ host: "github.com", login: "acme-dev", active: true, expired: false }],
      },
    });
    const ended = listRuns(db, { states: ["ended"] }).filter((run) => run.runnerId === runnerId);
    expect(ended.length).toBeGreaterThan(1);
    for (const run of ended.slice(0, 2)) {
      db.$client
        .prepare(`UPDATE runs SET pr_state = 'unknown', pr_read_error = 'no-access' WHERE id = ?`)
        .run(run.id);
    }
    const view = await loadGitHubAuthView(ctx);
    expect(view.prReadDiagnoses).toEqual([
      {
        runs: 2,
        diagnosis: {
          kind: "different",
          runner: "runner-a",
          runnerLogin: "acme-dev",
          server: { kind: "gh", logins: ["acme-bot"] },
        },
      },
    ]);
  });
});
