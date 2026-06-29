import { UiRow } from "../types";

interface QueueRowProps {
  row: UiRow;
  selected: boolean;
  onOpen: (key: string) => void;
  onDelete: (key: string) => void;
}

export function QueueRow({ row, selected, onOpen, onDelete }: QueueRowProps) {
  const c = row.counts;
  const badge = c ? `C${c.critical} M${c.major} m${c.minor} n${c.nit}` : "";

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete(row.key);
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
        className="row-del"
        data-key={row.key}
        title="Delete"
        aria-label={`Delete #${row.number}`}
        onClick={handleDelete}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    </div>
  );
}
