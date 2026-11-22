import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { bundleMigrations } from "@ganger/db/bundle-migrations";
import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";
import { relativeBuildPaths } from "../../scripts/build-paths";
import { thirdPartyManifest } from "../../scripts/third-party";

const stylexPlugin = stylex.vite as (options?: Parameters<typeof stylex.vite>[0]) => PluginOption;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const productionBuildId = (process.env["GANGER_WEB_BUILD_ID"] ??= randomUUID());

export default defineConfig(({ command }) => ({
  define: {
    __GANGER_BUILD_ID__: JSON.stringify(command === "build" ? productionBuildId : "dev"),
  },
  server: { host: "127.0.0.1", port: 3000 },
  ...(command === "build" ? { ssr: { noExternal: true } } : {}),
  plugins: [
    stylexPlugin({
      useCSSLayers: true,
      dev: process.env["NODE_ENV"] !== "production",
      runtimeInjection: false,
      unstable_moduleResolution: { type: "commonJS", rootDir: repoRoot },
    }),
    tanstackStart(),
    viteReact(),
    bundleMigrations(),
    relativeBuildPaths(repoRoot),
    thirdPartyManifest(fileURLToPath(new URL("dist/third-party", import.meta.url)), "web"),
  ],
}));
