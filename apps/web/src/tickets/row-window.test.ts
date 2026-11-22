import { describe, expect, it } from "vitest";
import { rowOffsets, windowOf } from "./row-window";

describe("높이가 다른 행의 창(0171)", () => {
  const offsets = rowOffsets([50, 80, 50, 100, 50, 50]);

  it("누적 위치를 만든다", () => {
    expect(offsets).toEqual([0, 50, 130, 180, 280, 330, 380]);
  });

  it("보이는 행과 여분만 고르고 앞뒤 빈 공간을 맞춘다", () => {
    expect(windowOf(offsets, 130, 200, 0)).toEqual({
      start: 2,
      end: 4,
      spaceBefore: 130,
      spaceAfter: 100,
    });
  });

  it("여분은 목록 끝을 넘지 않는다", () => {
    expect(windowOf(offsets, 0, 60, 10)).toEqual({
      start: 0,
      end: 6,
      spaceBefore: 0,
      spaceAfter: 0,
    });
  });

  it("빈 목록은 빈 창이다", () => {
    expect(windowOf(rowOffsets([]), 0, 100)).toEqual({
      start: 0,
      end: 0,
      spaceBefore: 0,
      spaceAfter: 0,
    });
  });
});
