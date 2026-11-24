// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProjects, TrackerProjectChoice } from "@ganger/app/settings/model";
import { NO_TODO } from "@ganger/app/shell/model";
import type { ShellData } from "@ganger/app/shell/model";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import { toWorkspaceId } from "@ganger/db";
import { appMessages, defaultLocale } from "../i18n";
import { settingsMessages } from "../settings/messages";
import { NoWorkspace } from "../settings/settings-page";
import { WorkspaceSwitcher } from "./app-shell";
import { CreateWorkspaceProvider, useOpenCreateWorkspace } from "./create-workspace";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";
import type {
  CreateWorkspaceDialogProps,
  CreateWorkspaceInput,
  CreateWorkspaceResult,
} from "./create-workspace-dialog";
import { openEditorField, registerUnsavedEditsHolder } from "../settings/blocked-editor";
import {
  canCreateWorkspace,
  isAtCreatedWorkspace,
  pickedProjects,
  projectChoiceNotice,
} from "./create-workspace-model";

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn<(input: unknown) => Promise<CreateWorkspaceResult>>(),
  getChoices: vi.fn<() => Promise<ConnectionProjects[]>>(),
  navigate: vi.fn<(options: unknown) => Promise<void>>(),
  invalidate: vi.fn<(client: unknown, kinds: ReadonlyArray<string>) => Promise<void>>(),
  toast: vi.fn<(message: string) => void>(),
}));

vi.mock("../server/onboarding-functions", () => ({
  createWorkspace: mocks.createWorkspace,
  getWorkspaceProjectChoices: mocks.getChoices,
}));

vi.mock("@ganger/db", () => ({ toWorkspaceId: (value: string) => value }));

vi.mock("../settings/settings-query", () => ({ invalidateChanged: mocks.invalidate }));

vi.mock("./shell-query", () => ({ SHELL_KEY: ["shell"] }));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="/settings" {...(className === undefined ? {} : { className })}>
      {children}
    </a>
  ),
}));

vi.mock("@ganger/ui", async (original) => ({
  ...(await original<typeof import("@ganger/ui")>()),
  showToast: mocks.toast,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(Element.prototype, { getAnimations: () => [], scrollIntoView: () => {} });
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

const copy = appMessages.shell.workspace.create;
const ALL_TAKEN = "모든 트래커 프로젝트가 다른 Workspace에 있어요.";

function project(id: string, owner: TrackerProjectChoice["owner"]): TrackerProjectChoice {
  return { id, name: id, owner, mappings: 0, queuedRuns: 0 };
}

const taken = { kind: "other", workspace: { id: "ws-a", name: "Acme" } } as const;

function group(projects: TrackerProjectChoice[], error: ConnectionProjects["error"] = null) {
  return { connection: { id: "conn", name: "Linear" }, error, projects };
}

const mixed = [group([project("Web", taken), project("Free", { kind: "free" })])];

let host: HTMLDivElement;
let root: Root;

function wrapped(node: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={defaultLocale}
        messages={{ ...appMessages, ...settingsMessages }}
        timeZone={DEFAULT_TIME_ZONE}
      >
        {node}
      </IntlProvider>
    </QueryClientProvider>
  );
}

async function settle(work: () => void = () => {}): Promise<void> {
  await act(async () => {
    work();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function dialogProps(
  overrides: Partial<CreateWorkspaceDialogProps> = {},
): CreateWorkspaceDialogProps {
  return {
    open: true,
    onOpenChange: () => {},
    finalFocus: () => null,
    choices: { kind: "ready", groups: mixed },
    onRetry: () => {},
    onCreate: () => Promise.resolve({ ok: true, id: "ws-new", name: "Labs" }),
    renderSettingsLink: ({ children, className }) => (
      <a href="/settings" {...(className === undefined ? {} : { className })}>
        {children}
      </a>
    ),
    ...overrides,
  };
}

function buttonNamed(name: string): HTMLButtonElement {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  const found = [...scope.querySelectorAll("button")].find((button) =>
    button.textContent.includes(name),
  );
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
}

function checkbox(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const label = labelledBy === null ? null : document.getElementById(labelledBy);
    return (label?.textContent ?? element.closest("label")?.textContent ?? "").includes(name);
  });
  if (found === undefined) throw new Error(`no checkbox ${name}`);
  return found;
}

function nameInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[name="name"]');
  if (input === null) throw new Error("no name input");
  return input;
}

function typeName(value: string): void {
  Reflect.set(HTMLInputElement.prototype, "value", value, nameInput());
  nameInput().dispatchEvent(new Event("input", { bubbles: true }));
}

const isDisabled = (element: HTMLElement) =>
  element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.navigate.mockResolvedValue(undefined);
  mocks.getChoices.mockResolvedValue(mixed);
});

afterEach(async () => {
  await settle(() => root.unmount());
  host.remove();
});

describe("고를 수 있는 트래커 프로젝트", () => {
  it("모두 다른 Workspace 에 있을 때만 고를 것 없음 안내를 낸다", () => {
    expect(projectChoiceNotice([group([project("Web", taken)])])).toBe("all-taken");
    expect(projectChoiceNotice(mixed)).toBeNull();
    expect(projectChoiceNotice([])).toBe("no-connections");
    expect(projectChoiceNotice([group([])])).toBeNull();
  });

  it("읽지 못한 연결이 있으면 모두 다른 Workspace 에 있다고 단정하지 않는다", () => {
    expect(projectChoiceNotice([group([project("Web", taken)], "network")])).toBeNull();
  });

  it("다른 Workspace 로 넘어간 프로젝트는 고른 값에서 빠진다", () => {
    const key = "conn\nFree";
    expect(pickedProjects(mixed, new Set([key]))).toEqual([
      { connectionId: "conn", projectId: "Free", name: "Free" },
    ]);
    expect(pickedProjects([group([project("Free", taken)])], new Set([key]))).toEqual([]);
  });

  it("이름과 프로젝트가 모두 있어야 만들 수 있다", () => {
    const one = [{ connectionId: "conn", projectId: "Free", name: "Free" }];
    expect(canCreateWorkspace("Labs", one)).toBe(true);
    expect(canCreateWorkspace("   ", one)).toBe(false);
    expect(canCreateWorkspace("Labs", [])).toBe(false);
    expect(canCreateWorkspace("가".repeat(200), one)).toBe(true);
    expect(canCreateWorkspace("가".repeat(201), one)).toBe(false);
  });
});

describe("새 Workspace 대화상자", () => {
  it("이름과 프로젝트를 모두 넣어야 만들기가 열리고, 다른 Workspace 프로젝트는 고를 수 없다", async () => {
    const onCreate = vi.fn<(input: CreateWorkspaceInput) => Promise<CreateWorkspaceResult>>(() =>
      Promise.resolve({ ok: true, id: "ws-new", name: "Labs" }),
    );
    await settle(() =>
      root.render(wrapped(<CreateWorkspaceDialog {...dialogProps({ onCreate })} />)),
    );

    expect(isDisabled(buttonNamed(copy.submit))).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Web");
    expect(document.body.textContent).not.toContain("Acme에 있어요");
    expect(document.body.textContent).toContain("다른 Workspace에 있는 1개는 숨겼어요.");

    await settle(() => typeName("  Labs  "));
    expect(isDisabled(buttonNamed(copy.submit))).toBe(true);
    await settle(() => checkbox("Free").click());
    expect(isDisabled(buttonNamed(copy.submit))).toBe(false);

    await settle(() => buttonNamed(copy.submit).click());
    expect(onCreate).toHaveBeenCalledWith({
      name: "Labs",
      projects: [{ connectionId: "conn", projectId: "Free", name: "Free" }],
    });
  });

  function connectionGroup(
    id: string,
    projects: TrackerProjectChoice[],
    error: ConnectionProjects["error"] = null,
  ): ConnectionProjects {
    return { connection: { id, name: id }, error, projects };
  }

  const free = (id: string) => project(id, { kind: "free" });

  async function renderGroups(groups: ConnectionProjects[]): Promise<void> {
    await settle(() =>
      root.render(
        wrapped(<CreateWorkspaceDialog {...dialogProps({ choices: { kind: "ready", groups } })} />),
      ),
    );
  }

  function toggleOf(connection: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(
      `[aria-expanded][aria-label^="${connection} "]`,
    );
    if (found === null) throw new Error(`no toggle ${connection}`);
    return found;
  }

  it("연결이 하나면 펼쳐 열고, 여럿이면 모두 접어 열며 따로 펼칠 수 있다", async () => {
    await renderGroups([connectionGroup("Solo", [free("One")])]);
    expect(toggleOf("Solo").getAttribute("aria-expanded")).toBe("true");
    expect(checkbox("One")).toBeDefined();

    await settle(() => root.render(wrapped(<div />)));
    await renderGroups([
      connectionGroup("Linear A", [free("One")]),
      connectionGroup("Linear B", [free("Two")]),
    ]);
    expect(toggleOf("Linear A").getAttribute("aria-expanded")).toBe("false");
    expect(toggleOf("Linear B").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("One");

    await settle(() => toggleOf("Linear B").click());
    expect(toggleOf("Linear A").getAttribute("aria-expanded")).toBe("false");
    expect(toggleOf("Linear B").getAttribute("aria-expanded")).toBe("true");
    expect(checkbox("Two")).toBeDefined();
  });

  it("머리 체크박스가 전체를 고르고 풀며, 일부만 고르면 일부 상태를 보인다", async () => {
    await renderGroups([
      connectionGroup("Solo", [free("One"), free("Two"), project("Web", taken)]),
    ]);
    const head = () => checkbox("Solo");
    const dialogText = () => document.querySelector('[role="dialog"]')?.textContent;
    expect(head().getAttribute("aria-checked")).toBe("false");
    expect(dialogText()).toContain("0개 고름 · 2개 넣을 수 있어요");

    await settle(() => checkbox("One").click());
    expect(head().getAttribute("aria-checked")).toBe("mixed");
    expect(dialogText()).toContain("1개 고름 · 2개 넣을 수 있어요");

    await settle(() => head().click());
    expect(head().getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Two").getAttribute("aria-checked")).toBe("true");
    expect(dialogText()).toContain("2개 모두 고름");

    await settle(() => head().click());
    expect(head().getAttribute("aria-checked")).toBe("false");
    expect(checkbox("One").getAttribute("aria-checked")).toBe("false");
  });

  it("접힌 묶음을 머리로 고르면 만들기가 열리고 그 프로젝트를 보낸다", async () => {
    const onCreate = vi.fn<(input: CreateWorkspaceInput) => Promise<CreateWorkspaceResult>>(() =>
      Promise.resolve({ ok: true, id: "ws-new", name: "Labs" }),
    );
    const groups = [
      connectionGroup("Linear A", [free("One")]),
      connectionGroup("Linear B", [free("Two")]),
    ];
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceDialog
            {...dialogProps({ onCreate, choices: { kind: "ready", groups } })}
          />,
        ),
      ),
    );
    await settle(() => typeName("Labs"));
    expect(isDisabled(buttonNamed(copy.submit))).toBe(true);
    await settle(() => checkbox("Linear B").click());
    expect(isDisabled(buttonNamed(copy.submit))).toBe(false);
    await settle(() => buttonNamed(copy.submit).click());
    expect(onCreate).toHaveBeenCalledWith({
      name: "Labs",
      projects: [{ connectionId: "Linear B", projectId: "Two", name: "Two" }],
    });
  });

  it("넣을 수 없는 연결은 머리를 막고 펼치기를 없앤다", async () => {
    await renderGroups([
      connectionGroup("Linear A", [project("Web", taken)]),
      connectionGroup("Linear B", [free("Two")]),
    ]);
    expect(isDisabled(checkbox("Linear A"))).toBe(true);
    expect(document.querySelector('[aria-expanded][aria-label^="Linear A "]')).toBeNull();
    expect(document.body.textContent).toContain(copy.groupNone);
    expect(document.body.textContent).toContain("다른 Workspace에 있는 1개는 숨겼어요.");
    expect(document.body.textContent).not.toContain(ALL_TAKEN);
  });

  it("읽지 못한 연결은 없다고 단정하지 않고 읽지 못했다고 보인다", async () => {
    await renderGroups([
      connectionGroup("Linear A", [], "network"),
      connectionGroup("Linear B", [free("Two")]),
    ]);
    expect(isDisabled(checkbox("Linear A"))).toBe(true);
    expect(document.body.textContent).toContain(copy.groupFailed);
    expect(document.body.textContent).not.toContain(copy.groupNone);
  });

  it("모두 다른 Workspace 에 있으면 숨긴 개수 대신 Settings 안내만 보인다", async () => {
    await renderGroups([connectionGroup("Linear A", [project("Web", taken)])]);
    expect(document.body.textContent).toContain(ALL_TAKEN);
    expect(document.body.textContent).not.toContain("숨겼어요");
  });

  it("고를 것이 없으면 Settings 링크가 있는 안내를 보이고 만들기를 막는다", async () => {
    const groups = [group([project("Web", taken)])];
    await settle(() =>
      root.render(
        wrapped(<CreateWorkspaceDialog {...dialogProps({ choices: { kind: "ready", groups } })} />),
      ),
    );
    await settle(() => typeName("Labs"));
    expect(document.body.textContent).toContain(ALL_TAKEN);
    expect(document.querySelector('[role="dialog"] a[href="/settings"]')?.textContent).toBe(
      "Settings",
    );
    expect(isDisabled(buttonNamed(copy.submit))).toBe(true);
  });

  it("서버가 거절하면 이유를 보이고 다시 만들 수 있다", async () => {
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceDialog
            {...dialogProps({ onCreate: () => Promise.resolve({ ok: false, reason: "taken" }) })}
          />,
        ),
      ),
    );
    await settle(() => typeName("Labs"));
    await settle(() => checkbox("Free").click());
    await settle(() => buttonNamed(copy.submit).click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy.error.taken);
    expect(isDisabled(buttonNamed(copy.submit))).toBe(false);
  });

  it("보내는 동안에는 닫을 수 없다", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const pending = new Promise<never>(() => {});
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceDialog {...dialogProps({ onOpenChange, onCreate: () => pending })} />,
        ),
      ),
    );
    await settle(() => typeName("Labs"));
    await settle(() => checkbox("Free").click());
    await settle(() => buttonNamed(copy.submit).click());
    expect(isDisabled(buttonNamed(copy.close))).toBe(true);
    await settle(() => buttonNamed(copy.close).click());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("목록을 읽지 못하면 다시 읽을 수 있다", async () => {
    const onRetry = vi.fn<() => void>();
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceDialog {...dialogProps({ choices: { kind: "failed" }, onRetry })} />,
        ),
      ),
    );
    expect(document.body.textContent).toContain(copy.loadFailed);
    await settle(() => buttonNamed(copy.retry).click());
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

function OpenButton() {
  const open = useOpenCreateWorkspace();
  return <NoWorkspace view="none" onCreate={open} />;
}

describe("입구와 만든 뒤", () => {
  it("Settings 빈 상태의 만들기가 같은 대화상자를 열고, 만들면 새 Workspace 의 Settings 프로젝트로 간다", async () => {
    mocks.createWorkspace.mockResolvedValue({ ok: true, id: "ws-new", name: "Labs" });
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceProvider>
            <OpenButton />
          </CreateWorkspaceProvider>,
        ),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await settle(() => buttonNamed(settingsMessages.settings.workspace.create).click());
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(copy.title);

    await settle(() => typeName("Labs"));
    await settle(() => checkbox("Free").click());
    await settle(() => buttonNamed(copy.submit).click());
    await settle();

    expect(mocks.createWorkspace).toHaveBeenCalledWith({
      data: {
        name: "Labs",
        projects: [{ connectionId: "conn", projectId: "Free", name: "Free" }],
      },
    });
    expect(mocks.invalidate).toHaveBeenCalledWith(expect.anything(), ["workspace"]);
    expect(mocks.toast).toHaveBeenCalledWith("Labs Workspace를 만들었어요");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { ws: "ws-new" },
      hash: "projects",
    });
  });

  it("저장하지 않은 편집이 이동을 막아도 대화상자는 닫힌다", async () => {
    mocks.createWorkspace.mockResolvedValue({ ok: true, id: "ws-new", name: "Labs" });
    mocks.navigate.mockReturnValue(new Promise<void>(() => {}));
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceProvider>
            <OpenButton />
          </CreateWorkspaceProvider>,
        ),
      ),
    );
    await settle(() => buttonNamed(settingsMessages.settings.workspace.create).click());
    await settle();
    await settle(() => typeName("Labs"));
    await settle(() => checkbox("Free").click());
    await settle(() => buttonNamed(copy.submit).click());
    await settle();
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("막혔던 이동이 다음 이동 때 끝나도 프로젝트 구역으로 포커스를 옮기지 않는다", async () => {
    mocks.createWorkspace.mockResolvedValue({ ok: true, id: "ws-new", name: "Labs" });
    let finishNavigation = () => {};
    mocks.navigate.mockReturnValue(
      new Promise<void>((resolve) => {
        finishNavigation = resolve;
      }),
    );
    const heading = document.createElement("h2");
    heading.id = "projects-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceProvider>
            <OpenButton />
          </CreateWorkspaceProvider>,
        ),
      ),
    );
    await settle(() => buttonNamed(settingsMessages.settings.workspace.create).click());
    await settle();
    await settle(() => typeName("Labs"));
    await settle(() => checkbox("Free").click());
    await settle(() => buttonNamed(copy.submit).click());
    await settle();
    const other = buttonNamed(settingsMessages.settings.workspace.create);
    other.focus();
    await settle(() => finishNavigation());
    expect(document.activeElement).toBe(other);
    heading.remove();
  });

  it("도착한 주소가 새 Workspace 의 프로젝트 구역일 때만 도착으로 본다", () => {
    const base = "https://ganger.example.com/settings";
    expect(isAtCreatedWorkspace(`${base}?ws=ws-new#projects`, "ws-new")).toBe(true);
    expect(isAtCreatedWorkspace(`${base}?ws=ws-a#projects`, "ws-new")).toBe(false);
    expect(isAtCreatedWorkspace(`${base}?ws=ws-new`, "ws-new")).toBe(false);
    expect(
      isAtCreatedWorkspace("https://ganger.example.com/runs?ws=ws-new#projects", "ws-new"),
    ).toBe(false);
  });

  it("저장하지 않은 편집이 있으면 이미 경고했어도 새 Workspace 로 옮기지 않는다", async () => {
    mocks.createWorkspace.mockResolvedValue({ ok: true, id: "ws-new", name: "Labs" });
    const warnIfUnsaved = vi.fn<() => boolean>(() => true);
    const unregister = registerUnsavedEditsHolder({ warnIfUnsaved });
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceProvider>
            <OpenButton />
          </CreateWorkspaceProvider>,
        ),
      ),
    );
    await settle(() => buttonNamed(settingsMessages.settings.workspace.create).click());
    await settle();
    await settle(() => typeName("Labs"));
    await settle(() => checkbox("Free").click());
    await settle(() => buttonNamed(copy.submit).click());
    await settle();
    unregister();
    expect(warnIfUnsaved).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith("Labs Workspace를 만들었어요");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("프로젝트 상세의 편집 구역도 막힌 편집 칸으로 찾는다", () => {
    const section = document.createElement("section");
    section.id = "repo";
    const input = document.createElement("input");
    section.append(input);
    document.body.append(section);
    expect(openEditorField()).toBe(input);
    section.remove();
    expect(openEditorField()).toBeNull();
  });

  it("다시 열면 지난 목록을 보이지 않고 새로 읽는다", async () => {
    await settle(() =>
      root.render(
        wrapped(
          <CreateWorkspaceProvider>
            <OpenButton />
          </CreateWorkspaceProvider>,
        ),
      ),
    );
    await settle(() => buttonNamed(settingsMessages.settings.workspace.create).click());
    await settle();
    expect(document.body.textContent).toContain("Free");
    await settle(() => buttonNamed(copy.close).click());
    await settle();
    mocks.getChoices.mockReturnValue(new Promise<ConnectionProjects[]>(() => {}));
    await settle(() => buttonNamed(settingsMessages.settings.workspace.create).click());
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(copy.loading);
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Free");
  });

  it("Workspace 메뉴 맨 끝의 새 Workspace 가 대화상자를 연다. 전체 보기에서도 같다", async () => {
    const onCreateWorkspace = vi.fn<(focusBack: HTMLElement | null) => void>();
    const shell: ShellData = {
      workspaces: [{ id: toWorkspaceId("ws-a"), name: "Acme" }],
      runnerIssues: 0,
      todo: NO_TODO,
    };
    await settle(() =>
      root.render(
        wrapped(
          <WorkspaceSwitcher
            shell={shell}
            workspace={{ kind: "all" }}
            onWorkspaceChange={() => {}}
            onCreateWorkspace={onCreateWorkspace}
          />,
        ),
      ),
    );
    await settle(() => {
      const trigger = host.querySelector("button");
      trigger?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger?.click();
    });
    await settle();
    const items = [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "Acme",
      appMessages.shell.workspace.all,
      appMessages.shell.workspace.new,
    ]);
    const added = items.at(-1);
    expect(added?.getAttribute("role")).toBe("menuitem");
    expect(added?.querySelector("svg")).not.toBeNull();
    await settle(() => {
      if (added instanceof HTMLElement) added.click();
    });
    expect(onCreateWorkspace).toHaveBeenCalledOnce();
  });
});
