import { useEffect, useRef, useState } from "react";

interface Props {
  dismissed: boolean;
  placement?: "top-end" | "bottom-start";
  canForceApprove?: boolean;
  onForceApprove?: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

/** The per-review overflow menu. Collapses Approve-anyway + Hide/Show + Discard
 *  behind a single `⋯` trigger, giving each action a one-line description, and
 *  hosts each destructive/irreversible confirm inside the popover instead of as a
 *  loose inline strip. Purely presentational — the semantics live in the injected
 *  callbacks. */
export function RowActionsMenu({
  dismissed, placement = "top-end", canForceApprove, onForceApprove,
  onDismiss, onRestore, onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<null | "discard" | "approve">(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setConfirming(null);
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="row-menu" ref={wrapRef}>
      <button
        type="button"
        className="row-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⋯
      </button>
      {open && (
        <div className={`row-menu__pop row-menu__pop--${placement}`} role={confirming ? undefined : "menu"}>
          {confirming === "discard" ? (
            <div className="row-menu__confirm">
              <div className="row-menu__confirm-q">Discard this review?</div>
              <div className="row-menu__confirm-row">
                <button
                  type="button"
                  className="row-menu__btn row-menu__btn--danger"
                  onClick={() => {
                    onDelete();
                    close();
                  }}
                >
                  Discard
                </button>
                <button type="button" className="row-menu__btn" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : confirming === "approve" ? (
            <div className="row-menu__confirm">
              <div className="row-menu__confirm-q">Approve anyway? Posts LGTM 👍 and leaves open comments.</div>
              <div className="row-menu__confirm-row">
                <button
                  type="button"
                  className="row-menu__btn row-menu__btn--approve"
                  onClick={() => {
                    onForceApprove?.();
                    close();
                  }}
                >
                  Approve
                </button>
                <button type="button" className="row-menu__btn" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {canForceApprove && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="row-menu__item row-menu__item--approve"
                    onClick={() => setConfirming("approve")}
                  >
                    <span className="row-menu__label">Approve anyway</span>
                    <span className="row-menu__desc">Posts LGTM 👍, leaves open comments</span>
                  </button>
                  <div className="row-menu__divider" role="separator" />
                </>
              )}
              {dismissed ? (
                <button
                  type="button"
                  role="menuitem"
                  className="row-menu__item"
                  onClick={() => {
                    onRestore();
                    close();
                  }}
                >
                  <span className="row-menu__label">Show in queue</span>
                  <span className="row-menu__desc">Bring it back to review</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="row-menu__item"
                  onClick={() => {
                    onDismiss();
                    close();
                  }}
                >
                  <span className="row-menu__label">Hide from queue</span>
                  <span className="row-menu__desc">Parked here — restore anytime</span>
                </button>
              )}
              <div className="row-menu__divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="row-menu__item row-menu__item--danger"
                onClick={() => setConfirming("discard")}
              >
                <span className="row-menu__label">Discard review</span>
                <span className="row-menu__desc">Regenerates on the next poll</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
