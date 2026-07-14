import type { UiRecord } from "../types";
import { GeneratingPane } from "./GeneratingPane";
import { FindingCard } from "./FindingCard";
import { VerifyCard } from "./VerifyCard";
import { ActionsBar, canForceApprove } from "./ActionsBar";
import { RowActionsMenu } from "./RowActionsMenu";

interface DetailProps {
  record: UiRecord | null;
  onToggle: (ref: string, included: boolean) => void;
  onEdit: (ref: string, body: string) => void;
  onApprove: (verdict: "approve" | "comment") => void;
  onForceApprove: () => void;
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

// Same wording as api.ts's DRAFT_LOCKED_MESSAGE — kept as a separate literal
// (not imported) so the renderer bundle carries no server-side import, same
// rule as the mirrored types in ../types.ts.
const DRAFT_LOCKED_MESSAGE =
  "Some findings are already attached to a draft review on GitHub. Retry the post to send the rest, or discard the draft review on GitHub.";

/** True once some mutation from the current post cycle has actually landed on
 *  GitHub — a reply posted, a thread resolved, or a finding attached to (or
 *  folded into) a pending review — and that review hasn't been submitted yet.
 *  Mirrors api.ts's draftLocked. */
function draftLocked(record: UiRecord): boolean {
  const p = record.postProgress;
  return !!p && !p.reviewPosted &&
    (p.repliesPosted.length > 0 || p.threadsResolved.length > 0 ||
     p.threadsAdded.length > 0 || p.threadsFailed.length > 0);
}

function LockedBanner() {
  return (
    <div className="locked-banner" role="status">
      <svg className="locked-banner__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      <span>{DRAFT_LOCKED_MESSAGE}</span>
    </div>
  );
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

export function Detail({ record, onToggle, onEdit, onApprove, onForceApprove, onDismiss, onRestore, onDelete, onFeedback }: DetailProps) {
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
      <div className="detail-generating">
        <PrHead number={record.number} title={record.title} url={record.url} />
        <GeneratingPane record={record} />
      </div>
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
              <RowActionsMenu
                dismissed={!!record.dismissed}
                placement="bottom-start"
                canForceApprove={canForceApprove(record.state)}
                onForceApprove={onForceApprove}
                onDismiss={onDismiss}
                onRestore={onRestore}
                onDelete={onDelete}
              />
            </div>
          </div>
        ) : (
          <div className="empty">{record.state}</div>
        )}
      </>
    );
  }

  const { draft } = record;
  const locked = draftLocked(record);

  return (
    <>
      <PrHead number={record.number} title={record.title} url={record.url} />
      <div
        className="overall"
        dangerouslySetInnerHTML={{ __html: mdLite(draft.overallEn) }}
      />
      {locked && <LockedBanner />}
      {draft.verify.length > 0 && (
        <>
          <h3>Verify</h3>
          {draft.verify.map((v) => (
            <VerifyCard key={v.ref} v={v} locked={locked} onToggle={onToggle} onEdit={onEdit} />
          ))}
        </>
      )}
      <h3>New findings</h3>
      {draft.findings.map((f) => (
        <FindingCard key={f.ref} f={f} locked={locked} onToggle={onToggle} onEdit={onEdit} />
      ))}
      <ActionsBar
        key={record.key}
        draft={draft}
        state={record.state}
        dismissed={record.dismissed}
        postVerdict={record.postVerdict}
        onApprove={onApprove}
        onForceApprove={onForceApprove}
        onDismiss={onDismiss}
        onRestore={onRestore}
        onDelete={onDelete}
        onFeedback={onFeedback}
      />
    </>
  );
}
