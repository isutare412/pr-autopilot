import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { UiRecord, UiRow } from "./types";
import { QueueRow } from "./components/QueueRow";
import { Detail } from "./components/Detail";

type OperatingMode = "disabled" | "supervised" | "automated";
const MODE_LABEL: Record<OperatingMode, string> = {
  disabled: "Disabled", supervised: "Supervised", automated: "Automated",
};

export function App() {
  const [rows, setRows] = useState<UiRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [record, setRecord] = useState<UiRecord | null>(null);
  const [polling, setPolling] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [mode, setMode] = useState<OperatingMode>("supervised");

  // Ref so stable subscriptions (bound once on mount) can read the current key
  // without re-binding whenever selectedKey state changes.
  const selectedKeyRef = useRef<string | null>(null);

  async function loadList() {
    const result = await api.list();
    const items: UiRow[] = (result as { items: UiRow[] }).items ?? [];
    setRows(items);
    const needsReview = items.filter((r) => r.state === "NEEDS_REVIEW").length;
    document.title = needsReview > 0 ? `PR Autopilot — ${needsReview} to review` : "PR Autopilot";
  }

  async function loadDetail(key: string) {
    setSelectedKey(key);
    selectedKeyRef.current = key;
    const r = await api.get(key);
    // IPC returns { error: string } (plain string) for not-found; real records have `state`
    if (!r || !("state" in (r as object))) return;
    setRecord(r as UiRecord);
  }

  async function dismiss(key: string) {
    await api.dismiss(key);
    if (key === selectedKeyRef.current) {
      setRecord(null);
      setSelectedKey(null);
      selectedKeyRef.current = null;
    }
    await loadList();
  }

  async function restore(key: string) {
    await api.restore(key);
    await loadList();
    if (key === selectedKeyRef.current) await loadDetail(key);
  }

  async function del(key: string) {
    await api.delete(key);
    if (key === selectedKeyRef.current) {
      setRecord(null);
      setSelectedKey(null);
      selectedKeyRef.current = null;
    }
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

  useEffect(() => {
    loadList();
    api.getSettings().then((s: { operatingMode?: OperatingMode }) => {
      if (s?.operatingMode) setMode(s.operatingMode);
    }).catch((e) => console.error("[getSettings]", e));
    // Subscribe once; use ref so these closures always read the current selection.
    const offMode = api.onModeChanged((m: string) => setMode(m as OperatingMode));
    const off1 = api.onRecordsChanged(() => {
      loadList();
      if (selectedKeyRef.current) loadDetail(selectedKeyRef.current);
    });
    const off2 = api.onFocusPr((k) => loadDetail(k));
    return () => {
      offMode();
      off1();
      off2();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hiddenCount = rows.filter((r) => r.state === "DISMISSED").length;
  const visibleRows = showHidden ? rows : rows.filter((r) => r.state !== "DISMISSED");

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
        <button className="poll-btn" onClick={pollNow} disabled={polling}>
          {polling ? "Polling…" : "Poll now"}
        </button>
        <button
          className="hidden-toggle"
          onClick={() => setShowHidden((v) => !v)}
          aria-pressed={showHidden}
        >
          {showHidden ? "Hide hidden" : `Show hidden${hiddenCount ? ` (${hiddenCount})` : ""}`}
        </button>
      </header>
      <div className="app">
        <aside id="queue">
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
            onApprove={async () => {
              if (!selectedKeyRef.current) return;
              const key = selectedKeyRef.current;
              await api.approve(key);
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
