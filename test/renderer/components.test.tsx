import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueueRow } from "../../src/renderer/src/components/QueueRow";
import { FindingCard } from "../../src/renderer/src/components/FindingCard";
import { ActionsBar } from "../../src/renderer/src/components/ActionsBar";
import { Detail } from "../../src/renderer/src/components/Detail";

afterEach(cleanup);

describe("QueueRow", () => {
  it("renders #number, repo, state and fires onOpen", () => {
    const onOpen = vi.fn();
    render(<QueueRow row={{ key: "k", number: 7, repo: "svc", title: "Add X", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "" }} selected={false} onOpen={onOpen} onDelete={vi.fn()} />);
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByText("svc")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add X"));
    expect(onOpen).toHaveBeenCalledWith("k");
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
  it("enables Approve only for NEEDS_REVIEW", () => {
    const { rerender } = render(<ActionsBar draft={{ overallEn: "", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] }} state="NEEDS_REVIEW" onApprove={vi.fn()} onDelete={vi.fn()} onFeedback={vi.fn()} />);
    expect(screen.getByText(/Approve/).closest("button")).not.toBeDisabled();
    rerender(<ActionsBar draft={{ overallEn: "", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] }} state="DONE" onApprove={vi.fn()} onDelete={vi.fn()} onFeedback={vi.fn()} />);
    expect(screen.getByText(/Approve/).closest("button")).toBeDisabled();
  });
});

describe("Detail empty state", () => {
  const noop = () => {};
  it("shows the branded placeholder when no record is selected", () => {
    render(
      <Detail record={null} onToggle={noop} onEdit={noop} onApprove={noop} onDelete={noop} onFeedback={noop} />,
    );
    expect(screen.getByText("Select a PR to review")).toBeInTheDocument();
    expect(screen.getByText(/Pick a pull request from the queue/)).toBeInTheDocument();
  });
});
