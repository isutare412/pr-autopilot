import { Tray, Menu, nativeImage } from "electron";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import type { PrRecord } from "./core/schema";
import { getPluginDir } from "./paths";

export interface TrayHandlers {
  openPr(key: string): void; openMain(): void; pollNow(): void;
  openPreferences(): void; toggleLogin(): void; quit(): void; openAtLogin: boolean;
}

const RANK: Record<string, number> = {
  NEEDS_REVIEW: 0, GENERATING: 1, POSTING: 2, POSTED_AWAITING_AUTHOR: 3,
  STALE: 4, ERROR: 5, DISCOVERED: 6, DONE: 7,
};

export function buildTrayMenu(records: PrRecord[], h: TrayHandlers): MenuItemConstructorOptions[] {
  const visible = records.filter((r) => r.state !== "DISMISSED");
  visible.sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || a.repo.localeCompare(b.repo));
  const prItems: MenuItemConstructorOptions[] = visible.length
    ? visible.map((r) => ({ label: `#${r.number} ${r.repo} — ${r.state}`, click: () => h.openPr(r.key) }))
    : [{ label: "No PRs in queue", enabled: false }];
  return [
    ...prItems,
    { type: "separator" },
    { label: "Open PR Autopilot", click: () => h.openMain() },
    { label: "Poll now", click: () => h.pollNow() },
    { label: "Preferences…", click: () => h.openPreferences() },
    { label: "Launch at login", type: "checkbox", checked: h.openAtLogin, click: () => h.toggleLogin() },
    { type: "separator" },
    { label: "Quit", click: () => h.quit() },
  ];
}

let tray: Tray | null = null;

export function createTray(getRecords: () => PrRecord[], h: TrayHandlers): Tray {
  const icon = nativeImage.createFromPath(join(getPluginDir(), "..", "build", "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("PR Autopilot");
  const refresh = () => tray!.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(getRecords(), h)));
  refresh();
  return tray;
}

export function refreshTray(getRecords: () => PrRecord[], h: TrayHandlers): void {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(getRecords(), h)));
}
