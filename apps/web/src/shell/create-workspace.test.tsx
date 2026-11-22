// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProjects, TrackerProjectChoice } from "@ganger/app/settings/model";
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
import { canCreateWorkspace, pickedProjects, projectChoiceNotice } from "./create-workspace-model";

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
    expect(isDisabled(checkbox("Web"))).toBe(true);
    expect(document.body.textContent).toContain("Acme에 있어요");

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

  it("Workspace 메뉴 맨 끝의 새 Workspace 가 대화상자를 연다. 전체 보기에서도 같다", async () => {
    const onCreateWorkspace = vi.fn<(focusBack: HTMLElement | null) => void>();
    const shell: ShellData = {
      workspaces: [{ id: toWorkspaceId("ws-a"), name: "Acme" }],
      runnerIssues: 0,
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
