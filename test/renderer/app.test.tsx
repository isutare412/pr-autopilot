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
  onRecordsChanged: vi.fn(() => () => {}),
  onFocusPr: vi.fn(() => () => {}),
  getSettings: vi.fn(async () => ({ operatingMode: "supervised" })),
  setMode: vi.fn(async () => {}),
  onModeChanged: vi.fn(() => () => {}),
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
    api.getSettings.mockResolvedValue({ operatingMode: "supervised" });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Supervised" })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Automated" }));
    await waitFor(() => expect(api.setMode).toHaveBeenCalledWith("automated"));
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
