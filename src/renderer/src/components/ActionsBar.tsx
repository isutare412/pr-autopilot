import { useState } from "react";
import { UiDraft } from "../types";
import { DeleteButton } from "./DeleteButton";

interface ActionsBarProps {
  draft: UiDraft;
  state: string;
  onApprove: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onFeedback: (text: string) => void;
}

function actionSummary(draft: UiDraft): string {
  const newComments = draft.findings.filter((f) => f.included).length;
  const resolves = draft.verify.filter((v) => v.included && v.verdict === "resolve").length;
  const followups = draft.verify.filter((v) => v.included && v.verdict === "follow-up").length;
  const parts: string[] = [];
  if (followups) parts.push(`${followups} follow-up reply${followups > 1 ? "s" : ""}`);
  if (resolves) parts.push(`resolve ${resolves} thread${resolves > 1 ? "s" : ""}`);
  if (newComments === 0 && resolves === 0 && followups === 0) return "approve LGTM";
  parts.push(newComments === 0 ? "no new comments" : `${newComments} new comment${newComments > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

export function ActionsBar({ draft, state, onApprove, onDismiss, onRestore, onDelete, onFeedback }: ActionsBarProps) {
  const [feedbackText, setFeedbackText] = useState("");
  const canApprove = state === "NEEDS_REVIEW";
  const hidden = state === "DISMISSED";
  const pretty = state.toLowerCase().replace(/_/g, " ");
  const summary = canApprove ? actionSummary(draft) : `already ${pretty}`;

  function handleSend() {
    onFeedback(feedbackText);
    setFeedbackText("");
  }

  return (
    <div className="actions">
      <button
        id="approve"
        onClick={onApprove}
        disabled={!canApprove}
        title={canApprove ? undefined : `Already ${pretty} — nothing to post`}
      >
        Approve &amp; post →
      </button>
      <span className="summary">{summary}</span>
      {hidden ? (
        <button type="button" className="del-btn" onClick={onRestore}>Restore</button>
      ) : (
        <button type="button" className="del-btn" onClick={onDismiss}>Dismiss</button>
      )}
      <DeleteButton onDelete={onDelete} />
      <div className="fb">
        <textarea
          id="feedback"
          placeholder="resolve V2 · drop #1 · soften #1"
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
        />
        <button id="send" onClick={handleSend}>
          Send →
        </button>
      </div>
    </div>
  );
}
