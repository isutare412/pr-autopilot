import { useState, useRef, useEffect } from "react";

interface QueueFilterProps {
  showDone: boolean;
  showDismissed: boolean;
  showClosed: boolean;
  doneCount: number;
  dismissedCount: number;
  closedCount: number;
  onChange: (next: { showDone: boolean; showDismissed: boolean; showClosed: boolean }) => void;
}

export function QueueFilter({ showDone, showDismissed, showClosed, doneCount, dismissedCount, closedCount, onChange }: QueueFilterProps) {
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

  return (
    <div className="queue-filter" ref={ref}>
      <button
        type="button"
        className="filter-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Filter
      </button>
      {open && (
        <div className="filter-menu" role="menu">
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
