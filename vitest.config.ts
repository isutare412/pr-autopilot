import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    environmentMatchGlobs: [["test/renderer/**", "jsdom"]],
    setupFiles: ["test/setup.ts"],
  },
});
