import type { UiRecord } from "../types";
import { GeneratingPane } from "./GeneratingPane";
import { FindingCard } from "./FindingCard";
import { VerifyCard } from "./VerifyCard";
import { ActionsBar } from "./ActionsBar";

interface DetailProps {
  record: UiRecord | null;
  onToggle: (ref: string, included: boolean) => void;
  onEdit: (ref: string, body: string) => void;
  onApprove: () => void;
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

function PrHead({ number, title }: { number: number; title: string }) {
  return (
    <div className="pr-head">
      <span className="pr-num">#{number}</span>
      <span className="pr-title">{title}</span>
    </div>
  );
}

export function Detail({ record, onToggle, onEdit, onApprove, onDelete, onFeedback }: DetailProps) {
  if (!record) {
    return <div className="empty">Select a PR to review.</div>;
  }

  if (record.state === "GENERATING") {
    return (
      <>
        <PrHead number={record.number} title={record.title} />
        <GeneratingPane record={record} />
      </>
    );
  }

  if (!record.draft) {
    const e = record.error;
    return (
      <>
        <PrHead number={record.number} title={record.title} />
        {e ? (
          <div className="error-box">
            <div className="error-head">
              {record.state} · {e.step}
            </div>
            <pre className="error-msg">{e.message}</pre>
            <button className="del-btn" onClick={onDelete} style={{ marginTop: 14 }}>
              Delete
            </button>
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
      <PrHead number={record.number} title={record.title} />
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
        draft={draft}
        state={record.state}
        onApprove={onApprove}
        onDelete={onDelete}
        onFeedback={onFeedback}
      />
    </>
  );
}
