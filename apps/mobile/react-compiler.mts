import { fileURLToPath } from "node:url";

import { transformAsync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";
import type { LoggerEvent, PluginOptions } from "babel-plugin-react-compiler";
import type { Plugin } from "vitest/config";

export interface CompilerReport {
  compiled: string[];
  failures: string[];
}

const APP_SOURCE = fileURLToPath(new URL("./src/", import.meta.url));
const TESTING = `${APP_SOURCE}testing/`;

export function compilesWithReactCompiler(id: string): boolean {
  const path = id.split("?")[0] ?? id;
  return (
    path.startsWith(APP_SOURCE) &&
    !path.startsWith(TESTING) &&
    /\.tsx?$/.test(path) &&
    !/\.test\.tsx?$/.test(path)
  );
}

function failureOf(filename: string, event: LoggerEvent): string | null {
  switch (event.kind) {
    case "CompileError":
      return `${filename}:${event.fnLoc?.start.line ?? "?"} ${event.detail.toString()}`;
    case "PipelineError":
      return `${filename}:${event.fnLoc?.start.line ?? "?"} ${event.data}`;
    case "CompileSkip":
      return `${filename}:${event.fnLoc?.start.line ?? "?"} ${event.reason}`;
    case "CompileSuccess":
    case "CompileDiagnostic":
    case "Timing":
    case "AutoDepsDecorations":
    case "AutoDepsEligible":
      return null;
  }
}

export async function compileWithReactCompiler(code: string, filename: string) {
  const report: CompilerReport = { compiled: [], failures: [] };
  const options: PluginOptions = {
    target: "19",
    panicThreshold: "none",
    logger: {
      logEvent(_file, event) {
        if (event.kind === "CompileSuccess") report.compiled.push(event.fnName ?? "?");
        const failure = failureOf(filename, event);
        if (failure !== null) report.failures.push(failure);
      },
    },
  };
  const result = await transformAsync(code, {
    filename,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [[reactCompiler, options]],
  });
  return { code: result?.code ?? code, map: result?.map ?? null, report };
}

export function reactCompilerForTests(): Plugin {
  return {
    name: "ganger-mobile-react-compiler",
    enforce: "pre",
    async transform(code, id) {
      if (!compilesWithReactCompiler(id)) return null;
      const { code: compiled, map, report } = await compileWithReactCompiler(code, id);
      if (report.failures.length > 0) {
        this.error(`React Compiler skipped:\n${report.failures.join("\n")}`);
      }
      return { code: compiled, map };
    },
  };
}
