import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { GANGER_YELLOW_HEX } from "../../../../packages/ui/src/brand-color";
import { brandArt, brandColors, colors, fontFamily, radius } from "./tokens";

const repoFile = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

const webTokens = repoFile("packages/ui/src/tokens.stylex.ts");
const brandGuide = repoFile("packages/ui/brand/README.md");

function srgbChannel(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function oklchToHex(oklch: string): string {
  const match = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(oklch);
  if (match === null) throw new Error(`not an oklch value: ${oklch}`);
  const [lightness, chroma, hue] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    srgbChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    srgbChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    srgbChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
  if (match[4] !== undefined) channels.push(Math.round(Number(match[4]) * 255));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function webColor(name: string): string {
  const match = new RegExp(`\\b${name}: "(oklch\\([^"]+\\))"`).exec(webTokens);
  if (match?.[1] === undefined) throw new Error(`web token not found: ${name}`);
  return match[1];
}

function brandGuideColor(name: string): string {
  const match = new RegExp(`\\| ${name}\\s+\\| \`(oklch\\([^\`]+\\))\``).exec(brandGuide);
  if (match?.[1] === undefined) throw new Error(`brand color not found: ${name}`);
  return match[1];
}

describe("모바일 색 토큰", () => {
  it.each(Object.entries(colors))("%s 는 웹 토큰을 sRGB로 바꾼 값과 같다", (name, value) => {
    expect(value).toBe(oklchToHex(webColor(name)));
  });

  it("브랜드 세 색은 브랜드 가이드의 값과 같다", () => {
    expect(brandColors.ink).toBe(oklchToHex(brandGuideColor("Ink")));
    expect(brandColors.paper).toBe(oklchToHex(brandGuideColor("Paper")));
    expect(brandColors.gangerYellow).toBe(oklchToHex(brandGuideColor("Ganger Yellow")));
    expect(brandColors.gangerYellow).toBe(GANGER_YELLOW_HEX);
  });

  it("마스코트 색은 브랜드 원본 그림의 색과 같다", () => {
    const art = repoFile("packages/ui/brand/mascot-resting.svg");
    for (const value of Object.values(brandArt)) expect(art).toContain(value);
  });
});

describe("모바일 모양 토큰", () => {
  it("둥글기는 스펙 M20의 값이다", () => {
    expect(radius).toMatchObject({
      card: 10,
      button: 8,
      segmentOuter: 8,
      segmentInner: 6,
      sheet: 16,
      pill: 6,
    });
  });

  it("글꼴은 Pretendard다", () => {
    for (const family of Object.values(fontFamily)) expect(family).toMatch(/^Pretendard-/);
  });
});
