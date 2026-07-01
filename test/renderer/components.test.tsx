import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueueRow } from "../../src/renderer/src/components/QueueRow";
import { FindingCard } from "../../src/renderer/src/components/FindingCard";
import { ActionsBar } from "../../src/renderer/src/components/ActionsBar";
import { Detail } from "../../src/renderer/src/components/Detail";
import { DeleteButton } from "../../src/renderer/src/components/DeleteButton";
import { QueueFilter } from "../../src/renderer/src/components/QueueFilter";

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

  it("fires onRestore from a dismissed row's action button", () => {
    const onRestore = vi.fn();
    render(<QueueRow row={row({ dismissed: true })} selected={false} onOpen={vi.fn()} onDismiss={vi.fn()} onRestore={onRestore} />);
    fireEvent.click(screen.getByRole("button", { name: /restore #7/i }));
    expect(onRestore).toHaveBeenCalledWith("k");
  });
});

describe("QueueFilter", () => {
  const props = { showDone: false, showDismissed: false, doneCount: 2, dismissedCount: 1, onChange: vi.fn() };

  it("opens the menu and toggles show done", () => {
    const onChange = vi.fn();
    render(<QueueFilter {...props} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show done/i }));
    expect(onChange).toHaveBeenCalledWith({ showDone: true, showDismissed: false });
  });

  it("toggles show dismissed independently", () => {
    const onChange = vi.fn();
    render(<QueueFilter {...props} showDone onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show dismissed/i }));
    expect(onChange).toHaveBeenCalledWith({ showDone: true, showDismissed: true });
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

  it("shows the Post control for NEEDS_REVIEW and hides it once posted", () => {
    const { rerender } = render(<ActionsBar {...props} state="NEEDS_REVIEW" />);
    expect(screen.getByRole("button", { name: /post/i })).toBeInTheDocument();
    rerender(<ActionsBar {...props} state="DONE" />);
    expect(screen.queryByRole("button", { name: /post/i })).not.toBeInTheDocument();
    expect(screen.getByText(/already done/i)).toBeInTheDocument();
  });

  it("posts with the chosen verdict (clean draft defaults to approve)", () => {
    const onApprove = vi.fn();
    render(<ActionsBar {...props} onApprove={onApprove} state="NEEDS_REVIEW" />);
    fireEvent.click(screen.getByRole("button", { name: /post/i }));
    expect(onApprove).toHaveBeenCalledWith("approve");
    fireEvent.click(screen.getByRole("radio", { name: /comment/i }));
    fireEvent.click(screen.getByRole("button", { name: /post/i }));
    expect(onApprove).toHaveBeenLastCalledWith("comment");
  });

  it("shows Dismiss for an active record and Restore for a dismissed one", () => {
    const { rerender } = render(<ActionsBar {...props} state="NEEDS_REVIEW" />);
    expect(screen.getByRole("button", { name: /^dismiss$/i })).toBeInTheDocument();
    rerender(<ActionsBar {...props} state="NEEDS_REVIEW" dismissed />);
    expect(screen.getByRole("button", { name: /^restore$/i })).toBeInTheDocument();
  });

  it("sends feedback on Cmd+Enter and clears the textarea", () => {
    const onFeedback = vi.fn();
    render(<ActionsBar {...props} onFeedback={onFeedback} state="NEEDS_REVIEW" />);
    const ta = screen.getByPlaceholderText(/resolve V2/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "soften #1" } });
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    expect(onFeedback).toHaveBeenCalledWith("soften #1");
    expect(ta.value).toBe("");
  });

  it("does not send empty or whitespace-only feedback", () => {
    const onFeedback = vi.fn();
    render(<ActionsBar {...props} onFeedback={onFeedback} state="NEEDS_REVIEW" />);
    const ta = screen.getByPlaceholderText(/resolve V2/i);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onFeedback).not.toHaveBeenCalled();
    fireEvent.change(ta, { target: { value: "   " } });
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    expect(onFeedback).not.toHaveBeenCalled();
  });

  it("labels the Post and Send buttons without trailing arrows", () => {
    const { rerender } = render(<ActionsBar {...props} state="NEEDS_REVIEW" />);
    expect(screen.getByRole("button", { name: "Post" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    rerender(<ActionsBar {...props} state="ERROR" />);
    expect(screen.getByRole("button", { name: "Retry post" })).toBeInTheDocument();
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

describe("Detail — View on GitHub link", () => {
  const noop = () => {};
  const rec = (over = {}) =>
    ({
      key: "k",
      host: "github.com",
      owner: "owner",
      repo: "repo",
      number: 1,
      url: "https://github.com/owner/repo/pull/1",
      title: "Test PR",
      author: "author",
      baseRef: "main",
      state: "NEEDS_REVIEW",
      mode: "first-review",
      headSha: "",
      draftVersion: 1,
      draft: { overallEn: "looks good", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] },
      feedbackHistory: [],
      postResult: null,
      postProgress: null,
      error: null,
      discoveredAt: "",
      generatedAt: null,
      updatedAt: "",
      doneAt: null,
      ...over,
    }) as import("../../src/renderer/src/types").UiRecord;

  it("links the draft header to the PR url, opening in a new tab", () => {
    render(<Detail record={rec()} onToggle={noop} onEdit={noop} onApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />);
    const link = screen.getByRole("link", { name: /view on github/i });
    expect(link).toHaveAttribute("href", "https://github.com/owner/repo/pull/1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows the link while a review is still generating", () => {
    render(<Detail record={rec({ state: "GENERATING", draft: null })} onToggle={noop} onEdit={noop} onApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />);
    expect(screen.getByRole("link", { name: /view on github/i })).toHaveAttribute("href", "https://github.com/owner/repo/pull/1");
  });
});

describe("Detail error-branch actions", () => {
  const noop = () => {};
  const errRecord = (state: string, dismissed = false) => ({
    key: "k",
    host: "github.com",
    owner: "owner",
    repo: "repo",
    number: 1,
    url: "https://github.com/owner/repo/pull/1",
    title: "Test PR",
    author: "author",
    baseRef: "main",
    state,
    mode: "first-review",
    headSha: "",
    draftVersion: 0,
    draft: null,
    feedbackHistory: [],
    postResult: null,
    postProgress: null,
    error: { step: "generate", message: "boom" },
    discoveredAt: "",
    generatedAt: null,
    updatedAt: "",
    doneAt: null,
    dismissed,
  } as import("../../src/renderer/src/types").UiRecord);

  it("shows Dismiss for an errored record and Restore when dismissed", () => {
    const { rerender } = render(
      <Detail record={errRecord("ERROR")} onToggle={noop} onEdit={noop} onApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />,
    );
    expect(screen.getByRole("button", { name: /^dismiss$/i })).toBeInTheDocument();
    rerender(
      <Detail record={errRecord("ERROR", true)} onToggle={noop} onEdit={noop} onApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />,
    );
    expect(screen.getByRole("button", { name: /^restore$/i })).toBeInTheDocument();
  });
});
