import { useState, useEffect } from "react";
import type { Settings } from "../settings";

interface Props {
  settings: Settings;
  onSave: (next: Settings) => void;
}

export function PrefsForm({ settings, onSave }: Props) {
  // Spread the full settings so unexposed fields (repoAllow, repoDeny) are preserved
  const [state, setState] = useState<Settings>({ ...settings });

  // Keep the interval field current when it changes elsewhere (e.g. the sidebar
  // dropdown). Only this field is re-synced, so other in-progress edits survive.
  useEffect(() => {
    setState((prev) => ({ ...prev, pollIntervalSec: settings.pollIntervalSec }));
  }, [settings.pollIntervalSec]);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(state);
  }

  return (
    <form className="prefs-form" onSubmit={handleSubmit}>
      <div className="prefs-section">
        <div className="prefs-row">
          <label htmlFor="githubHost">GitHub host</label>
          <input
            id="githubHost"
            className="edit prefs-input"
            type="text"
            value={state.githubHost}
            onChange={(e) => set("githubHost", e.target.value)}
          />
        </div>

        <div className="prefs-row">
          <label htmlFor="commentLanguage">Comment language</label>
          <select
            id="commentLanguage"
            className="edit prefs-select"
            value={state.commentLanguage}
            onChange={(e) =>
              set("commentLanguage", e.target.value as Settings["commentLanguage"])
            }
          >
            <option value="en">English</option>
            <option value="ko">Korean</option>
            <option value="ja">Japanese</option>
          </select>
        </div>

        <div className="prefs-row">
          <label htmlFor="effort">Review effort</label>
          <select
            id="effort"
            className="edit prefs-select"
            value={state.effort}
            onChange={(e) =>
              set("effort", e.target.value as Settings["effort"])
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">X-High</option>
            <option value="max">Max</option>
          </select>
        </div>

        <div className="prefs-row">
          <label htmlFor="pollIntervalSec">Poll every (seconds)</label>
          <input
            id="pollIntervalSec"
            className="edit prefs-input prefs-input-num"
            type="number"
            min={60}
            value={state.pollIntervalSec}
            onChange={(e) => set("pollIntervalSec", Number(e.target.value))}
          />
        </div>

        <div className="prefs-row">
          <label htmlFor="genConcurrency">Review concurrency</label>
          <input
            id="genConcurrency"
            className="edit prefs-input prefs-input-num"
            type="number"
            min={1}
            value={state.genConcurrency}
            onChange={(e) => set("genConcurrency", Number(e.target.value))}
          />
        </div>

        <div className="prefs-row">
          <label htmlFor="retentionDays">Retain reviews (days)</label>
          <input
            id="retentionDays"
            className="edit prefs-input prefs-input-num"
            type="number"
            min={1}
            value={state.retentionDays}
            onChange={(e) => set("retentionDays", Number(e.target.value))}
          />
        </div>

        <div className="prefs-row">
          <label htmlFor="claudeConfigDir">Claude config dir</label>
          <input
            id="claudeConfigDir"
            className="edit prefs-input"
            type="text"
            value={state.claudeConfigDir}
            onChange={(e) => set("claudeConfigDir", e.target.value)}
          />
        </div>

        <div className="prefs-row">
          <label htmlFor="claudePath">Claude path</label>
          <input
            id="claudePath"
            className="edit prefs-input"
            type="text"
            placeholder="auto-detect (leave empty)"
            value={state.claudePath}
            onChange={(e) => set("claudePath", e.target.value)}
          />
        </div>

        <div className="prefs-row prefs-row-check">
          <label htmlFor="notify">Send notifications</label>
          <input
            id="notify"
            type="checkbox"
            checked={state.notify}
            onChange={(e) => set("notify", e.target.checked)}
          />
        </div>

        <div className="prefs-row prefs-row-check">
          <label htmlFor="openAtLogin">Launch at login</label>
          <input
            id="openAtLogin"
            type="checkbox"
            checked={state.openAtLogin}
            onChange={(e) => set("openAtLogin", e.target.checked)}
          />
        </div>
      </div>

      <div className="prefs-actions">
        <button type="submit" className="prefs-save">
          Save
        </button>
        <p className="prefs-restart-note">
          Changes to GitHub host, concurrency, retention, repo filters, and Claude path take effect after the app restarts.
        </p>
      </div>
    </form>
  );
}
