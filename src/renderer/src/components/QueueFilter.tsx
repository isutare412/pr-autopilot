import { useState, useRef, useEffect } from "react";

interface QueueFilterProps {
  showDone: boolean;
  showDismissed: boolean;
  doneCount: number;
  dismissedCount: number;
  onChange: (next: { showDone: boolean; showDismissed: boolean }) => void;
}

export function QueueFilter({ showDone, showDismissed, doneCount, dismissedCount, onChange }: QueueFilterProps) {
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
              onChange={(e) => onChange({ showDone: e.target.checked, showDismissed })}
            />
            Show done{doneCount ? ` (${doneCount})` : ""}
          </label>
          <label className="filter-opt">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => onChange({ showDone, showDismissed: e.target.checked })}
            />
            Show dismissed{dismissedCount ? ` (${dismissedCount})` : ""}
          </label>
        </div>
      )}
    </div>
  );
}
