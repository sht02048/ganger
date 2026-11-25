import { DESKTOP_NAVIGATION_GLOBAL } from "@ganger/app/shell/nav-shortcuts";
import type { DesktopPage } from "@ganger/app/shell/nav-shortcuts";
import { describe, expect, it } from "vitest";
import { desktopNavigation } from "./desktop-navigation";

describe("데스크톱 앱이 여는 앱 안 페이지(0214)", () => {
  it("트레이가 보낸 페이지 이름은 목록에 있는 것만 넘기고, 듣기를 끊을 수 있다", () => {
    const sent: Array<(value: unknown) => void> = [];
    let off = 0;
    const bridge = desktopNavigation({
      [DESKTOP_NAVIGATION_GLOBAL]: {
        onNavigate: () => () => {},
        onOpenPage: (listener: (value: unknown) => void) => {
          sent.push(listener);
          return () => {
            off += 1;
          };
        },
      },
    });
    if (bridge === null) throw new Error("bridge did not parse");
    const pages: DesktopPage[] = [];
    const stop = bridge.onOpenPage((page) => pages.push(page));
    for (const listener of sent) {
      listener("notifications");
      listener("toString");
      listener(42);
    }
    expect(pages).toEqual(["notifications"]);
    stop();
    expect(off).toBe(1);
  });

  it("onOpenPage 가 없는 예전 다리도 받아들이고 페이지 열기는 하지 않는다", () => {
    const bridge = desktopNavigation({
      [DESKTOP_NAVIGATION_GLOBAL]: { onNavigate: () => () => {} },
    });
    expect(bridge).not.toBeNull();
    const stop = bridge?.onOpenPage(() => {
      throw new Error("not expected");
    });
    stop?.();
  });
});
