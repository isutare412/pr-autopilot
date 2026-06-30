import { UiVerify } from "../types";
import { AutoTextarea } from "./AutoTextarea";

interface VerifyCardProps {
  v: UiVerify;
  onToggle: (ref: string, included: boolean) => void;
  onEdit: (ref: string, value: string) => void;
}

function mdLite(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function VerifyCard({ v, onToggle, onEdit }: VerifyCardProps) {
  const body = v.editedBody ?? v.replyBody ?? "";
  const toggle = v.included ? "☑" : "☐";

  return (
    <div className={`card verify verdict-${v.verdict}`} data-ref={v.ref}>
      <div className="card-head">
        <span className="tag">{v.ref}</span>
        <span className="verdict">{v.verdict}</span>
        <code>{v.path ?? ""}:{v.line ?? ""}</code>
        <button
          className="toggle"
          data-ref={v.ref}
          data-included={String(v.included)}
          onClick={() => onToggle(v.ref, !v.included)}
        >
          {toggle}
        </button>
      </div>
      <div
        className="why"
        dangerouslySetInnerHTML={{ __html: mdLite(v.rationaleEn ?? "") }}
      />
      <AutoTextarea
        className="edit"
        data-ref={v.ref}
        value={body}
        onChange={(e) => onEdit(v.ref, e.target.value)}
      />
    </div>
  );
}
