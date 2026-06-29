import { app } from "electron";

export function hideDock(): void { app.dock?.hide(); }

export function applyLoginItem(openAtLogin: boolean): void {
  app.setLoginItemSettings({ openAtLogin });
}
