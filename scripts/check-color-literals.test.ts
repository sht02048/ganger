import { describe, expect, it } from "vitest";

import { findColorLiterals, isChecked } from "./check-color-literals.ts";

describe("findColorLiterals", () => {
  it("hex, 색 함수, 이름 색을 찾는다", () => {
    const source = [
      'const a = { color: "#fff" };',
      'const b = { backgroundColor: "#1a2b3c80" };',
      'const c = { color: "oklch(0.7 0.18 25)" };',
      "const d = `rgb(0 0 0 / 0.5)`;",
      'const e = { borderColor: "color-mix(in oklch, red 50%, blue)" };',
      'const f = { color: "white" };',
      'const g = { color: "#123456" };',
      "body { background: hsl(210 20% 10%); }",
    ].join("\n");

    expect(findColorLiterals(source).map((f) => [f.line, f.text])).toEqual([
      [1, "#fff"],
      [2, "#1a2b3c80"],
      [3, "oklch("],
      [4, "rgb("],
      [5, "color-mix("],
      [6, "white"],
      [7, "#123456"],
      [8, "hsl("],
    ]);
  });

  it("토큰, 키워드, 색이 아닌 #·이름은 놓아준다", () => {
    const source = [
      "const a = { color: colors.textPrimary, borderColor: 'transparent' };",
      'const b = { color: "currentColor", fill: "inherit" };',
      "const c = `PR #418 열기`;",
      'const d = <a href="#colors">색</a>;',
      "const e = `#${run.number}`;",
      "const f = textColor(value);",
      "const g = label(1);",
      'const h = "redirect";',
      "const i = `PR #418 열기`;",
    ].join("\n");

    expect(findColorLiterals(source)).toEqual([]);
  });

  it("테두리·그림자 값 안의 hex 와 이름 색을 찾는다", () => {
    const source = [
      'const a = { border: "1px solid red" };',
      'const b = { border: "1px solid #000" };',
      "const c = `0 0 0 1px ${x}, #000`;",
    ].join("\n");
    expect(findColorLiterals(source).map((f) => [f.line, f.text])).toEqual([
      [1, "red"],
      [2, "#000"],
      [3, "#000"],
    ]);
  });

  it("CSS 파일은 선언 값의 hex 와 이름 색을 모두 찾고 주석은 건너뛴다", () => {
    const css = [
      "/* #000 red 는 주석 */",
      "body { background: #000; }",
      "a { color: red; border: 1px solid white }",
      "html { color-scheme: dark; }",
    ].join("\n");
    expect(findColorLiterals(css, "css").map((f) => [f.line, f.text])).toEqual([
      [2, "#000"],
      [3, "red"],
      [3, "white"],
    ]);
  });

  it("메서드 호출과 값이 아닌 이름은 색으로 보지 않는다", () => {
    const source = [
      "const a = d3.color(x);",
      "const b = chalk.color(y);",
      'const plans = ["gold", "tan", "navy"];',
      'const tone = "red";',
    ].join("\n");
    expect(findColorLiterals(source)).toEqual([]);
  });

  it("JSX 색 속성의 이름 색을 찾는다", () => {
    const source = [
      "<circle fill=\"red\" stroke='navy' />",
      '<stop stopColor="white" />',
      '<path fill={"black"} />',
      '<Icon color={active ? "green" : "gray"} />',
    ].join("\n");
    expect(findColorLiterals(source).map((f) => [f.line, f.column, f.text])).toEqual([
      [1, 15, "red"],
      [1, 28, "navy"],
      [2, 18, "white"],
      [3, 14, "black"],
      [4, 24, "green"],
      [4, 34, "gray"],
    ]);
  });

  it("삼항식의 두 분기 모두에서 이름 색을 찾는다", () => {
    const source = [
      'const a = { color: active ? "red" : "blue" };',
      "const b = {",
      "  backgroundColor: selected",
      '    ? "white"',
      '    : "black",',
      "};",
    ].join("\n");
    expect(findColorLiterals(source).map((f) => [f.line, f.text])).toEqual([
      [1, "red"],
      [1, "blue"],
      [4, "white"],
      [5, "black"],
    ]);
  });

  it("gradient 안의 이름 색을 찾는다", () => {
    const source = [
      'const a = { backgroundImage: "linear-gradient(to right, red, blue 50%)" };',
      "const b = `radial-gradient(circle, ${colors.red}, white)`;",
      "const c = 'repeating-conic-gradient(gold 0 10deg, transparent 0 20deg)';",
    ].join("\n");
    expect(findColorLiterals(source).map((f) => [f.line, f.text])).toEqual([
      [1, "red"],
      [1, "blue"],
      [2, "white"],
      [3, "gold"],
    ]);
  });

  it("색이 아닌 속성의 색 이름 값은 놓아준다", () => {
    const source = [
      "const a = { plan: 'gold', tier: \"silver\" };",
      'const b = <Badge tone="red" data-plan="gold" />;',
      'const c = isPremium ? "gold" : "silver";',
      'const d = { "plan-name": "navy" };',
      'const color = "red";',
    ].join("\n");
    expect(findColorLiterals(source)).toEqual([]);
  });

  it("줄과 열을 1부터 센다", () => {
    expect(findColorLiterals('\n  x: "#abc"')).toEqual([{ line: 2, column: 7, text: "#abc" }]);
  });
});

describe("isChecked", () => {
  it("packages/ui 밖의 코드 파일만 본다", () => {
    expect(isChecked("apps/web/src/routes/ds.tsx")).toBe(true);
    expect(isChecked("apps/web/src/styles/app.css")).toBe(true);
    expect(isChecked("packages/core/src/index.ts")).toBe(true);
    expect(isChecked("packages/ui/src/tokens.stylex.ts")).toBe(false);
    expect(isChecked("apps/mobile/src/design/tokens.ts")).toBe(false);
    expect(isChecked("apps/mobile/src/design/components.tsx")).toBe(true);
    expect(isChecked("apps/web/src/routeTree.gen.ts")).toBe(false);
    expect(isChecked("apps/web/dist/client/assets/app.css")).toBe(false);
    expect(isChecked("apps/web/messages/ko.json")).toBe(false);
    expect(isChecked("design/prototype/styles.css")).toBe(false);
  });
});
