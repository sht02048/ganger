import {
  AdapterRegistry,
  isAssignmentBlocked,
  toCodeHostKind,
  toRunnerProjectId,
  toLabelId,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { RunnerHealth, RunnerId, TrackerConnectionId } from "@ganger/core";
import { FakeCodeHost, FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  completeRunnerCheckRequest,
  getWorkspaceTrackerProject,
  listPendingRunnerCheckRequests,
  listRunners,
  listTrackerConnections,
  listWorkspaces,
  migrate,
  openDatabase,
  recordRunnerCheck,
  requestRunnerCheck,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
} from "@ganger/db";
import { describe, expect, it, vi } from "vitest";
import {
  saveGitHubToken,
  saveInProgressState,
  saveLabel,
  saveMappingSetting,
  saveRunnerSetting,
  saveTrackerConnectionSetting,
} from "@ganger/app/settings/actions";
import { loadSettingsPage, loadTrackerProjectChoices } from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import type {
  ConnectionProjects,
  GhCliView,
  GitHubAuthView,
  SettingsPage,
} from "@ganger/app/settings/model";
import { checkGitHubConnection, loadGitHubAuthView } from "@ganger/app/settings/github-auth";
import { GitHubAuth } from "@ganger/codehost-github";
import type { GhRunner } from "@ganger/codehost-github";
import { settingsMessages } from "../settings/messages";
import { SettingsScreen } from "../settings/settings-page";
import { buttonsOf } from "../testing/buttons";
import { renderWithMessages } from "../testing/render";
import {
  createNewWorkspace,
  firstWorkspaceInput,
  isOnboardingComplete,
  loadOnboardingPage,
  newWorkspaceInput,
  setUpFirstWorkspace,
} from "./load";
import { onboardingMessages } from "./messages";
import { runnerSetupMessages } from "../runner-setup/messages";
import {
  HOME_PATH,
  ONBOARDING_PATH,
  ONBOARDING_STEPS,
  missingMappingParts,
  onboardingRedirect,
  resolveStep,
  serviceInstallCommand,
  stepPassed,
  stepToPin,
} from "./model";
import type { OnboardingStep } from "./model";
import { OnboardingScreen } from "./onboarding-screen";
import type { OnboardingActions } from "./onboarding-screen";

const now = new Date("2026-11-18T09:00:00Z");
const webProject = toTrackerProjectId("tp-web");
const repo = toRunnerProjectId("github:acme/web");
const orcaPath = "/opt/orca/bin/orca";

interface Fixture {
  context: SettingsContext;
  tracker: FakeTracker;
  codeHost: FakeCodeHost;
  gh: { scene: GhScene; runner: GhRunner };
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const tracker = new FakeTracker(toTrackerKind("fake"));
  tracker.projects.push({ id: webProject, name: "Web", url: "https://tracker.example.com/web" });
  tracker.states.set(webProject, [
    { id: toTrackerStateId("st-todo"), name: "Todo", category: "unstarted" },
    { id: toTrackerStateId("st-doing"), name: "In Progress", category: "started" },
  ]);
  tracker.labels.set(webProject, [{ id: toLabelId("lb-auto"), name: "factory" }]);
  const codeHost = new FakeCodeHost(toCodeHostKind("fake-host"));
  const registry = new AdapterRegistry()
    .registerTracker({ kind: tracker.kind, create: () => tracker })
    .registerCodeHost({ kind: codeHost.kind, create: () => codeHost });
  const gh = fakeGh();
  return {
    context: {
      db,
      secretBox: new SecretBox(new Uint8Array(32).fill(7)),
      registry,
      githubAuth: new GitHubAuth({ gh: gh.runner, fetch: ghOwnersFetch }),
    },
    tracker,
    codeHost,
    gh,
  };
}

type GhScene = "connected" | "logged-out" | "missing";

function fakeGh(): { scene: GhScene; runner: GhRunner } {
  const state: { scene: GhScene; runner: GhRunner } = {
    scene: "missing",
    runner: {
      run: (args) => {
        if (state.scene === "missing") return Promise.resolve(null);
        if (args[0] === "--version") {
          return Promise.resolve({ code: 0, stdout: "gh version 2.60.0", stderr: "" });
        }
        const accounts =
          state.scene === "connected"
            ? [{ state: "success", active: true, login: "acme-bot" }]
            : [];
        if (args[1] === "status") {
          const hosts = { "github.com": accounts };
          return Promise.resolve({ code: 0, stdout: JSON.stringify({ hosts }), stderr: "" });
        }
        if (args[1] === "token" && accounts.length > 0) {
          return Promise.resolve({ code: 0, stdout: GH_TOKEN, stderr: "" });
        }
        return Promise.resolve({ code: 1, stdout: "", stderr: "" });
      },
    },
  };
  return state;
}

const GH_TOKEN = "gho_onboardingSECRET9";

const ghOwnersFetch: typeof fetch = (input) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  const body =
    path === "/user" ? { login: "acme-bot" } : path === "/user/orgs" ? [{ login: "acme" }] : {};
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
};

const page = (f: Fixture): Promise<SettingsPage> => loadSettingsPage(f.context, undefined, now);

const reject = () => Promise.reject(new Error("unused"));
const noopActions: OnboardingActions = {
  saveGeneral: reject,
  saveBrief: reject,
  addProject: reject,
  removeProject: reject,
  saveMapping: reject,
  saveInProgress: reject,
  saveLabel: reject,
  saveConnection: reject,
  checkConnection: reject,
  saveGitHubToken: reject,
  checkGitHub: reject,
  saveRunner: reject,
  recheckRunner: reject,
  saveAddresses: reject,
  savePower: reject,
  saveMcpWrite: reject,
  createLabel: reject,
  reloadFromTracker: reject,
  pollRunnerChecks: () => Promise.resolve(false),
  checkWebhookAddress: reject,
  turnOffWebhook: reject,
  thisMacStatus: () => new Promise(() => undefined),
  runThisMacStep: reject,
  startEnrollment: () => new Promise(() => undefined),
  startAppEnrollment: () => new Promise(() => undefined),
  saveWebAddress: reject,
  enrollment: reject,
  cancelEnrollment: () => Promise.resolve(),
  setUpWorkspace: reject,
};

const GH_MISSING: GhCliView = { kind: "missing" };

function githubView(settings: SettingsPage, cli: GhCliView = GH_MISSING): GitHubAuthView {
  return {
    cli,
    tokenSaved: settings.install.githubToken,
    source: cli.kind === "logged-in" ? "gh" : settings.install.githubToken ? "token" : "none",
  };
}

function render(
  settings: SettingsPage,
  step: OnboardingStep,
  trackerProjects: ConnectionProjects[] = [],
  github: GitHubAuthView = githubView(settings),
): string {
  return renderWithMessages(
    <OnboardingScreen
      page={settings}
      trackerProjects={trackerProjects}
      github={github}
      index={ONBOARDING_STEPS.indexOf(step)}
      onStep={() => {}}
      onFinish={() => {}}
      actions={noopActions}
      direct={{ open: false, openHref: "", closeHref: "", onChange: () => {} }}
    />,
    { ...onboardingMessages, ...runnerSetupMessages },
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ");
}

function nextButton(html: string, label: string): string {
  const button = html.match(new RegExp(`<button[^>]*>${label}</button>`, "g"))?.at(-1);
  if (button === undefined) throw new Error(`no ${label} button`);
  return button;
}

const isDisabled = (button: string) => /\sdisabled(=""|\s|>)/.test(button);

async function connectTracker(f: Fixture): Promise<void> {
  f.tracker.connection = { ok: true, organizationName: "Acme" };
  expect(
    await saveTrackerConnectionSetting(
      f.context,
      { apiKey: "lin_api_example", webhookSecret: "" },
      now,
    ),
  ).toEqual({ ok: true });
}

function connectionId(f: Fixture): TrackerConnectionId {
  const found = listTrackerConnections(f.context.db, f.context.secretBox)[0];
  if (found === undefined) throw new Error("no tracker connection");
  return found.id;
}

function setUpWorkspace(f: Fixture, name = "Acme Commerce") {
  return setUpFirstWorkspace(
    f.context,
    { name, projects: [{ connectionId: connectionId(f), projectId: webProject, name: "Web" }] },
    now,
  );
}

function registerRunner(f: Fixture): RunnerId {
  const saved = saveRunnerSetting(
    f.context,
    { name: "runner-a", sshTarget: "factory@runner-a.example.com", orcaPath, capacity: 2 },
    now,
  );
  if (!saved.ok) throw new Error(saved.reason);
  return saved.runnerId;
}

const health = (
  prerequisites: { service: boolean; push: boolean },
  online = true,
): RunnerHealth => ({
  online,
  version: "1.4.258",
  checkedAt: now,
  error: online ? null : { kind: "unreachable", detail: "ssh: connect timed out" },
  prerequisites: [
    {
      id: "orca-service",
      name: "Orca 상시 서비스",
      satisfied: prerequisites.service,
      hint: null,
      blocksAssignment: false,
    },
    {
      id: `github-push:${repo}`,
      name: "GitHub push access: acme/web",
      satisfied: prerequisites.push,
      hint: null,
      blocksAssignment: false,
      project: repo,
      ...(prerequisites.push
        ? {}
        : {
            failure: {
              kind: "auth" as const,
              reason: "Permission to acme/web.git denied to someone.",
            },
          }),
    },
  ],
});

const serviceMissing: RunnerHealth = {
  online: false,
  version: "1.4.258",
  checkedAt: now,
  error: { kind: "not-ready", detail: "runtime state: stopped" },
  prerequisites: [
    {
      id: "orca-service",
      name: "Orca background service",
      satisfied: false,
      hint: null,
      blocksAssignment: false,
    },
  ],
};

function finishCheck(f: Fixture, runnerId: RunnerId, result: RunnerHealth): void {
  const request = listPendingRunnerCheckRequests(f.context.db).find((r) => r.runnerId === runnerId);
  if (request === undefined) throw new Error("no pending request");
  completeRunnerCheckRequest(f.context.db, {
    runnerId,
    requestedAt: request.requestedAt,
    completedAt: now,
    result,
  });
  recordRunnerCheck(f.context.db, {
    runnerId,
    online: result.online,
    checkedAt: now,
    error: null,
    projects: result.online ? [{ id: repo, displayName: "acme/web", setupState: "ready" }] : null,
    assignmentBlocked: result.online ? isAssignmentBlocked(result) : null,
    prerequisites: result.online ? result.prerequisites : null,
  });
}

describe("온보딩으로 보내기", () => {
  it("설정이 없는 DB 로 아무 화면에 들어가도 온보딩으로 간다", async () => {
    const f = fixture();
    const complete = isOnboardingComplete(f.context.db, f.context.secretBox);
    expect(complete).toBe(false);
    for (const path of [
      "/",
      "/tickets",
      "/runs",
      "/runs/run-1",
      "/runners",
      "/stats",
      "/settings",
      "/unknown",
    ]) {
      expect({ path, to: onboardingRedirect(path, complete) }).toEqual({
        path,
        to: ONBOARDING_PATH,
      });
    }
    for (const path of ["/onboarding", "/api/webhooks/tracker/c-1", "/ds"]) {
      expect({ path, to: onboardingRedirect(path, complete) }).toEqual({ path, to: null });
    }
    expect(resolveStep(await page(f), undefined)).toBe(0);
  });
});

describe("확인이 실패한 단계", () => {
  it("트래커 연결 확인이 실패하면 저장하지 않고 다음으로 갈 수 없다", async () => {
    const f = fixture();
    f.tracker.connection = { ok: false, error: { kind: "unauthorized" } };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_wrong", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: false, reason: "unauthorized" });
    const settings = await page(f);
    expect(stepPassed(settings, "tracker")).toBe(false);
    expect(isDisabled(nextButton(render(settings, "tracker"), "다음"))).toBe(true);
    expect(resolveStep(settings, 4)).toBe(0);
  });

  it("GitHub 토큰 확인이 실패하면 다음으로 갈 수 없다", async () => {
    const f = fixture();
    await connectTracker(f);
    f.codeHost.connection = { ok: false, error: { kind: "unauthorized" } };
    expect(await saveGitHubToken(f.context, { token: "github_pat_wrong" }, now)).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    const settings = await page(f);
    expect(resolveStep(settings, 3)).toBe(1);
    expect(isDisabled(nextButton(render(settings, "github"), "다음"))).toBe(true);
  });

  async function runnerStep(result: RunnerHealth | null) {
    const f = fixture();
    await connectTracker(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const runnerId = registerRunner(f);
    if (result !== null) finishCheck(f, runnerId, result);
    const settings = await page(f);
    return { settings, html: render(settings, "runner") };
  }

  it("러너 확인을 기다리는 동안에는 다음으로 갈 수 없다", async () => {
    const { settings, html } = await runnerStep(null);
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    expect(text(html)).toContain("확인하는 중이에요 · <1 min");
  });

  it("Orca 상시 서비스가 없으면 설치 명령을 안내하고 다음으로 갈 수 없다", async () => {
    const { settings, html } = await runnerStep(serviceMissing);
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(resolveStep(settings, 5)).toBe(2);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    const shown = text(html);
    expect(shown).toContain("Orca 상시 서비스가 없어요");
    expect(serviceInstallCommand(orcaPath)).toBe(
      "/opt/orca/bin/orca serve service install --bind 127.0.0.1 --command /opt/orca/bin/orca",
    );
    expect(shown).toContain(serviceInstallCommand(orcaPath));
    expect(serviceInstallCommand("/opt/my tools/orca")).toBe(
      "'/opt/my tools/orca' serve service install --bind 127.0.0.1 --command '/opt/my tools/orca'",
    );
    expect(shown).not.toContain("ssh 대상과 orca 실행 파일 경로를 확인하고");
    expect(shown).not.toContain("--supervise");
    expect(shown).not.toContain("러너의 GitHub 인증이 안 돼요");
  });

  it("저장소 push가 안 돼도 러너 전체 조건이 통과하면 다음으로 가고, 실패한 저장소와 이유·해결 방법을 경고로 보인다 (0096)", async () => {
    const { settings, html } = await runnerStep(health({ service: true, push: false }));
    expect(stepPassed(settings, "runner")).toBe(true);
    expect(isDisabled(nextButton(html, "다음"))).toBe(false);
    const shown = text(html);
    expect(shown).toContain("runner-a 러너가 준비됐어요");
    expect(shown).toContain("GitHub push · 1개 중 0개 통과");
    expect(shown).toContain("push가 안 되는 저장소가 있어요");
    expect(shown).toContain("acme/web 인증 실패 · Permission to acme/web.git denied to someone.");
    expect(shown).toContain("gh auth login --insecure-storage");
    expect(shown).toContain("gh auth setup-git");
    expect(shown).toContain("push가 안 되는 저장소의 티켓만 이 러너에 맡기지 않아요.");
    expect(shown).not.toContain("Orca 상시 서비스가 없어요");
    expect(html).toContain('aria-label="갖추지 못했어요"');
    expect(html).not.toContain('aria-label="일부만 통과"');
  });

  it("러너에 닿지 않으면 다음으로 갈 수 없다", async () => {
    const { settings, html } = await runnerStep(health({ service: true, push: true }, false));
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    expect(text(html)).toContain("러너에 닿지 않았어요");
  });

  it("러너에 닿았지만 확인 중 오류가 나면 다음으로 갈 수 없다", async () => {
    const { settings, html } = await runnerStep({
      ...serviceMissing,
      online: true,
      error: { kind: "runner-error", code: "repo_list_failed", message: "project list failed" },
      prerequisites: [{ ...serviceMissing.prerequisites[0]!, satisfied: true }],
    });
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    expect(text(html)).toContain("러너 확인 중 오류가 났어요");
  });

  it("push를 확인할 저장소가 없어도 다음으로 가고 그렇다고 알린다 (0096)", async () => {
    const result = health({ service: true, push: true });
    const { settings, html } = await runnerStep({
      ...result,
      prerequisites: result.prerequisites.filter((p) => p.id === "orca-service"),
    });
    expect(stepPassed(settings, "runner")).toBe(true);
    expect(isDisabled(nextButton(html, "다음"))).toBe(false);
    expect(text(html)).toContain("push를 확인할 저장소가 없어요");
    expect(html).not.toContain('aria-label="일부만 통과"');
  });

  it("push를 확인하지 못한 저장소만 있으면 실패라고 하지 않고 확인하지 못했다고 알린다 (0096)", async () => {
    const result = health({ service: true, push: true });
    const { settings, html } = await runnerStep({
      ...result,
      prerequisites: result.prerequisites.map((p) =>
        p.id === "orca-service"
          ? p
          : { ...p, satisfied: null, failure: { kind: "timeout" as const, reason: null } },
      ),
    });
    expect(stepPassed(settings, "runner")).toBe(true);
    const shown = text(html);
    expect(shown).toContain("push를 확인하지 못한 저장소가 있어요");
    expect(shown).toContain("acme/web 확인하지 못했어요 · 시간 초과");
    expect(shown).not.toContain("push가 안 되는 저장소가 있어요");
    expect(html).not.toContain('aria-label="일부만 통과"');
  });

  it("러너가 여럿이어도 주 버튼은 하나다: 마치기 전에는 가장 최근 러너의 다시 확인, 마친 뒤에는 다음", async () => {
    const f = fixture();
    await connectTracker(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const first = registerRunner(f);
    finishCheck(f, first, health({ service: false, push: true }));
    const second = saveRunnerSetting(
      f.context,
      { name: "runner-b", sshTarget: "factory@runner-b.example.com", orcaPath, capacity: 1 },
      now,
    );
    if (!second.ok) throw new Error(second.reason);
    finishCheck(f, second.runnerId, health({ service: false, push: true }));
    const primaries = async () =>
      buttonsOf(render(await page(f), "runner"))
        .filter((b) => b.variant === "primary")
        .map((b) => b.label);
    expect(await primaries()).toEqual(["다시 확인"]);

    requestRunnerCheck(f.context.db, first, now);
    finishCheck(f, first, health({ service: true, push: true }));
    expect(await primaries()).toEqual(["다음"]);
  });

  it("러너 확인이 성공하면 폼을 접어 요약과 확인 목록을 보이고 다음으로 갈 수 있다", async () => {
    const { settings, html } = await runnerStep(health({ service: true, push: true }));
    expect(stepPassed(settings, "runner")).toBe(true);
    expect(isDisabled(nextButton(html, "다음"))).toBe(false);
    const shown = text(html);
    expect(shown).toContain("runner-a 러너가 준비됐어요");
    expect(shown).toContain("factory@runner-a.example.com · capacity 2");
    expect(shown).toContain("러너에 닿았어요 · orca 1.4.258");
    expect(html).not.toContain('name="sshTarget"');
    const labels = buttonsOf(html).map((b) => `${b.variant}:${b.label}`);
    expect(labels).toContain("secondary:다시 확인");
    expect(labels).toContain("secondary:수정");
    expect(html.match(/role="img" aria-label="갖췄어요"/g)).toHaveLength(3);
  });
});

const primaryCount = (html: string) => html.match(/data-variant="primary"/g)?.length ?? 0;

function primaryByStep(settings: SettingsPage): Array<{ step: OnboardingStep; primary: number }> {
  return ONBOARDING_STEPS.map((step) => ({ step, primary: primaryCount(render(settings, step)) }));
}

describe("단계 목록과 주 버튼(ADR 0010)", () => {
  it("단계 이름 메시지는 Tracker·GitHub·Runner·Workspace·Mapping 이다", () => {
    const steps = onboardingMessages.onboarding.steps;
    expect(ONBOARDING_STEPS.map((step) => steps[step].name)).toEqual([
      "Tracker",
      "GitHub",
      "Runner",
      "Workspace",
      "Mapping",
    ]);
  });

  it("왼쪽 단계 목록에 다섯 단계 이름과 지금 단계를 보인다", async () => {
    const f = fixture();
    await connectTracker(f);
    const html = render(await page(f), "github");
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(text(nav)).toContain("시작하기 1 Tracker 완료 2 GitHub 3 Runner 4 Workspace 5 Mapping");
    expect(nav).toMatch(/aria-current="step"[^>]*>.*?GitHub</);
    const buttons = (nav.match(/<button.*?<\/button>/g) ?? []).map(text);
    expect(buttons).toEqual([" 1 Tracker 완료 "]);
    expect(text(html)).toContain("2/5 · GitHub");
  });

  it("단계를 마치기 전에는 그 단계의 저장·확인이, 마친 뒤에는 다음이 하나뿐인 주 버튼이다", async () => {
    const f = fixture();
    const check = async () => {
      const settings = await page(f);
      for (const { step, primary } of primaryByStep(settings)) {
        const expected = step === "mapping" && !stepPassed(settings, step) ? 0 : 1;
        expect({ step, primary }).toEqual({ step, primary: expected });
      }
    };
    await check();
    await connectTracker(f);
    await check();
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    await check();
    const runnerId = registerRunner(f);
    await check();
    finishCheck(f, runnerId, health({ service: true, push: true }));
    await check();
    expect(setUpWorkspace(f)).toEqual({ ok: true });
    await check();
  });

  it("다음을 막은 동안에는 막은 까닭을 다음 버튼의 설명으로 잇는다(0052)", async () => {
    const f = fixture();
    const html = render(await page(f), "tracker");
    const next = nextButton(html, "다음");
    expect(isDisabled(next)).toBe(true);
    const describedBy = next.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toMatch(
      new RegExp(`id="${describedBy}"[^>]*>확인이 끝나야 다음으로 갈 수 있어요.<`),
    );

    await connectTracker(f);
    expect(nextButton(render(await page(f), "tracker"), "다음")).not.toContain("aria-describedby");
  });

  it("확인이 성공한 단계는 다음이 주 버튼이고 저장 버튼은 보조 버튼이다", async () => {
    const f = fixture();
    await connectTracker(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const settings = await page(f);
    for (const step of ["tracker", "github"] as const) {
      const html = render(settings, step);
      expect(primaryCount(html)).toBe(1);
      expect(nextButton(html, "다음")).toContain('data-variant="primary"');
    }
  });
});

describe("다섯 단계를 마치기", () => {
  it("다섯 단계를 마치면 홈으로 가고, 그 뒤에는 온보딩이 뜨지 않는다", async () => {
    const f = fixture();
    const reached = async () => resolveStep(await page(f), undefined);

    await connectTracker(f);
    expect(await reached()).toBe(1);

    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    expect(await reached()).toBe(2);

    const runnerId = registerRunner(f);
    finishCheck(f, runnerId, health({ service: true, push: true }));
    expect(await reached()).toBe(3);

    expect(setUpWorkspace(f)).toEqual({ ok: true });
    const workspaces = listWorkspaces(f.context.db);
    expect(workspaces.map((w) => w.name)).toEqual(["Acme Commerce"]);
    const ws = workspaces[0]?.id ?? "";
    const project = { ws, connectionId: connectionId(f), projectId: webProject };
    expect(await reached()).toBe(4);

    const locked = async (missing: string[]) => {
      const html = render(await page(f), "mapping");
      expect(isDisabled(nextButton(html, "설정 마치기"))).toBe(true);
      expect(isOnboardingComplete(f.context.db, f.context.secretBox)).toBe(false);
      expect(html).toMatch(/<div class="[^"]*"><p[^>]*>설정을 마치려면 이것을 정해요.</);
      const shown = text(html);
      for (const part of ["mapping", "progress", "label"] as const) {
        const guide = onboardingMessages.onboarding.mapping.missing[part];
        expect({ part, shown: shown.includes(guide) }).toEqual({
          part,
          shown: missing.includes(part),
        });
      }
    };
    await locked(["mapping", "progress", "label"]);
    const table = render(await page(f), "mapping");
    const shown = text(table);
    expect(shown).toContain(settingsMessages.settings.mapping.repos);
    expect(shown).toContain(settingsMessages.settings.mapping.agent);
    expect(shown).toContain("시작하면 옮길 상태");
    expect(shown).toContain("Auto-assign Label");
    expect(table).toContain('aria-label="Web Mapping"');
    expect(table).toContain('aria-label="Web의 기본 저장소 고르기"');
    expect(table).toContain('aria-label="Acme의 Auto-assign Label"');
    expect(table).not.toContain('name="model"');
    expect(shown).not.toContain(settingsMessages.settings.mapping.model);
    expect(
      buttonsOf(table)
        .filter((b) => b.variant !== "other")
        .map((b) => b.label),
    ).toEqual([settingsMessages.settings.mapping.reload, "이전", "설정 마치기"]);

    expect(
      saveMappingSetting(f.context, { ...project, runnerProjectId: repo, agentId: "claude" }),
    ).toEqual({ ok: true });
    await locked(["progress", "label"]);
    expect(render(await page(f), "mapping")).toContain('aria-label="아직 비어 있어요"');
    expect(saveInProgressState(f.context, { ...project, stateId: "st-doing" })).toEqual({
      ok: true,
    });
    await locked(["label"]);
    expect(render(await page(f), "mapping")).toContain('aria-label="다 채웠어요"');
    expect(saveLabel(f.context, { ws, connectionId: connectionId(f), labelId: "lb-auto" })).toEqual(
      { ok: true },
    );

    const settings = await page(f);
    const ready = render(settings, "mapping");
    expect(ready).toMatch(/<div class="[^"]*"><p[^>]*>라벨만 붙이면/);
    expect(text(ready)).toContain(onboardingMessages.onboarding.mapping.ready);
    expect(ONBOARDING_STEPS.every((step) => stepPassed(settings, step))).toBe(true);
    expect(isDisabled(nextButton(render(settings, "mapping"), "설정 마치기"))).toBe(false);
    expect(HOME_PATH).toBe("/");
    const settingsHtml = renderWithMessages(
      <SettingsScreen
        page={settings}
        runnerIssues={0}
        workspaceView="one"
        ws={ws}
        actions={noopActions}
        onCreateWorkspace={() => {}}
      />,
      settingsMessages,
    );
    expect(text(settingsHtml)).toContain("factory 라벨이면 바로 할당");
    expect(text(settingsHtml)).not.toContain(settingsMessages.settings.projects.noRepo);

    const complete = isOnboardingComplete(f.context.db, f.context.secretBox);
    expect(complete).toBe(true);
    for (const path of ["/", "/runs", "/settings"]) {
      expect({ path, to: onboardingRedirect(path, complete) }).toEqual({ path, to: null });
    }
    recordRunnerCheck(f.context.db, {
      runnerId,
      online: false,
      checkedAt: now,
      error: null,
      projects: null,
      assignmentBlocked: null,
    });
    expect(listRunners(f.context.db)[0]?.online).toBe(false);
    expect(isOnboardingComplete(f.context.db, f.context.secretBox)).toBe(true);
  });

  it("Mapping 보다 라벨과 상태를 먼저 정하면 Mapping 만 남았다고 안내한다(0042)", () => {
    const choice = { id: "c-1", name: "Acme" };
    const bound = {
      connection: choice,
      project: { id: "tp-web", name: "Web" },
      mapping: null,
      inProgressStateId: "st-doing",
      mergedStateId: null,
      trackerKind: "linear",
      states: { ok: true as const, items: [] },
      labels: { ok: true as const, items: [] },
    };
    const workspace = {
      general: {
        id: toWorkspaceId("ws-1"),
        name: "Acme",
        maxRunMinutes: 120,
        brief: { before: "", after: "" },
        agentProtocol: "",
      },
      trackerProjects: [],
      bound: [bound],
      labels: [
        {
          connection: choice,
          labelId: "lb-auto",
          labels: { ok: true as const, items: [] },
          repoLabels: [],
        },
      ],
    };
    expect(missingMappingParts(workspace)).toEqual(["mapping"]);
    expect(missingMappingParts({ ...workspace, bound: [] })).toEqual([
      "mapping",
      "progress",
      "label",
    ]);
    expect(
      missingMappingParts({
        ...workspace,
        bound: [
          {
            ...bound,
            mapping: {
              agent: "claude",
              model: null,
              repos: [{ id: "r", isDefault: true, labelId: null }],
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("이전 단계로 돌아갈 수 있다", async () => {
    const f = fixture();
    await connectTracker(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const settings = await page(f);
    expect(resolveStep(settings, 1)).toBe(0);
    expect(text(render(settings, "github"))).toContain("이전");
    expect(text(render(settings, "tracker"))).not.toContain("이전");
  });

  it("1단계는 API 키 하나만 묻고, 키 만드는 법과 webhook 없이 돌아가는 방식을 안내한다", async () => {
    const f = fixture();
    const html = render(await page(f), "tracker");
    const inputs = [...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(inputs).toEqual(["apiKey"]);
    const shown = text(html);
    expect(shown).toContain("API 키 만드는 법");
    expect(html).toContain('href="https://linear.app/settings/account/security"');
    expect(shown).toContain("webhook은 안 만들어도 되나요?");
    expect(shown).toContain("1분쯤마다");
    expect(shown).toContain("10초쯤 안에");
    expect(shown).toContain("끝난 런이 있던 티켓");
    expect(shown).toContain("하루 넘게 멈춰");
    expect(shown).toContain("아직 런이 없던 티켓");
    expect(shown).toContain("Tickets에서 직접 할당해요");
    expect(shown).not.toContain("signing secret");
    expect(shown).not.toContain("Webhook 경로");
    expect(
      buttonsOf(html)
        .filter((b) => b.variant === "primary")
        .map((b) => b.label),
    ).toEqual(["연결 확인"]);
  });

  it("트래커 연결을 마치면 조직 이름과 확인했다는 요약 한 줄만 보이고, 수정으로 폼을 다시 연다", async () => {
    const f = fixture();
    await connectTracker(f);
    const settings = await page(f);
    expect(settings.install.connections.map((c) => c.name)).toEqual(["Acme"]);
    const html = render(settings, "tracker");
    const shown = text(html);
    expect(shown).toContain("Acme 연결을 확인했어요");
    expect(html).not.toContain('name="apiKey"');
    expect(html).not.toContain(settings.install.connections[0]?.webhookPath ?? "?");
    const edit = buttonsOf(html).find((b) => b.label === "수정");
    expect(edit?.variant).toBe("secondary");
    expect(html).toMatch(/aria-expanded="false"[^>]*>수정</);
    expect(isDisabled(nextButton(html, "다음"))).toBe(false);
  });

  it("GitHub 단계: gh가 없으면 토큰 칸과 만드는 법을 펼쳐 두고 머지 권한까지 알린다 (0204)", async () => {
    const f = fixture();
    await connectTracker(f);
    const settings = await page(f);
    const github = await loadGitHubAuthView(f.context);
    expect(github).toEqual({ cli: { kind: "missing" }, tokenSaved: false, source: "none" });
    const before = render(settings, "github", [], github);
    const shown = text(before);
    expect(shown).toContain("GitHub에 연결해요");
    expect(shown).toContain("이 서버 기계의 gh 로그인을 먼저 써요");
    expect(shown).toContain("이 서버 기계에 gh가 없어요");
    expect(before).toMatch(/<details[^>]*\sopen=""/);
    expect(shown).toContain("대신 토큰 붙여 넣기");
    expect(before).toContain('href="https://github.com/settings/personal-access-tokens/new"');
    for (const word of [
      "Fine-grained token",
      "Resource owner",
      "Repository access",
      "Pull requests",
      "Metadata는 자동으로 들어가요",
      "Actions",
      "Contents",
      "Pull requests와 Contents 쓰기 권한",
      "조직 관리자가 토큰을 승인",
    ]) {
      expect({ word, shown: shown.includes(word) }).toEqual({ word, shown: true });
    }
    expect(before).toContain('name="token"');
    expect(buttonsOf(before).find((b) => b.label === "확인하고 저장")?.variant).toBe("primary");
    expect(buttonsOf(before).find((b) => b.label === "다시 확인")?.variant).toBe("secondary");

    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const after = await page(f);
    const saved = render(after, "github", [], await loadGitHubAuthView(f.context));
    expect(text(saved)).toContain("붙여 넣은 토큰도 저장해 뒀어요");
    expect(buttonsOf(saved).find((b) => b.label === "확인하고 저장")?.variant).toBe("secondary");
    expect(isDisabled(nextButton(saved, "다음"))).toBe(false);
  });

  it("GitHub 단계: gh에 로그인돼 있지 않으면 gh auth login 복사 칸과 다시 확인을 보이고 토큰 칸은 접어 둔다 (0204)", async () => {
    const f = fixture();
    await connectTracker(f);
    f.gh.scene = "logged-out";
    const github = await loadGitHubAuthView(f.context);
    expect(github.cli).toEqual({ kind: "logged-out", multiAccount: true });
    const html = render(await page(f), "github", [], github);
    const shown = text(html);
    expect(shown).toContain("gh에 로그인돼 있지 않아요");
    expect(html).toMatch(/<pre[^>]*aria-label="gh 로그인 명령"[^>]*>gh auth login<\/pre>/);
    expect(buttonsOf(html).map((b) => b.label)).toEqual(
      expect.arrayContaining(["복사", "다시 확인"]),
    );
    expect(html).not.toMatch(/<details[^>]*\sopen=""/);
    expect(shown).toContain("대신 토큰 붙여 넣기");
    expect(await checkGitHubConnection(f.context, now)).toEqual({
      ok: false,
      reason: "no-credentials",
    });
    expect(stepPassed(await page(f), "github")).toBe(false);
  });

  it("GitHub 단계: gh로 연결되면 계정과 볼 수 있는 곳을 보이고, 연결하면 토큰 없이 단계를 마친다 (0204)", async () => {
    const f = fixture();
    await connectTracker(f);
    f.gh.scene = "connected";
    const github = await loadGitHubAuthView(f.context);
    expect(github).toEqual({
      cli: {
        kind: "logged-in",
        multiAccount: true,
        accounts: [{ login: "acme-bot", active: true, owners: ["acme-bot", "acme"] }],
      },
      tokenSaved: false,
      source: "gh",
    });
    const html = render(await page(f), "github", [], github);
    const shown = text(html);
    expect(shown).toContain("gh로 연결했어요");
    expect(shown).toContain("acme-bot 활성");
    expect(shown).toContain("볼 수 있는 곳 · acme-bot, acme");
    expect(html).not.toContain(GH_TOKEN);
    expect(buttonsOf(html).find((b) => b.label === "이 로그인으로 연결")?.variant).toBe("primary");
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);

    expect(await checkGitHubConnection(f.context, now)).toEqual({ ok: true });
    const after = await page(f);
    expect(after.install.githubConnected).toBe(true);
    expect(after.install.githubToken).toBe(false);
    expect(stepPassed(after, "github")).toBe(true);
    const connected = render(after, "github", [], github);
    expect(buttonsOf(connected).find((b) => b.label === "다시 확인")?.variant).toBe("secondary");
    expect(isDisabled(nextButton(connected, "다음"))).toBe(false);
  });

  it("GitHub 단계는 낮은 gh 버전이면 활성 계정 하나만 쓴다고 알린다 (0204)", async () => {
    const f = fixture();
    await connectTracker(f);
    const html = render(
      await page(f),
      "github",
      [],
      githubView(await page(f), {
        kind: "logged-in",
        multiAccount: false,
        accounts: [{ login: "acme-bot", active: true, owners: null }],
      }),
    );
    expect(text(html)).toContain("gh 버전이 낮아 활성 계정 하나만 써요");
    expect(text(html)).toContain("볼 수 있는 곳을 읽지 못했어요");
  });

  it("Workspace 단계는 이름과 연결별 트래커 프로젝트 체크 목록을 한 폼으로 보이고, 다른 Workspace의 것은 고를 수 없다", async () => {
    const f = fixture();
    await connectTracker(f);
    const listed = await loadTrackerProjectChoices(f.context, null);
    const projects = listed.map((group) => ({
      ...group,
      projects: [
        ...group.projects,
        {
          id: "tp-mobile",
          name: "Mobile",
          owner: { kind: "other" as const, workspace: { id: "ws-labs", name: "Acme Labs" } },
          mappings: 0,
          queuedRuns: 0,
        },
      ],
    }));
    expect(listed[0]?.projects.map((p) => [p.name, p.owner.kind])).toEqual([["Web", "free"]]);
    const html = render(await page(f), "workspace", projects);
    const shown = text(html);
    expect(shown).toContain("Workspace 이름");
    expect(shown).toContain("넣을 트래커 프로젝트");
    expect(shown).toContain("Acme");
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="false"(?![^>]*disabled)/);
    expect(shown).toContain("Acme Labs에 있어요");
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="false"[^>]*aria-disabled="true"/);
    expect(buttonsOf(html).find((b) => b.label === "만들기")?.variant).toBe("primary");
  });

  it("Workspace 가 없을 때 트래커 프로젝트 목록은 Workspace 단계에서만 트래커에서 읽는다", async () => {
    const f = fixture();
    await connectTracker(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const runnerId = registerRunner(f);
    finishCheck(f, runnerId, health({ service: true, push: true }));
    const listProjects = vi.spyOn(f.tracker, "listProjects");

    for (const step of [1, 2, 3]) {
      expect((await loadOnboardingPage(f.context, step, now)).trackerProjects).toEqual([]);
    }
    expect(listProjects).not.toHaveBeenCalled();

    const atWorkspace = await loadOnboardingPage(f.context, 4, now);
    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(atWorkspace.trackerProjects[0]?.projects.map((p) => p.name)).toEqual(["Web"]);
    expect((await loadOnboardingPage(f.context, undefined, now)).trackerProjects).toHaveLength(1);
  });

  it("새 Workspace 는 있던 Workspace 를 고치지 않고 새 id 로 만들고, 못 넣으면 아무것도 남기지 않는다", async () => {
    const f = fixture();
    await connectTracker(f);
    const project = { connectionId: connectionId(f), projectId: webProject, name: "Web" };
    const free = { ...project, projectId: "tp-free", name: "Free" };
    expect(setUpFirstWorkspace(f.context, { name: "Acme", projects: [project] }, now)).toEqual({
      ok: true,
    });
    const first = listWorkspaces(f.context.db)[0]?.id;

    expect(createNewWorkspace(f.context, { name: "Labs", projects: [free, project] }, now)).toEqual(
      { ok: false, reason: "taken" },
    );
    expect(
      createNewWorkspace(
        f.context,
        { name: "Labs", projects: [free, { ...free, connectionId: "missing" }] },
        now,
      ),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(listWorkspaces(f.context.db).map((w) => w.name)).toEqual(["Acme"]);

    const created = createNewWorkspace(f.context, { name: "Labs", projects: [free] }, now);
    if (!created.ok) throw new Error(created.reason);
    expect(created.name).toBe("Labs");
    expect(created.id).not.toBe(first);
    const names = new Map(listWorkspaces(f.context.db).map((w) => [w.id, w.name]));
    expect(names.get(toWorkspaceId(created.id))).toBe("Labs");
    expect(first === undefined ? undefined : names.get(first)).toBe("Acme");
    expect(
      getWorkspaceTrackerProject(
        f.context.db,
        toTrackerConnectionId(free.connectionId),
        toTrackerProjectId(free.projectId),
      )?.workspaceId,
    ).toBe(created.id);
  });

  it("새 Workspace 입력은 트래커 프로젝트 하나 이상을 요구한다", () => {
    expect(newWorkspaceInput.safeParse({ name: "Labs", projects: [] }).success).toBe(false);
    expect(firstWorkspaceInput.safeParse({ name: "Labs", projects: [] }).success).toBe(true);
  });

  it("Workspace 를 만들면서 고른 트래커 프로젝트를 한 번에 넣고, 하나라도 못 넣으면 아무것도 만들지 않는다", async () => {
    const f = fixture();
    await connectTracker(f);
    const project = { connectionId: connectionId(f), projectId: webProject, name: "Web" };
    expect(
      setUpFirstWorkspace(
        f.context,
        { name: "Acme", projects: [project, { ...project, connectionId: "missing" }] },
        now,
      ),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(listWorkspaces(f.context.db)).toEqual([]);

    expect(setUpFirstWorkspace(f.context, { name: "Acme", projects: [project] }, now)).toEqual({
      ok: true,
    });
    const settings = await page(f);
    expect(settings.workspace?.bound.map((b) => b.project.name)).toEqual(["Web"]);
    expect(stepPassed(settings, "workspace")).toBe(true);
    const html = render(settings, "workspace");
    expect(text(html)).toContain("Acme Workspace");
    expect(text(html)).toContain("트래커 프로젝트 1개 · Web");

    expect(
      setUpFirstWorkspace(f.context, { name: "Acme Commerce", projects: [project] }, now),
    ).toEqual({ ok: true });
    expect(listWorkspaces(f.context.db).map((w) => w.name)).toEqual(["Acme Commerce"]);

    const taken = toTrackerProjectId("tp-taken");
    saveWorkspace(f.context.db, { id: toWorkspaceId("ws-labs"), name: "Acme Labs" }, now);
    saveWorkspaceTrackerProject(f.context.db, {
      workspaceId: toWorkspaceId("ws-labs"),
      connection: connectionId(f),
      projectId: taken,
      name: "Taken",
      inProgressStateId: null,
    });
    expect(
      setUpFirstWorkspace(
        f.context,
        {
          name: "Renamed",
          projects: [{ ...project, projectId: taken, name: "Taken" }],
        },
        now,
      ),
    ).toEqual({ ok: false, reason: "taken" });
    expect(listWorkspaces(f.context.db)[0]?.name).toBe("Acme Commerce");
  });

  it("단계 없는 주소로 들어와 트래커 연결을 저장하면 1단계에 머물고 연결 요약이 보인다", async () => {
    const f = fixture();
    const step = stepToPin(await page(f), undefined);
    expect(step).toBe(1);
    expect(stepToPin(await page(f), step ?? undefined)).toBeNull();

    await connectTracker(f);
    const settings = await page(f);
    const index = resolveStep(settings, step ?? undefined);
    expect(index).toBe(0);
    expect(stepToPin(settings, step ?? undefined)).toBeNull();
    const html = render(settings, ONBOARDING_STEPS[index] ?? "github");
    expect(text(html)).toContain("연결을 확인했어요");
    expect(isDisabled(nextButton(html, "다음"))).toBe(false);
  });

  it("갈 수 없는 뒤 단계 주소로 들어와도 보이는 단계를 주소에 넣어, 저장 뒤 1단계에 머문다", async () => {
    const f = fixture();
    const step = stepToPin(await page(f), 3);
    expect(step).toBe(1);
    await connectTracker(f);
    expect(resolveStep(await page(f), step ?? undefined)).toBe(0);
  });
});
