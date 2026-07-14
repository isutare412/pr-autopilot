import { UiFinding } from "../types";
import { AutoTextarea } from "./AutoTextarea";

interface FindingCardProps {
  f: UiFinding;
  onToggle: (ref: string, included: boolean) => void;
  onEdit: (ref: string, value: string) => void;
}

export function FindingCard({ f, onToggle, onEdit }: FindingCardProps) {
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
          onClick={() => onToggle(f.ref, !f.included)}
        >
          {toggle} {f.included ? "include" : "dropped"}
        </button>
      </div>
      <AutoTextarea
        className="edit"
        data-ref={f.ref}
        value={body}
        onChange={(e) => onEdit(f.ref, e.target.value)}
      />
    </div>
  );
}
