import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGB = 2;
const RGBA = 6;

const iosIcon = z
  .object({
    expo: z.object({
      ios: z.object({
        icon: z.object({ light: z.string(), dark: z.string(), tinted: z.string() }),
      }),
    }),
  })
  .parse(JSON.parse(readFileSync(join(import.meta.dirname, "app.json"), "utf8"))).expo.ios.icon;

function pngChunks(path: string) {
  const file = readFileSync(join(import.meta.dirname, path));
  expect(file.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  const chunks: { type: string; data: Buffer }[] = [];
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, data: file.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  const header = chunks[0];
  if (header?.type !== "IHDR") throw new Error(`${path}: IHDR missing`);
  return {
    width: header.data.readUInt32BE(0),
    height: header.data.readUInt32BE(4),
    colorType: header.data.readUInt8(9),
    types: chunks.map((chunk) => chunk.type),
  };
}

describe("iOS 앱 아이콘(0229)", () => {
  it("app.json 이 assets 의 밝은·어두운·색조 아이콘을 ios.icon 에 건다", () => {
    expect(iosIcon).toEqual({
      light: "./assets/icon.png",
      dark: "./assets/icon-dark.png",
      tinted: "./assets/icon-tinted.png",
    });
  });

  it.each([iosIcon.light, iosIcon.tinted])("%s 는 알파 없는 1024 정사각 PNG 다", (path) => {
    const png = pngChunks(path);
    expect({ width: png.width, height: png.height }).toEqual({ width: 1024, height: 1024 });
    expect(png.colorType).toBe(RGB);
    expect(png.types).not.toContain("tRNS");
  });

  it("어두운 아이콘은 배경 없이 1024 정사각이라 시스템이 어두운 바탕을 깐다", () => {
    const png = pngChunks(iosIcon.dark);
    expect({ width: png.width, height: png.height }).toEqual({ width: 1024, height: 1024 });
    expect(png.colorType).toBe(RGBA);
  });
});
