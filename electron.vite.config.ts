import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: { build: { outDir: "out/main" } },
  preload: { build: { outDir: "out/preload" } },
  renderer: {
    root: "src/renderer",
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          preferences: resolve("src/renderer/preferences.html"),
        },
      },
    },
    plugins: [react()],
  },
});
