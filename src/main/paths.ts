import { join } from "node:path";
import { app } from "electron";

// Re-export pure helpers so all four remain importable from paths.ts
export { expandTilde, resolvePath } from "./paths-pure";

/** The bundled plugin: packaged → Resources/plugin; dev → repo plugin/. */
export function getPluginDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "plugin") : join(app.getAppPath(), "plugin");
}

export function getDataDir(): string {
  return app.getPath("userData");
}
