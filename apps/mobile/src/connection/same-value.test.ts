import { describe, expect, it } from "vitest";

import { sameValue } from "./same-value";

describe("응답 값 비교(티켓 0224)", () => {
  it("따로 파싱한 같은 내용은 같다고 본다", () => {
    const text = '{"a":[1,{"b":null,"c":"x"}],"d":true}';
    expect(sameValue(JSON.parse(text), JSON.parse(text))).toBe(true);
  });

  it.each([
    [{ a: 1 }, { a: 2 }],
    [{ a: 1 }, { a: 1, b: 1 }],
    [
      { a: 1, b: undefined },
      { a: 1, c: undefined },
    ],
    [
      [1, 2],
      [1, 2, 3],
    ],
    [[1], { 0: 1 }],
    [null, {}],
    ["1", 1],
  ])("다른 값 %j 과 %j 를 가른다", (left, right) => {
    expect(sameValue(left, right)).toBe(false);
  });

  it("서버 시계 기준 상대 시간은 화면에 보이는 분 단위가 같으면 같다고 본다", () => {
    expect(
      sameValue(
        { waitMs: 61_000, usage: { agoMs: 5_000, now: "2026-11-25T00:00:00.000Z" } },
        { waitMs: 119_000, usage: { agoMs: 59_000, now: "2026-11-25T00:00:54.000Z" } },
      ),
    ).toBe(true);
    expect(sameValue({ executionMs: 59_000 }, { executionMs: 60_000 })).toBe(false);
    expect(sameValue({ resetsInMs: null }, { resetsInMs: 60_000 })).toBe(false);
    expect(sameValue({ count: 61_000 }, { count: 119_000 })).toBe(false);
  });
});
