import { useState } from "react";
import { UiDraft } from "../types";
import { RowActionsMenu } from "./RowActionsMenu";

type Verdict = "approve" | "comment";

/** Force-approve ("give up & LGTM") is offered only from stuck states — the normal
 *  Post flow already lives in NEEDS_REVIEW, and in-flight/terminal states have nothing
 *  to give up on. */
export function canForceApprove(state: string): boolean {
  return state === "POSTED_AWAITING_AUTHOR" || state === "STALE" || state === "ERROR";
}

interface ActionsBarProps {
  draft: UiDraft;
  state: string;
  dismissed?: boolean;
  postVerdict?: Verdict;
  onApprove: (verdict: Verdict) => void;
  onDismiss: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onForceApprove: () => void;
  onFeedback: (text: string) => void;
}

/** The default disposition: "approve" when the only open items are Nit findings
 *  (and/or resolve replies) — the nits ship on the approval; "comment" (and
 *  re-queue yourself) when any Critical/Major/Minor finding or unresolved
 *  follow-up/needs-call thread remains. Mirrors executor.defaultVerdict. */
export function defaultVerdict(draft: UiDraft): Verdict {
  const hasNonNit = draft.findings.some((f) => f.included && f.priority !== "Nit");
  const hasOpenThreads = draft.verify.some((v) => v.included && v.verdict !== "resolve");
  return hasNonNit || hasOpenThreads ? "comment" : "approve";
}

/** A one-line read-out of what Post will do, ending in the consequence so the
 *  disposition's effect is never a surprise. */
function postSummary(draft: UiDraft, verdict: Verdict): string {
  const comments = draft.findings.filter((f) => f.included).length;
  const resolves = draft.verify.filter((v) => v.included && v.verdict === "resolve").length;
  const followups = draft.verify.filter((v) => v.included && v.verdict === "follow-up").length;
  const parts: string[] = [];
  if (comments) parts.push(`${comments} comment${comments > 1 ? "s" : ""}`);
  if (followups) parts.push(`${followups} repl${followups > 1 ? "ies" : "y"}`);
  if (resolves) parts.push(`resolve ${resolves} thread${resolves > 1 ? "s" : ""}`);
  const content = parts.length ? parts.join(" · ") : verdict === "approve" ? "LGTM" : "replies only";
  return `${content} · ${verdict === "comment" ? "re-requests you" : "approves, done"}`;
}

export function ActionsBar({ draft, state, dismissed, postVerdict, onApprove, onDismiss, onRestore, onDelete, onForceApprove, onFeedback }: ActionsBarProps) {
  const [feedbackText, setFeedbackText] = useState("");
  const [verdict, setVerdict] = useState<Verdict>(postVerdict ?? defaultVerdict(draft));

  // A post that failed lands in ERROR with its draft intact; let the user retry
  // from here — the post path resumes and skips already-sent items.
  const isError = state === "ERROR";
  const canPost = state === "NEEDS_REVIEW" || isError;
  const hidden = !!dismissed;
  const pretty = state.toLowerCase().replace(/_/g, " ");

  function handleSend() {
    if (!feedbackText.trim()) return;
    onFeedback(feedbackText);
    setFeedbackText("");
  }

  return (
    <div className="actions">
      {canPost ? (
        <>
          <div className="verdict" role="radiogroup" aria-label="Review verdict">
            <button
              type="button"
              role="radio"
              aria-checked={verdict === "approve"}
              className={`verdict-opt verdict-opt--approve${verdict === "approve" ? " is-on" : ""}`}
              onClick={() => setVerdict("approve")}
            >
              Approve
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={verdict === "comment"}
              className={`verdict-opt verdict-opt--comment${verdict === "comment" ? " is-on" : ""}`}
              onClick={() => setVerdict("comment")}
            >
              Comment
            </button>
          </div>
          <button id="approve" className={verdict} onClick={() => onApprove(verdict)}>
            {isError ? "Retry post" : "Post"}
          </button>
          <span className={`summary${isError ? " summary--error" : ""}`}>
            {isError ? "last post didn’t finish — retry to send the rest" : postSummary(draft, verdict)}
          </span>
        </>
      ) : (
        <span className="summary">already {pretty}</span>
      )}
      <div className="actions-trailing">
        <RowActionsMenu
          dismissed={hidden}
          placement="top-end"
          canForceApprove={canForceApprove(state)}
          onForceApprove={onForceApprove}
          onDismiss={onDismiss}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      </div>
      <div className="fb">
        <textarea
          id="feedback"
          placeholder="resolve V2 · drop #1 · soften #1"
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button id="send" onClick={handleSend} disabled={!feedbackText.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
