// @vitest-environment jsdom
import type { AppRunner } from "@ganger/api";
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
