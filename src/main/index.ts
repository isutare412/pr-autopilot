import { app, dialog } from "electron";
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
app.on("second-instance", () => showMain());

app.whenReady().then(async () => {
  try {
    hideDock();
    const dataDir = getDataDir();
    let settings = loadSettings(dataDir);

    // Set PATH before any gh spawn so packaged .app finds gh even with launchd's minimal PATH.
    const shimDir = join(getPluginDir(), "..", "build", "bin");
    process.env.PATH = `${shimDir}:${resolvePath()}`;

    const store = new Store(dataDir);
    const gh = new Gh(realGhRunner(), settings.githubHost);
    const login = await gh.login();
    const nowIso = () => new Date().toISOString();

    const genDeps = {
      spawner: realClaudeSpawner(),
      claudeConfigDir: expandTilde(settings.claudeConfigDir),
      shimDir,
      guardSettings: join(getPluginDir(), "..", "build", "guard.settings.json"),
      pluginDir: getPluginDir(),
      claudePath: expandTilde(settings.claudePath),
      dataDir,
    };

    const orch = new Orchestrator({
      store, gh,
      generate: (input, onActivity) => genFn(genDeps, input, onActivity),
      notifier: electronNotifier(() => settings.notify, (url) => { showMain(); openExternal(url); }),
      nowIso, login, retentionDays: settings.retentionDays, concurrency: settings.genConcurrency,
      host: settings.githubHost, repoAllow: settings.repoAllow, repoDeny: settings.repoDeny,
      language: () => settings.commentLanguage,
      effort: () => settings.effort,
      operatingMode: () => settings.operatingMode,
    });

    const trayHandlers: TrayHandlers = {
      openPr: (key) => showMain(key), openMain: () => showMain(),
      pollNow: () => orch.runPoll().then(() => refreshTray(() => store.list(), trayHandlers)).catch((e) => console.error("[pollNow]", e)),
      openPreferences: () => showPreferences(),
      toggleLogin: () => { settings = { ...settings, openAtLogin: !settings.openAtLogin }; saveSettings(dataDir, settings); applyLoginItem(settings.openAtLogin); refreshTray(() => store.list(), trayHandlers); trayHandlers.openAtLogin = settings.openAtLogin; },
      quit: () => { app.quit(); }, openAtLogin: settings.openAtLogin,
    };

    applyLoginItem(settings.openAtLogin);
    installAppMenu(() => showPreferences());   // Cmd+, + clipboard shortcuts
    createTray(() => store.list(), trayHandlers);

    // recover + poll loop + prune (as pr-cockpit did)
    try { orch.recoverInFlight(); } catch (e) { console.error("[recover]", e); }
    const poll = () => orch.runPoll().then(() => refreshTray(() => store.list(), trayHandlers)).catch((e) => console.error("[poll]", e));
    poll();
    let pollTimer = setInterval(poll, settings.pollIntervalSec * 1000);
    setInterval(() => orch.pruneNow(), 24 * 60 * 60 * 1000);

    registerIpc({
      store, orch, dataDir, nowIso,
      getSettings: () => settings,
      setSettings: (s: Settings) => {
        const parsed = Settings.parse(s);
        settings = parsed;
        saveSettings(dataDir, parsed);
        applyLoginItem(parsed.openAtLogin);
        clearInterval(pollTimer);
        pollTimer = setInterval(poll, parsed.pollIntervalSec * 1000);
      },
    });
    watchStoreForChanges(dataDir);

    showMain(); // open the window on first launch
  } catch (e) {
    dialog.showErrorBox("PR Autopilot failed to start", String((e as Error)?.stack ?? e));
  }
});
