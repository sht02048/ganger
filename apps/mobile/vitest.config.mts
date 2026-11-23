import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const esmEntry = (name: string) =>
  fileURLToPath(new URL(`./node_modules/${name}/lib/module/index.js`, import.meta.url));

export default defineProject({
  define: { __DEV__: "true" },
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      {
        find: /^expo-crypto$/,
        replacement: fileURLToPath(new URL("./src/testing/expo-crypto.ts", import.meta.url)),
      },
      { find: /^react-native-svg$/, replacement: esmEntry("react-native-svg") },
      {
        find: /^react-native-safe-area-context$/,
        replacement: esmEntry("react-native-safe-area-context"),
      },
    ],
    extensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".json",
    ],
  },
  test: {
    name: "mobile",
    include: ["src/**/*.test.{ts,tsx}", "*.test.ts"],
    server: {
      deps: {
        inline: [/react-native-web/, /react-native-svg/, /react-native-safe-area-context/],
      },
    },
  },
});
