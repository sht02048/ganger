// @vitest-environment jsdom
import type { AppRunner, V1GhAccount } from "@ganger/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { RunnersScreen } from "./runners-screen";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const runner: AppRunner = {
  id: "r",
  name: "acme-runner",
  cause: null,
  offlineMs: null,
  used: 0,
  capacity: 1,
  usage: null,
  limits: [],
};

const mounted: Array<() => void> = [];

function mount(runners: AppRunner[]): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<RunnersScreen runners={runners} onBack={() => undefined} />));
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

describe("Runners의 모르는 값", () => {
  it("원인을 모르는 러너에 Online을 보이지 않는다", () => {
    const host = mount([{ ...runner, cause: "unknown" }]);
    expect(host.querySelector('[data-testid="pill-online"]')).toBeNull();
    expect(host.querySelector('[data-testid="pill-runner-issue"]')).toBeNull();
    expect(host.querySelector('[data-testid="pill-unknown"]')).not.toBeNull();
  });

  it("모르는 상태의 공급자를 숨기지 않는다", () => {
    const now = "2026-11-23T00:00:00.000Z";
    const host = mount([
      {
        ...runner,
        usage: {
          kind: "read",
          readAt: now,
          agoMs: 0,
          now,
          highest: null,
          providers: [{ provider: "claude", status: "unknown", windows: [] }],
        },
      },
    ]);
    expect(host.textContent).toContain("알 수 없는 상태: Claude");
  });
});

describe("Runners의 러너 gh 계정", () => {
  const readAt = { readAt: "2026-11-25T00:00:00.000Z", agoMs: 60_000 };
  const loggedIn = (accounts: V1GhAccount[]): AppRunner["ghAccounts"] => ({
    ...readAt,
    kind: "logged-in",
    accounts,
  });
  const account = (login: string, active: boolean, expired: boolean): V1GhAccount => ({
    host: "github.com",
    login,
    active,
    expired,
  });

  it("러너 카드에 사용 중인 gh 계정을 보이고 문제 구역에는 올리지 않는다", () => {
    const host = mount([
      {
        ...runner,
        ghAccounts: loggedIn([account("acme-old", false, true), account("acme-dev", true, false)]),
      },
    ]);
    const text = host.textContent ?? "";
    expect(text).toContain("GitHub (gh)");
    expect(text).toContain("acme-dev · github.com");
    expect(text).not.toContain("로그인이 만료됐어요");
    expect(host.querySelector('[data-testid="card-problem"]')).toBeNull();
  });

  it("사용 중인 계정이 만료되면 카드 줄에 만료를 알리고 문제 구역에 문제 카드로 올린다", () => {
    const host = mount([{ ...runner, ghAccounts: loggedIn([account("acme-dev", true, true)]) }]);
    const text = host.textContent ?? "";
    expect(text).toContain("acme-dev · 로그인이 만료됐어요");
    const problem = host.querySelector('[data-testid="card-problem"]');
    expect(problem?.textContent).toContain(
      "러너의 gh 계정 acme-dev 로그인이 만료됐어요. 이 러너로는 push와 PR 열기를 하지 못해요.",
    );
    expect(problem?.textContent).toContain("고치기는 Ganger 웹이나 데스크톱 앱의 Runners에서 해요");
    expect(problem?.querySelector('[data-testid="pill-runner-issue"]')).not.toBeNull();
    expect(text.indexOf("문제")).toBeLessThan(text.indexOf("러너의 gh 계정"));
  });

  it.each([
    [null, "아직 읽지 않았어요"],
    [{ ...readAt, kind: "not-installed" as const }, "gh 없음"],
    [{ ...readAt, kind: "logged-out" as const }, "로그인 안 됨"],
    [{ ...readAt, kind: "unreadable" as const }, "읽지 못했어요"],
    [{ kind: "unknown" as const }, "알 수 없는 상태"],
  ])("계정이 없으면 그 상태를 보인다 (%#)", (ghAccounts, message) => {
    const text = mount([{ ...runner, ghAccounts }]).textContent ?? "";
    expect(text).toContain(`GitHub (gh)${message}`);
  });

  it("gh 계정을 싣지 않는 계약 1 서버면 줄을 뺀다", () => {
    expect(mount([runner]).textContent).not.toContain("GitHub (gh)");
  });
});
