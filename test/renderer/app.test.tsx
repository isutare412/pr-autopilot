import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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
  onRecordsChanged: vi.fn(() => () => {}),
  onFocusPr: vi.fn(() => () => {}),
  getSettings: vi.fn(async () => ({ operatingMode: "supervised", pollIntervalSec: 600 })),
  setMode: vi.fn(async () => {}),
  onModeChanged: vi.fn(() => () => {}),
  setPollInterval: vi.fn(async () => {}),
  onPollIntervalChanged: vi.fn((_fn: (sec: number) => void) => (() => {})),
}));
vi.mock("../../src/renderer/src/api", () => ({ api }));

import { App } from "../../src/renderer/src/App";

beforeEach(() => {
  vi.clearAllMocks();
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
    api.getSettings.mockResolvedValue({ operatingMode: "disabled", pollIntervalSec: 600 });
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

describe("App — Show hidden", () => {
  it("hides DISMISSED rows until 'Show hidden' is toggled", async () => {
    api.list.mockResolvedValue({ items: [
      { key: "k1", number: 1, repo: "r", title: "Active row", state: "NEEDS_REVIEW", mode: "first-review", counts: null, updatedAt: "" },
      { key: "k2", number: 2, repo: "r", title: "Hidden row", state: "DISMISSED", mode: "first-review", counts: null, updatedAt: "" },
    ] as UiRow[] });
    render(<App />);
    await waitFor(() => expect(screen.getByText("Active row")).toBeInTheDocument());
    expect(screen.queryByText("Hidden row")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show hidden/i }));
    await waitFor(() => expect(screen.getByText("Hidden row")).toBeInTheDocument());
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
    api.getSettings.mockResolvedValue({ operatingMode: "supervised", pollIntervalSec: 900 });
    render(<App />);
    const select = () => screen.getByRole("combobox", { name: /poll interval/i }) as HTMLSelectElement;
    await waitFor(() => expect(select().value).toBe("900"));
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
