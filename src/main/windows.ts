import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

let main: BrowserWindow | null = null;
let prefs: BrowserWindow | null = null;

let isQuitting = false;
app.on("before-quit", () => { isQuitting = true; });

const PRELOAD = join(__dirname, "../preload/index.js");

function rendererUrl(page: "index" | "preferences"): { url?: string; file?: string } {
  // electron-vite sets ELECTRON_RENDERER_URL in dev
  const dev = process.env.ELECTRON_RENDERER_URL;
  return dev ? { url: `${dev}/${page}.html` } : { file: join(__dirname, `../renderer/${page}.html`) };
}

export function showMain(key?: string): void {
  if (!main) {
    main = new BrowserWindow({
      width: 1040, height: 720, show: false, title: "PR Autopilot",
      webPreferences: { preload: PRELOAD },
    });
    main.on("close", (e) => { if (!isQuitting) { e.preventDefault(); main?.hide(); } }); // hide unless really quitting
    main.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    const r = rendererUrl("index");
    r.url ? main.loadURL(r.url) : main.loadFile(r.file!);
  }
  main.show(); main.focus();
  if (key) main.webContents.send("focus-pr", key);
}

export function getMain(): BrowserWindow | null { return main; }

export function showPreferences(): void {
  if (!prefs) {
    prefs = new BrowserWindow({ width: 520, height: 600, title: "Preferences", webPreferences: { preload: PRELOAD } });
    prefs.on("closed", () => { prefs = null; });
    const r = rendererUrl("preferences");
    r.url ? prefs.loadURL(r.url) : prefs.loadFile(r.file!);
  }
  prefs.show(); prefs.focus();
}

export function openExternal(url: string): void { shell.openExternal(url); }
