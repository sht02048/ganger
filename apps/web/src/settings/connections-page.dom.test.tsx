// @vitest-environment jsdom
import type { SettingsPage, TrackerConnectionView } from "@ganger/app/settings/model";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import settings from "../../messages/ko/settings.json" with { type: "json" };
import { appMessages, defaultLocale } from "../i18n";
import { ConnectionsScreen } from "./connections-page";
import { settingsMessages } from "./messages";
import { WEBHOOK_ADDRESS_ROW_ID, plainSettingsLink } from "./settings-page";
import type { SettingsActions } from "./settings-screen";

const ADDRESS = "https://hooks.example.com";

const connection: TrackerConnectionView = {
  id: "conn-acme",
  name: "Acme",
  webhook: { kind: "off" },
  hasWebhookSecret: false,
  webhookPath: "/api/webhooks/tracker/conn-acme",
  webhookSettingsUrl: null,
};

function install(webhookAddress: string | null): Pick<SettingsPage, "install"> {
  return {
    install: {
      connections: [connection],
      githubConnected: true,
      githubToken: false,
      unreadPrRuns: { "no-access": 0, other: 0 },
      runners: [],
      addresses: {
        webAddress: null,
        webhookAddress,
        webhookAddressChecked: webhookAddress !== null,
        autoAllowedHosts: [],
      },
      power: { available: false, preventSleep: true },
      mcp: {
        now: "2026-11-24T09:00:00.000Z",
        writeAllowed: false,
        launch: { located: false, command: "ganger", args: ["mcp"], env: {} },
        recent: [],
      },
    },
  } satisfies Pick<SettingsPage, "install">;
}

function actionsSpy() {
  const ok = () => Promise.resolve({ ok: true as const });
  const checkWebhookAddress = vi.fn<SettingsActions["checkWebhookAddress"]>(ok);
  const saveConnection = vi.fn<SettingsActions["saveConnection"]>(ok);
  const actions: SettingsActions = {
    saveGeneral: ok,
    saveBrief: ok,
    addProject: ok,
    removeProject: ok,
    saveMapping: ok,
    saveInProgress: ok,
    saveLabel: ok,
    saveConnection,
    checkConnection: ok,
    saveGitHubToken: ok,
    checkGitHub: ok,
    saveRunner: ok,
    recheckRunner: ok,
    saveAddresses: ok,
    savePower: ok,
    saveMcpWrite: ok,
    createLabel: () => Promise.resolve({ ok: false, reason: "not-found" }),
    reloadFromTracker: () => Promise.resolve(),
    pollRunnerChecks: () => Promise.resolve(false),
    checkWebhookAddress,
    turnOffWebhook: ok,
  };
  return { actions, checkWebhookAddress, saveConnection };
}

let container: HTMLDivElement;
let root: Root;

function draw(page: Pick<SettingsPage, "install">, actions: SettingsActions) {
  act(() => {
    root.render(
      <IntlProvider
        locale={defaultLocale}
        messages={{ ...appMessages, ...settingsMessages }}
        timeZone={DEFAULT_TIME_ZONE}
      >
        <ConnectionsScreen
          page={page}
          setup={{ funnel: null }}
          github={undefined}
          actions={actions}
          renderLink={plainSettingsLink(undefined)}
          nav={null}
        />
      </IntlProvider>,
    );
  });
}

function buttonLabelled(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`${label} 버튼이 없다`);
  return button;
}

function type(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`${name} 칸이 없다`);
  act(() => {
    Reflect.set(HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(name: string) {
  const form = container.querySelector(`input[name="${name}"]`)?.closest("form");
  if (form === null || form === undefined) throw new Error(`${name} 폼이 없다`);
  await act(async () => {
    form.requestSubmit();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("연결 페이지의 webhook 받을 주소(0214)", () => {
  it("맨 위 한 줄에서 정하기를 누르고 주소를 넣으면 그 주소를 확인하고 저장한다", async () => {
    const { actions, checkWebhookAddress } = actionsSpy();
    draw(install(null), actions);
    const row = document.getElementById(WEBHOOK_ADDRESS_ROW_ID);
    expect(row?.textContent).toContain(settings.connections.webhookAddressNone);
    act(() => buttonLabelled(`${settings.connections.webhookAddress} 정하기`).click());
    type("webhookAddress", ADDRESS);
    await submit("webhookAddress");
    expect(checkWebhookAddress).toHaveBeenCalledWith({ address: ADDRESS });
  });

  it("연결 상자의 키 바꾸기는 빈 키 칸을 열고 저장한 키를 보이지 않는다", async () => {
    const { actions, saveConnection } = actionsSpy();
    draw(install(ADDRESS), actions);
    act(() => buttonLabelled(`Acme ${settings.connections.changeKey}`).click());
    const key = container.querySelector<HTMLInputElement>('input[name="apiKey"]');
    expect(key?.value).toBe("");
    type("apiKey", "lin_api_new");
    await submit("apiKey");
    expect(saveConnection).toHaveBeenCalledWith({
      id: connection.id,
      apiKey: "lin_api_new",
      webhookSecret: "",
    });
  });

  it("+ Linear 연결 더하기를 누르면 빈 키 칸을 연다", () => {
    const { actions } = actionsSpy();
    draw(install(ADDRESS), actions);
    const add = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === settings.connections.add,
    );
    if (add === undefined) throw new Error("더하기 버튼이 없다");
    act(() => add.click());
    expect(container.querySelector('input[name="apiKey"]')).not.toBeNull();
  });
});
