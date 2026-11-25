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
});
