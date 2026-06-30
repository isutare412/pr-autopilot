import type { UiRecord } from "../types";
import { GeneratingPane } from "./GeneratingPane";
import { FindingCard } from "./FindingCard";
import { VerifyCard } from "./VerifyCard";
import { ActionsBar } from "./ActionsBar";
import { DeleteButton } from "./DeleteButton";

interface DetailProps {
  record: UiRecord | null;
  onToggle: (ref: string, included: boolean) => void;
  onEdit: (ref: string, body: string) => void;
  onApprove: (verdict: "approve" | "comment") => void;
  onDismiss: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onFeedback: (text: string) => void;
}

// Escape HTML first, then apply inline markdown styles.
// The escape-first order makes dangerouslySetInnerHTML XSS-safe.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdLite(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function PrHead({ number, title, url }: { number: number; title: string; url: string }) {
  return (
    <div className="pr-head">
      <span className="pr-num">#{number}</span>
      <span className="pr-title">{title}</span>
      <a className="pr-link" href={url} target="_blank" rel="noreferrer">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        View on GitHub
      </a>
    </div>
  );
}

export function Detail({ record, onToggle, onEdit, onApprove, onDismiss, onRestore, onDelete, onFeedback }: DetailProps) {
  if (!record) {
    return (
      <div className="detail-empty">
        <svg className="detail-empty__glyph" viewBox="0 0 100 100" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round">
            <circle cx="50" cy="50" r="36" />
            <line x1="50" y1="50" x2="17" y2="50" />
            <line x1="50" y1="50" x2="83" y2="50" />
            <line x1="50" y1="50" x2="50" y2="83" />
          </g>
          <circle cx="50" cy="50" r="8" fill="currentColor" />
        </svg>
        <p className="detail-empty__title">Select a PR to review</p>
        <p className="detail-empty__hint">Pick a pull request from the queue to see its draft review.</p>
      </div>
    );
  }

  if (record.state === "GENERATING") {
    return (
      <>
        <PrHead number={record.number} title={record.title} url={record.url} />
        <GeneratingPane record={record} />
      </>
    );
  }

  if (!record.draft) {
    const e = record.error;
    return (
      <>
        <PrHead number={record.number} title={record.title} url={record.url} />
        {e ? (
          <div className="error-box">
            <div className="error-head">
              {record.state} · {e.step}
            </div>
            <pre className="error-msg">{e.message}</pre>
            <div className="actions-inline">
              {record.state === "DISMISSED" ? (
                <button type="button" className="del-btn" onClick={onRestore}>Restore</button>
              ) : (
                <button type="button" className="del-btn" onClick={onDismiss}>Dismiss</button>
              )}
              <DeleteButton onDelete={onDelete} />
            </div>
          </div>
        ) : (
          <div className="empty">{record.state}</div>
        )}
      </>
    );
  }

  const { draft } = record;

  return (
    <>
      <PrHead number={record.number} title={record.title} url={record.url} />
      <div
        className="overall"
        dangerouslySetInnerHTML={{ __html: mdLite(draft.overallEn) }}
      />
      {draft.verify.length > 0 && (
        <>
          <h3>Verify</h3>
          {draft.verify.map((v) => (
            <VerifyCard key={v.ref} v={v} onToggle={onToggle} onEdit={onEdit} />
          ))}
        </>
      )}
      <h3>New findings</h3>
      {draft.findings.map((f) => (
        <FindingCard key={f.ref} f={f} onToggle={onToggle} onEdit={onEdit} />
      ))}
      <ActionsBar
        key={record.key}
        draft={draft}
        state={record.state}
        postVerdict={record.postVerdict}
        onApprove={onApprove}
        onDismiss={onDismiss}
        onRestore={onRestore}
        onDelete={onDelete}
        onFeedback={onFeedback}
      />
    </>
  );
}
