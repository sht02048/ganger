import {
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { RunnerHealth, RunnerId, TrackerConnectionId } from "@ganger/core";
import { FakeCodeHost, FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  assignRun,
  completeRunnerCheckRequest,
  listPendingRunnerCheckRequests,
  listRunners,
  listTrackerConnections,
  migrate,
  openDatabase,
  recordMcpAction,
  recordRunnerCheck,
  saveRunner,
  saveWorkspace,
  schema,
  toWorkspaceId,
} from "@ganger/db";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { GANGER_YELLOW_HEX } from "@ganger/ui/brand-color";
import { serverMcpLaunch } from "../server/mcp-launch";
import { installPowerSettings } from "../server/power-settings";
import { labeledTimesOf } from "../testing/labeled-times";
import { renderWithMessages } from "../testing/render";
import {
  addTrackerProject,
  briefInput,
  createAutoAssignLabel,
  mappingStateInput,
  removeTrackerProject,
  saveMappingState,
  requestRunnerCheckSetting,
  saveBrief,
  saveGeneral,
  saveAddresses,
  saveGitHubToken,
  saveInProgressState,
  saveLabel,
  saveMappingSetting,
  saveMergedState,
  saveRunnerSetting,
  runnerInput,
  saveTrackerConnectionSetting,
  trackerConnectionInput,
  mappingInput,
  powerInput,
  saveMcpWriteSetting,
  savePowerSetting,
} from "@ganger/app/settings/actions";
import { hasPendingRunnerChecks, loadSettingsPage } from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import { settingsMessages } from "./messages";
import type { GitHubAuthView, SettingsPage } from "@ganger/app/settings/model";
import { jsonConfig } from "@ganger/app/settings/mcp-launch";
import { McpScreen } from "./mcp-screen";
import { BriefPreview } from "./workspace-brief";
import settingsJson from "../../messages/ko/settings.json" with { type: "json" };
import { ProjectDetailScreen, findBoundProject } from "./project-detail";
import { ConnectionsScreen } from "./connections-page";
import { ProjectCandidates, ProjectsScreen } from "./projects-page";
import { ServerScreen } from "./server-page";
import { SettingsPagesNav, pageProblems, settingsNavState } from "./settings-frame";
import {
  plainSettingsLink,
  projectRowId,
  settingsHref,
  settingsTargetOf,
  type SettingsPageId,
} from "./settings-page";
import { GeneralScreen } from "./workspace-pages";
import { RunnerCheck, RunnerForm, nameFromSshTarget, sshCheckCommand } from "./settings-screen";
import type { ProjectDetailActions } from "./settings-screen";

const now = new Date("2026-11-17T09:00:00Z");
const commerce = toWorkspaceId("ws-commerce");
const labs = toWorkspaceId("ws-labs");
const webProject = toTrackerProjectId("tp-web");
const labProject = toTrackerProjectId("tp-lab");
const repo = toRunnerProjectId("github:acme/web");

interface Fixture {
  context: SettingsContext;
  tracker: FakeTracker;
  codeHost: FakeCodeHost;
  trackerConfigs: unknown[];
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  saveWorkspace(db, { id: commerce, name: "Acme Commerce" }, now);
  saveWorkspace(db, { id: labs, name: "Acme Labs" }, new Date(now.getTime() + 1));

  const tracker = new FakeTracker(toTrackerKind("fake"));
  tracker.projects.push(
    { id: webProject, name: "Web", url: "https://tracker.example.com/web" },
    { id: labProject, name: "Lab", url: "https://tracker.example.com/lab" },
  );
  tracker.states.set(webProject, [
    { id: toTrackerStateId("st-todo"), name: "Todo", category: "unstarted" },
    { id: toTrackerStateId("st-doing"), name: "In Progress", category: "started" },
  ]);
  tracker.labels.set(webProject, [{ id: toLabelId("lb-auto"), name: "factory" }]);
  const codeHost = new FakeCodeHost(toCodeHostKind("fake-host"));
  const trackerConfigs: unknown[] = [];
  const registry = new AdapterRegistry()
    .registerTracker({
      kind: tracker.kind,
      create: (config) => {
        trackerConfigs.push(config);
        return tracker;
      },
    })
    .registerCodeHost({ kind: codeHost.kind, create: () => codeHost });

  return {
    context: { db, secretBox: new SecretBox(new Uint8Array(32).fill(7)), registry },
    tracker,
    codeHost,
    trackerConfigs,
  };
}

async function addConnection(f: Fixture): Promise<TrackerConnectionId> {
  const saved = await saveTrackerConnectionSetting(
    f.context,
    { name: "Acme", apiKey: "lin_api_example", webhookSecret: "whsec_example" },
    now,
  );
  expect(saved).toEqual({ ok: true });
  const connection = listTrackerConnections(f.context.db, f.context.secretBox)[0];
  if (connection === undefined) throw new Error("no connection");
  return connection.id;
}

function addRunner(f: Fixture): RunnerId {
  const saved = saveRunnerSetting(
    f.context,
    {
      name: "runner-a",
      sshTarget: "factory@runner-a.example.com",
      orcaPath: "/usr/local/bin/orca",
      capacity: 3,
    },
    now,
  );
  if (!saved.ok) throw new Error(saved.reason);
  const id = listRunners(f.context.db)[0]?.id;
  if (id === undefined) throw new Error("no runner");
  return id;
}

const noopActions: ProjectDetailActions = {
  saveGeneral: () => Promise.resolve({ ok: true }),
  saveBrief: () => Promise.resolve({ ok: true }),
  addProject: () => Promise.resolve({ ok: true }),
  removeProject: () => Promise.resolve({ ok: true }),
  saveMapping: () => Promise.resolve({ ok: true }),
  saveInProgress: () => Promise.resolve({ ok: true }),
  saveMergedState: () => Promise.resolve({ ok: true }),
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

const TOKEN_ONLY_VIEW: GitHubAuthView = {
  cli: { kind: "missing" },
  tokenSaved: true,
  source: "token",
};

type PageKind = "general" | "projects" | "connections" | "server";

function renderPage(kind: PageKind, page: SettingsPage, github?: GitHubAuthView): string {
  const ws = page.workspace?.general.id;
  const view = page.workspace === null ? "all" : "one";
  const common = { page, actions: noopActions, nav: null };
  const workspace = { ...common, workspaceView: view, onCreateWorkspace: () => {} } as const;
  const screens: Record<PageKind, () => ReactNode> = {
    general: () => <GeneralScreen {...workspace} />,
    projects: () => <ProjectsScreen {...workspace} renderLink={plainSettingsLink(ws)} />,
    connections: () => (
      <ConnectionsScreen
        {...common}
        setup={{ funnel: null }}
        github={github}
        renderLink={plainSettingsLink(ws)}
      />
    ),
    server: () => (
      <ServerScreen
        {...common}
        logs={{ available: false }}
        logActions={{
          openFolder: null,
          saveDebug: () => Promise.resolve({ ok: true }),
          makeDiagnostics: () => Promise.resolve({ ok: false, reason: "unknown" }),
        }}
      />
    ),
  };
  return renderWithMessages(screens[kind](), settingsMessages);
}

function renderNav(page: SettingsPage, current: SettingsPageId, desktop = false): string {
  return renderWithMessages(
    <SettingsPagesNav
      current={current}
      state={settingsNavState(page, desktop)}
      renderLink={plainSettingsLink(page.workspace?.general.id)}
    />,
    settingsMessages,
  );
}

function renderProject(page: SettingsPage, connectionId: string, projectId: string): string {
  return renderWithMessages(
    <ProjectDetailScreen
      page={page}
      connectionId={connectionId}
      projectId={projectId}
      actions={noopActions}
      onRemoved={() => {}}
      renderLink={plainSettingsLink(page.workspace?.general.id)}
      nav={null}
    />,
    settingsMessages,
  );
}

function renderMcp(page: SettingsPage): string {
  return renderWithMessages(
    <McpScreen mcp={page.install.mcp} actions={noopActions} nav={null} />,
    settingsMessages,
  );
}

function renderRunnerCheck(page: SettingsPage): string {
  const runner = page.install.runners[0];
  if (runner === undefined) throw new Error("no runner");
  return renderWithMessages(
    <RunnerCheck runner={runner} actions={noopActions} workerSilent={false} />,
    settingsMessages,
  );
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ");
}

function sectionOf(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  if (start === -1) throw new Error(`no section ${id}`);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}

describe("Settings 저장하고 다시 열기", () => {
  it("각 설정을 저장하고 다시 열면 같은 값이 보인다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const runnerId = addRunner(f);
    recordRunnerCheck(f.context.db, {
      runnerId,
      online: true,
      checkedAt: now,
      error: null,
      projects: [{ id: repo, displayName: "acme/web", setupState: "ready" }],
      assignmentBlocked: false,
    });

    const ws = commerce;
    const project = { ws, connectionId: connection, projectId: webProject };
    expect(saveGeneral(f.context, { ws, name: "Acme Store", maxRunMinutes: 90 })).toEqual({
      ok: true,
    });
    expect(addTrackerProject(f.context, { ...project, name: "Web" })).toEqual({ ok: true });
    expect(
      saveMappingSetting(f.context, {
        ...project,
        runnerProjectId: repo,
        agentId: "codex",
        model: "gpt-example",
      }),
    ).toEqual({ ok: true });
    expect(saveInProgressState(f.context, { ...project, stateId: "st-doing" })).toEqual({
      ok: true,
    });
    expect(saveMergedState(f.context, { ...project, stateId: "st-done" })).toEqual({ ok: true });
    expect((await loadSettingsPage(f.context, ws, now)).workspace?.bound[0]?.mergedStateId).toBe(
      "st-done",
    );
    expect(saveMergedState(f.context, { ...project, stateId: null })).toEqual({ ok: true });
    expect(
      (await loadSettingsPage(f.context, ws, now)).workspace?.bound[0]?.mergedStateId,
    ).toBeNull();
    expect(saveMergedState(f.context, { ...project, stateId: "st-todo" })).toEqual({ ok: true });
    expect(saveLabel(f.context, { ws, connectionId: connection, labelId: "lb-auto" })).toEqual({
      ok: true,
    });

    const page = await loadSettingsPage(f.context, ws, now);
    expect(page.workspace?.general).toMatchObject({
      id: ws,
      name: "Acme Store",
      maxRunMinutes: 90,
      brief: { before: "", after: "" },
    });
    expect(page.workspace?.trackerProjects).toEqual([
      {
        connection: { id: connection, name: "Acme" },
        error: null,
        projects: [
          { id: webProject, name: "Web", owner: { kind: "this" }, mappings: 1, queuedRuns: 0 },
          { id: labProject, name: "Lab", owner: { kind: "free" }, mappings: 0, queuedRuns: 0 },
        ],
      },
    ]);
    expect(page.workspace?.bound).toEqual([
      {
        connection: { id: connection, name: "Acme" },
        trackerKind: "fake",
        project: { id: webProject, name: "Web" },
        mapping: {
          agent: "codex",
          model: "gpt-example",
          repos: [{ id: repo, isDefault: true, labelId: null }],
        },
        inProgressStateId: "st-doing",
        mergedStateId: "st-todo",
        states: {
          ok: true,
          items: [
            { id: "st-todo", name: "Todo" },
            { id: "st-doing", name: "In Progress" },
          ],
        },
        labels: { ok: true, items: [{ id: "lb-auto", name: "factory" }] },
      },
    ]);
    expect(page.workspace?.labels).toEqual([
      {
        connection: { id: connection, name: "Acme" },
        labelId: "lb-auto",
        labels: { ok: true, items: [{ id: "lb-auto", name: "factory" }] },
        repoLabels: [],
      },
    ]);
    expect(page.install.connections).toEqual([
      {
        id: connection,
        name: "Acme",
        hasWebhookSecret: true,
        webhookPath: `/api/webhooks/tracker/${connection}`,
        webhook: { kind: "waiting" },
        webhookSettingsUrl: null,
      },
    ]);
    expect(page.install.githubToken).toBe(true);
    expect(page.install.runners).toEqual([
      {
        id: runnerId,
        name: "runner-a",
        sshTarget: "factory@runner-a.example.com",
        orcaPath: "/usr/local/bin/orca",
        access: "manual",
        capacity: 3,
        check: { status: "pending", requestedAt: now.toISOString(), requestedAgoMs: 0 },
      },
    ]);
    expect(page.runnerProjects).toEqual([{ id: repo, name: "acme/web" }]);

    const general = renderPage("general", page);
    expect(textOf(general)).toContain("Acme Store");
    expect(general).toMatch(/name="maxRunMinutes"[^>]*value="90"/);
    const projects = textOf(renderPage("projects", page));
    expect(projects).toContain("Web");
    expect(projects).toContain("acme/web · Codex");
    expect(projects).toContain(settingsJson.projects.autoLabel);
    expect(projects).not.toContain(settingsJson.projects.autoLabelNone);
    const detail = renderProject(page, connection, webProject);
    expect(detail).toContain("acme/web");
    expect(textOf(detail)).toContain("In Progress");
    expect(textOf(detail)).toContain("트래커 티켓 상태");
    expect(detail).toMatch(
      /role="tooltip"[^>]*hidden=""[^>]*>런이 바뀔 때 트래커 티켓 상태를 같이 바꿔요/,
    );
    const workspaceSettings = page.workspace;
    if (workspaceSettings === null) throw new Error("no workspace");
    const onLinear = renderProject(
      {
        ...page,
        workspace: {
          ...workspaceSettings,
          bound: workspaceSettings.bound.map((b) => ({ ...b, trackerKind: "linear" })),
        },
      },
      connection,
      webProject,
    );
    expect(textOf(onLinear)).toContain("Linear 티켓 상태");
    expect(textOf(detail)).toContain("런이 시작되면");
    expect(textOf(detail)).toContain("PR이 머지되면");
    expect(textOf(detail)).not.toContain(settingsJson.projects.autoLabel);
    expect(detail).toContain('value="gpt-example"');
    const runner = page.install.runners[0];
    if (runner === undefined) throw new Error("no runner");
    const runnerForm = renderWithMessages(
      <RunnerForm runner={runner} actions={noopActions} />,
      settingsMessages,
    );
    expect(runnerForm).toContain('value="factory@runner-a.example.com"');
    expect(runnerForm).toContain('value="/usr/local/bin/orca"');
    expect(runnerForm).toContain('value="3"');
  });

  it("토큰은 암호화해 저장하고 화면 값에 담지 않는다", async () => {
    const f = fixture();
    await addConnection(f);
    await saveGitHubToken(f.context, { token: "github_pat_example" }, now);
    const raw = JSON.stringify([
      f.context.db.select().from(schema.trackerConnections).all(),
      f.context.db.select().from(schema.codeHostConnections).all(),
    ]);
    expect(raw).not.toContain("lin_api_example");
    expect(raw).not.toContain("whsec_example");
    expect(raw).not.toContain("github_pat_example");

    const page = JSON.stringify(await loadSettingsPage(f.context, commerce, now));
    expect(page).not.toContain("lin_api_example");
    expect(page).not.toContain("github_pat_example");
  });

  it("비밀값 칸을 비우고 저장하면 저장한 값을 그대로 쓴다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { id, name: "Acme HQ", apiKey: "", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    expect(listTrackerConnections(f.context.db, f.context.secretBox)).toEqual([
      expect.objectContaining({
        id,
        name: "Acme HQ",
        secrets: { apiKey: "lin_api_example", webhookSecret: "whsec_example" },
      }),
    ]);
  });

  it("이름 없이 저장하면 연결 이름을 트래커 조직 이름으로, 조직 이름이 없으면 Linear로 정한다", async () => {
    const f = fixture();
    f.tracker.connection = { ok: true, organizationName: "Acme" };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_example", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    f.tracker.connection = { ok: true, organizationName: null };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_other", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    f.tracker.connection = { ok: true, organizationName: "   " };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_blank", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    f.tracker.connection = { ok: true, organizationName: `  ${"가😀".repeat(150)}  ` };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_long", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    const saved = listTrackerConnections(f.context.db, f.context.secretBox);
    expect(saved.map((c) => c.name).toSorted()).toEqual([
      "Acme",
      "Linear",
      "Linear",
      "가😀".repeat(100),
    ]);

    const long = saved.find((c) => c.name.startsWith("가"));
    if (long === undefined) throw new Error("no long connection");
    const resubmitted = trackerConnectionInput.parse({
      id: long.id,
      name: long.name,
      apiKey: "",
      webhookSecret: "",
    });
    expect(await saveTrackerConnectionSetting(f.context, resubmitted, now)).toEqual({ ok: true });
    expect(
      trackerConnectionInput.safeParse({
        name: `${long.name}가`,
        apiKey: "",
        webhookSecret: "",
      }).success,
    ).toBe(false);

    const id = saved.find((c) => c.name === "Acme")?.id ?? "";
    f.tracker.connection = { ok: true, organizationName: "Acme Renamed" };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { id, apiKey: "lin_api_rotated", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    expect(
      listTrackerConnections(f.context.db, f.context.secretBox).find((c) => c.id === id)?.name,
    ).toBe("Acme");
  });

  it("연결 확인에 실패하면 트래커 연결과 GitHub 토큰을 저장하지 않는다", async () => {
    const f = fixture();
    f.tracker.connection = { ok: false, error: { kind: "unauthorized" } };
    f.codeHost.connection = { ok: false, error: { kind: "unauthorized" } };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { name: "Acme", apiKey: "wrong", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: false, reason: "unauthorized" });
    expect(await saveGitHubToken(f.context, { token: "wrong" }, now)).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    const page = await loadSettingsPage(f.context, commerce, now);
    expect(page.install.connections).toEqual([]);
    expect(page.install.githubToken).toBe(false);
    expect(f.trackerConfigs).toEqual([
      { config: {}, secrets: { apiKey: "wrong", webhookSecret: null } },
    ]);
  });

  it("GitHub 연결이 없으면 연결 구역에 문제로 보이고 gh 로그인이나 토큰을 안내하며 보기 버튼을 둔다 (0204)", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, commerce, now);
    const none: GitHubAuthView = {
      cli: { kind: "logged-out", multiAccount: true },
      tokenSaved: false,
      source: "none",
    };
    const connections = renderPage("connections", page, none);
    expect(textOf(connections)).toContain(
      "연결하지 않았어요. 이 서버 기계에서 gh auth login 을 하거나 토큰을 붙여 넣어 주세요",
    );
    expect(connections).toMatch(
      /<button[^>]*aria-label="gh 로그인 계정 보기"[^>]*>계정 보기<\/button>/,
    );
    expect(connections).toMatch(
      /<button[^>]*aria-label="GitHub 토큰 넣기"[^>]*>토큰 넣기<\/button>/,
    );
    expect(textOf(connections)).toContain(settingsJson.github.tokenNone);
    expect(connections).toContain('aria-label="토큰 도움말"');
    expect(pageProblems(page).has("connections")).toBe(true);
    expect(connections).not.toContain('type="password"');
    expect(textOf(renderPage("connections", page))).toContain("gh 로그인을 확인하는 중…");
  });

  it("GitHub 줄은 지금 쓰는 출처를 보인다: gh 계정, 붙여 넣은 토큰 (0204)", async () => {
    const f = fixture();
    await saveGitHubToken(f.context, { token: "github_pat_example" }, now);
    const page = await loadSettingsPage(f.context, commerce, now);
    expect(page.install.githubToken).toBe(true);
    const gh = (count: number): GitHubAuthView => ({
      cli: {
        kind: "logged-in",
        multiAccount: true,
        accounts: [
          { login: "acme-bot", active: true, owners: ["acme"] },
          ...(count > 1 ? [{ login: "jane-doe", active: false, owners: ["jane-labs"] }] : []),
        ],
      },
      tokenSaved: true,
      source: "gh",
    });
    expect(textOf(renderPage("connections", page, gh(1)))).toContain("gh로 연결했어요 acme-bot");
    expect(textOf(renderPage("connections", page, gh(2)))).toContain(
      "gh로 연결했어요 acme-bot · jane-doe",
    );
    const tokenOnly = renderPage("connections", page, TOKEN_ONLY_VIEW);
    expect(textOf(tokenOnly)).toContain("붙여 넣은 토큰으로 연결했어요");
    expect(tokenOnly).toMatch(/>토큰 바꾸기<\/button>/);
    expect(tokenOnly).not.toContain("github_pat_example");
    const fresh = await loadSettingsPage(fixture().context, commerce, now);
    expect(textOf(renderPage("connections", fresh, gh(1)))).toContain(
      "gh 로그인이 있어요. 펼쳐서 다시 확인하면 연결해요",
    );
  });

  it("Mapping 에서 권한을 미리 허용하라고 안내하고 러너는 고르지 않는다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    addTrackerProject(f.context, {
      ws: commerce,
      connectionId: connection,
      projectId: webProject,
      name: "Web",
    });
    const page = await loadSettingsPage(f.context, commerce, now);
    const html = renderProject(page, connection, webProject);
    const text = textOf(html);
    expect(html).toContain('aria-label="저장소 도움말"');
    expect(html).toContain('<section id="agent"');
    expect(text).toContain("에이전트");
    expect(text).not.toContain("러너 이름");
    expect(text).toContain("모델");
    expect(text).toContain("러너 Orca의 기본값");
  });

  it("Mapping 의 모델은 비우면 정하지 않은 것으로 저장하고, 러너 CLI 옵션으로 읽힐 값은 받지 않는다(0043)", async () => {
    const f = fixture();
    const connectionId = await addConnection(f);
    const project = { ws: commerce, connectionId, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    const mapping = { ...project, runnerProjectId: repo, agentId: "claude" };
    const saved = async () =>
      (await loadSettingsPage(f.context, commerce, now)).workspace?.bound[0];

    expect(saveMappingSetting(f.context, { ...mapping, model: "sonnet" })).toEqual({ ok: true });
    expect((await saved())?.mapping?.model).toBe("sonnet");
    expect(saveMappingSetting(f.context, { ...mapping, model: "" })).toEqual({ ok: true });
    expect((await saved())?.mapping?.model).toBeNull();

    expect(mappingInput.safeParse({ ...mapping, model: " sonnet " }).data?.model).toBe("sonnet");
    expect(mappingInput.safeParse(mapping).success).toBe(true);
    for (const model of ["--dangerously-skip-permissions", "a b", "a\u0001", "x".repeat(201)]) {
      expect({ model, ok: mappingInput.safeParse({ ...mapping, model }).success }).toEqual({
        model,
        ok: false,
      });
    }
  });
});

describe("Mapping 여러 저장소와 Auto-assign Label 만들기(0115)", () => {
  async function bound(f: Fixture) {
    const connectionId = await addConnection(f);
    const project = { ws: commerce, connectionId, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    return { connectionId, project };
  }

  it("저장소 목록을 한 번에 저장하고, 한 라벨을 두 저장소에 붙이면 거절한다", async () => {
    const f = fixture();
    const { project } = await bound(f);
    const state = {
      ...project,
      agentId: "claude",
      model: "",
      repos: [
        { runnerProjectId: "github:acme/web", isDefault: true, labelId: null },
        { runnerProjectId: "github:acme/api", isDefault: false, labelId: "lb-api" },
      ],
    };
    expect(saveMappingState(f.context, mappingStateInput.parse(state))).toEqual({ ok: true });
    expect(
      saveMappingState(
        f.context,
        mappingStateInput.parse({
          ...state,
          repos: [
            ...state.repos,
            { runnerProjectId: "github:acme/infra", isDefault: false, labelId: "lb-api" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "label-in-use" });
    saveLabel(f.context, { ws: commerce, connectionId: project.connectionId, labelId: "lb-auto" });
    expect(
      saveMappingState(
        f.context,
        mappingStateInput.parse({
          ...state,
          repos: [
            state.repos[0],
            { runnerProjectId: "github:acme/api", isDefault: false, labelId: "lb-auto" },
          ],
        }),
      ),
    ).toEqual({ ok: false, reason: "auto-assign-label" });
    expect(
      saveLabel(f.context, { ws: commerce, connectionId: project.connectionId, labelId: "lb-api" }),
    ).toEqual({ ok: false, reason: "repo-label" });
    const page = await loadSettingsPage(f.context, commerce, now);
    expect(page.workspace?.bound[0]?.mapping?.repos).toEqual([
      { id: "github:acme/web", isDefault: true, labelId: null },
      { id: "github:acme/api", isDefault: false, labelId: "lb-api" },
    ]);
    expect(mappingStateInput.safeParse({ ...state, repos: [] }).success).toBe(false);
  });

  it("ganger 라벨이 없으면 Ganger Yellow로 만들어 고르고, 있으면 만들지 않고 그것을 고른다", async () => {
    const f = fixture();
    const { connectionId } = await bound(f);

    const created = await createAutoAssignLabel(
      f.context,
      { ws: commerce, connectionId },
      GANGER_YELLOW_HEX,
    );
    expect(created).toEqual({
      ok: true,
      labelId: "label-created-1",
      name: "ganger",
      created: true,
    });
    expect(f.tracker.createdLabels).toEqual([
      { label: { id: "label-created-1", name: "ganger" }, color: GANGER_YELLOW_HEX },
    ]);

    const again = await createAutoAssignLabel(
      f.context,
      { ws: commerce, connectionId },
      GANGER_YELLOW_HEX,
    );
    expect(again).toEqual({ ok: true, labelId: "label-created-1", name: "ganger", created: false });
    expect(f.tracker.createdLabels).toHaveLength(1);
    const page = await loadSettingsPage(f.context, commerce, now);
    expect(page.workspace?.labels[0]?.labelId).toBe("label-created-1");
  });

  it("트래커가 라벨 만들기를 거절하면 저장하지 않고 이유를 돌려준다", async () => {
    const f = fixture();
    const { connectionId } = await bound(f);
    f.tracker.createLabel = () => Promise.reject(new Error("Only admins can create labels"));

    expect(
      await createAutoAssignLabel(f.context, { ws: commerce, connectionId }, GANGER_YELLOW_HEX),
    ).toEqual({ ok: false, reason: "rejected" });
    expect((await loadSettingsPage(f.context, commerce, now)).workspace?.labels[0]?.labelId).toBe(
      null,
    );
  });
});

describe("Settings 페이지 주소(0214)", () => {
  it("페이지마다 자기 주소가 있고 ws 와 줄 id 를 붙인다", () => {
    expect(settingsHref({ kind: "page", page: "connections" }, "ws-a")).toBe(
      "/settings/connections?ws=ws-a",
    );
    expect(
      settingsHref({ kind: "page", page: "projects", rowId: projectRowId("c1", "p1") }, undefined),
    ).toBe("/settings/projects#project-c1-p1");
    expect(settingsHref({ kind: "page", page: "notifications" }, undefined)).toBe(
      "/settings/notifications",
    );
  });

  it("/settings 는 일반으로, Workspace 가 없거나 전체 보기면 연결로 보낸다", () => {
    expect(settingsTargetOf("", "one")).toEqual({ kind: "page", page: "general" });
    expect(settingsTargetOf("", "all")).toEqual({ kind: "page", page: "connections" });
    expect(settingsTargetOf("", "none")).toEqual({ kind: "page", page: "connections" });
  });

  it("예전 /settings#구역 링크는 그 설정이 옮겨 간 페이지로 보낸다", () => {
    expect(settingsTargetOf("#connections", "one")).toEqual({ kind: "page", page: "connections" });
    expect(settingsTargetOf("projects", "one")).toEqual({ kind: "page", page: "projects" });
    expect(settingsTargetOf("#workspace", "one")).toEqual({ kind: "page", page: "general" });
    expect(settingsTargetOf("#server", "one")).toEqual({ kind: "page", page: "server" });
    expect(settingsTargetOf("#logs", "one")).toEqual({ kind: "page", page: "server" });
    expect(settingsTargetOf("#devices", "one")).toEqual({ kind: "page", page: "mobile" });
    expect(settingsTargetOf("#advanced", "one")).toEqual({ kind: "page", page: "mcp" });
    expect(settingsTargetOf("#mcp-row", "one")).toEqual({ kind: "page", page: "mcp" });
    expect(settingsTargetOf("#web-address-row", "one")).toEqual({ kind: "page", page: "mobile" });
    expect(settingsTargetOf("#connection-c1", "one")).toEqual({
      kind: "connection",
      connectionId: "c1",
    });
    expect(settingsTargetOf("#project-c1-p1", "one")).toEqual({
      kind: "page",
      page: "projects",
      rowId: "project-c1-p1",
    });
    expect(settingsTargetOf("#toString", "one")).toEqual({ kind: "page", page: "general" });
    expect(settingsTargetOf("#%E0%A4%A", "one")).toEqual({ kind: "page", page: "general" });
    expect(settingsTargetOf("#%E0%A4%A", "all")).toEqual({ kind: "page", page: "connections" });
  });
});

describe("주소(0048)", () => {
  const local = { host: "127.0.0.1:3000", bindHost: "127.0.0.1" };

  it("두 주소를 origin 으로 저장하고 다시 열면 보인다. 비우면 정하지 않음이다", async () => {
    const f = fixture();
    expect((await loadSettingsPage(f.context, undefined, now)).install.addresses).toEqual({
      webAddress: null,
      webhookAddress: null,
      webhookAddressChecked: false,
      autoAllowedHosts: [],
    });
    expect(
      saveAddresses(
        f.context,
        {
          webAddress: "https://Server.example.ts.net/",
          webhookAddress: "https://hooks.example.com",
        },
        now,
        local,
      ),
    ).toEqual({ ok: true });
    const page = await loadSettingsPage(f.context, undefined, now);
    expect(page.install.addresses).toEqual({
      webAddress: "https://server.example.ts.net",
      webhookAddress: "https://hooks.example.com",
      webhookAddressChecked: false,
      autoAllowedHosts: [],
    });
    expect(textOf(renderPage("server", page))).not.toContain("https://server.example.ts.net");

    expect(saveAddresses(f.context, { webAddress: "", webhookAddress: "" }, now, local)).toEqual({
      ok: true,
    });
    expect((await loadSettingsPage(f.context, undefined, now)).install.addresses).toEqual({
      webAddress: null,
      webhookAddress: null,
      webhookAddressChecked: false,
      autoAllowedHosts: [],
    });
  });

  it("와일드카드 바인드면 tailnet 주소를 자동으로 허용하고, 그 주소로 연 화면은 저장해도 막히지 않는다", async () => {
    const f = fixture();
    const tailnetHosts = ["server.example.ts.net", "100.64.0.10"];
    const page = await loadSettingsPage(
      { ...f.context, autoAllowedHosts: tailnetHosts },
      undefined,
      now,
    );
    expect(page.install.addresses.autoAllowedHosts).toEqual(tailnetHosts);
    const from = { host: "server.example.ts.net:3000", bindHost: "0.0.0.0", webPort: 3000 };
    const input = { webAddress: "", webhookAddress: "" };
    expect(saveAddresses(f.context, input, now, { ...from, tailnetHosts })).toEqual({ ok: true });
    expect(saveAddresses(f.context, input, now, from)).toEqual({ ok: false, reason: "locks-out" });
    expect(
      saveAddresses(f.context, input, now, {
        ...from,
        host: "server.example.ts.net:8443",
        tailnetHosts,
      }),
    ).toEqual({ ok: false, reason: "locks-out" });
  });

  it("경로·사용자 정보가 붙거나 http·https 가 아닌 주소는 받지 않는다", () => {
    const f = fixture();
    for (const webAddress of [
      "server.example.ts.net",
      "https://server.example.ts.net/app",
      "ftp://x.example",
      "https://a:b@x.example",
      "https://my_host.example",
    ]) {
      expect(saveAddresses(f.context, { webAddress, webhookAddress: "" }, now, local)).toEqual({
        ok: false,
        reason: "invalid-web-address",
      });
    }
    expect(
      saveAddresses(
        f.context,
        { webAddress: "", webhookAddress: "https://hooks.example.com/?x=1" },
        now,
        local,
      ),
    ).toEqual({ ok: false, reason: "invalid-webhook-address" });
  });

  it("저장하면 지금 보는 화면의 주소가 막히는 값은 저장하지 않는다", async () => {
    const f = fixture();
    const remote = { host: "server.example.ts.net", bindHost: "127.0.0.1" };
    expect(
      saveAddresses(
        f.context,
        { webAddress: "https://other.example.ts.net", webhookAddress: "" },
        now,
        remote,
      ),
    ).toEqual({ ok: false, reason: "locks-out" });
    expect(
      (await loadSettingsPage(f.context, undefined, now)).install.addresses.webAddress,
    ).toBeNull();
    expect(
      saveAddresses(
        f.context,
        { webAddress: "https://server.example.ts.net", webhookAddress: "" },
        now,
        remote,
      ),
    ).toEqual({ ok: true });
    expect(
      saveAddresses(
        f.context,
        { webAddress: "https://other.example.ts.net", webhookAddress: "" },
        now,
        local,
      ),
    ).toEqual({ ok: true });
  });
});

describe("트래커 프로젝트는 Workspace 하나에만", () => {
  it("이미 다른 Workspace 에 묶인 트래커 프로젝트는 고를 수 없다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    expect(
      addTrackerProject(f.context, {
        ws: commerce,
        connectionId: connection,
        projectId: webProject,
        name: "Web",
      }),
    ).toEqual({ ok: true });

    expect(
      addTrackerProject(f.context, {
        ws: labs,
        connectionId: connection,
        projectId: webProject,
        name: "Web",
      }),
    ).toEqual({ ok: false, reason: "taken" });

    const page = await loadSettingsPage(f.context, labs, now);
    expect(page.workspace?.trackerProjects[0]?.projects).toEqual([
      {
        id: webProject,
        name: "Web",
        owner: { kind: "other", workspace: { id: commerce, name: "Acme Commerce" } },
        mappings: 0,
        queuedRuns: 0,
      },
      { id: labProject, name: "Lab", owner: { kind: "free" }, mappings: 0, queuedRuns: 0 },
    ]);
    const workspace = page.workspace;
    if (workspace === null) throw new Error("no workspace");
    const html = renderWithMessages(
      <ProjectCandidates workspace={workspace} actions={noopActions} onAdded={() => {}} />,
      settingsMessages,
    );
    const webRow = html.split("<li").find((chunk) => chunk.includes(">Web<")) ?? "";
    expect(webRow).toContain("Acme Commerce에 있어요");
    expect(webRow).toMatch(/<button[^>]*disabled/);
    const labRow = html.split("<li").find((chunk) => chunk.includes(">Lab<")) ?? "";
    expect(labRow).not.toMatch(/<button[^>]*disabled/);

    expect(
      removeTrackerProject(f.context, {
        ws: labs,
        connectionId: connection,
        projectId: webProject,
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("빼기 전에 함께 지워질 Mapping 과 그 Queued 런 수를 알고, 빼도 런 기록은 남는다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    const project = { ws: commerce, connectionId: connection, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    saveMappingSetting(f.context, { ...project, runnerProjectId: repo, agentId: "claude" });
    for (const key of ["ACME-1", "ACME-2"]) {
      const result = assignRun(f.context.db, {
        ticket: { connection, key: toTicketKey(key) },
        trackerProject: webProject,
        runnerProject: repo,
        agent: toAgentId("claude"),
        now,
      });
      expect(result.ok).toBe(true);
    }

    const before = await loadSettingsPage(f.context, commerce, now);
    expect(before.workspace?.trackerProjects[0]?.projects[0]).toMatchObject({
      id: webProject,
      mappings: 1,
      queuedRuns: 2,
    });
    const detail = renderProject(before, connection, webProject);
    expect(detail).toMatch(/<button[^>]*data-variant="danger"[^>]*>.*?Web 빼기.*?<\/button>/);
    expect(textOf(detail)).toContain("이 Workspace에서 빼기");

    expect(removeTrackerProject(f.context, project)).toEqual({ ok: true });
    const after = await loadSettingsPage(f.context, commerce, now);
    expect(after.workspace?.bound).toEqual([]);
    expect(after.workspace?.trackerProjects[0]?.projects[0]).toMatchObject({
      id: webProject,
      owner: { kind: "free" },
    });
    expect(f.context.db.select().from(schema.runs).all()).toHaveLength(2);
  });
});

describe("러너 확인", () => {
  const health = (overrides: Partial<RunnerHealth> = {}): RunnerHealth => ({
    online: true,
    version: "1.4.258",
    checkedAt: now,
    error: null,
    prerequisites: [
      {
        id: "orca-service",
        name: "Orca 상시 서비스",
        satisfied: true,
        hint: "orca serve service install",
        blocksAssignment: false,
      },
      {
        id: "push:acme/web",
        name: "acme/web GitHub 인증",
        satisfied: true,
        hint: null,
        blocksAssignment: true,
      },
    ],
    ...overrides,
  });

  async function checked(
    f: Fixture,
    runnerId: RunnerId,
    result: { result: RunnerHealth } | { error: string },
  ) {
    const pending = listPendingRunnerCheckRequests(f.context.db);
    const request = pending.find((p) => p.runnerId === runnerId);
    if (request === undefined) throw new Error("no pending request");
    expect(
      completeRunnerCheckRequest(f.context.db, {
        runnerId,
        requestedAt: request.requestedAt,
        completedAt: new Date(now.getTime() + 5000),
        ...result,
      }),
    ).toBe(true);
    return loadSettingsPage(f.context, commerce, now);
  }

  it("러너를 등록하면 확인 요청이 DB 에 생기고 기다리는 중으로 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    expect(listPendingRunnerCheckRequests(f.context.db)).toEqual([{ runnerId, requestedAt: now }]);
    expect(listRunners(f.context.db)[0]).toMatchObject({
      kind: "orca",
      config: { sshTarget: "factory@runner-a.example.com", orcaPath: "/usr/local/bin/orca" },
    });

    const later = new Date(now.getTime() + 60_000);
    expect(requestRunnerCheckSetting(f.context, { id: runnerId }, later)).toEqual({ ok: true });
    expect(listPendingRunnerCheckRequests(f.context.db)).toEqual([
      { runnerId, requestedAt: later },
    ]);
    const text = textOf(renderRunnerCheck(await loadSettingsPage(f.context, commerce, now)));
    expect(text).toContain("worker가 러너를 확인하고 있어요");
    expect(text).toContain("확인하는 중");
    expect(text).not.toContain("다시 확인");
  });

  it("기다리는 동안 읽는 요청 상태는 결과가 오면 거짓이 되고 트래커를 부르지 않는다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    expect(hasPendingRunnerChecks(f.context.db)).toBe(true);
    await checked(f, runnerId, { result: health() });
    expect(hasPendingRunnerChecks(f.context.db)).toBe(false);
    expect(f.trackerConfigs).toEqual([]);
  });

  it("러너를 고쳐 저장해도 Settings 가 고치지 않는 설정 키는 남긴다", () => {
    const f = fixture();
    const runnerId = addRunner(f);
    saveRunner(f.context.db, {
      id: runnerId,
      kind: toRunnerKind("orca"),
      name: "runner-a",
      config: {
        sshTarget: "factory@runner-a.example.com",
        orcaPath: "/usr/local/bin/orca",
        extra: 1,
      },
      capacity: 3,
    });
    const saved = saveRunnerSetting(
      f.context,
      {
        id: runnerId,
        name: "runner-a",
        sshTarget: "factory@a.example.com",
        orcaPath: "/opt/orca",
        capacity: 2,
      },
      now,
    );
    expect(saved).toEqual({ ok: true, runnerId });
    expect(listRunners(f.context.db)[0]?.config).toEqual({
      sshTarget: "factory@a.example.com",
      orcaPath: "/opt/orca",
      extra: 1,
    });
  });

  it("ssh 옵션으로 읽힐 대상(- 로 시작)과 공백이 든 대상은 받지 않는다", () => {
    const base = { name: "runner-a", orcaPath: "/usr/local/bin/orca", capacity: 1 };
    expect(
      runnerInput.safeParse({ ...base, sshTarget: "factory@runner-a.example.com" }).success,
    ).toBe(true);
    expect(runnerInput.safeParse({ ...base, sshTarget: "-oProxyCommand=touch x" }).success).toBe(
      false,
    );
    expect(runnerInput.safeParse({ ...base, sshTarget: "host other" }).success).toBe(false);
    expect(runnerInput.safeParse({ ...base, sshTarget: "host\u0001" }).success).toBe(false);
  });

  it("결과를 넣으면 성공이 보이고 필수 조건을 하나씩 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    const page = await checked(f, runnerId, { result: health() });
    expect(page.install.runners[0]?.check).toMatchObject({
      status: "done",
      online: true,
      version: "1.4.258",
    });
    const text = textOf(renderRunnerCheck(page));
    expect(text).toContain("러너에 닿았어요 · orca 1.4.258");
    expect(text).toContain("Orca 상시 서비스 갖췄어요");
    expect(text).toContain("acme/web GitHub 인증 갖췄어요");
    expect(text).not.toContain("해결 방법");
  });

  it("확인 시각은 서버가 읽은 때부터의 상대 시간이다(ADR 0010 7번)", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    await checked(f, runnerId, { result: health() });
    const later = await loadSettingsPage(
      f.context,
      commerce,
      new Date(now.getTime() + 25 * 60_000),
    );
    const check = later.install.runners[0]?.check;
    expect(check).toMatchObject({ status: "done", completedAgoMs: 25 * 60_000 - 5000 });
    const html = renderRunnerCheck(later);
    const checkedLabel = settingsJson.runners.check.checkedLabel;
    expect(labeledTimesOf(html)).toContainEqual(
      expect.objectContaining({ title: checkedLabel, hidden: checkedLabel, visible: "24 min ago" }),
    );
    expect(textOf(html)).not.toContain("24 min ago 확인");
  });

  it("GitHub 인증이 깨진 결과는 실패와 해결 방법을 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    const page = await checked(f, runnerId, {
      result: health({
        prerequisites: [
          {
            id: "orca-service",
            name: "Orca 상시 서비스",
            satisfied: false,
            hint: "orca serve service install",
            blocksAssignment: false,
          },
          {
            id: "push:acme/web",
            name: "acme/web GitHub 인증",
            satisfied: false,
            hint: null,
            blocksAssignment: true,
          },
        ],
      }),
    });
    const text = textOf(renderRunnerCheck(page));
    expect(text).toContain("Orca 상시 서비스 갖추지 못했어요");
    expect(text).toContain("orca serve service install");
    expect(text).toContain("acme/web GitHub 인증 갖추지 못했어요");
    expect(text).toContain("이 러너를 할당에서 뺐어요");
    expect(text).toContain("gh auth login --insecure-storage");
    expect(text).toContain("gh auth setup-git");
    expect(text).toContain("GitHub용 ssh 키");
  });

  it("runner-orca 의 확인 항목은 id 종류로 메시지를 골라 보이고 모르는 종류는 어댑터 이름을 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    recordRunnerCheck(f.context.db, {
      runnerId,
      online: true,
      checkedAt: now,
      error: null,
      projects: [{ id: repo, displayName: "acme/web", setupState: "ready" }],
      assignmentBlocked: true,
    });
    const page = await checked(f, runnerId, {
      result: health({
        prerequisites: [
          {
            id: "orca-service",
            name: "Orca background service",
            satisfied: false,
            hint: "/usr/local/bin/orca serve service install",
            blocksAssignment: false,
          },
          {
            id: `github-push:${repo}`,
            name: "GitHub push access: acme/web",
            satisfied: false,
            hint: "Run `gh auth login --insecure-storage` and `gh auth setup-git` on the runner.",
            blocksAssignment: true,
          },
          {
            id: "github-push:github:acme/gone",
            name: "GitHub push access: acme/gone",
            satisfied: true,
            hint: null,
            blocksAssignment: true,
          },
          {
            id: "disk-space",
            name: "Disk space",
            satisfied: true,
            hint: null,
            blocksAssignment: false,
          },
        ],
      }),
    });
    const text = textOf(renderRunnerCheck(page));
    expect(text).toContain("Orca 상시 서비스 갖추지 못했어요");
    expect(text).toContain("/usr/local/bin/orca serve service install");
    expect(text).toContain("GitHub push 권한: acme/web 갖추지 못했어요");
    expect(text).toContain("GitHub push 권한: github:acme/gone 갖췄어요");
    expect(text).toContain("Disk space 갖췄어요");
    expect(text).not.toContain("Orca background service");
    expect(text).not.toContain("GitHub push access");
    expect(text).not.toContain("Run `gh auth login");
    expect(text).toContain("gh auth login --insecure-storage");
  });

  it("프로젝트에만 걸린 push 실패도 실패 이유와 해결 안내를 보인다 (0096)", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    recordRunnerCheck(f.context.db, {
      runnerId,
      online: true,
      checkedAt: now,
      error: null,
      projects: [{ id: repo, displayName: "acme/web", setupState: "ready" }],
      assignmentBlocked: false,
    });
    const page = await checked(f, runnerId, {
      result: health({
        prerequisites: [
          {
            id: `github-push:${repo}`,
            name: "GitHub push access: acme/web",
            satisfied: false,
            hint: "Run `gh auth login --insecure-storage` and `gh auth setup-git` on the runner.",
            blocksAssignment: false,
            project: repo,
            failure: { kind: "auth", reason: "Permission to acme/web.git denied to someone." },
          },
        ],
      }),
    });
    const text = textOf(renderRunnerCheck(page));
    expect(text).toContain("GitHub push 권한: acme/web 갖추지 못했어요");
    expect(text).toContain("acme/web 인증 실패 · Permission to acme/web.git denied to someone.");
    expect(text).toContain("gh auth setup-git");
    expect(text).toContain("push가 안 되는 저장소의 티켓만 이 러너에 맡기지 않아요.");
    expect(text).not.toContain("이 조건이 깨져 이 러너를 할당에서 뺐어요");
  });

  it("러너에 닿지 않은 결과와 확인 오류를 실패로 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    const offline = await checked(f, runnerId, {
      result: health({
        online: false,
        version: null,
        error: { kind: "unreachable", detail: "ssh: connect timed out" },
      }),
    });
    expect(textOf(renderRunnerCheck(offline))).toContain("러너에 닿지 않았어요 (ssh로 닿지 않음)");

    requestRunnerCheckSetting(f.context, { id: runnerId }, new Date(now.getTime() + 10_000));
    const failed = await checked(f, runnerId, { error: "ssh failed" });
    expect(failed.install.runners[0]?.check).toMatchObject({
      status: "failed",
      error: "ssh failed",
    });
    expect(textOf(renderRunnerCheck(failed))).toContain("러너를 확인하지 못했어요. ssh failed");
  });
});

describe("Settings 화면", () => {
  it("메뉴는 Workspace · 이름, 설치 전체 묶음 아래 페이지 링크를 두고 지금 페이지를 표시한다(0214)", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, commerce, now);
    const html = renderNav(page, "connections");
    expect(html).toContain('<nav aria-label="Settings 메뉴"');
    expect(textOf(html)).toContain("Workspace · Acme Commerce");
    expect(textOf(html)).toContain("설치 전체");
    expect(textOf(html)).not.toContain("이 Mac");
    expect([...html.matchAll(/href="([^"?]+)\?ws=ws-commerce"/g)].map((m) => m[1])).toEqual([
      "/settings/general",
      "/settings/projects",
      "/settings/connections",
      "/settings/mobile",
      "/settings/server",
      "/settings/mcp",
    ]);
    expect(html).toMatch(/href="\/settings\/connections\?ws=ws-commerce"[^>]*aria-current="page"/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const desktop = renderNav(page, "notifications", true);
    expect(textOf(desktop)).toContain("이 Mac");
    expect(desktop).toMatch(
      /href="\/settings\/notifications\?ws=ws-commerce"[^>]*aria-current="page"/,
    );
  });

  it("문제가 있는 페이지만 메뉴에 점을 붙인다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    await saveGitHubToken(f.context, { token: "github_pat_example" }, now);
    addRunner(f);
    const project = { ws: commerce, connectionId: connection, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    const unmapped = await loadSettingsPage(f.context, commerce, now);
    expect([...pageProblems(unmapped)]).toEqual(["projects"]);
    const nav = renderNav(unmapped, "general");
    expect(nav.match(/확인할 것이 있어요/g)).toHaveLength(1);
    expect(nav).toMatch(
      /href="\/settings\/projects\?ws=ws-commerce"[^>]*>프로젝트<span aria-hidden="true"/,
    );
    const projects = textOf(renderPage("projects", unmapped));
    expect(projects).toContain("저장소를 아직 정하지 않았어요");

    saveMappingSetting(f.context, { ...project, runnerProjectId: repo, agentId: "claude" });
    const mapped = await loadSettingsPage(f.context, commerce, now);
    expect([...pageProblems(mapped)]).toEqual([]);
    expect(renderNav(mapped, "general")).not.toContain("확인할 것이 있어요");
  });

  it("PR 정보를 읽지 못한 런이 있으면 GitHub 줄에 문제로 보이고 메뉴의 연결에 점을 붙인다 (0144)", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    await saveGitHubToken(f.context, { token: "github_pat_example" }, now);
    const runnerId = addRunner(f);
    const project = { ws: commerce, connectionId: connection, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    saveMappingSetting(f.context, { ...project, runnerProjectId: repo, agentId: "claude" });
    const ids = ["ACME-1", "ACME-2"].map((key) => {
      const result = assignRun(f.context.db, {
        ticket: { connection, key: toTicketKey(key) },
        trackerProject: webProject,
        runnerProject: repo,
        agent: toAgentId("claude"),
        now,
      });
      if (!result.ok) throw new Error("assign failed");
      return result.run.id;
    });
    const endUnread = (id: string, reason: "no-access" | "other"): void => {
      f.context.db.$client
        .prepare(
          `UPDATE runs SET state = 'ended', runner_id = ?, started_at = 1, ended_at = 2,
            worktree_ref = 'wt', branch = 'b', agent_ref = 'a', agent_result = 'reported-success',
            pr_state = 'unknown', pr_read_error = ? WHERE id = ?`,
        )
        .run(runnerId, reason, id);
    };

    const clean = await loadSettingsPage(f.context, commerce, now);
    expect(textOf(renderPage("connections", clean, TOKEN_ONLY_VIEW))).toContain(
      "붙여 넣은 토큰으로 연결했어요",
    );
    expect([...pageProblems(clean)]).toEqual([]);

    endUnread(ids[0] ?? "", "other");
    const other = await loadSettingsPage(f.context, commerce, now);
    expect(other.install.unreadPrRuns).toEqual({ "no-access": 0, other: 1 });
    expect(textOf(renderPage("connections", other))).toContain(
      "런 1개의 PR 정보를 읽지 못했어요. 다시 읽고 있어요",
    );
    expect([...pageProblems(other)]).toEqual(["connections"]);

    endUnread(ids[1] ?? "", "no-access");
    const noAccess = await loadSettingsPage(f.context, commerce, now);
    const html = renderPage("connections", noAccess, TOKEN_ONLY_VIEW);
    expect(textOf(html)).toContain(
      "런 1개의 PR 정보를 읽지 못했어요. gh 계정이나 토큰이 그 저장소를 볼 수 없어요",
    );
    expect(textOf(html)).not.toContain("붙여 넣은 토큰으로 연결했어요");
    const nav = renderNav(noAccess, "connections");
    expect(nav.match(/확인할 것이 있어요/g)).toHaveLength(1);
  });

  it("프로젝트 페이지는 트래커 연결별로 묶고, 묶음 맨 위에 바로 할당 라벨, 아래에 프로젝트 상세로 가는 줄을 둔다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    addTrackerProject(f.context, {
      ws: commerce,
      connectionId: connection,
      projectId: webProject,
      name: "Web",
    });
    const html = renderPage("projects", await loadSettingsPage(f.context, commerce, now));
    expect(html).toMatch(/<h1[^>]*>프로젝트<\/h1>/);
    expect(html).toMatch(/<button[^>]*>\+ 트래커 프로젝트 넣기<\/button>/);
    const group = sectionOf(html, `projects-${connection}`);
    expect(textOf(group)).toContain("Acme 연결");
    expect(group.indexOf(settingsJson.projects.autoLabel)).toBeLessThan(group.indexOf("Web"));
    expect(group).toContain('aria-label="바로 할당 라벨 도움말"');
    expect(group).toContain(`aria-label="Acme 연결의 바로 할당 라벨"`);
    expect(textOf(group)).toContain(settingsJson.projects.autoLabelNone);
    expect(group).toContain(`href="/settings/projects/${connection}/${webProject}?ws=${commerce}"`);
  });

  it("페이지 머리는 제목 하나이고 설명 줄을 두지 않는다", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, commerce, now);
    for (const kind of ["general", "projects", "connections", "server"] as const) {
      const html = renderPage(kind, page);
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(html).not.toMatch(/<h1[^>]*>[^<]*<\/h1><p/);
    }
  });

  it("처음 열 때는 비밀값 입력칸을 띄우지 않는다(ADR 0010 6번)", async () => {
    const f = fixture();
    await addConnection(f);
    const page = await loadSettingsPage(f.context, commerce, now);
    for (const kind of ["general", "projects", "connections", "server"] as const) {
      const html = renderPage(kind, page);
      expect(html).not.toContain('type="password"');
      expect(html).not.toContain('data-variant="primary"');
    }
  });

  it("최대 실행 시간 칸은 숫자 키보드를 쓰고, 처음 열 때는 오류를 보이지 않는다(0055)", async () => {
    const f = fixture();
    const html = renderPage("general", await loadSettingsPage(f.context, commerce, now));
    expect(/<input[^>]*name="maxRunMinutes"[^>]*>/.exec(html)?.[0]).toContain(
      'inputMode="numeric"',
    );
    expect(html).toContain('aria-label="최대 실행 시간(분)"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("일반에는 이름, 최대 실행 시간 아래에 에이전트 지시를 두고 프로젝트 요약은 두지 않는다", async () => {
    const f = fixture();
    const text = textOf(renderPage("general", await loadSettingsPage(f.context, commerce, now)));
    expect(text.indexOf("이름")).toBeLessThan(text.indexOf("최대 실행 시간"));
    expect(text.indexOf("최대 실행 시간")).toBeLessThan(text.indexOf(settingsJson.brief.title));
    expect(text).not.toContain(settingsJson.pages.projects);
  });

  it("보조 설명은 늘 보이는 문단이 아니라 라벨 옆 도움말 단추로 둔다", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, commerce, now);
    const html = renderPage("general", page);
    expect(html).toContain('aria-label="최대 실행 시간 도움말"');
    const visible = textOf(
      html.replace(/<div[^>]*role="tooltip"[^>]*hidden=""[^>]*>.*?<\/div>/gs, ""),
    );
    expect(visible).not.toContain("런이 이 시간을 넘기면");
    expect(html).toMatch(/role="tooltip"[^>]*hidden=""[^>]*>런이 이 시간을 넘기면/);
  });

  it("Workspace 가 없으면 일반에 Workspace 를 만들라는 한 줄을 두고 메뉴는 일반만 남긴다", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, "all", now);
    expect(page.workspace).toBeNull();
    const none = renderWithMessages(
      <GeneralScreen
        page={page}
        workspaceView="none"
        actions={noopActions}
        onCreateWorkspace={() => {}}
        nav={null}
      />,
      settingsMessages,
    );
    expect(textOf(none)).toContain("아직 Workspace가 없어요");
    expect(none).toMatch(/<button[^>]*>Workspace 만들기</);
    expect(none).not.toContain("/onboarding");
    expect(none).not.toContain('name="maxRunMinutes"');
    expect(textOf(renderPage("general", page))).toContain("전체 보기에서는");
    expect(renderPage("general", page)).not.toContain("Workspace 만들기");
    expect(textOf(renderPage("projects", page))).toContain("전체 보기에서는");
    const nav = renderNav(page, "general");
    expect(textOf(nav)).toContain("Workspace 일반 설치 전체");
    expect(nav).not.toContain("/settings/projects");
  });

  it("없는 프로젝트 상세는 프로젝트 페이지로 가는 링크를 보인다", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, commerce, now);
    expect(findBoundProject(page.workspace, "nope", "nope")).toBeNull();
    const html = renderProject(page, "nope", "nope");
    expect(textOf(html)).toContain("이 Workspace에 없는 트래커 프로젝트예요.");
    expect(html).toMatch(
      /href="\/settings\/projects\?ws=ws-commerce#project-nope-nope"[^>]*>프로젝트</,
    );
  });

  it("프로젝트 상세는 머리에 프로젝트 › 연결 이동 경로와 프로젝트 이름을 두고, 바로 할당 라벨은 두지 않는다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    addTrackerProject(f.context, {
      ws: commerce,
      connectionId: connection,
      projectId: webProject,
      name: "Web",
    });
    const html = renderProject(
      await loadSettingsPage(f.context, commerce, now),
      connection,
      webProject,
    );
    expect(html).toMatch(/<h1[^>]*>Web<\/h1>/);
    expect(html).toMatch(
      new RegExp(
        `href="/settings/projects\\?ws=ws-commerce#project-${connection}-tp-web"[^>]*>프로젝트</a> › Acme 연결`,
      ),
    );
    expect(textOf(html)).not.toContain(settingsJson.projects.autoLabel);
    expect(html).not.toContain(settingsJson.label.choose);
    expect(textOf(html)).toContain("런이 시작되면");
    expect(textOf(html)).toContain(settingsJson.project.remove);
  });
});

describe("잠자기 방지(0084)", () => {
  function withHome<T>(use: (home: string) => T): T {
    const home = mkdtempSync(join(tmpdir(), "ganger-web-power-"));
    try {
      return use(home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it("설치 폴더를 모르면 바꿀 수 없다고 보이고 저장하지 않는다", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, undefined, now);
    expect(page.install.power).toEqual({ available: false, preventSleep: true });
    const server = renderPage("server", page);
    expect(textOf(server)).toContain("ganger start로 띄우지 않아 여기서 바꿀 수 없어요");
    const toggle = /<button[^>]*role="switch"[^>]*>/.exec(server)?.[0] ?? "";
    expect(toggle).toContain("disabled");
    expect(toggle).toContain('aria-checked="false"');
    expect(savePowerSetting(f.context, { preventSleep: false })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("기본은 켜짐이고, 끄면 설치 폴더의 power.json에 저장해 다시 열면 꺼져 있다", async () => {
    await withHome(async (home) => {
      const power = installPowerSettings({ GANGER_HOME: home });
      if (power === undefined) throw new Error("home not accepted");
      const f = fixture();
      const context = { ...f.context, power };
      expect((await loadSettingsPage(context, undefined, now)).install.power).toEqual({
        available: true,
        preventSleep: true,
      });
      expect(savePowerSetting(context, { preventSleep: false })).toEqual({ ok: true });
      expect(JSON.parse(readFileSync(join(home, "power.json"), "utf8"))).toEqual({
        preventSleep: false,
      });
      const page = await loadSettingsPage(context, undefined, now);
      expect(page.install.power).toEqual({ available: true, preventSleep: false });
      const server = renderPage("server", page);
      expect(textOf(server)).toContain("서버가 도는 동안 이 맥이 잠들지 않게");
      expect(textOf(server)).toContain("뚜껑을 닫거나");
      const toggle = /<button[^>]*role="switch"[^>]*>/.exec(server)?.[0] ?? "";
      expect(toggle).not.toContain("disabled");
      expect(toggle).toContain('aria-checked="false"');
    });
  });

  it("설치 폴더 값은 절대 경로일 때만 받는다", () => {
    expect(installPowerSettings({})).toBeUndefined();
    expect(installPowerSettings({ GANGER_HOME: " " })).toBeUndefined();
    expect(installPowerSettings({ GANGER_HOME: "relative/home" })).toBeUndefined();
  });

  it("켜기·끄기 값은 boolean만 받는다", () => {
    expect(powerInput.safeParse({ preventSleep: true }).success).toBe(true);
    expect(powerInput.safeParse({ preventSleep: "false" }).success).toBe(false);
  });
});

describe("MCP 구역(0088)", () => {
  const appEnv = {
    GANGER_CLI_ENTRY: "/Applications/Ganger.app/Contents/Resources/server/cli/bin/cli.js",
    GANGER_HOME: "/Users/operator/.ganger",
    ELECTRON_RUN_AS_NODE: "1",
  };
  const appNode = "/Applications/Ganger.app/Contents/MacOS/Ganger";

  it("앱 안 CLI의 절대 경로가 든 Hermes·JSON 설정 조각과 복사 버튼을 보인다", async () => {
    const f = fixture();
    const context = { ...f.context, mcpLaunch: serverMcpLaunch(appEnv, appNode) };
    const page = await loadSettingsPage(context, commerce, now);
    const html = renderMcp(page);
    const shown = textOf(html);
    expect(shown).toContain("mcp_servers:");
    expect(shown).toContain(`command: "${appNode}"`);
    expect(shown).toContain(`- "${appEnv.GANGER_CLI_ENTRY}"`);
    expect(shown).toContain('ELECTRON_RUN_AS_NODE: "1"');
    expect(jsonConfig(page.install.mcp.launch)).toContain('"mcpServers"');
    expect(shown).toContain("~/.hermes/config.yaml");
    expect(shown).not.toContain("CLI 위치를 몰라요");
    expect(html).toMatch(/aria-label="클라이언트"[^>]*role="tablist"/);
    expect(html).toMatch(/<button[^>]*>복사<\/button>/);
  });

  it("CLI 위치를 모르면 PATH의 ganger를 쓰라고 알린다", async () => {
    const f = fixture();
    const context = { ...f.context, mcpLaunch: serverMcpLaunch({}, "/usr/bin/node") };
    const shown = textOf(renderMcp(await loadSettingsPage(context, commerce, now)));
    expect(shown).toContain("CLI 위치를 몰라요");
    expect(shown).toContain('command: "ganger"');
  });

  it("CLI·설치 폴더 경로는 절대 경로일 때만 받는다", () => {
    expect(
      serverMcpLaunch({ GANGER_CLI_ENTRY: "cli.js", GANGER_HOME: "home" }, "/usr/bin/node"),
    ).toEqual({ located: false, command: "ganger", args: ["mcp"], env: {} });
  });
});

describe("MCP 쓰기 허용과 최근 작업(0089)", () => {
  it("스위치는 처음엔 꺼져 있고, 저장하면 켜진 채로 다시 보인다", async () => {
    const f = fixture();
    const off = await loadSettingsPage(f.context, commerce, now);
    expect(off.install.mcp.writeAllowed).toBe(false);
    const offMcp = renderMcp(off);
    expect(textOf(offMcp)).toContain("MCP 클라이언트도 할당·답하기·취소를 하게");
    expect(textOf(offMcp)).toContain("이 화면에서만 바꿔요");
    expect(offMcp).toContain('aria-label="켜기 전에 알아 둘 것"');
    expect(offMcp).toMatch(
      /role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/,
    );

    expect(saveMcpWriteSetting(f.context, { allowed: true }, now)).toEqual({ ok: true });
    const on = await loadSettingsPage(f.context, commerce, now);
    expect(on.install.mcp.writeAllowed).toBe(true);
    expect(renderMcp(on)).toMatch(
      /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/,
    );
  });

  it("런과 상관없는 MCP 쓰기는 최근 작업에 MCP · 이름, 도구, 대상, 결과로 보이고 Operator라고 보내도 MCP가 붙는다", async () => {
    const f = fixture();
    expect(textOf(renderMcp(await loadSettingsPage(f.context, commerce, now)))).toContain(
      "아직 MCP 클라이언트가 한 작업이 없어요",
    );
    recordMcpAction(f.context.db, {
      at: new Date(now.getTime() - 60_000),
      client: "Operator",
      tool: "set_runner_capacity",
      target: "runner-a",
      runId: null,
      outcome: "done",
      reason: null,
    });
    recordMcpAction(f.context.db, {
      at: now,
      client: "hermes\u0007\u202e",
      tool: "request_runner_check",
      target: "runner-b",
      runId: null,
      outcome: "rejected",
      reason: "not-found",
    });

    const shown = textOf(renderMcp(await loadSettingsPage(f.context, commerce, now)));
    expect(shown).toContain("러너 Capacity 바꾸기 · runner-a MCP · Operator");
    expect(shown).toContain("MCP · hermes");
    expect(shown).not.toContain("\u202e");
    expect(shown).toContain(
      "러너 다시 확인 · runner-b MCP · hermes · 하지 못했어요: 대상을 찾지 못했어요",
    );
    expect(shown.indexOf("MCP · hermes")).toBeLessThan(shown.indexOf("MCP · Operator"));
  });
});

describe("직접 입력 러너 폼(0095 M2b)", () => {
  const html = renderWithMessages(
    <RunnerForm runner={null} actions={noopActions} primary={false} direct />,
    settingsMessages,
  );
  const shown = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("ssh 대상을 맨 앞에 두고, 이름·자리·orca 경로가 뒤따른다", () => {
    const order = ["ssh 대상", "러너 이름", "자리", "orca 실행 파일 경로"].map((label) =>
      shown.indexOf(label),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("orca 경로는 고칠 수 있는 Orca 앱 기본 경로로 채워 둔다", () => {
    expect(html).toMatch(
      /name="orcaPath"[^>]*value="\/Applications\/Orca.app\/Contents\/Resources\/bin\/orca"/,
    );
  });

  it("먼저 돌려 볼 ssh 명령과 복사 버튼, 확인하고 등록 버튼을 보인다", () => {
    expect(shown).toContain("이 서버 맥에서 먼저 확인해 볼 수 있어요");
    expect(shown).toContain("ssh -o BatchMode=yes -- user@host true");
    expect(html).toMatch(/data-variant="ghost"[^>]*disabled=""[^>]*>명령 복사/);
    expect(html).toMatch(/type="submit"[^>]*>확인하고 등록/);
  });

  it("ssh 대상의 호스트 첫 부분으로 이름을 미리 정한다", () => {
    expect(nameFromSshTarget("dev@mac-mini.example.com")).toBe("mac-mini");
    expect(nameFromSshTarget("  studio ")).toBe("studio");
    expect(nameFromSshTarget("me@runner-a:2222")).toBe("runner-a");
    expect(nameFromSshTarget("")).toBe("");
    expect(nameFromSshTarget("dev@192.168.0.5")).toBe("192.168.0.5");
    expect(nameFromSshTarget("dev@10.0.0.5:2222")).toBe("10.0.0.5");
    expect(nameFromSshTarget("dev@[fe80::1]:22")).toBe("fe80::1");
    expect(nameFromSshTarget("fe80::1")).toBe("fe80::1");
  });

  it("먼저 돌려 볼 명령은 입력한 대상을 그대로 넣는다", () => {
    expect(sshCheckCommand("dev@mac-mini.example.com")).toBe(
      "ssh -o BatchMode=yes -- dev@mac-mini.example.com true",
    );
    expect(sshCheckCommand("my mac; rm -rf ~")).toBe(
      "ssh -o BatchMode=yes -- 'my mac; rm -rf ~' true",
    );
  });

  it("Settings의 러너 추가 폼은 지금처럼 이름부터 받고 orca 경로를 비워 둔다", () => {
    const plain = renderWithMessages(
      <RunnerForm runner={null} actions={noopActions} />,
      settingsMessages,
    );
    expect(plain).toMatch(/name="orcaPath"[^>]*value=""/);
    expect(plain).not.toContain("BatchMode");
    expect(plain).toMatch(/type="submit"[^>]*>등록하고 확인/);
  });
});

describe("Workspace 앞뒤 지시 (0146)", () => {
  it("저장하면 다시 열 때 같은 값이 보이고 앞뒤 빈 줄은 다듬어 저장한다", async () => {
    const f = fixture();
    expect(
      saveBrief(
        f.context,
        briefInput.parse({
          ws: commerce,
          before: "\nRead AGENTS.md first.\n",
          after: "Push the branch.\nOpen a PR.",
        }),
      ),
    ).toEqual({ ok: true });
    const page = await loadSettingsPage(f.context, commerce, now);
    expect(page.workspace?.general.brief).toEqual({
      before: "Read AGENTS.md first.",
      after: "Push the branch.\nOpen a PR.",
    });
    expect(page.workspace?.general.agentProtocol).toContain("orca orchestration ask");
  });

  it("각 칸은 8,000자까지 받고 넘으면 입력 검증이 막는다", () => {
    const ok = { ws: commerce, before: "가".repeat(8_000), after: "" };
    expect(briefInput.safeParse(ok).success).toBe(true);
    expect(briefInput.safeParse({ ...ok, before: "가".repeat(8_001) }).success).toBe(false);
    expect(briefInput.safeParse({ ...ok, after: "a".repeat(8_001) }).success).toBe(false);
    expect(briefInput.safeParse({ ws: commerce, before: 1, after: "" }).success).toBe(false);
    expect(briefInput.safeParse({ ...ok, before: `\n${"가".repeat(8_000)}\n  ` }).success).toBe(
      true,
    );
  });

  it("없는 Workspace에는 저장하지 않는다", () => {
    const f = fixture();
    expect(saveBrief(f.context, { ws: "ws-missing", before: "x", after: "" })).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("일반 페이지에 지시 줄을 두고, 비어 있으면 덧붙이는 지시가 없다고 보인다", async () => {
    const f = fixture();
    const empty = renderPage("general", await loadSettingsPage(f.context, commerce, now));
    expect(textOf(empty)).toContain(settingsJson.brief.title);
    expect(textOf(empty)).toContain(settingsJson.brief.summaryEmpty);
    saveBrief(f.context, { ws: commerce, before: "", after: "Push.\nOpen a PR.\nRun checks." });
    const filled = renderPage("general", await loadSettingsPage(f.context, commerce, now));
    expect(textOf(filled)).toContain("티켓 앞 없음 · 티켓 뒤 3줄");
  });

  it("미리 보기는 앞 지시 → 예시 티켓 → 뒤 지시 → 통신 규약 순서로, 빈 칸은 빼고 보인다", () => {
    const html = renderWithMessages(
      <BriefPreview brief={{ before: "", after: "Open a PR." }} protocol={"## Protocol"} />,
      settingsMessages,
    );
    const shown = textOf(html);
    const order = [
      settingsJson.brief.preview.ticket,
      settingsJson.brief.example.title,
      settingsJson.brief.preview.after,
      "Open a PR.",
      settingsJson.brief.preview.protocol,
      "## Protocol",
    ].map((part) => shown.indexOf(part));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(shown).not.toContain(settingsJson.brief.preview.before);
  });
});
