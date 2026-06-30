import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// The renderer `api` is `window.api`; mock the module App imports.
const api = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items: [] })),
  get: vi.fn(async () => null),
  toggle: vi.fn(),
  edit: vi.fn(),
  approve: vi.fn(),
  feedback: vi.fn(),
  dismiss: vi.fn(),
  pollNow: vi.fn(async () => {}),
  onRecordsChanged: vi.fn(() => () => {}),
  onFocusPr: vi.fn(() => () => {}),
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
