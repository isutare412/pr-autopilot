import { vi } from "vitest";
vi.mock("electron", () => ({ Tray: class {}, Menu: {}, nativeImage: {} }));

import { describe, it, expect } from "vitest";
import { buildTrayMenu, trayIconFile, hasNeedsReview } from "../src/main/tray";
import type { PrRecord, OperatingMode } from "../src/main/core/schema";

const rec = (over: Partial<PrRecord>): PrRecord => ({
  key: "h/o/r#1", host: "h", owner: "o", repo: "r", number: 1, url: "u", title: "T",
  author: "a", baseRef: "main", state: "NEEDS_REVIEW", mode: "first-review", headSha: "s",
  draftVersion: 1, draft: null, feedbackHistory: [], postResult: null, postProgress: null,
  error: null, discoveredAt: "", generatedAt: null, updatedAt: "", doneAt: null, ...over,
});

const handlers = {
  openPr: vi.fn(), openMain: vi.fn(), pollNow: vi.fn(), openPreferences: vi.fn(),
  toggleLogin: vi.fn(), quit: vi.fn(), openAtLogin: true,
  getMode: () => "supervised" as OperatingMode, setMode: vi.fn(),
  getFilters: () => ({ showDone: false, showDismissed: false, showClosed: false }),
};

describe("buildTrayMenu", () => {
  it("lists visible PRs '#n repo — STATE' NEEDS_REVIEW first, hiding dismissed and (by default) DONE", () => {
    const records = [
      rec({ key: "k-done", number: 2, repo: "r2", state: "DONE", title: "done" }),
      rec({ key: "k-nr", number: 3, repo: "r3", state: "NEEDS_REVIEW", title: "needs" }),
      rec({ key: "k-dis", number: 4, repo: "r4", state: "NEEDS_REVIEW", dismissed: true }),
    ];
    const menu = buildTrayMenu(records, handlers);
    const labels = menu.map((m) => m.label);
    expect(labels).toContain("#3 r3 — NEEDS_REVIEW");
    expect(labels.some((l) => l?.includes("#2"))).toBe(false); // DONE hidden (showDone off)
    expect(labels.some((l) => l?.includes("#4"))).toBe(false); // dismissed hidden
  });

  it("reveals DONE and dismissed rows when the filters are on", () => {
    const h = { ...handlers, getFilters: () => ({ showDone: true, showDismissed: true, showClosed: false }) };
    const records = [
      rec({ key: "k-done", number: 2, repo: "r2", state: "DONE", title: "done" }),
      rec({ key: "k-dis", number: 4, repo: "r4", state: "NEEDS_REVIEW", dismissed: true, title: "dis" }),
    ];
    const labels = buildTrayMenu(records, h).map((m) => m.label);
    expect(labels).toContain("#2 r2 — DONE");
    expect(labels).toContain("#4 r4 — NEEDS_REVIEW");
  });

  it("hides a CLOSED row unless showClosed is on", () => {
    const records = [rec({ key: "k-cl", number: 9, repo: "r9", state: "CLOSED", title: "closed" })];
    expect(buildTrayMenu(records, handlers).map((m) => m.label).some((l) => l?.includes("#9"))).toBe(false);
    const h = { ...handlers, getFilters: () => ({ showDone: false, showDismissed: false, showClosed: true }) };
    expect(buildTrayMenu(records, h).map((m) => m.label)).toContain("#9 r9 — CLOSED");
  });

  it("includes the fixed controls and reflects openAtLogin as checked", () => {
    const menu = buildTrayMenu([], handlers);
    const byLabel = (s: string) => menu.find((m) => m.label === s);
    expect(byLabel("Open PR Autopilot")).toBeTruthy();
    expect(byLabel("Poll now")).toBeTruthy();
    expect(byLabel("Preferences…")).toBeTruthy();
    expect(byLabel("Quit")).toBeTruthy();
    expect(byLabel("Launch at login")?.checked).toBe(true);
  });

  it("wires a PR item click to openPr(key)", () => {
    const menu = buildTrayMenu([rec({ key: "k-nr", number: 3, repo: "r3", state: "NEEDS_REVIEW" })], handlers);
    const item = menu.find((m) => m.label === "#3 r3 — NEEDS_REVIEW")!;
    (item.click as () => void)();
    expect(handlers.openPr).toHaveBeenCalledWith("k-nr");
  });
});

describe("buildTrayMenu — mode controls", () => {
  it("renders three mode radios with the current mode checked", () => {
    const h = { ...handlers, getMode: () => "automated" as OperatingMode };
    const menu = buildTrayMenu([], h);
    const item = (s: string) => menu.find((m) => m.label === s);
    expect(item("Disabled")?.type).toBe("radio");
    expect(item("Automated")?.checked).toBe(true);
    expect(item("Supervised")?.checked).toBe(false);
    expect(item("Disabled")?.checked).toBe(false);
  });

  it("wires a mode radio click to setMode", () => {
    const setMode = vi.fn();
    const h = { ...handlers, getMode: () => "supervised" as OperatingMode, setMode };
    const menu = buildTrayMenu([], h);
    (menu.find((m) => m.label === "Disabled")!.click as () => void)();
    expect(setMode).toHaveBeenCalledWith("disabled");
  });
});

describe("trayIconFile", () => {
  it("maps each mode to its template png", () => {
    expect(trayIconFile("disabled")).toBe("trayTemplate-disabled.png");
    expect(trayIconFile("supervised")).toBe("trayTemplate.png");
    expect(trayIconFile("automated")).toBe("trayTemplate-automated.png");
  });

  it("badges the supervised wheel when reviews await, picking the light/dark variant", () => {
    expect(trayIconFile("supervised", true, false)).toBe("trayTemplate-needsreview.png");
    expect(trayIconFile("supervised", true, true)).toBe("trayTemplate-needsreview-dark.png");
  });

  it("never badges automated or disabled, and not supervised without reviews", () => {
    expect(trayIconFile("automated", true, true)).toBe("trayTemplate-automated.png");
    expect(trayIconFile("disabled", true, true)).toBe("trayTemplate-disabled.png");
    expect(trayIconFile("supervised", false, true)).toBe("trayTemplate.png");
  });
});

describe("hasNeedsReview", () => {
  const F = { showDone: false, showDismissed: false, showClosed: false };
  it("is true iff some visible record is NEEDS_REVIEW", () => {
    expect(hasNeedsReview([], F)).toBe(false);
    expect(hasNeedsReview([rec({ state: "DONE" })], F)).toBe(false);
    expect(hasNeedsReview([rec({ state: "DONE" }), rec({ state: "NEEDS_REVIEW" })], F)).toBe(true);
  });
  it("a dismissed NEEDS_REVIEW does not light the dot while showDismissed is off", () => {
    expect(hasNeedsReview([rec({ state: "NEEDS_REVIEW", dismissed: true })], F)).toBe(false);
    expect(hasNeedsReview([rec({ state: "NEEDS_REVIEW", dismissed: true })], { ...F, showDismissed: true })).toBe(true);
  });
});
