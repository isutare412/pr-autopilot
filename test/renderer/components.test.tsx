import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueueRow } from "../../src/renderer/src/components/QueueRow";
import { FindingCard } from "../../src/renderer/src/components/FindingCard";
import { ActionsBar, defaultVerdict as uiDefaultVerdict } from "../../src/renderer/src/components/ActionsBar";
import { defaultVerdict as coreDefaultVerdict } from "../../src/main/core/executor";
import { Detail } from "../../src/renderer/src/components/Detail";
import { QueueFilter } from "../../src/renderer/src/components/QueueFilter";
import { GeneratingPane } from "../../src/renderer/src/components/GeneratingPane";
import { RowActionsMenu } from "../../src/renderer/src/components/RowActionsMenu";

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
    fireEvent.click(screen.getByRole("button", { name: /hide #7/i }));
    expect(onDismiss).toHaveBeenCalledWith("k");
  });

  it("fires onRestore from a dismissed row's action button", () => {
    const onRestore = vi.fn();
    render(<QueueRow row={row({ dismissed: true })} selected={false} onOpen={vi.fn()} onDismiss={vi.fn()} onRestore={onRestore} />);
    fireEvent.click(screen.getByRole("button", { name: /show #7/i }));
    expect(onRestore).toHaveBeenCalledWith("k");
  });
});

describe("RowActionsMenu", () => {
  const base = { onDismiss: vi.fn(), onRestore: vi.fn(), onDelete: vi.fn() };

  it("opens the menu and shows Hide for an active record", () => {
    render(<RowActionsMenu {...base} dismissed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Hide from queue")).toBeInTheDocument();
    expect(screen.queryByText("Show in queue")).not.toBeInTheDocument();
  });

  it("shows Show in queue for a dismissed record", () => {
    render(<RowActionsMenu {...base} dismissed={true} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Show in queue")).toBeInTheDocument();
    expect(screen.queryByText("Hide from queue")).not.toBeInTheDocument();
  });

  it("fires onDismiss from Hide", () => {
    const onDismiss = vi.fn();
    render(<RowActionsMenu {...base} onDismiss={onDismiss} dismissed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByText("Hide from queue"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("fires onRestore from Show", () => {
    const onRestore = vi.fn();
    render(<RowActionsMenu {...base} onRestore={onRestore} dismissed={true} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByText("Show in queue"));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("requires the in-menu confirm before firing onDelete", () => {
    const onDelete = vi.fn();
    render(<RowActionsMenu {...base} onDelete={onDelete} dismissed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByText("Discard review"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Discard this review?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("cancel aborts the discard and returns to the list", () => {
    const onDelete = vi.fn();
    render(<RowActionsMenu {...base} onDelete={onDelete} dismissed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByText("Discard review"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Discard review")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<RowActionsMenu {...base} dismissed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Hide from queue")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("Hide from queue")).not.toBeInTheDocument();
  });

  it("closes on an outside click", () => {
    render(<RowActionsMenu {...base} dismissed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Hide from queue")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Hide from queue")).not.toBeInTheDocument();
  });

  it("hides Approve anyway unless canForceApprove", () => {
    render(<RowActionsMenu {...base} dismissed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.queryByText("Approve anyway")).not.toBeInTheDocument();
  });

  it("shows Approve anyway when canForceApprove and requires the in-menu confirm", () => {
    const onForceApprove = vi.fn();
    render(<RowActionsMenu {...base} dismissed={false} canForceApprove onForceApprove={onForceApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByText("Approve anyway"));
    expect(onForceApprove).not.toHaveBeenCalled();          // confirm first
    expect(screen.getByText(/leaves open comments/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(onForceApprove).toHaveBeenCalledTimes(1);
  });

  it("cancel aborts the approve and returns to the menu", () => {
    const onForceApprove = vi.fn();
    render(<RowActionsMenu {...base} dismissed={false} canForceApprove onForceApprove={onForceApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByText("Approve anyway"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onForceApprove).not.toHaveBeenCalled();
    expect(screen.getByText("Approve anyway")).toBeInTheDocument();
  });
});

describe("QueueFilter", () => {
  const props = { showDone: false, showDismissed: false, showClosed: false, doneCount: 2, dismissedCount: 1, closedCount: 3, onChange: vi.fn(), sort: { key: "activity", dir: "desc" } as const, onSortChange: vi.fn() };

  it("opens the menu and toggles show done", () => {
    const onChange = vi.fn();
    render(<QueueFilter {...props} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show done/i }));
    expect(onChange).toHaveBeenCalledWith({ showDone: true, showDismissed: false, showClosed: false });
  });

  it("toggles show dismissed independently", () => {
    const onChange = vi.fn();
    render(<QueueFilter {...props} showDone onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show dismissed/i }));
    expect(onChange).toHaveBeenCalledWith({ showDone: true, showDismissed: true, showClosed: false });
  });

  it("toggles show closed independently", () => {
    const onChange = vi.fn();
    render(<QueueFilter {...props} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show closed/i }));
    expect(onChange).toHaveBeenCalledWith({ showDone: false, showDismissed: false, showClosed: true });
  });

  it("'Show all' turns every option on", () => {
    const onChange = vi.fn();
    render(<QueueFilter {...props} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show all/i }));
    expect(onChange).toHaveBeenCalledWith({ showDone: true, showDismissed: true, showClosed: true });
  });

  it("'Show all' turns every option off when all are already on", () => {
    const onChange = vi.fn();
    render(<QueueFilter {...props} showDone showDismissed showClosed onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show all/i }));
    expect(onChange).toHaveBeenCalledWith({ showDone: false, showDismissed: false, showClosed: false });
  });

  it("'Show all' is checked only when all three options are on", () => {
    const { rerender } = render(<QueueFilter {...props} showDone showDismissed showClosed />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    expect(screen.getByRole("checkbox", { name: /show all/i })).toBeChecked();
    rerender(<QueueFilter {...props} showDone showDismissed={false} showClosed />);
    expect(screen.getByRole("checkbox", { name: /show all/i })).not.toBeChecked();
  });

  it("toggles direction when the active sort key is clicked again", () => {
    const onSortChange = vi.fn();
    render(<QueueFilter {...props} sort={{ key: "activity", dir: "desc" }} onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /recent activity/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "activity", dir: "asc" });
  });

  it("switches to the other key at descending", () => {
    const onSortChange = vi.fn();
    render(<QueueFilter {...props} sort={{ key: "activity", dir: "asc" }} onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /repo & number/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "repo", dir: "desc" });
  });

  it("badges the direction and marks the active key", () => {
    const { container } = render(<QueueFilter {...props} sort={{ key: "repo", dir: "asc" }} />);
    expect(container.querySelector(".filter-badge")?.textContent).toBe("↑");
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    expect(screen.getByRole("menuitemradio", { name: /repo & number/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /recent activity/i })).toHaveAttribute("aria-checked", "false");
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
  const props = { draft, onApprove: vi.fn(), onForceApprove: vi.fn(), onDismiss: vi.fn(), onRestore: vi.fn(), onDelete: vi.fn(), onFeedback: vi.fn() };

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

  it("shows Hide for an active record and Show in queue for a dismissed one", () => {
    render(<ActionsBar {...props} state="NEEDS_REVIEW" />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Hide from queue")).toBeInTheDocument();
    cleanup();
    render(<ActionsBar {...props} state="NEEDS_REVIEW" dismissed />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Show in queue")).toBeInTheDocument();
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

  it("defaults a nit-only draft to approve", () => {
    const onApprove = vi.fn();
    const nitDraft = {
      ...draft, counts: { critical: 0, major: 0, minor: 0, nit: 1 },
      findings: [{ ref: "#1", path: "a.ts", line: 5, priority: "Nit", body: "b", editedBody: null, included: true, anchorable: true }],
    };
    render(<ActionsBar {...props} draft={nitDraft} onApprove={onApprove} state="NEEDS_REVIEW" />);
    fireEvent.click(screen.getByRole("button", { name: /post/i }));
    expect(onApprove).toHaveBeenCalledWith("approve");
  });

  it("defaults a draft with a non-Nit finding to comment", () => {
    const onApprove = vi.fn();
    const majorDraft = {
      ...draft, counts: { critical: 0, major: 1, minor: 0, nit: 0 },
      findings: [{ ref: "#1", path: "a.ts", line: 5, priority: "Major", body: "b", editedBody: null, included: true, anchorable: true }],
    };
    render(<ActionsBar {...props} draft={majorDraft} onApprove={onApprove} state="NEEDS_REVIEW" />);
    fireEvent.click(screen.getByRole("button", { name: /post/i }));
    expect(onApprove).toHaveBeenCalledWith("comment");
  });

  it("exposes Approve anyway in POSTED_AWAITING_AUTHOR but not in NEEDS_REVIEW", () => {
    const onForceApprove = vi.fn();
    render(<ActionsBar {...props} state="POSTED_AWAITING_AUTHOR" onForceApprove={onForceApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByText("Approve anyway"));
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(onForceApprove).toHaveBeenCalledTimes(1);
    cleanup();
    render(<ActionsBar {...props} state="NEEDS_REVIEW" onForceApprove={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.queryByText("Approve anyway")).not.toBeInTheDocument();
  });
});

describe("Detail empty state", () => {
  const noop = () => {};
  it("shows the branded placeholder when no record is selected", () => {
    render(
      <Detail record={null} onToggle={noop} onEdit={noop} onApprove={noop} onForceApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />,
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
    render(<Detail record={rec()} onToggle={noop} onEdit={noop} onApprove={noop} onForceApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />);
    const link = screen.getByRole("link", { name: /view on github/i });
    expect(link).toHaveAttribute("href", "https://github.com/owner/repo/pull/1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows the link while a review is still generating", () => {
    render(<Detail record={rec({ state: "GENERATING", draft: null })} onToggle={noop} onEdit={noop} onApprove={noop} onForceApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />);
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

  it("shows Hide for an errored record and Show in queue when dismissed", () => {
    render(
      <Detail record={errRecord("ERROR")} onToggle={noop} onEdit={noop} onApprove={noop} onForceApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Hide from queue")).toBeInTheDocument();
    cleanup();
    render(
      <Detail record={errRecord("ERROR", true)} onToggle={noop} onEdit={noop} onApprove={noop} onForceApprove={noop} onDismiss={noop} onRestore={noop} onDelete={noop} onFeedback={noop} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText("Show in queue")).toBeInTheDocument();
  });
});

describe("GeneratingPane", () => {
  const rec = (over = {}) =>
    ({
      key: "k", number: 7, repo: "svc", title: "t", state: "GENERATING",
      mode: "first-review", updatedAt: "", ...over,
    }) as unknown as import("../../src/renderer/src/types").UiRecord;

  it("renders every activity line, not just the last few", () => {
    const activity = Array.from({ length: 20 }, (_, i) => `step ${i}`);
    render(<GeneratingPane record={rec({ genActivity: activity })} />);
    expect(screen.getByText(/step 0$/)).toBeInTheDocument();
    expect(screen.getByText(/step 19$/)).toBeInTheDocument();
    expect(document.querySelectorAll(".act-line")).toHaveLength(20);
  });

  it("marks only the last line active", () => {
    render(<GeneratingPane record={rec({ genActivity: ["a", "b", "c"] })} />);
    const active = document.querySelectorAll(".act-line.act-active");
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain("c");
  });

  it("shows the warming-up placeholder when the feed is empty", () => {
    render(<GeneratingPane record={rec({ genActivity: [] })} />);
    expect(screen.getByText(/warming up/i)).toBeInTheDocument();
  });
});

describe("defaultVerdict parity: executor vs ActionsBar", () => {
  const draft = (findings: any[], verify: any[] = []) => ({
    overallEn: "", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings, verify,
  });
  const f = (priority: string, included = true, anchorable = true) =>
    ({ ref: "#1", path: "a.ts", line: 1, side: "RIGHT", startLine: null, startSide: null,
       anchorable, priority, body: "b", suggestion: null, included, editedBody: null, id: "x" });
  const v = (verdict: string, included = true) =>
    ({ ref: "V1", verdict, included, id: "v", threadNodeId: "N", replyTargetDatabaseId: 1,
       path: "a.ts", line: 1, rationaleEn: "r", replyBody: "", editedBody: null });
  const check = (d: any, expected: "approve" | "comment") => {
    expect(coreDefaultVerdict(d as any)).toBe(expected);
    expect(uiDefaultVerdict(d as any)).toBe(expected);
    expect(coreDefaultVerdict(d as any)).toBe(uiDefaultVerdict(d as any));
  };

  it("empty → approve", () => check(draft([]), "approve"));
  it("nit-only → approve", () => check(draft([f("Nit")]), "approve"));
  it("a non-Nit finding → comment", () => check(draft([f("Major")]), "comment"));
  it("nit + open follow-up → comment", () => check(draft([f("Nit")], [v("follow-up")]), "comment"));
  it("nit + resolve-only reply → approve", () => check(draft([f("Nit")], [v("resolve")]), "approve"));
  it("excluded non-Nit finding does not force comment", () => check(draft([f("Critical", false), f("Nit")]), "approve"));
});
