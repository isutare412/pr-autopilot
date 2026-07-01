import { app } from "electron";

export function applyLoginItem(openAtLogin: boolean): void {
  app.setLoginItemSettings({ openAtLogin });
}
