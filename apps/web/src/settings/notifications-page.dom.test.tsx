// @vitest-environment jsdom
import { DESKTOP_NOTIFICATIONS_GLOBAL } from "@ganger/app/notifications/desktop";
import type {
  NotificationPrefs,
  NotificationSettingsView,
  PermissionRequestResult,
  TestNotificationResult,
} from "@ganger/app/notifications/desktop";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { appMessages, defaultLocale } from "../i18n";
import { desktopNotifications } from "../shell/desktop-notifications";
import { settingsMessages } from "./messages";
import { NotificationsScreen, type NotificationsBridge } from "./notifications-page";

const t = settings.notifications;

const allOn: NotificationSettingsView = {
  enabled: true,
  groups: {
    question: true,
    permission: true,
    humanCheckRequest: true,
    failedDisconnected: true,
    runnerIssue: true,
  },
  permission: "allowed",
  deviceLink: "connected",
};

function fakeDesktop(first: NotificationSettingsView) {
  const calls: unknown[] = [];
  const listeners = new Set<(view: unknown) => void>();
  const behaviour = {
    failSave: false,
    grant: false,
    testResult: "sent" as TestNotificationResult,
  };
  const push = (view: NotificationSettingsView) => {
    for (const listener of listeners) listener(view);
  };
  const raw = {
    getSettings: () => Promise.resolve(first),
    onSettings: (listener: (view: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    saveSettings: (prefs: NotificationPrefs) => {
      calls.push({ set: prefs });
      return behaviour.failSave ? Promise.reject(new Error("save failed")) : Promise.resolve();
    },
    requestPermission: (): Promise<PermissionRequestResult> => {
      calls.push("request");
      push({ ...first, permission: behaviour.grant ? "allowed" : "denied" });
      return Promise.resolve(behaviour.grant ? "allowed" : "not-allowed");
    },
    sendTest: (): Promise<TestNotificationResult> => {
      calls.push("test");
      if (behaviour.testResult === "denied") push({ ...first, permission: "denied" });
      return Promise.resolve(behaviour.testResult);
    },
    openSystemSettings: () => {
      calls.push("open-system");
    },
    openFocusSettings: () => {
      calls.push("open-focus");
    },
    reconnectDevice: () => {
      calls.push("reconnect");
      push({ ...first, deviceLink: "reconnected" });
    },
  };
  const bridge = desktopNotifications({ [DESKTOP_NOTIFICATIONS_GLOBAL]: raw });
  if (bridge === null) throw new Error("bridge did not parse");
  return { bridge, calls, behaviour, push };
}

let container: HTMLDivElement;
let root: Root;

async function draw(bridge: NotificationsBridge) {
  await act(async () => {
    root.render(
      <IntlProvider
        locale={defaultLocale}
        messages={{ ...appMessages, ...settingsMessages }}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <NotificationsScreen bridge={bridge} nav={null} />
      </IntlProvider>,
    );
    await Promise.resolve();
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name || candidate.textContent?.startsWith(name),
  );
  if (button === undefined) throw new Error(`${name} 버튼이 없다`);
  return button;
}

function switchNamed(name: string): HTMLElement {
  const label = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.textContent === name,
  );
  const id = label?.getAttribute("for");
  const control = id === null || id === undefined ? null : document.getElementById(id);
  if (control === null) throw new Error(`${name} 스위치가 없다`);
  return control;
}

async function press(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

const text = () => container.textContent;
const statusTexts = () =>
  [...container.querySelectorAll('[role="status"]')].map((node) => node.textContent);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("알림 페이지(0214)", () => {
  it("브라우저에서는 데스크톱 앱에서 받는다는 한 줄만 보인다", async () => {
    await draw(null);
    expect(text()).toContain(t.browser);
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("데스크톱 앱에서는 알림 받기와 들여 쓴 종류 다섯 줄을 스위치로 보인다", async () => {
    const { bridge } = fakeDesktop(allOn);
    await draw(bridge);
    expect(switchNamed(t.enabled.label).getAttribute("aria-checked")).toBe("true");
    for (const group of Object.values(t.groups)) {
      expect(switchNamed(group.label).getAttribute("aria-checked")).toBe("true");
    }
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(6);
  });

  it("종류 하나를 끄면 그 값만 저장하고, 전체를 끄면 종류는 고를 수 없다", async () => {
    const { bridge, calls } = fakeDesktop(allOn);
    await draw(bridge);
    await press(switchNamed(t.groups.failedDisconnected.label));
    expect(calls).toContainEqual({
      set: { enabled: true, groups: { ...allOn.groups, failedDisconnected: false } },
    });
    await press(switchNamed(t.enabled.label));
    expect(calls).toContainEqual({
      set: { enabled: false, groups: { ...allOn.groups, failedDisconnected: false } },
    });
    const question = switchNamed(t.groups.question.label);
    expect(
      question.hasAttribute("disabled") || question.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });

  it("저장에 실패하면 바꾸기 전 값으로 되돌린다", async () => {
    const { bridge, calls, behaviour } = fakeDesktop(allOn);
    behaviour.failSave = true;
    await draw(bridge);
    await press(switchNamed(t.groups.question.label));
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toHaveLength(1);
    expect(switchNamed(t.groups.question.label).getAttribute("aria-checked")).toBe("true");
  });

  it("허용했으면 허용 문구와 도움말, 시험 알림·시스템 설정 버튼을 보인다(A)", async () => {
    const { bridge, calls } = fakeDesktop(allOn);
    await draw(bridge);
    const card = container.querySelector(
      `[role="group"][aria-label="${t.permission.allowed.title}"]`,
    );
    expect(card).not.toBeNull();
    expect(
      card?.querySelector(`[aria-label="${t.permission.allowed.title} 도움말"]`),
    ).not.toBeNull();
    await press(buttonNamed(t.permission.openSettings));
    expect(calls).toEqual(["open-system"]);
    expect(text()).not.toContain(t.permission.notAsked.action);
  });

  it("아직 묻지 않았으면 노란 허용하기 버튼만 보이고, 누르기 전에는 묻지 않는다(B)", async () => {
    const { bridge, calls } = fakeDesktop({ ...allOn, permission: "not-asked" });
    await draw(bridge);
    expect(text()).toContain(t.permission.notAsked.body);
    expect(buttonNamed(t.permission.notAsked.action).getAttribute("data-variant")).toBe("primary");
    expect(text()).not.toContain(t.permission.test);
    expect(calls).toEqual([]);
  });

  it("허용하기를 누르면 macOS 에 묻고, 허용하지 않으면 꺼짐 안내(C)와 이유를 보인다", async () => {
    const { bridge, calls } = fakeDesktop({ ...allOn, permission: "not-asked" });
    await draw(bridge);
    await press(buttonNamed(t.permission.notAsked.action));
    expect(calls).toEqual(["request"]);
    expect(text()).toContain(t.permissionOff.title);
    expect(statusTexts()).toContain(t.permission.notAsked.notAllowed);
    expect(document.activeElement?.getAttribute("role")).toBe("status");
  });

  it("허용하기에서 허용하면 A 로 바뀐다", async () => {
    const { bridge, behaviour } = fakeDesktop({ ...allOn, permission: "not-asked" });
    behaviour.grant = true;
    await draw(bridge);
    await press(buttonNamed(t.permission.notAsked.action));
    expect(text()).toContain(t.permission.allowed.title);
  });

  it("권한을 읽지 못하면 그 사실과 시험 알림·시스템 설정을 보인다", async () => {
    const { bridge } = fakeDesktop({ ...allOn, permission: "unknown" });
    await draw(bridge);
    expect(text()).toContain(t.permission.unknown.title);
    expect(buttonNamed(t.permission.test)).toBeDefined();
    expect(buttonNamed(t.permission.openSettings)).toBeDefined();
  });

  it("시험 알림을 보내면 확인 순서 셋과 집중 모드 설정 링크를 보인다(D)", async () => {
    const { bridge, calls } = fakeDesktop(allOn);
    await draw(bridge);
    await press(buttonNamed(t.permission.test));
    expect(text()).toContain(t.testResult.sent);
    expect(container.querySelectorAll('[role="status"] li')).toHaveLength(3);
    const link = [...container.querySelectorAll("a")].find(
      (candidate) => candidate.textContent === t.testResult.focusLink,
    );
    if (link === undefined) throw new Error("집중 모드 링크가 없다");
    await press(link);
    expect(calls).toEqual(["test", "open-focus"]);
  });

  it("권한 때문에 시험 알림이 실패하면 권한 문제라고 알리고 꺼짐 안내로 바꾼다", async () => {
    const { bridge, behaviour } = fakeDesktop({ ...allOn, permission: "unknown" });
    behaviour.testResult = "denied";
    await draw(bridge);
    await press(buttonNamed(t.permission.test));
    expect(statusTexts()).toContain(t.testResult.denied);
    expect(text()).toContain(t.permissionOff.title);
  });

  it("서명하지 않은 빌드에서 실패하면 서명 문제라고 알린다", async () => {
    const { bridge, behaviour } = fakeDesktop(allOn);
    behaviour.testResult = "unsigned";
    await draw(bridge);
    await press(buttonNamed(t.permission.test));
    expect(statusTexts()).toContain(t.testResult.unsigned);
  });

  it("기기가 지워지면 다시 연결 안내를 보이고, 누르면 등록하고 결과 문장에 포커스를 둔다", async () => {
    const { bridge, calls } = fakeDesktop({ ...allOn, deviceLink: "rejected" });
    await draw(bridge);
    expect(text()).toContain(t.deviceLink.title);
    expect(calls).toEqual([]);
    await press(buttonNamed(t.deviceLink.action));
    expect(calls).toEqual(["reconnect"]);
    expect(text()).not.toContain(t.deviceLink.title);
    expect(document.activeElement?.textContent).toBe(t.deviceLink.done);
  });

  it("v1 이 없는 옛 서버면 서버를 업데이트해야 알림을 받는다고 안내한다", async () => {
    const { bridge } = fakeDesktop({ ...allOn, deviceLink: "unsupported" });
    await draw(bridge);
    expect(text()).toContain(t.deviceLink.unsupportedTitle);
    expect(text()).toContain(t.deviceLink.unsupportedBody);
  });
});

describe("데스크톱 알림 다리(0214)", () => {
  it("모양이 맞지 않는 다리는 받지 않는다", () => {
    expect(desktopNotifications({})).toBeNull();
    expect(desktopNotifications({ [DESKTOP_NOTIFICATIONS_GLOBAL]: { getSettings: 1 } })).toBeNull();
  });

  it("다리에서 받은 설정 값은 스키마로 읽고, 모르는 권한 값은 못 읽음으로 본다", async () => {
    const { bridge } = fakeDesktop(allOn);
    expect(await bridge.current()).toEqual(allOn);
    const odd = desktopNotifications({
      [DESKTOP_NOTIFICATIONS_GLOBAL]: {
        getSettings: () => Promise.resolve({ ...allOn, permission: "weird" }),
        onSettings: () => () => {},
        saveSettings: () => Promise.resolve(),
        requestPermission: () => Promise.resolve("allowed"),
        sendTest: () => Promise.resolve("sent"),
        openSystemSettings: () => {},
        openFocusSettings: () => {},
        reconnectDevice: () => {},
      },
    });
    expect((await odd?.current())?.permission).toBe("unknown");
  });
});
