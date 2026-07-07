import { app, dialog, BrowserWindow, nativeTheme } from "electron";
import { join } from "node:path";
import { Store } from "./core/store";
import { Gh, realGhRunner } from "./core/gh";
import { realClaudeSpawner, generate as genFn } from "./core/generator";
import { Orchestrator } from "./core/orchestrator";
import { Settings, SettingsStore } from "./settings";
import { OperatingMode, QueueSort } from "./core/schema";
import { electronNotifier } from "./notify-electron";
import { resolvePath, expandTilde, getPluginDir, getDataDir } from "./paths";
import { registerIpc, watchStoreForChanges } from "./ipc";
import { createTray, refreshTray, TrayHandlers } from "./tray";
import { showMain, showPreferences, openExternal, getMain } from "./windows";
import { applyLoginItem } from "./lifecycle";
import { installAppMenu } from "./menu";

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain());

app.whenReady().then(async () => {
  try {
    const dataDir = getDataDir();
    const settingsStore = new SettingsStore(dataDir);

    // Set PATH before any gh spawn so packaged .app finds gh even with launchd's minimal PATH.
    // NB: the read-only gh shim must NOT go on the main-process PATH — that would route the
    // executor's user-approved mutations (postReview/postReply/resolve) through the shim and
    // get them blocked (exit 97). The shim is applied only to the generation subprocess, by
    // generator.ts prepending shimDir to its own env. Here we expose just the real gh.
    const shimDir = join(getPluginDir(), "..", "build", "bin");
    process.env.PATH = resolvePath();

    const store = new Store(dataDir);
    const gh = new Gh(realGhRunner(), settingsStore.get().githubHost);
    const login = await gh.login();
    const nowIso = () => new Date().toISOString();

    const genBase = {
      spawner: realClaudeSpawner(),
      shimDir,
      guardSettings: join(getPluginDir(), "..", "build", "guard.settings.json"),
      pluginDir: getPluginDir(),
      dataDir,
    };

    const orch = new Orchestrator({
      store, gh,
      generate: (input, onActivity) => genFn(
        { ...genBase,
          claudeConfigDir: expandTilde(settingsStore.get().claudeConfigDir),
          claudePath: expandTilde(settingsStore.get().claudePath) },
        input, onActivity),
      notifier: electronNotifier(() => settingsStore.get().notify, (url) => { showMain(); openExternal(url); }),
      nowIso, login,
      retentionDays: () => settingsStore.get().retentionDays,
      concurrency: settingsStore.get().genConcurrency,
      host: settingsStore.get().githubHost,
      repoAllow: () => settingsStore.get().repoAllow,
      repoDeny: () => settingsStore.get().repoDeny,
      language: () => settingsStore.get().commentLanguage,
      effort: () => settingsStore.get().effort,
      operatingMode: () => settingsStore.get().operatingMode,
    });

    const trayHandlers: TrayHandlers = {
      openPr: (key) => showMain(key), openMain: () => showMain(),
      pollNow: () => orch.runPoll().then(() => refreshTray(() => store.list(), trayHandlers)).catch((e) => console.error("[pollNow]", e)),
      openPreferences: () => showPreferences(),
      toggleLogin: () => { settingsStore.update({ openAtLogin: !settingsStore.get().openAtLogin }); },
      quit: () => { app.quit(); }, openAtLogin: settingsStore.get().openAtLogin,
      getMode: () => settingsStore.get().operatingMode,
      setMode: (m) => { setOperatingMode(m).catch((e) => console.error("[setMode]", e)); },
      getFilters: () => ({ showDone: settingsStore.get().showDone, showDismissed: settingsStore.get().showDismissed, showClosed: settingsStore.get().showClosed }),
      getSort: () => settingsStore.get().queueSort,
    };

    applyLoginItem(settingsStore.get().openAtLogin);
    installAppMenu({
      onPreferences: () => showPreferences(),
      onPollNow: () => {
        const w = getMain();
        if (w && !w.isDestroyed()) w.webContents.send("trigger-poll");
        else trayHandlers.pollNow();
      },
    });
    createTray(() => store.list(), trayHandlers);
    // Re-swap the light/dark badge variant when the system appearance changes.
    nativeTheme.on("updated", () => refreshTray(() => store.list(), trayHandlers));

    // recover + poll loop + prune (as pr-cockpit did)
    try { orch.recoverInFlight(); } catch (e) { console.error("[recover]", e); }
    const poll = () => orch.runPoll().then(() => refreshTray(() => store.list(), trayHandlers)).catch((e) => console.error("[poll]", e));
    let pollTimer: NodeJS.Timeout | null = null;
    const restartPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = settingsStore.get().operatingMode === "disabled" ? null : setInterval(poll, settingsStore.get().pollIntervalSec * 1000);
    };
    if (settingsStore.get().operatingMode !== "disabled") poll();
    restartPolling();
    setInterval(() => orch.pruneNow(), 24 * 60 * 60 * 1000);

    // Live settings: settingsStore.update() fans out to these reactions.
    settingsStore.subscribe((next, prev) => {
      if (next.operatingMode !== prev.operatingMode || next.pollIntervalSec !== prev.pollIntervalSec) restartPolling();
    });
    settingsStore.subscribe((next, prev) => {
      if (next.openAtLogin !== prev.openAtLogin) applyLoginItem(next.openAtLogin);
    });
    settingsStore.subscribe((next, prev) => {
      if (next.genConcurrency !== prev.genConcurrency) orch.setConcurrency(next.genConcurrency);
    });
    settingsStore.subscribe((next, prev) => {
      if (next.operatingMode !== prev.operatingMode || next.queueSort !== prev.queueSort ||
          next.showDone !== prev.showDone || next.showDismissed !== prev.showDismissed ||
          next.showClosed !== prev.showClosed || next.openAtLogin !== prev.openAtLogin) {
        trayHandlers.openAtLogin = next.openAtLogin;
        refreshTray(() => store.list(), trayHandlers);
      }
    });

    const broadcastMode = () => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send("mode-changed", settingsStore.get().operatingMode);
    };

    const broadcastPollInterval = () => {
      for (const w of BrowserWindow.getAllWindows())
        w.webContents.send("poll-interval-changed", settingsStore.get().pollIntervalSec);
    };

    const broadcastQueueFilters = () => {
      for (const w of BrowserWindow.getAllWindows())
        w.webContents.send("queue-filters-changed", { showDone: settingsStore.get().showDone, showDismissed: settingsStore.get().showDismissed, showClosed: settingsStore.get().showClosed });
    };

    async function setOperatingMode(mode: OperatingMode): Promise<void> {
      if (mode === settingsStore.get().operatingMode) { refreshTray(() => store.list(), trayHandlers); broadcastMode(); return; }
      let confirmAutomated = false;
      if (mode === "automated" && !settingsStore.get().automatedConfirmed) {
        const { response } = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Cancel", "Enable Automated"],
          defaultId: 1, cancelId: 0,
          message: "Enable Automated mode?",
          detail: "PR Autopilot will post reviews and approvals to your PRs automatically, with no per-PR confirmation.",
        });
        if (response !== 1) { refreshTray(() => store.list(), trayHandlers); broadcastMode(); return; } // declined — resync both surfaces
        confirmAutomated = true;
      }
      const wasDisabled = settingsStore.get().operatingMode === "disabled";
      settingsStore.update({ operatingMode: mode, ...(confirmAutomated ? { automatedConfirmed: true } : {}) });
      // subscribers: poll-timer re-arms; tray refreshes.
      if (wasDisabled && mode !== "disabled") poll();
      if (mode === "automated") orch.autoPostReady();
      broadcastMode();
    }

    function setPollInterval(sec: number): void {
      // Ignore junk; on a no-op still rebroadcast so a stale sender resyncs.
      if (!Number.isInteger(sec) || sec <= 0 || sec === settingsStore.get().pollIntervalSec) {
        broadcastPollInterval();
        return;
      }
      settingsStore.update({ pollIntervalSec: sec }); // poll-timer subscriber re-arms
      broadcastPollInterval();
    }

    function setQueueFilters(f: { showDone: boolean; showDismissed: boolean; showClosed: boolean }): void {
      settingsStore.update({ showDone: !!f.showDone, showDismissed: !!f.showDismissed, showClosed: !!f.showClosed });
      broadcastQueueFilters(); // tray subscriber refreshes; broadcast resyncs the renderer
    }

    function setQueueSort(s: QueueSort): void {
      settingsStore.update({ queueSort: QueueSort.parse(s) }); // tray subscriber refreshes
    }

    registerIpc({
      store, orch, dataDir, nowIso,
      getSettings: () => settingsStore.get(),
      setSettings: (s: Settings) => {
        const parsed = Settings.parse(s);
        // The prefs form owns everything except the live main-window controls.
        const { operatingMode, automatedConfirmed, showDone, showDismissed, showClosed, queueSort, ...owned } = parsed;
        settingsStore.update(owned); // subscribers react: poll-timer / login / concurrency / tray as fields change
        broadcastPollInterval();     // resync the renderer's interval field
      },
      setOperatingMode,
      openPreferences: () => showPreferences(),
      setPollInterval,
      setQueueFilters,
      setQueueSort,
    });
    watchStoreForChanges(dataDir, () => refreshTray(() => store.list(), trayHandlers));

    showMain(); // open the window on first launch
    app.on("activate", () => showMain()); // dock-icon click re-shows the (hidden, not destroyed) window
  } catch (e) {
    dialog.showErrorBox("PR Autopilot failed to start", String((e as Error)?.stack ?? e));
  }
});
