import { useState, useRef, useEffect } from "react";
import type { QueueSort } from "../queueSort";

interface QueueFilterProps {
  showDone: boolean;
  showDismissed: boolean;
  showClosed: boolean;
  doneCount: number;
  dismissedCount: number;
  closedCount: number;
  onChange: (next: { showDone: boolean; showDismissed: boolean; showClosed: boolean }) => void;
  sort: QueueSort;
  onSortChange: (next: QueueSort) => void;
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
    </svg>
  );
}

export function QueueFilter({ showDone, showDismissed, showClosed, doneCount, dismissedCount, closedCount, onChange, sort, onSortChange }: QueueFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const arrow = (dir: QueueSort["dir"]) => (dir === "desc" ? "↓" : "↑");
  const pickSort = (key: QueueSort["key"]) =>
    onSortChange(key === sort.key ? { key, dir: sort.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });

  return (
    <div className="queue-filter" ref={ref}>
      <button
        type="button"
        className="filter-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Filter and sort"
        onClick={() => setOpen((v) => !v)}
      >
        <FunnelIcon />
        <span className="filter-badge" aria-hidden="true">{arrow(sort.dir)}</span>
      </button>
      {open && (
        <div className="filter-menu" role="menu">
          <div className="filter-section-label">Sort</div>
          <button type="button" role="menuitemradio" aria-checked={sort.key === "activity"} className="sort-opt" onClick={() => pickSort("activity")}>
            <span className="sort-arrow" aria-hidden="true">{sort.key === "activity" ? arrow(sort.dir) : "↓"}</span>
            Recent activity
          </button>
          <button type="button" role="menuitemradio" aria-checked={sort.key === "repo"} className="sort-opt" onClick={() => pickSort("repo")}>
            <span className="sort-arrow" aria-hidden="true">{sort.key === "repo" ? arrow(sort.dir) : "↓"}</span>
            Repo &amp; number
          </button>
          <div className="filter-sep" role="separator" />
          <div className="filter-section-label">Show</div>
          <label className="filter-opt filter-opt--all">
            <input
              type="checkbox"
              checked={showDone && showDismissed && showClosed}
              onChange={(e) =>
                onChange({ showDone: e.target.checked, showDismissed: e.target.checked, showClosed: e.target.checked })
              }
            />
            Show all
          </label>
          <div className="filter-sep" role="separator" />
          <label className="filter-opt">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => onChange({ showDone: e.target.checked, showDismissed, showClosed })}
            />
            Show done{doneCount ? ` (${doneCount})` : ""}
          </label>
          <label className="filter-opt">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => onChange({ showDone, showDismissed: e.target.checked, showClosed })}
            />
            Show dismissed{dismissedCount ? ` (${dismissedCount})` : ""}
          </label>
          <label className="filter-opt">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => onChange({ showDone, showDismissed, showClosed: e.target.checked })}
            />
            Show closed{closedCount ? ` (${closedCount})` : ""}
          </label>
        </div>
      )}
    </div>
  );
}
