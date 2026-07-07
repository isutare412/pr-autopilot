import { Tray, Menu, nativeImage, nativeTheme } from "electron";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import type { PrRecord, OperatingMode } from "./core/schema";
import { getPluginDir } from "./paths";
import { isQueueVisible, QueueFilters } from "./core/visibility";
import { sortRows } from "./core/queueSort";
import type { QueueSort } from "./core/schema";

export interface TrayHandlers {
  openPr(key: string): void; openMain(): void; pollNow(): void;
  openPreferences(): void; toggleLogin(): void; quit(): void; openAtLogin: boolean;
  getMode(): OperatingMode; setMode(m: OperatingMode): void;
  getFilters(): QueueFilters;
  getSort(): QueueSort;
}

const MODE_LABEL: Record<OperatingMode, string> = {
  disabled: "Disabled", supervised: "Supervised", automated: "Automated",
};

export function trayIconFile(mode: OperatingMode, needsReview = false, dark = false): string {
  if (mode === "supervised" && needsReview)
    return dark ? "trayTemplate-needsreview-dark.png" : "trayTemplate-needsreview.png";
  return mode === "disabled" ? "trayTemplate-disabled.png"
    : mode === "automated" ? "trayTemplate-automated.png"
    : "trayTemplate.png";
}

/** True when a *visible* record awaits the user's approval (drives the red dot). */
export function hasNeedsReview(records: PrRecord[], filters: QueueFilters): boolean {
  return records.some((r) => r.state === "NEEDS_REVIEW" && isQueueVisible(r, filters));
}

function loadTrayIcon(mode: OperatingMode, needsReview: boolean) {
  const colored = mode === "automated" || (mode === "supervised" && needsReview);
  const file = trayIconFile(mode, needsReview, nativeTheme.shouldUseDarkColors);
  const icon = nativeImage.createFromPath(join(getPluginDir(), "..", "build", file));
  icon.setTemplateImage(!colored); // colored icons (blue automated wheel, red needs-review dot) must not be templates; disabled stays a dimmed template
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

export function buildTrayMenu(records: PrRecord[], h: TrayHandlers): MenuItemConstructorOptions[] {
  const mode = h.getMode();
  const modeItems: MenuItemConstructorOptions[] = [
    { label: "Mode", enabled: false },
    { label: "Disabled", type: "radio", checked: mode === "disabled", click: () => h.setMode("disabled") },
    { label: "Supervised", type: "radio", checked: mode === "supervised", click: () => h.setMode("supervised") },
    { label: "Automated", type: "radio", checked: mode === "automated", click: () => h.setMode("automated") },
    { type: "separator" },
  ];
  const visible = sortRows(records.filter((r) => isQueueVisible(r, h.getFilters())), h.getSort());
  const prItems: MenuItemConstructorOptions[] = visible.length
    ? visible.map((r) => ({ label: `#${r.number} ${r.repo} — ${r.state}`, click: () => h.openPr(r.key) }))
    : [{ label: "No PRs in queue", enabled: false }];
  return [
    ...modeItems,
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
  tray = new Tray(loadTrayIcon(h.getMode(), hasNeedsReview(getRecords(), h.getFilters())));
  tray.setToolTip(`PR Autopilot — ${MODE_LABEL[h.getMode()]}`);
  const refresh = () => tray!.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(getRecords(), h)));
  refresh();
  return tray;
}

export function refreshTray(getRecords: () => PrRecord[], h: TrayHandlers): void {
  if (!tray) return;
  tray.setImage(loadTrayIcon(h.getMode(), hasNeedsReview(getRecords(), h.getFilters())));
  tray.setToolTip(`PR Autopilot — ${MODE_LABEL[h.getMode()]}`);
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(getRecords(), h)));
}
