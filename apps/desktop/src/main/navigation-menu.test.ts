import { describe, expect, it } from "vitest";
import { canStepHistory, electronAccelerator, navigationMenu } from "./navigation-menu.js";
import type { HistoryDirection } from "./navigation-menu.js";

const SERVER = "http://127.0.0.1:4000";

function menuItems(enabled: boolean, onHistory: (direction: HistoryDirection) => void = () => {}) {
  const sent: string[] = [];
  const menu = navigationMenu({
    label: "이동",
    screenLabel: (screen) => `label:${screen}`,
    backLabel: "뒤로",
    forwardLabel: "앞으로",
    enabled,
    onNavigate: (screen) => sent.push(screen),
    onHistory,
  });
  return { menu, sent, items: Array.isArray(menu.submenu) ? menu.submenu : [] };
}

describe("이동 메뉴(0102)", () => {
  it("Mod 를 맥은 Command, 그 밖은 Control 로 받는 accelerator 로 바꾼다", () => {
    expect(electronAccelerator("Mod+1")).toBe("CommandOrControl+1");
    expect(electronAccelerator("Mod+,")).toBe("CommandOrControl+,");
  });

  it("레일 순서대로 여섯 화면을 키와 함께 늘어놓고, 누르면 그 화면으로 보낸다", () => {
    const { menu, sent, items } = menuItems(true);
    expect(menu.label).toBe("이동");
    const screens = items.slice(3);
    expect(screens.map((item) => [item.label, item.accelerator, item.enabled])).toEqual([
      ["label:dashboard", "CommandOrControl+1", true],
      ["label:tickets", "CommandOrControl+2", true],
      ["label:runs", "CommandOrControl+3", true],
      ["label:runners", "CommandOrControl+4", true],
      ["label:stats", "CommandOrControl+5", true],
      ["label:settings", "CommandOrControl+,", true],
    ]);
    for (const item of screens)
      if (item.click !== undefined) Reflect.apply(item.click, undefined, []);
    expect(sent).toEqual(["dashboard", "tickets", "runs", "runners", "stats", "settings"]);
  });

  it("서버 화면이 열리지 않았으면 메뉴 항목을 끈다", () => {
    expect(menuItems(false).items.every((item) => item.enabled === false)).toBe(true);
  });
});

describe("뒤로·앞으로(0181)", () => {
  it("메뉴 맨 위에 ⌘[ 와 ⌘] 를 두고 누르면 그 방향으로 보낸다", () => {
    const directions: HistoryDirection[] = [];
    const { items } = menuItems(true, (direction) => directions.push(direction));
    expect(items.slice(0, 2).map((item) => [item.label, item.accelerator])).toEqual([
      ["뒤로", "CommandOrControl+["],
      ["앞으로", "CommandOrControl+]"],
    ]);
    for (const item of items.slice(0, 2))
      if (item.click !== undefined) Reflect.apply(item.click, undefined, []);
    expect(directions).toEqual(["back", "forward"]);
  });

  const history = (activeIndex: number, urls: string[]) => ({
    activeIndex,
    length: urls.length,
    urlAt: (index: number) => urls[index] ?? "",
  });

  it("같은 서버 화면 사이로만 움직인다", () => {
    const urls = [`${SERVER}/tickets`, `${SERVER}/runs/r1`, `${SERVER}/runs`];
    expect(canStepHistory(history(1, urls), "back", SERVER)).toBe(true);
    expect(canStepHistory(history(1, urls), "forward", SERVER)).toBe(true);
  });

  it("갈 곳이 없으면 움직이지 않는다", () => {
    const urls = [`${SERVER}/tickets`];
    expect(canStepHistory(history(0, urls), "back", SERVER)).toBe(false);
    expect(canStepHistory(history(0, urls), "forward", SERVER)).toBe(false);
  });

  it("서버 화면 앞의 앱 시작 화면으로는 돌아가지 않는다", () => {
    const urls = ["file:///app/renderer/index.html", `${SERVER}/`];
    expect(canStepHistory(history(1, urls), "back", SERVER)).toBe(false);
  });

  it("서버 화면이 열리지 않았으면 움직이지 않는다", () => {
    const urls = [`${SERVER}/tickets`, `${SERVER}/runs`];
    expect(canStepHistory(history(1, urls), "back", undefined)).toBe(false);
  });
});
