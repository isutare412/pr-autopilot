import { app, dialog, BrowserWindow, nativeTheme } from "electron";
import { join } from "node:path";
import { Store } from "./core/store";
import { Gh, realGhRunner } from "./core/gh";
import { realClaudeSpawner, generate as genFn } from "./core/generator";
import { Orchestrator } from "./core/orchestrator";
import { loadSettings, saveSettings, Settings } from "./settings";
import { OperatingMode } from "./core/schema";
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
    // NB: the read-only gh shim must NOT go on the main-process PATH — that would route the
    // executor's user-approved mutations (postReview/postReply/resolve) through the shim and
    // get them blocked (exit 97). The shim is applied only to the generation subprocess, by
    // generator.ts prepending shimDir to its own env. Here we expose just the real gh.
    const shimDir = join(getPluginDir(), "..", "build", "bin");
    process.env.PATH = resolvePath();

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
      getMode: () => settings.operatingMode,
      setMode: (m) => { setOperatingMode(m).catch((e) => console.error("[setMode]", e)); },
      getFilters: () => ({ showDone: settings.showDone, showDismissed: settings.showDismissed }),
    };

    applyLoginItem(settings.openAtLogin);
    installAppMenu(() => showPreferences());   // Cmd+, + clipboard shortcuts
    createTray(() => store.list(), trayHandlers);
    // Re-swap the light/dark badge variant when the system appearance changes.
    nativeTheme.on("updated", () => refreshTray(() => store.list(), trayHandlers));

    // recover + poll loop + prune (as pr-cockpit did)
    try { orch.recoverInFlight(); } catch (e) { console.error("[recover]", e); }
    const poll = () => orch.runPoll().then(() => refreshTray(() => store.list(), trayHandlers)).catch((e) => console.error("[poll]", e));
    let pollTimer: NodeJS.Timeout | null = null;
    const restartPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      // Disabled stops the cron; in-flight queues drain on their own.
      pollTimer = settings.operatingMode === "disabled" ? null : setInterval(poll, settings.pollIntervalSec * 1000);
    };
    if (settings.operatingMode !== "disabled") poll();
    restartPolling();
    setInterval(() => orch.pruneNow(), 24 * 60 * 60 * 1000);

    const broadcastMode = () => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send("mode-changed", settings.operatingMode);
    };

    const broadcastPollInterval = () => {
      for (const w of BrowserWindow.getAllWindows())
        w.webContents.send("poll-interval-changed", settings.pollIntervalSec);
    };

    const broadcastQueueFilters = () => {
      for (const w of BrowserWindow.getAllWindows())
        w.webContents.send("queue-filters-changed", { showDone: settings.showDone, showDismissed: settings.showDismissed });
    };

    async function setOperatingMode(mode: OperatingMode): Promise<void> {
      if (mode === settings.operatingMode) { refreshTray(() => store.list(), trayHandlers); broadcastMode(); return; }
      if (mode === "automated" && !settings.automatedConfirmed) {
        const { response } = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Cancel", "Enable Automated"],
          defaultId: 1, cancelId: 0,
          message: "Enable Automated mode?",
          detail: "PR Autopilot will post reviews and approvals to your PRs automatically, with no per-PR confirmation.",
        });
        if (response !== 1) { refreshTray(() => store.list(), trayHandlers); broadcastMode(); return; } // declined — keep current mode, resync both surfaces
        settings = { ...settings, automatedConfirmed: true };
      }
      const wasDisabled = settings.operatingMode === "disabled";
      settings = { ...settings, operatingMode: mode };
      saveSettings(dataDir, settings);
      restartPolling();
      if (wasDisabled && mode !== "disabled") poll();
      if (mode === "automated") orch.autoPostReady();
      refreshTray(() => store.list(), trayHandlers);
      broadcastMode();
    }

    function setPollInterval(sec: number): void {
      // Ignore junk; on a no-op still rebroadcast so a stale sender resyncs.
      if (!Number.isInteger(sec) || sec <= 0 || sec === settings.pollIntervalSec) {
        broadcastPollInterval();
        return;
      }
      settings = { ...settings, pollIntervalSec: sec };
      saveSettings(dataDir, settings);
      restartPolling();
      broadcastPollInterval();
    }

    function setQueueFilters(f: { showDone: boolean; showDismissed: boolean }): void {
      settings = { ...settings, showDone: !!f.showDone, showDismissed: !!f.showDismissed };
      saveSettings(dataDir, settings);
      refreshTray(() => store.list(), trayHandlers);
      broadcastQueueFilters();
    }

    registerIpc({
      store, orch, dataDir, nowIso,
      getSettings: () => settings,
      setSettings: (s: Settings) => {
        const parsed = Settings.parse(s);
        // Preserve the live main-window controls — the prefs form does not own them.
        settings = { ...parsed, operatingMode: settings.operatingMode, automatedConfirmed: settings.automatedConfirmed,
          showDone: settings.showDone, showDismissed: settings.showDismissed };
        saveSettings(dataDir, settings);
        applyLoginItem(settings.openAtLogin);
        restartPolling();
        broadcastPollInterval();
      },
      setOperatingMode,
      openPreferences: () => showPreferences(),
      setPollInterval,
      setQueueFilters,
    });
    watchStoreForChanges(dataDir, () => refreshTray(() => store.list(), trayHandlers));

    showMain(); // open the window on first launch
    app.on("activate", () => showMain()); // dock-icon click re-shows the (hidden, not destroyed) window
  } catch (e) {
    dialog.showErrorBox("PR Autopilot failed to start", String((e as Error)?.stack ?? e));
  }
});
