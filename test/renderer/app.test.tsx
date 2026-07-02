import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { UiRow } from "../../src/renderer/src/types";

// The renderer `api` is `window.api`; mock the module App imports.
const api = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items: [] as UiRow[] })),
  get: vi.fn(async () => null),
  toggle: vi.fn(),
  edit: vi.fn(),
  approve: vi.fn(),
  feedback: vi.fn(),
  dismiss: vi.fn(),
  pollNow: vi.fn(async () => {}),
  openPreferences: vi.fn(),
  onRecordsChanged: vi.fn((_cb: () => void) => () => {}),
  onFocusPr: vi.fn(() => () => {}),
  getSettings: vi.fn(async () => ({ operatingMode: "supervised", pollIntervalSec: 600, showDone: false, showDismissed: false, showClosed: false })),
  setMode: vi.fn(async () => {}),
  onModeChanged: vi.fn(() => () => {}),
  setPollInterval: vi.fn(async () => {}),
  onPollIntervalChanged: vi.fn((_fn: (sec: number) => void) => (() => {})),
  setQueueFilters: vi.fn(async () => {}),
  onQueueFiltersChanged: vi.fn(() => () => {}),
}));
vi.mock("../../src/renderer/src/api", () => ({ api }));

import { App } from "../../src/renderer/src/App";

beforeEach(() => {
  vi.clearAllMocks();
  document.title = "";
  api.list.mockResolvedValue({ items: [] });
});
afterEach(cleanup);

describe("App — Poll now", () => {
  it("calls api.pollNow then re-lists when clicked", async () => {
    render(<App />);
    await waitFor(() => expect(api.list).toHaveBeenCalled()); // initial mount list
    const before = api.list.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /poll now/i }));
    await waitFor(() => expect(api.pollNow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(before));
  });

  it("disables the button and shows Polling… while the poll runs", async () => {
    let resolvePoll!: () => void;
    api.pollNow.mockReturnValueOnce(new Promise<void>((r) => { resolvePoll = r; }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /poll now/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /polling/i })).toBeDisabled());
    resolvePoll();
    await waitFor(() => expect(screen.getByRole("button", { name: /poll now/i })).not.toBeDisabled());
  });
});

describe("App — mode switch", () => {
  it("reflects the loaded mode and calls api.setMode on click", async () => {
    api.getSettings.mockResolvedValue({ operatingMode: "disabled", pollIntervalSec: 600, showDone: false, showDismissed: false, showClosed: false });
    render(<App />);
    // "disabled" differs from the useState default "supervised", so this can
    // only be true if the api.getSettings() load actually drove state.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Disabled" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Supervised" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Automated" }));
    await waitFor(() => expect(api.setMode).toHaveBeenCalledWith("automated"));
  });

  it("renders the mode help affordance with an explanation of each mode", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /what the modes mean/i })).toBeInTheDocument();
    // The explanation copy is always in the DOM; hover/focus only toggles CSS visibility.
    expect(screen.getByText("Pauses watching for review requests.")).toBeInTheDocument();
    expect(screen.getByText(/no approval step/i)).toBeInTheDocument();
  });
});

describe("App — queue filters", () => {
  const rows = [
    { key: "k1", number: 1, repo: "r", title: "Active row", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "" },
    { key: "k2", number: 2, repo: "r", title: "Done row", state: "DONE", mode: "first-review", counts: null, updatedAt: "" },
    { key: "k3", number: 3, repo: "r", title: "Dismissed row", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "", dismissed: true },
    { key: "k4", number: 4, repo: "r", title: "Closed row", state: "CLOSED", mode: "first-review", counts: null, updatedAt: "" },
  ] as UiRow[];

  it("hides DONE and dismissed rows by default", async () => {
    api.list.mockResolvedValue({ items: rows });
    render(<App />);
    await waitFor(() => expect(screen.getByText("Active row")).toBeInTheDocument());
    expect(screen.queryByText("Done row")).not.toBeInTheDocument();
    expect(screen.queryByText("Dismissed row")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed row")).not.toBeInTheDocument();
  });

  it("reveals only DONE when Show done is checked", async () => {
    api.list.mockResolvedValue({ items: rows });
    render(<App />);
    await waitFor(() => expect(screen.getByText("Active row")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show done/i }));
    await waitFor(() => expect(screen.getByText("Done row")).toBeInTheDocument());
    expect(screen.queryByText("Dismissed row")).not.toBeInTheDocument();
    expect(api.setQueueFilters).toHaveBeenCalledWith({ showDone: true, showDismissed: false, showClosed: false });
  });

  it("reveals only dismissed when Show dismissed is checked", async () => {
    api.list.mockResolvedValue({ items: rows });
    render(<App />);
    await waitFor(() => expect(screen.getByText("Active row")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show dismissed/i }));
    await waitFor(() => expect(screen.getByText("Dismissed row")).toBeInTheDocument());
    expect(screen.queryByText("Done row")).not.toBeInTheDocument();
  });

  it("reveals only CLOSED when Show closed is checked", async () => {
    api.list.mockResolvedValue({ items: rows });
    render(<App />);
    await waitFor(() => expect(screen.getByText("Active row")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show closed/i }));
    await waitFor(() => expect(screen.getByText("Closed row")).toBeInTheDocument());
    expect(screen.queryByText("Done row")).not.toBeInTheDocument();
    expect(api.setQueueFilters).toHaveBeenCalledWith({ showDone: false, showDismissed: false, showClosed: true });
  });

  it("clears the detail pane when a filter hides the selected PR", async () => {
    // Start with Show done ON so the DONE row (k2) is visible and selectable.
    api.getSettings.mockResolvedValue({
      operatingMode: "supervised", pollIntervalSec: 600,
      showDone: true, showDismissed: false, showClosed: false,
    });
    api.list.mockResolvedValue({ items: rows });
    // Selecting k2 loads its record; Detail renders "View on GitHub" for any record.
    api.get.mockResolvedValue({
      key: "k2", number: 2, title: "Done row", url: "http://x",
      state: "DONE", draft: null, error: null,
    } as any);

    render(<App />);
    // The DONE row is visible because Show done was loaded as true.
    await waitFor(() => expect(screen.getByText("Done row")).toBeInTheDocument());

    // Select it — detail pane now shows the record.
    fireEvent.click(screen.getByText("Done row"));
    await waitFor(() => expect(screen.getByText("View on GitHub")).toBeInTheDocument());

    // Turn Show done OFF — k2 leaves the queue and the detail must clear.
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show done/i }));

    await waitFor(() => expect(screen.queryByText("Done row")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Select a PR to review")).toBeInTheDocument());
    expect(screen.queryByText("View on GitHub")).not.toBeInTheDocument();
  });

  it("keeps the selection when a filter change does not hide it", async () => {
    api.list.mockResolvedValue({ items: rows });
    // k1 (active NEEDS_REVIEW) is visible under default filters.
    api.get.mockResolvedValue({
      key: "k1", number: 1, title: "Active row", url: "http://x",
      state: "NEEDS_REVIEW", draft: null, error: null,
    } as any);

    render(<App />);
    await waitFor(() => expect(screen.getByText("Active row")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Active row"));
    await waitFor(() => expect(screen.getByText("View on GitHub")).toBeInTheDocument());

    // Toggle an unrelated filter (Show closed) — k1 stays visible, selection intact.
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /show closed/i }));

    await waitFor(() => expect(screen.getByText("Closed row")).toBeInTheDocument());
    expect(screen.getByText("View on GitHub")).toBeInTheDocument();
    expect(screen.queryByText("Select a PR to review")).not.toBeInTheDocument();
  });

  it("clears the detail pane when the selected PR advances to a hidden state", async () => {
    // Show done OFF (set explicitly: getSettings implementations leak across
    // tests since clearAllMocks does not reset them). k1 starts visible as
    // NEEDS_REVIEW. Capture the onRecordsChanged callback the app subscribes at
    // mount (mockImplementationOnce is consumed by that single mount call, so
    // it does not leak into other tests).
    api.getSettings.mockResolvedValue({
      operatingMode: "supervised", pollIntervalSec: 600,
      showDone: false, showDismissed: false, showClosed: false,
    });
    let onRecords: (() => void) | undefined;
    api.onRecordsChanged.mockImplementationOnce((cb: () => void) => {
      onRecords = cb;
      return () => {};
    });
    api.list.mockResolvedValue({ items: [
      { key: "k1", number: 1, repo: "r", title: "Active row", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "" },
    ] as UiRow[] });
    api.get.mockResolvedValue({
      key: "k1", number: 1, title: "Active row", url: "http://x",
      state: "NEEDS_REVIEW", draft: null, error: null,
    } as any);

    render(<App />);
    await waitFor(() => expect(screen.getByText("Active row")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Active row"));
    await waitFor(() => expect(screen.getByText("View on GitHub")).toBeInTheDocument());

    // The PR completes to DONE while Show done is off: its row leaves the queue
    // and a re-fetch returns the DONE record. The main process fires
    // onRecordsChanged after state advances; the pane must converge to cleared
    // even though the app re-fetches the (now hidden) record.
    api.list.mockResolvedValue({ items: [
      { key: "k1", number: 1, repo: "r", title: "Active row", state: "DONE", mode: "first-review", counts: null, updatedAt: "" },
    ] as UiRow[] });
    api.get.mockResolvedValue({
      key: "k1", number: 1, title: "Active row", url: "http://x",
      state: "DONE", draft: null, error: null,
    } as any);
    await act(async () => { onRecords?.(); });

    await waitFor(() => expect(screen.getByText("Select a PR to review")).toBeInTheDocument());
    expect(screen.queryByText("View on GitHub")).not.toBeInTheDocument();
  });
});

describe("App — window title", () => {
  it("does not count a dismissed NEEDS_REVIEW as 'to review'", async () => {
    api.list.mockResolvedValue({ items: [
      { key: "k1", number: 1, repo: "r", title: "Dismissed NR", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "", dismissed: true },
    ] as UiRow[] });
    render(<App />);
    await waitFor(() => expect(document.title).toBe("PR Autopilot"));
  });

  it("counts only visible NEEDS_REVIEW rows in the title", async () => {
    api.list.mockResolvedValue({ items: [
      { key: "k1", number: 1, repo: "r", title: "Active NR", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "" },
      { key: "k2", number: 2, repo: "r", title: "Dismissed NR", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "", dismissed: true },
    ] as UiRow[] });
    render(<App />);
    await waitFor(() => expect(document.title).toBe("PR Autopilot — 1 to review"));
  });
});

describe("App — settings gear", () => {
  it("opens Preferences when the gear is clicked", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    await waitFor(() => expect(api.openPreferences).toHaveBeenCalledTimes(1));
  });
});

describe("App — poll interval", () => {
  it("reflects the loaded pollIntervalSec in the dropdown", async () => {
    api.getSettings.mockResolvedValue({ operatingMode: "supervised", pollIntervalSec: 900, showDone: false, showDismissed: false, showClosed: false });
    render(<App />);
    const select = () => screen.getByRole("combobox", { name: /poll interval/i }) as HTMLSelectElement;
    await waitFor(() => expect(select().value).toBe("900"));
  });

  it("shows a non-preset interval as the nearest preset without rewriting it", async () => {
    // 420s has no preset; nearest is 300 (5m). It must display as 300 but never
    // be silently persisted back — only an explicit user choice calls setPollInterval.
    api.getSettings.mockResolvedValue({ operatingMode: "supervised", pollIntervalSec: 420, showDone: false, showDismissed: false, showClosed: false });
    render(<App />);
    const select = () => screen.getByRole("combobox", { name: /poll interval/i }) as HTMLSelectElement;
    await waitFor(() => expect(select().value).toBe("300"));
    expect(api.setPollInterval).not.toHaveBeenCalled();
  });

  it("calls api.setPollInterval with the chosen seconds on change", async () => {
    render(<App />);
    const select = screen.getByRole("combobox", { name: /poll interval/i });
    fireEvent.change(select, { target: { value: "60" } });
    await waitFor(() => expect(api.setPollInterval).toHaveBeenCalledWith(60));
  });

  it("updates the dropdown when a poll-interval-changed broadcast arrives", async () => {
    let cb: ((sec: number) => void) | null = null;
    api.onPollIntervalChanged.mockImplementation((fn: (sec: number) => void) => { cb = fn; return () => {}; });
    render(<App />);
    const select = () => screen.getByRole("combobox", { name: /poll interval/i }) as HTMLSelectElement;
    await waitFor(() => expect(cb).not.toBeNull());
    cb!(1800);
    await waitFor(() => expect(select().value).toBe("1800"));
  });
});
