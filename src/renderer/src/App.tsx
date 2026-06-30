import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { UiRecord, UiRow } from "./types";
import { QueueRow } from "./components/QueueRow";
import { Detail } from "./components/Detail";

export function App() {
  const [rows, setRows] = useState<UiRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [record, setRecord] = useState<UiRecord | null>(null);
  const [polling, setPolling] = useState(false);

  // Ref so stable subscriptions (bound once on mount) can read the current key
  // without re-binding whenever selectedKey state changes.
  const selectedKeyRef = useRef<string | null>(null);

  async function loadList() {
    const result = await api.list();
    const items: UiRow[] = (result as { items: UiRow[] }).items ?? [];
    const visible = items.filter((r) => r.state !== "DISMISSED");
    setRows(visible);
    const needsReview = visible.filter((r) => r.state === "NEEDS_REVIEW").length;
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
    // Subscribe once; use ref so these closures always read the current selection.
    const off1 = api.onRecordsChanged(() => {
      loadList();
      if (selectedKeyRef.current) loadDetail(selectedKeyRef.current);
    });
    const off2 = api.onFocusPr((k) => loadDetail(k));
    return () => {
      off1();
      off2();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <header className="topbar">
        <span className="brand">PR&nbsp;AUTOPILOT</span>
        <span className="tagline">review console</span>
        <button className="poll-btn" onClick={pollNow} disabled={polling}>
          {polling ? "Polling…" : "Poll now"}
        </button>
      </header>
      <div className="app">
        <aside id="queue">
          {rows.length === 0 ? (
            <div className="empty">
              No reviews in the queue yet — they'll appear here as PRs request your review.
            </div>
          ) : (
            rows.map((row) => (
              <QueueRow
                key={row.key}
                row={row}
                selected={row.key === selectedKey}
                onOpen={loadDetail}
                onDelete={dismiss}
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
            onDelete={async () => {
              if (!selectedKeyRef.current) return;
              await dismiss(selectedKeyRef.current);
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
