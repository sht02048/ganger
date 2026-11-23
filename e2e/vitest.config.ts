import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "e2e",
    include: ["src/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { GANGER_GH_CLI: "/nonexistent/ganger-e2e-gh" },
  },
});
