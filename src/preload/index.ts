import { contextBridge, ipcRenderer } from "electron";

const api = {
  list: () => ipcRenderer.invoke("pr:list"),
  get: (key: string) => ipcRenderer.invoke("pr:get", key),
  toggle: (key: string, ref: string, included: boolean) => ipcRenderer.invoke("pr:toggle", key, ref, included),
  edit: (key: string, ref: string, editedBody: string | null) => ipcRenderer.invoke("pr:edit", key, ref, editedBody),
  feedback: (key: string, text: string) => ipcRenderer.invoke("pr:feedback", key, text),
  approve: (key: string) => ipcRenderer.invoke("pr:approve", key),
  dismiss: (key: string) => ipcRenderer.invoke("pr:dismiss", key),
  pollNow: () => ipcRenderer.invoke("app:pollNow"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s: unknown) => ipcRenderer.invoke("settings:set", s),
  onRecordsChanged: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("records-changed", fn);
    return () => ipcRenderer.removeListener("records-changed", fn);
  },
};
contextBridge.exposeInMainWorld("api", api);
export type Api = typeof api;
