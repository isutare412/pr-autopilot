import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueueRow } from "../../src/renderer/src/components/QueueRow";
import { FindingCard } from "../../src/renderer/src/components/FindingCard";
import { ActionsBar } from "../../src/renderer/src/components/ActionsBar";
import { Detail } from "../../src/renderer/src/components/Detail";
import { DeleteButton } from "../../src/renderer/src/components/DeleteButton";

afterEach(cleanup);

describe("QueueRow", () => {
  const row = (over = {}) => ({ key: "k", number: 7, repo: "svc", title: "Add X", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "", ...over });

  it("renders #number, repo, state and fires onOpen", () => {
    const onOpen = vi.fn();
    render(<QueueRow row={row()} selected={false} onOpen={onOpen} onDismiss={vi.fn()} onRestore={vi.fn()} />);
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByText("svc")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add X"));
    expect(onOpen).toHaveBeenCalledWith("k");
  });

  it("fires onDismiss from an active row's action button", () => {
    const onDismiss = vi.fn();
    render(<QueueRow row={row()} selected={false} onOpen={vi.fn()} onDismiss={onDismiss} onRestore={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss #7/i }));
    expect(onDismiss).toHaveBeenCalledWith("k");
  });

  it("fires onRestore from a hidden (DISMISSED) row's action button", () => {
    const onRestore = vi.fn();
    render(<QueueRow row={row({ state: "DISMISSED" })} selected={false} onOpen={vi.fn()} onDismiss={vi.fn()} onRestore={onRestore} />);
    fireEvent.click(screen.getByRole("button", { name: /restore #7/i }));
    expect(onRestore).toHaveBeenCalledWith("k");
  });
});

describe("FindingCard", () => {
  it("shows editedBody over body and fires onEdit on change", () => {
    const onEdit = vi.fn();
    render(<FindingCard f={{ ref: "#1", path: "a.ts", line: 5, priority: "Critical", body: "orig", editedBody: "edited", included: true, anchorable: true }} onToggle={vi.fn()} onEdit={onEdit} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("edited");
    fireEvent.change(ta, { target: { value: "new" } });
    expect(onEdit).toHaveBeenCalledWith("#1", "new");
  });
});

describe("ActionsBar", () => {
  const draft = { overallEn: "", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
  const props = { draft, onApprove: vi.fn(), onDismiss: vi.fn(), onRestore: vi.fn(), onDelete: vi.fn(), onFeedback: vi.fn() };

  it("enables Approve only for NEEDS_REVIEW", () => {
    const { rerender } = render(<ActionsBar {...props} state="NEEDS_REVIEW" />);
    expect(screen.getByText(/Approve/).closest("button")).not.toBeDisabled();
    rerender(<ActionsBar {...props} state="DONE" />);
    expect(screen.getByText(/Approve/).closest("button")).toBeDisabled();
  });

  it("shows Dismiss for an active record and Restore for a dismissed one", () => {
    const { rerender } = render(<ActionsBar {...props} state="NEEDS_REVIEW" />);
    expect(screen.getByRole("button", { name: /^dismiss$/i })).toBeInTheDocument();
    rerender(<ActionsBar {...props} state="DISMISSED" />);
    expect(screen.getByRole("button", { name: /^restore$/i })).toBeInTheDocument();
  });
});

describe("DeleteButton", () => {
  it("requires a confirm step before firing onDelete", () => {
    const onDelete = vi.fn();
    render(<DeleteButton onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("cancel aborts without firing onDelete", () => {
    const onDelete = vi.fn();
    render(<DeleteButton onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });
});

describe("Detail empty state", () => {
  const noop = () => {};
  it("shows the branded placeholder when no record is selected", () => {
    render(
      <Detail record={null} onToggle={noop} onEdit={noop} onApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />,
    );
    expect(screen.getByText("Select a PR to review")).toBeInTheDocument();
    expect(screen.getByText(/Pick a pull request from the queue/)).toBeInTheDocument();
  });
});
