import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { compileWithReactCompiler, compilesWithReactCompiler } from "./react-compiler.mjs";

const appJson = z.object({
  expo: z.object({ experiments: z.object({ reactCompiler: z.boolean() }) }),
});

const sourceRoot = join(import.meta.dirname, "src");
const appSources = readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
  .map((path) => join(sourceRoot, path))
  .filter(compilesWithReactCompiler);

describe("React Compiler(0225)", () => {
  it("모바일 앱 설정에서 켠다", () => {
    const stored = appJson.parse(
      JSON.parse(readFileSync(join(import.meta.dirname, "app.json"), "utf8")),
    );
    expect(stored.expo.experiments.reactCompiler).toBe(true);
  });

  it("시험과 시험 도구는 컴파일하지 않고 앱 소스만 컴파일한다", () => {
    const app = (path: string) => join(sourceRoot, path);
    expect(compilesWithReactCompiler(app("dashboard/run-card.tsx"))).toBe(true);
    expect(compilesWithReactCompiler(`${app("connection/session.ts")}?v=1`)).toBe(true);
    expect(compilesWithReactCompiler(app("dashboard/run-card.test.tsx"))).toBe(false);
    expect(compilesWithReactCompiler(app("testing/expo-crypto.ts"))).toBe(false);
    expect(compilesWithReactCompiler(app("../app.config.ts"))).toBe(false);
    expect(
      compilesWithReactCompiler(join(import.meta.dirname, "../../packages/api/src/index.ts")),
    ).toBe(false);
  });

  it("규칙을 어긴 컴포넌트는 건너뛴 것으로 알린다", async () => {
    const { report } = await compileWithReactCompiler(
      [
        'import { useRef } from "react";',
        "export function Bad() { const renders = useRef(0); renders.current += 1; return <p>{renders.current}</p>; }",
      ].join("\n"),
      "/app/src/bad.tsx",
    );
    expect(report.failures).not.toEqual([]);
    expect(report.compiled).toEqual([]);
  });

  it("규칙을 지킨 컴포넌트는 메모해 컴파일한다", async () => {
    const { code, report } = await compileWithReactCompiler(
      "export function Good({ name }: { name: string }) { return <p>{name}</p>; }",
      "/app/src/good.tsx",
    );
    expect(report).toEqual({ compiled: ["Good"], failures: [] });
    expect(code).toContain("react/compiler-runtime");
  });

  it.each(appSources.map((path) => [path.slice(sourceRoot.length + 1), path]))(
    "%s 의 컴포넌트와 훅을 건너뛰지 않는다",
    async (_name, path) => {
      const { report } = await compileWithReactCompiler(readFileSync(path, "utf8"), path);
      expect(report.failures).toEqual([]);
    },
  );
});
