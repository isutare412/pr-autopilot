import { UiRow } from "../types";

interface QueueRowProps {
  row: UiRow;
  selected: boolean;
  onOpen: (key: string) => void;
  onDismiss: (key: string) => void;
  onRestore: (key: string) => void;
}

const DISMISS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.1 6.1A13.12 13.12 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.9-2.1" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);

const RESTORE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export function QueueRow({ row, selected, onOpen, onDismiss, onRestore }: QueueRowProps) {
  const c = row.counts;
  const badge = c ? `C${c.critical} M${c.major} m${c.minor} n${c.nit}` : "";
  const hidden = row.state === "DISMISSED";

  function handleAction(e: React.MouseEvent) {
    e.stopPropagation();
    if (hidden) onRestore(row.key);
    else onDismiss(row.key);
  }

  return (
    <div
      className={`row state-${row.state}${selected ? " selected" : ""}`}
      data-key={row.key}
      onClick={() => onOpen(row.key)}
    >
      <div className="row-num">#{row.number}</div>
      <div className="row-repo">{row.repo}</div>
      <div className="row-counts">{badge}</div>
      <div className="row-title">{row.title}</div>
      <div className="row-state">{row.state}</div>
      <button
        className="row-action"
        data-key={row.key}
        title={hidden ? "Restore" : "Dismiss"}
        aria-label={`${hidden ? "Restore" : "Dismiss"} #${row.number}`}
        onClick={handleAction}
      >
        {hidden ? RESTORE_ICON : DISMISS_ICON}
      </button>
    </div>
  );
}
