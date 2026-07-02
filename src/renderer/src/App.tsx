import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { UiRecord, UiRow } from "./types";
import { QueueRow } from "./components/QueueRow";
import { QueueFilter } from "./components/QueueFilter";
import { Detail } from "./components/Detail";
import { isQueueVisible } from "./visibility";

type OperatingMode = "disabled" | "supervised" | "automated";
const MODE_LABEL: Record<OperatingMode, string> = {
  disabled: "Disabled", supervised: "Supervised", automated: "Automated",
};

const INTERVAL_PRESETS = [60, 300, 600, 900, 1800, 3600] as const;
const INTERVAL_LABEL: Record<number, string> = {
  60: "1m", 300: "5m", 600: "10m", 900: "15m", 1800: "30m", 3600: "1h",
};
function nearestPreset(sec: number): number {
  return INTERVAL_PRESETS.reduce(
    (best, p) => (Math.abs(p - sec) < Math.abs(best - sec) ? p : best),
    INTERVAL_PRESETS[0],
  );
}

export function App() {
  const [rows, setRows] = useState<UiRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [record, setRecord] = useState<UiRecord | null>(null);
  const [polling, setPolling] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [mode, setMode] = useState<OperatingMode>("supervised");
  const [pollIntervalSec, setPollIntervalSec] = useState(600);

  // Ref so stable subscriptions (bound once on mount) can read the current key
  // without re-binding whenever selectedKey state changes.
  const selectedKeyRef = useRef<string | null>(null);

  async function loadList() {
    const result = await api.list();
    const items: UiRow[] = (result as { items: UiRow[] }).items ?? [];
    setRows(items);
  }

  async function loadDetail(key: string) {
    setSelectedKey(key);
    selectedKeyRef.current = key;
    const r = await api.get(key);
    // IPC returns { error: string } (plain string) for not-found; real records have `state`
    if (!r || !("state" in (r as object))) return;
    setRecord(r as UiRecord);
  }

  // Drop the detail-pane selection entirely (state + ref, kept in sync).
  function clearSelection() {
    setRecord(null);
    setSelectedKey(null);
    selectedKeyRef.current = null;
  }

  async function dismiss(key: string) {
    await api.dismiss(key);
    if (key === selectedKeyRef.current) clearSelection();
    await loadList();
  }

  async function restore(key: string) {
    await api.restore(key);
    await loadList();
    if (key === selectedKeyRef.current) await loadDetail(key);
  }

  async function del(key: string) {
    await api.delete(key);
    if (key === selectedKeyRef.current) clearSelection();
    await loadList();
  }

  async function pollNow() {
    if (polling) return;
    setPolling(true);
    try {
      await api.pollNow();
      await loadList();
    } catch (e) {
      console.error("[pollNow]", e);
    } finally {
      setPolling(false);
    }
  }

  function applyFilters(next: { showDone: boolean; showDismissed: boolean; showClosed: boolean }) {
    setShowDone(next.showDone);
    setShowDismissed(next.showDismissed);
    setShowClosed(next.showClosed);
    api.setQueueFilters(next);
  }

  useEffect(() => {
    loadList();
    api.getSettings().then((s: { operatingMode?: OperatingMode; pollIntervalSec?: number; showDone?: boolean; showDismissed?: boolean; showClosed?: boolean }) => {
      if (s?.operatingMode) setMode(s.operatingMode);
      if (typeof s?.pollIntervalSec === "number") setPollIntervalSec(s.pollIntervalSec);
      if (typeof s?.showDone === "boolean") setShowDone(s.showDone);
      if (typeof s?.showDismissed === "boolean") setShowDismissed(s.showDismissed);
      if (typeof s?.showClosed === "boolean") setShowClosed(s.showClosed);
    }).catch((e) => console.error("[getSettings]", e));
    // Subscribe once; use ref so these closures always read the current selection.
    const offMode = api.onModeChanged((m: string) => setMode(m as OperatingMode));
    const offInterval = api.onPollIntervalChanged((sec: number) => setPollIntervalSec(sec));
    const offFilters = api.onQueueFiltersChanged((f: { showDone: boolean; showDismissed: boolean; showClosed: boolean }) => {
      setShowDone(f.showDone);
      setShowDismissed(f.showDismissed);
      setShowClosed(f.showClosed);
    });
    const off1 = api.onRecordsChanged(() => {
      loadList();
      if (selectedKeyRef.current) loadDetail(selectedKeyRef.current);
    });
    const off2 = api.onFocusPr((k) => loadDetail(k));
    return () => {
      offMode();
      offInterval();
      offFilters();
      off1();
      off2();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = rows.filter((r) => r.state === "DONE").length;
  const dismissedCount = rows.filter((r) => r.dismissed).length;
  const closedCount = rows.filter((r) => r.state === "CLOSED").length;
  const visibleRows = rows.filter((r) => isQueueVisible(r, { showDone, showDismissed, showClosed }));

  // Never keep a PR focused in the detail pane once it has left the queue's
  // visible set — whether its row was hidden by a filter toggle (from here or
  // the tray) or by a state change. Reuses the derived visibleRows so
  // isQueueVisible stays the single source of truth.
  useEffect(() => {
    if (selectedKey && !visibleRows.some((r) => r.key === selectedKey)) clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, visibleRows]);

  // Title counts only reviews that actually await me: visible NEEDS_REVIEW.
  // A dismissed (or filtered-out) review is not "to review" — same rule as the tray dot.
  useEffect(() => {
    const n = rows.filter((r) => r.state === "NEEDS_REVIEW" && isQueueVisible(r, { showDone, showDismissed, showClosed })).length;
    document.title = n > 0 ? `PR Autopilot — ${n} to review` : "PR Autopilot";
  }, [rows, showDone, showDismissed, showClosed]);

  return (
    <>
      <header className="topbar">
        <span className="brand">PR&nbsp;AUTOPILOT</span>
        <span className="tagline">review console</span>
        <div className="mode-switch" role="group" aria-label="Operating mode">
          {(["disabled", "supervised", "automated"] as OperatingMode[]).map((m) => (
            <button
              key={m}
              className="mode-seg"
              aria-pressed={mode === m}
              onClick={() => api.setMode(m)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="mode-help">
          <button
            type="button"
            className="mode-help__btn"
            aria-label="What the modes mean"
            aria-describedby="mode-help-tip"
          >
            ?
          </button>
          <span id="mode-help-tip" role="tooltip" className="mode-help__tip">
            <span className="mode-help__row">
              <span className="mode-help__led mode-help__led--off" aria-hidden="true" />
              <span className="mode-help__text">
                <span className="mode-help__name">Disabled</span>
                <span className="mode-help__desc">Pauses watching for review requests.</span>
              </span>
            </span>
            <span className="mode-help__row">
              <span className="mode-help__led mode-help__led--sup" aria-hidden="true" />
              <span className="mode-help__text">
                <span className="mode-help__name">Supervised</span>
                <span className="mode-help__desc">Drafts each review for you to approve before posting.</span>
              </span>
            </span>
            <span className="mode-help__row">
              <span className="mode-help__led mode-help__led--auto" aria-hidden="true" />
              <span className="mode-help__text">
                <span className="mode-help__name">Automated</span>
                <span className="mode-help__desc">Posts reviews and approvals automatically — no approval step.</span>
              </span>
            </span>
          </span>
        </span>
        <button
          type="button"
          className="settings-btn"
          aria-label="Settings"
          onClick={() => api.openPreferences()}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>
      <div className="app">
        <aside id="queue">
          <div className="queue-toolbar">
            <button className="poll-btn" onClick={pollNow} disabled={polling}>
              {polling ? "Polling…" : "Poll now"}
            </button>
            <select
              className="interval-select"
              aria-label="Poll interval"
              value={String(nearestPreset(pollIntervalSec))}
              onChange={(e) => {
                const sec = Number(e.target.value);
                setPollIntervalSec(sec);
                api.setPollInterval(sec);
              }}
            >
              {INTERVAL_PRESETS.map((p) => (
                <option key={p} value={p}>{INTERVAL_LABEL[p]}</option>
              ))}
            </select>
            <QueueFilter
              showDone={showDone}
              showDismissed={showDismissed}
              showClosed={showClosed}
              doneCount={doneCount}
              dismissedCount={dismissedCount}
              closedCount={closedCount}
              onChange={applyFilters}
            />
          </div>
          <div className="queue-list">
            {visibleRows.length === 0 ? (
              <div className="queue-empty">
                No reviews in the queue yet — they'll appear here as PRs request your review.
              </div>
            ) : (
              visibleRows.map((row) => (
                <QueueRow
                  key={row.key}
                  row={row}
                  selected={row.key === selectedKey}
                  onOpen={loadDetail}
                  onDismiss={dismiss}
                  onRestore={restore}
                />
              ))
            )}
          </div>
        </aside>
        <main id="detail">
          <Detail
            record={record}
            onToggle={async (ref, included) => {
              if (!selectedKeyRef.current) return;
              await api.toggle(selectedKeyRef.current, ref, included);
              await loadDetail(selectedKeyRef.current);
            }}
            onEdit={async (ref, body) => {
              if (!selectedKeyRef.current) return;
              await api.edit(selectedKeyRef.current, ref, body);
            }}
            onApprove={async (verdict) => {
              if (!selectedKeyRef.current) return;
              const key = selectedKeyRef.current;
              await api.approve(key, verdict);
              await loadList();
              await loadDetail(key);
            }}
            onDismiss={async () => {
              if (!selectedKeyRef.current) return;
              await dismiss(selectedKeyRef.current);
            }}
            onRestore={async () => {
              if (!selectedKeyRef.current) return;
              await restore(selectedKeyRef.current);
            }}
            onDelete={async () => {
              if (!selectedKeyRef.current) return;
              await del(selectedKeyRef.current);
            }}
            onFeedback={async (text) => {
              if (!selectedKeyRef.current) return;
              const key = selectedKeyRef.current;
              await api.feedback(key, text);
              await loadList();
              await loadDetail(key);
            }}
          />
        </main>
      </div>
    </>
  );
}
