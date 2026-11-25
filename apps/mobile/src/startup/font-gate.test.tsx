// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { fontFamily } from "../design/tokens";
import { FontGate, fontsBuiltIn } from "./font-gate";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

async function mount(builtIn: boolean, loadFonts: () => Promise<void>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <FontGate builtIn={builtIn} loadFonts={loadFonts}>
        첫 화면
      </FontGate>,
    );
    await Promise.resolve();
  });
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

function heldLoad() {
  const load = {
    calls: 0,
    finish: (): void => undefined,
    fail: (): void => undefined,
    run: () => {
      load.calls += 1;
      return new Promise<void>((resolve, reject) => {
        load.finish = resolve;
        load.fail = () => reject(new Error("font"));
      });
    },
  };
  return load;
}

describe("빌드에 넣은 폰트", () => {
  it("세 굵기가 모두 있으면 빌드에 들어 있다고 본다", () => {
    expect(fontsBuiltIn(() => true)).toBe(true);
    expect(fontsBuiltIn((family) => family !== fontFamily.semibold)).toBe(false);
  });

  it("빌드에 들어 있으면 불러오지 않고 바로 첫 화면을 그린다", async () => {
    const load = heldLoad();
    const host = await mount(true, load.run);
    expect(host.textContent).toBe("첫 화면");
    expect(load.calls).toBe(0);
  });

  it("app.json의 expo-font 플러그인이 디자인 토큰의 세 폰트를 빌드에 넣는다", () => {
    const appJson = z
      .object({ expo: z.object({ plugins: z.array(z.unknown()) }) })
      .parse(JSON.parse(readFileSync(join(import.meta.dirname, "../../app.json"), "utf8")));
    const plugin = appJson.expo.plugins
      .map((entry) =>
        z
          .tuple([z.literal("expo-font"), z.object({ fonts: z.array(z.string()) })])
          .safeParse(entry),
      )
      .find((parsed) => parsed.success);
    const files = plugin?.data?.[1].fonts.map((path) => basename(path)) ?? [];
    expect(files.sort()).toEqual(
      Object.values(fontFamily)
        .map((family) => `${family}.otf`)
        .sort(),
    );
  });
});

describe("Expo Go처럼 폰트가 빌드에 없을 때", () => {
  it("불러올 때까지 그리지 않고, 다 불러오면 그린다", async () => {
    const load = heldLoad();
    const host = await mount(false, load.run);
    expect(host.textContent).toBe("");
    await act(async () => {
      load.finish();
      await Promise.resolve();
    });
    expect(host.textContent).toBe("첫 화면");
    expect(load.calls).toBe(1);
  });

  it("불러오기에 실패해도 기본 글꼴로 그린다", async () => {
    const load = heldLoad();
    const host = await mount(false, load.run);
    await act(async () => {
      load.fail();
      await Promise.resolve();
    });
    expect(host.textContent).toBe("첫 화면");
  });
});
