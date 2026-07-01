import { ipcMain, BrowserWindow } from "electron";
import { watch } from "node:fs";
import { api, ApiDeps } from "./core/api";
import { Store } from "./core/store";
import { Orchestrator } from "./core/orchestrator";
import { Settings } from "./settings";
import { OperatingMode } from "./core/schema";

export interface IpcDeps {
  store: Store; orch: Orchestrator; dataDir: string;
  nowIso: () => string; getSettings: () => Settings; setSettings: (s: Settings) => void;
  setOperatingMode: (m: OperatingMode) => void;
  openPreferences: () => void;
  setPollInterval: (sec: number) => void;
  setQueueFilters: (f: { showDone: boolean; showDismissed: boolean }) => void;
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
  ipcMain.handle("pr:approve", (_e, key: string, verdict: "approve" | "comment") => api.approve(apiDeps, key, verdict));
  ipcMain.handle("pr:dismiss", (_e, key: string) => api.dismiss(apiDeps, key));
  ipcMain.handle("pr:restore", (_e, key: string) => api.restore(apiDeps, key));
  ipcMain.handle("pr:delete", (_e, key: string) => api.delete(apiDeps, key));
  ipcMain.handle("app:pollNow", () => d.orch.runPoll());
  ipcMain.handle("settings:get", () => d.getSettings());
  ipcMain.handle("settings:set", (_e, s: Settings) => { d.setSettings(s); return d.getSettings(); });
  ipcMain.handle("mode:set", (_e, m: OperatingMode) => d.setOperatingMode(m));
  ipcMain.handle("app:openPreferences", () => d.openPreferences());
  ipcMain.handle("poll-interval:set", (_e, sec: number) => d.setPollInterval(sec));
  ipcMain.handle("queue-filters:set", (_e, f: { showDone: boolean; showDismissed: boolean }) => d.setQueueFilters(f));
}

/** The Store rewrites index.json on every put; watch the directory and notify all windows.
 *  Watching the directory (not the file) survives atomic rename-based writes.
 *  Covers both foreground IPC mutations and background poll/gen/post writes,
 *  including live genActivity updates. Debounced to coalesce bursts. */
export function watchStoreForChanges(dataDir: string, onChange?: () => void): void {
  let timer: NodeJS.Timeout | null = null;
  const emit = () => {
    timer = null;
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("records-changed");
    onChange?.();
  };
  watch(dataDir, (_e, name) => {
    if (name === "index.json" && !timer) timer = setTimeout(emit, 150);
  });
}
