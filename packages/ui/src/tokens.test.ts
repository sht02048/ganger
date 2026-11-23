import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { colors, motion, radius, space } from "./tokens.stylex";

const source = readFileSync(new URL("./tokens.stylex.ts", import.meta.url), "utf8");

function block(name: string): Array<[string, string]> {
  const start = source.indexOf(`export const ${name} = stylex.defineVars({`);
  const end = source.indexOf("\n});", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^\s+(\w+):\s*\n?\s*"([^"]+)",/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]);
}

const OKLCH = /^oklch\((?<l>[\d.]+) (?<c>[\d.]+) (?<h>[\d.]+)(?: \/ [\d.]+)?\)$/;

function parts(value: string): { l: number; c: number; h: number } {
  const groups = OKLCH.exec(value)?.groups;
  return { l: Number(groups?.["l"]), c: Number(groups?.["c"]), h: Number(groups?.["h"]) };
}

function relativeLuminance(value: string): number {
  const { l, c, h } = parts(value);
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  const rgb = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (x, y) => y - x,
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function hueDistance(a: number, b: number): number {
  return Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
}

const GANGER_YELLOW = "oklch(0.84 0.15 75)";
const INK = "oklch(0.14 0 0)";
const PAPER = "oklch(0.97 0.003 85)";

const MEANINGS = ["answer", "check", "problem", "progress", "merged"] as const;
const CHROMATIC_GROUP = /^(accent|answer|check|problem|progress|merged)/;

describe("색 토큰", () => {
  const entries = block("colors");
  const value = (key: string): string => entries.find(([k]) => k === key)?.[1] ?? "";

  it("모두 OKLCH 로 쓴다", () => {
    expect(entries.length).toBeGreaterThan(20);
    const notOklch = entries.filter(([, v]) => !OKLCH.test(v)).map(([key]) => key);
    expect(notOklch).toEqual([]);
  });

  it("채도 있는 색은 포인트와 상태 색 다섯 뜻에만 쓴다(ADR 0010 5번)", () => {
    const chromatic = entries.filter(([, v]) => parts(v).c > 0.03).map(([key]) => key);
    expect(chromatic.filter((key) => !CHROMATIC_GROUP.test(key))).toEqual([]);
    expect(chromatic).toEqual(expect.arrayContaining(["accent", ...MEANINGS]));
  });

  it("상태 색 여섯 뜻이 글·점 색과 알약 바탕(Soft)을 갖는다", () => {
    const keys = [...MEANINGS, "idle"].flatMap((meaning) => [meaning, `${meaning}Soft`]);
    expect(keys.filter((key) => !OKLCH.test(value(key)))).toEqual([]);
  });

  it("회색(대기·멈춤)은 무채색이다", () => {
    expect(parts(value("idle")).c).toBeLessThanOrEqual(0.03);
    expect(parts(value("idleSoft")).c).toBeLessThanOrEqual(0.03);
  });

  it("상태 색은 색상(hue)이 서로 멀어 헷갈리지 않는다", () => {
    const hues = MEANINGS.map((m) => parts(value(m)).h);
    for (const [i, a] of hues.entries()) {
      for (const b of hues.slice(i + 1)) {
        expect(hueDistance(a, b)).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("상태 색과 accent 가 hue 40° 이상 떨어진다", () => {
    const accent = parts(value("accent")).h;
    const close = MEANINGS.filter((m) => hueDistance(parts(value(m)).h, accent) < 40);
    expect(close).toEqual([]);
  });

  it("상태 색 다섯은 밝기·채도가 한 묶음이다", () => {
    for (const meaning of MEANINGS) {
      const { l, c } = parts(value(meaning));
      expect(l).toBeGreaterThanOrEqual(0.7);
      expect(l).toBeLessThanOrEqual(0.84);
      expect(c).toBeGreaterThanOrEqual(0.1);
      expect(c).toBeLessThanOrEqual(0.17);
    }
  });

  it("Human Check 는 노랑을 내놓고 청록이다. 초록(progress)·파랑(merged)과 밝기도 다르다", () => {
    const check = parts(value("check"));
    expect(check.h).toBeGreaterThanOrEqual(180);
    expect(check.h).toBeLessThanOrEqual(210);
    expect(hueDistance(check.h, parts(value("accent")).h)).toBeGreaterThanOrEqual(90);
    for (const near of ["progress", "merged"] as const) {
      expect(hueDistance(check.h, parts(value(near)).h)).toBeGreaterThanOrEqual(40);
      expect(Math.abs(check.l - parts(value(near)).l)).toBeGreaterThanOrEqual(0.05);
    }
    expect(parts(value("checkSoft")).h).toBe(check.h);
  });

  it("answer 버튼의 바탕과 hover 는 answer 와 같은 색상이고 hover 가 더 밝다(티켓 0198)", () => {
    const answer = parts(value("answer"));
    const soft = parts(value("answerSoft"));
    const hover = parts(value("answerSoftHover"));
    expect(soft.h).toBe(answer.h);
    expect(hover.h).toBe(answer.h);
    expect(hover.l).toBeGreaterThan(soft.l);
  });

  it("브랜드 세 색이 축이다: 강조색은 Ganger Yellow, 캔버스는 Ink, 글자는 Paper", () => {
    expect(value("accent")).toBe(GANGER_YELLOW);
    expect(value("bgCanvas")).toBe(INK);
    expect(value("textPrimary")).toBe(PAPER);
    expect(value("textOnAccent")).toBe(INK);
  });

  it("바탕·선은 Ink 에서 밝기만 바꾼 무채색이고, 안쪽·뒤 어둡게는 Ink 보다 어둡다", () => {
    const surfaces = entries.filter(([key]) => /^(bg|border|backdrop)/.test(key));
    expect(surfaces.length).toBeGreaterThan(10);
    const tinted = surfaces.filter(([, v]) => parts(v).c > 0).map(([key]) => key);
    expect(tinted).toEqual([]);
    const ink = parts(INK).l;
    expect(parts(value("bgInset")).l).toBeLessThan(ink);
    expect(parts(value("backdrop")).l).toBeLessThan(ink);
    const lighter = surfaces.filter(([key]) => !["bgCanvas", "bgInset", "backdrop"].includes(key));
    expect(lighter.filter(([, v]) => parts(v).l <= ink)).toEqual([]);
  });

  it("고른 행은 노랑 없이 hover 보다 밝은 무채색 바탕이다(티켓 0091)", () => {
    const selected = parts(value("bgSelected"));
    expect(selected.c).toBe(0);
    expect(selected.l).toBeGreaterThan(parts(value("bgHover")).l);
    expect(selected.l).toBeGreaterThan(parts(value("bgCard")).l);
    expect(selected.l).toBeGreaterThan(parts(value("bgCardHover")).l);
  });

  it("고른 행 테두리는 행이 놓이는 바탕·고른 행 바탕과 3:1 을 넘는다(WCAG 1.4.11, 티켓 0091)", () => {
    const ratios = Object.fromEntries(
      ["bgCanvas", "bgCard", "bgPanel", "bgHover", "bgSelected"].map((bg) => [
        bg,
        Math.round(contrast(value("borderSelected"), value(bg)) * 100) / 100,
      ]),
    );
    expect(Object.values(ratios).every((ratio) => ratio >= 3)).toBe(true);
  });

  it("글자는 Paper 의 따뜻한 무채색에서 밝기만 내린 단계다", () => {
    const steps = ["textPrimary", "textSecondary", "textTertiary", "textDisabled"].map((key) =>
      parts(value(key)),
    );
    for (const step of steps) {
      expect(step.h).toBe(parts(PAPER).h);
      expect(step.c).toBeLessThanOrEqual(0.005);
    }
    const lightness = steps.map((step) => step.l);
    expect(lightness).toEqual(lightness.toSorted((a, b) => b - a));
  });

  it("노랑 바탕 위 Ink 글자가 WCAG AA(4.5:1)를 넘는다", () => {
    expect(contrast(value("textOnAccent"), value("accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(value("textOnAccent"), value("accentHover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("노랑 링크 글자는 모든 바탕에서 WCAG AA(4.5:1)를, 포커스 링은 3:1을 넘는다", () => {
    const backgrounds = [
      "bgCanvas",
      "bgSidebar",
      "bgPanel",
      "bgCard",
      "bgCardHover",
      "bgHover",
      "bgRaised",
      "bgRaisedHover",
      "bgSelected",
      "bgControl",
      "bgControlHover",
      "bgInset",
      "accentSoft",
    ];
    const low = backgrounds.filter((bg) => contrast(value("accentText"), value(bg)) < 4.5);
    expect(low).toEqual([]);
    const lowRing = backgrounds.filter((bg) => contrast(value("accentText"), value(bg)) < 3);
    expect(lowRing).toEqual([]);
  });

  it("흐린 글자(textTertiary)도 카드·패널·고른 행에서 WCAG AA 를 넘는다", () => {
    for (const bg of ["bgCanvas", "bgPanel", "bgCard", "bgRaised", "bgSelected", "bgControl"]) {
      expect(contrast(value("textTertiary"), value(bg))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("상태 색 글은 제 알약 바탕(Soft) 위에서 WCAG AA 를 넘는다", () => {
    for (const meaning of [...MEANINGS, "idle"]) {
      expect(contrast(value(meaning), value(`${meaning}Soft`))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("CSS 변수로 컴파일된다", () => {
    expect(String(colors.bgCanvas)).toMatch(/^var\(--/);
    expect(String(space.s4)).toMatch(/^var\(--/);
    expect(String(radius.card)).toMatch(/^var\(--/);
    expect(String(motion.easeOut)).toMatch(/^var\(--/);
  });
});

describe("브랜드 그림 토큰(티켓 0077)", () => {
  const entries = block("brand");

  it("마스코트 몸·눈·코골이 무채색만 두고, Ganger Yellow·Ink·Paper 는 colors 하나에 모은다(티켓 0080)", () => {
    expect(entries.map(([key]) => key)).toEqual(["body", "eye", "snore"]);
    expect(entries.filter(([, v]) => !OKLCH.test(v))).toEqual([]);
    expect(entries.filter(([, v]) => parts(v).c > 0)).toEqual([]);
    expect(source.match(/oklch\(0\.84 0\.15 75\)/g)).toHaveLength(1);
  });
});

describe("둥글기 토큰", () => {
  it("카드 12, 버튼·행·입력 8, 알약 6 이다(ADR 0010 10번)", () => {
    expect(Object.fromEntries(block("radius"))).toEqual({
      card: "12px",
      control: "8px",
      pill: "6px",
      full: "9999px",
    });
  });
});

describe("간격 토큰", () => {
  it("4px 단위이고 2px·6px 만 예외다", () => {
    const offGrid = block("space").filter(([, v]) => {
      const px = Number(v.replace("px", ""));
      return !(px % 4 === 0 || px === 2 || px === 6);
    });
    expect(block("space").length).toBeGreaterThan(5);
    expect(offGrid).toEqual([]);
  });
});

describe("글자 토큰(티켓 0073)", () => {
  it("기존 크기는 그대로 두고 display 26, heading 20, subheading 15 를 더한다", () => {
    expect(Object.fromEntries(block("fontSize"))).toEqual({
      display: "26px",
      page: "22px",
      heading: "20px",
      panel: "17px",
      subheading: "15px",
      body: "14px",
      ui: "13px",
      small: "12px",
      label: "11px",
      input: "16px",
    });
  });

  it("굵기·줄 높이·자간의 기존 값을 바꾸지 않는다", () => {
    expect(Object.fromEntries(block("fontWeight"))).toEqual({
      regular: "400",
      medium: "500",
      semibold: "600",
    });
    expect(Object.fromEntries(block("lineHeight"))).toEqual({
      tight: "1.2",
      snug: "1.35",
      normal: "1.5",
      relaxed: "1.55",
    });
    expect(Object.fromEntries(block("letterSpacing"))).toEqual({
      display: "-0.015em",
      page: "-0.01em",
      panel: "-0.005em",
      label: "0.04em",
    });
  });
});
