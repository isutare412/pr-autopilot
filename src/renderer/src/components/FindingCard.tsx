import { UiFinding } from "../types";
import { AutoTextarea } from "./AutoTextarea";

interface FindingCardProps {
  f: UiFinding;
  /** True once the draft has findings already attached to a pending review on
   *  GitHub that hasn't been submitted yet — dropping or editing one now can't
   *  un-post what's already there. Mirrors api.ts's draftLocked. */
  locked?: boolean;
  onToggle: (ref: string, included: boolean) => void;
  onEdit: (ref: string, value: string) => void;
}

const LOCKED_TITLE =
  "Already attached to a draft review on GitHub — retry the post to send the rest, or discard the draft review on GitHub.";

export function FindingCard({ f, locked, onToggle, onEdit }: FindingCardProps) {
  const body = f.editedBody ?? f.body;
  const dropped = f.included ? "" : " dropped";
  const toggle = f.included ? "☑" : "☐";

  return (
    <div className={`card finding${dropped}`} data-ref={f.ref}>
      <div className="card-head">
        <span className="tag">{f.ref}</span>
        <span className={`prio prio-${f.priority.toLowerCase()}`}>{f.priority}</span>
        <code>{f.path}:{f.line}</code>
        {!f.anchorable && (
          <span
            className="chip-file"
            title="This line is outside the diff, so GitHub can't anchor a comment to it. It will post as a file-level thread on this file."
          >
            file-level
          </span>
        )}
        <button
          className="toggle"
          data-ref={f.ref}
          data-included={String(f.included)}
          disabled={locked}
          title={locked ? LOCKED_TITLE : undefined}
          onClick={() => onToggle(f.ref, !f.included)}
        >
          {toggle} {f.included ? "include" : "dropped"}
        </button>
      </div>
      <AutoTextarea
        className="edit"
        data-ref={f.ref}
        value={body}
        readOnly={locked}
        title={locked ? LOCKED_TITLE : undefined}
        onChange={(e) => onEdit(f.ref, e.target.value)}
      />
    </div>
  );
}
