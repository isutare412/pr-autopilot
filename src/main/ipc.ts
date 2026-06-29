import { ipcMain, BrowserWindow } from "electron";
import { watch } from "node:fs";
import { join } from "node:path";
import { api, ApiDeps } from "./core/api";
import { Store } from "./core/store";
import { Orchestrator } from "./core/orchestrator";
import { Settings } from "./settings";

export interface IpcDeps {
  store: Store; orch: Orchestrator; dataDir: string;
  nowIso: () => string; getSettings: () => Settings; setSettings: (s: Settings) => void;
}

export function registerIpc(d: IpcDeps): void {
  const apiDeps: ApiDeps = {
    store: d.store, nowIso: d.nowIso,
    enqueueGen: d.orch.enqueueGen, enqueuePost: d.orch.enqueuePost,
  };
  ipcMain.handle("pr:list", () => api.list(apiDeps));
  ipcMain.handle("pr:get", (_e, key: string) => api.get(apiDeps, key));
  ipcMain.handle("pr:toggle", (_e, key: string, ref: string, included: boolean) => api.toggleItem(apiDeps, key, ref, included));
  ipcMain.handle("pr:edit", (_e, key: string, ref: string, editedBody: string | null) => api.editItem(apiDeps, key, ref, editedBody));
  ipcMain.handle("pr:feedback", (_e, key: string, text: string) => api.submitFeedback(apiDeps, key, text));
  ipcMain.handle("pr:approve", (_e, key: string) => api.approve(apiDeps, key));
  ipcMain.handle("pr:dismiss", (_e, key: string) => api.dismiss(apiDeps, key));
  ipcMain.handle("app:pollNow", () => d.orch.runPoll());
  ipcMain.handle("settings:get", () => d.getSettings());
  ipcMain.handle("settings:set", (_e, s: Settings) => { d.setSettings(s); return d.getSettings(); });
}

/** The Store rewrites index.json on every put; watch it and notify all windows.
 *  Covers both foreground IPC mutations and background poll/gen/post writes,
 *  including live genActivity updates. Debounced to coalesce bursts. */
export function watchStoreForChanges(dataDir: string): void {
  const index = join(dataDir, "index.json");
  let timer: NodeJS.Timeout | null = null;
  const emit = () => {
    timer = null;
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("records-changed");
  };
  try {
    watch(index, () => { if (!timer) timer = setTimeout(emit, 150); });
  } catch { /* index.json appears after first put; re-arm in index.ts after first poll */ }
}
