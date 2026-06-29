import { app } from "electron";
import { join } from "node:path";
import { Store } from "./core/store";
import { Gh, realGhRunner } from "./core/gh";
import { realClaudeSpawner, generate as genFn } from "./core/generator";
import { Orchestrator } from "./core/orchestrator";
import { loadSettings, saveSettings, Settings } from "./settings";
import { electronNotifier } from "./notify-electron";
import { resolvePath, expandTilde, getPluginDir, getDataDir } from "./paths";
import { registerIpc, watchStoreForChanges } from "./ipc";
import { createTray, refreshTray, TrayHandlers } from "./tray";
import { showMain, showPreferences, openExternal } from "./windows";
import { hideDock, applyLoginItem } from "./lifecycle";
import { installAppMenu } from "./menu";

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(async () => {
  hideDock();
  const dataDir = getDataDir();
  let settings = loadSettings(dataDir);

  const store = new Store(dataDir);
  const gh = new Gh(realGhRunner(), settings.githubHost);
  const login = await gh.login();
  const nowIso = () => new Date().toISOString();

  const genDeps = {
    spawner: realClaudeSpawner(),
    claudeConfigDir: expandTilde(settings.claudeConfigDir),
    shimDir: join(getPluginDir(), "..", "build", "bin"),
    guardSettings: join(getPluginDir(), "..", "build", "guard.settings.json"),
    pluginDir: getPluginDir(),
    dataDir,
  };
  // Ensure spawned claude/gh/node are findable and the gh shim is first.
  process.env.PATH = `${genDeps.shimDir}:${resolvePath()}`;

  const orch = new Orchestrator({
    store, gh,
    generate: (input, onActivity) => genFn(genDeps, input, onActivity),
    notifier: electronNotifier(settings.notify, (url) => { showMain(); openExternal(url); }),
    nowIso, login, retentionDays: settings.retentionDays, concurrency: settings.genConcurrency,
    host: settings.githubHost, repoAllow: settings.repoAllow, repoDeny: settings.repoDeny,
    language: () => settings.commentLanguage,
  });

  const trayHandlers: TrayHandlers = {
    openPr: (key) => showMain(key), openMain: () => showMain(), pollNow: () => orch.runPoll(),
    openPreferences: () => showPreferences(),
    toggleLogin: () => { settings = { ...settings, openAtLogin: !settings.openAtLogin }; saveSettings(dataDir, settings); applyLoginItem(settings.openAtLogin); refreshTray(() => store.list(), trayHandlers); trayHandlers.openAtLogin = settings.openAtLogin; },
    quit: () => { app.quit(); }, openAtLogin: settings.openAtLogin,
  };

  applyLoginItem(settings.openAtLogin);
  installAppMenu(() => showPreferences());   // Cmd+, + clipboard shortcuts
  createTray(() => store.list(), trayHandlers);

  registerIpc({
    store, orch, dataDir, nowIso,
    getSettings: () => settings,
    setSettings: (s: Settings) => { settings = s; saveSettings(dataDir, s); applyLoginItem(s.openAtLogin); },
  });
  watchStoreForChanges(dataDir);

  // recover + poll loop + prune (as pr-cockpit did)
  try { orch.recoverInFlight(); } catch (e) { console.error("[recover]", e); }
  const poll = () => orch.runPoll().then(() => refreshTray(() => store.list(), trayHandlers)).catch((e) => console.error("[poll]", e));
  poll();
  setInterval(poll, settings.pollIntervalSec * 1000);
  setInterval(() => orch.pruneNow(), 24 * 60 * 60 * 1000);

  showMain(); // open the window on first launch
});
