import { contextBridge, ipcRenderer } from "electron";

const api = {
  list: () => ipcRenderer.invoke("pr:list"),
  get: (key: string) => ipcRenderer.invoke("pr:get", key),
  toggle: (key: string, ref: string, included: boolean) => ipcRenderer.invoke("pr:toggle", key, ref, included),
  edit: (key: string, ref: string, editedBody: string | null) => ipcRenderer.invoke("pr:edit", key, ref, editedBody),
  feedback: (key: string, text: string) => ipcRenderer.invoke("pr:feedback", key, text),
  approve: (key: string) => ipcRenderer.invoke("pr:approve", key),
  dismiss: (key: string) => ipcRenderer.invoke("pr:dismiss", key),
  restore: (key: string) => ipcRenderer.invoke("pr:restore", key),
  delete: (key: string) => ipcRenderer.invoke("pr:delete", key),
  pollNow: () => ipcRenderer.invoke("app:pollNow"),
  openPreferences: () => ipcRenderer.invoke("app:openPreferences"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s: unknown) => ipcRenderer.invoke("settings:set", s),
  setMode: (m: string) => ipcRenderer.invoke("mode:set", m),
  setPollInterval: (sec: number) => ipcRenderer.invoke("poll-interval:set", sec),
  onRecordsChanged: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("records-changed", fn);
    return () => ipcRenderer.removeListener("records-changed", fn);
  },
  onModeChanged: (cb: (m: string) => void) => {
    const fn = (_e: unknown, m: string) => cb(m);
    ipcRenderer.on("mode-changed", fn);
    return () => ipcRenderer.removeListener("mode-changed", fn);
  },
  onPollIntervalChanged: (cb: (sec: number) => void) => {
    const fn = (_e: unknown, sec: number) => cb(sec);
    ipcRenderer.on("poll-interval-changed", fn);
    return () => ipcRenderer.removeListener("poll-interval-changed", fn);
  },
  onFocusPr: (cb: (key: string) => void) => {
    const fn = (_e: unknown, key: string) => cb(key);
    ipcRenderer.on("focus-pr", fn);
    return () => ipcRenderer.removeListener("focus-pr", fn);
  },
};
contextBridge.exposeInMainWorld("api", api);
export type Api = typeof api;
