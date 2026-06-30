import { useState } from "react";

interface Props {
  onDelete: () => void;
}

export function DeleteButton({ onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="del-btn" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }

  return (
    <span className="del-confirm">
      <span className="del-confirm__q">Delete?</span>
      <button type="button" className="del-btn del-btn--danger" onClick={onDelete}>
        Confirm
      </button>
      <button type="button" className="del-btn" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  );
}
